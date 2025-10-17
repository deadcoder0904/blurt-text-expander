import type { Snippet } from './types'

export function countChars(text: string): number {
  return text?.length ?? 0
}

export function normalizeTrigger(trigger: string, prefix: string): string {
  const t = trigger.trim()
  if (!t) return ''
  if (t.startsWith(prefix)) return t
  return `${prefix}${t}`
}

export function detectOverlapWarnings(snippets: Snippet[]): string[] {
  const warnings: string[] = []
  const triggers = snippets.map((s) => s.trigger).sort((a, b) => a.localeCompare(b))
  for (let i = 0; i < triggers.length; i++) {
    for (let j = i + 1; j < triggers.length; j++) {
      const a = triggers[i]
      const b = triggers[j]
      if (b.startsWith(a)) {
        warnings.push(`Trigger overlap: "${a}" is a prefix of "${b}"`)
      }
    }
  }
  return warnings
}

function deepActiveElement(root: Document | ShadowRoot): Element | null {
  let a: Element | null = root.activeElement
  // Traverse into shadow DOMs
  // eslint-disable-next-line no-constant-condition
  while (a && (a as HTMLElement).shadowRoot && (a as HTMLElement).shadowRoot?.activeElement) {
    a = ((a as HTMLElement).shadowRoot?.activeElement as Element | null) ?? a
  }
  // Dive into iframes if same-origin (best effort)
  try {
    if (a instanceof HTMLIFrameElement && a.contentDocument) {
      return deepActiveElement(a.contentDocument)
    }
  } catch {}
  return a
}

function selectionForNode(node: Node): Selection | null {
  const root = node.getRootNode()
  if (root instanceof ShadowRoot) {
    const sr = root as unknown as { getSelection?: () => Selection | null }
    if (typeof sr.getSelection === 'function') {
      const sel = sr.getSelection()
      if (sel) return sel
    }
  }
  return document.getSelection()
}

export function getActiveEditable(): HTMLElement | null {
  const activeAny = deepActiveElement(document) as HTMLElement | null
  if (!activeAny) return null
  // Inputs and textareas (text-like)
  const isTextInput =
    activeAny instanceof HTMLInputElement &&
    (activeAny.type === 'text' ||
      activeAny.type === 'search' ||
      activeAny.type === 'email' ||
      activeAny.type === 'url' ||
      activeAny.type === 'tel')
  if (isTextInput || activeAny instanceof HTMLTextAreaElement) return activeAny
  // contentEditable or within one
  if (activeAny.isContentEditable) return activeAny
  const ce = activeAny.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"]')
  if (ce) return ce as HTMLElement
  return null
}

export function getWordBeforeCaret(
  element: HTMLElement
): { word: string; range: [number, number] } | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? 0
    const end = element.selectionEnd ?? start
    const text = element.value
    // Walk back to whitespace boundary
    let i = start - 1
    while (i >= 0 && !/\s/.test(text[i])) i--
    const wStart = i + 1
    const word = text.slice(wStart, end)
    return { word, range: [wStart, end] }
  }

  // contentEditable: use Range
  const sel = selectionForNode(element)
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.collapse(true)
  try {
    if (element.contains(range.startContainer)) preRange.setStart(element, 0)
    else preRange.setStart(range.startContainer, 0)
  } catch {
    preRange.setStart(range.startContainer, 0)
  }
  const textBefore = preRange.toString()
  // Find last whitespace boundary
  const match = textBefore.match(/(\S+)$/)
  if (!match) return { word: '', range: [textBefore.length, textBefore.length] }
  const word = match[1]
  const wStart = textBefore.length - word.length
  return { word, range: [wStart, textBefore.length] }
}

export function replaceRangeWithText(
  element: HTMLElement,
  start: number,
  end: number,
  replacement: string
) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.setRangeText(replacement, start, end, 'end')
    return
  }
  const sel = selectionForNode(element)
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  const toDelete = Math.max(0, end - start)
  // Best-effort: extend selection backwards by characters, then insert
  try {
    // Ensure caret at the end, then extend backwards
    sel.collapse(range.endContainer, range.endOffset)
    if (typeof sel.modify === 'function') {
      for (let i = 0; i < toDelete; i++) sel.modify('extend', 'backward', 'character')
      document.execCommand('insertText', false, replacement)
      return
    }
  } catch {}

  // Fallback: try to adjust range start within the current text node
  try {
    const r = range.cloneRange()
    r.collapse(false)
    const sc = r.startContainer
    const so = r.startOffset
    if (sc.nodeType === Node.TEXT_NODE) {
      const newStart = Math.max(0, so - toDelete)
      r.setStart(sc, newStart)
      sel.removeAllRanges()
      sel.addRange(r)
      document.execCommand('insertText', false, replacement)
      return
    }
  } catch {}

  // Last resort: delete and insert using Range APIs
  try {
    const r = range.cloneRange()
    r.collapse(false)
    // Walk backward through text nodes to cover `toDelete` characters
    let remaining = toDelete
    let node: Node | null = r.startContainer
    let offset = r.startOffset
    while (remaining > 0 && node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const take = Math.min(offset, remaining)
        offset -= take
        remaining -= take
        if (remaining === 0) {
          r.setStart(node, offset)
          break
        }
      }
      // Move to previous text node in the tree
      let prev: Node | null = node
      while (prev && !prev.previousSibling) prev = prev.parentNode
      prev = prev?.previousSibling || null
      while (prev?.lastChild) prev = prev.lastChild
      // Set defaults for next loop
      if (prev && prev.nodeType === Node.TEXT_NODE) {
        node = prev
        offset = (prev.textContent || '').length
      } else {
        node = prev
        offset = 0
      }
    }
    // Replace contents
    r.deleteContents()
    r.insertNode(document.createTextNode(replacement))
    // Place caret after inserted text
    sel.removeAllRanges()
    const after = r.cloneRange()
    after.setStartAfter(r.startContainer)
    after.collapse(true)
    sel.addRange(after)
    return
  } catch {}
}

// Compute an approximate caret rectangle in viewport coordinates for inputs/textarea/contentEditable.
// For contentEditable, prefer the native Range rect. For inputs and textareas, mirror the element
// to derive a client rect at the caret index.
export function getCaretClientRect(target: HTMLElement): DOMRect {
  // contentEditable: use Range rect when possible
  if (target.isContentEditable) {
    const sel = selectionForNode(target)
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      if (target.contains(range.endContainer)) {
        const r = range.cloneRange()
        r.collapse(false)
        const rects = r.getClientRects()
        const last = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect()
        if (last && (last.width || last.height)) return last as DOMRect
      }
    }
    return target.getBoundingClientRect()
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const input = target
    const selectionEnd = input.selectionEnd ?? 0
    const value = input.value ?? ''

    const rect = input.getBoundingClientRect()
    const style = window.getComputedStyle(input)

    // Create a mirror element positioned at the input's location
    const mirror = document.createElement('div')
    const isTextarea = input instanceof HTMLTextAreaElement
    const mirrorStyles: Partial<CSSStyleDeclaration> = {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      overflow: 'auto',
      whiteSpace: isTextarea ? 'pre-wrap' : 'pre',
      wordWrap: 'break-word',
      visibility: 'hidden',
      pointerEvents: 'none',
      zIndex: '-1',
    }
    // Copy critical text/layout styles that affect text metrics
    const propsToCopy = [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'letterSpacing',
      'textTransform',
      'textAlign',
      'lineHeight',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'borderTopWidth',
      'borderRightWidth',
      'borderBottomWidth',
      'borderLeftWidth',
      'boxSizing',
    ] as const
    for (const prop of propsToCopy) {
      mirrorStyles[prop] = style[prop]
    }

    Object.assign(mirror.style, mirrorStyles)

    // Build content up to caret, place a marker span
    const before = value.slice(0, selectionEnd)
    const afterMarker = document.createElement('span')
    afterMarker.textContent = '\u200b' // zero-width space as caret marker

    const content = document.createElement('div')
    content.textContent = before
    content.appendChild(afterMarker)

    mirror.appendChild(content)
    document.body.appendChild(mirror)

    // Sync scroll to account for internal scrolling in textarea
    try {
      mirror.scrollTop = input.scrollTop
      mirror.scrollLeft = input.scrollLeft
    } catch {}

    const markerRect = afterMarker.getBoundingClientRect()
    document.body.removeChild(mirror)

    // Fallback to input rect if measurement failed
    if (!markerRect || (!markerRect.width && !markerRect.height)) return rect
    return markerRect
  }

  // Fallback
  return target.getBoundingClientRect()
}

// Pure helper to compute the word before a caret in plain text (for testing)
export function getWordBeforeIndex(
  text: string,
  start: number,
  end: number
): { word: string; range: [number, number] } {
  const s = Math.max(0, Math.min(start, text.length))
  const e = Math.max(0, Math.min(end, text.length))
  let i = s - 1
  while (i >= 0 && !/\s/.test(text[i])) i--
  const wStart = i + 1
  const word = text.slice(wStart, e)
  return { word, range: [wStart, e] }
}

export async function loadStorage<T = unknown>(key: string, fallback: T): Promise<T> {
  try {
    const browser = (await import('webextension-polyfill')).default
    const local = await browser.storage.local.get(key)
    if (local && key in local) return local[key] as T
  } catch {}
  return fallback
}

export async function saveStorage<T = unknown>(key: string, value: T): Promise<void> {
  try {
    const browser = (await import('webextension-polyfill')).default
    await browser.storage.local.set({ [key]: value })
  } catch {}
}

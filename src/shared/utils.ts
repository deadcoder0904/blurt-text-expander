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

export function getActiveEditable(): HTMLElement | null {
  const active = (document.activeElement as HTMLElement | null) ?? null
  if (!active) return null
  const isInput =
    active instanceof HTMLInputElement &&
    (active.type === 'text' ||
      active.type === 'search' ||
      active.type === 'email' ||
      active.type === 'url' ||
      active.type === 'tel')
  if (isInput || active instanceof HTMLTextAreaElement) return active
  if (active.isContentEditable) return active
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
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const preRange = range.cloneRange()
  preRange.collapse(true)
  preRange.setStart(range.startContainer, 0)
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
  const sel = window.getSelection()
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

  // Last resort: insert, then try to remove the preceding token characters via separate ops
  document.execCommand('insertText', false, replacement)
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

import browser from 'webextension-polyfill'

import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants'
// keep local qs helper in this module for minimal diff
import { ICON_DELETE, ICON_DRAG_HANDLE, ICON_EDIT } from '../shared/icons'
import { IMPORT_FILENAME, isValidImportFilename } from '../shared/import'
import { canSaveSnippet, retargetTriggers } from '../shared/logic'
import {
  clearOpenTarget,
  getOpenTarget,
  getSettings,
  getSnippets,
  saveSnippets,
  subscribe,
  saveSettings as writeSettings,
} from '../shared/storage'
import type { Settings, Snippet } from '../shared/types'
import { countChars, detectOverlapWarnings, normalizeTrigger } from '../shared/utils'

function qs<T extends Element = Element>(sel: string): T {
  const el = document.querySelector(sel)
  if (!el) throw new Error(`Missing element: ${sel}`)
  return el as T
}

let currentId: string | null = null
let snippets: Snippet[] = []
let settings: Settings = { ...DEFAULT_SETTINGS }

function applyTheme(theme: Settings['theme']) {
  let t = theme
  if (t === 'system') {
    t = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  document.body.setAttribute('data-theme', t)
}

// Icons imported from shared/icons

function renderList() {
  const list = qs<HTMLDivElement>('#list')
  list.innerHTML = ''
  for (const s of snippets) {
    const row = document.createElement('div')
    row.className =
      'snippet-row flex items-center gap-3 justify-between p-3 cursor-grab border border-transparent'
    row.draggable = true
    row.dataset.id = s.id
    // Prevent layout shift when active by reserving right border space always
    Object.assign(row.style, {
      borderRight: '3px solid transparent',
      boxSizing: 'border-box',
    } as CSSStyleDeclaration)
    const isActive = s.id === currentId
    if (isActive) {
      Object.assign(row.style, {
        background: 'rgba(255,69,0,0.08)',
        borderRight: '3px solid #ff4500',
      } as CSSStyleDeclaration)
    }

    const handle = document.createElement('button')
    handle.type = 'button'
    handle.className =
      'drag-handle shrink-0 p-2 rounded text-(--color-muted) hover:text-(--color-accent) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)'
    handle.innerHTML = ICON_DRAG_HANDLE
    handle.title = 'Drag to reorder'
    handle.tabIndex = -1

    const left = document.createElement('div')
    left.className = 'min-w-0 flex-1'
    const trig = document.createElement('div')
    trig.className = 'font-mono text-[13px] truncate'
    trig.textContent = s.trigger
    const desc = document.createElement('div')
    desc.className = 'text-sm text-(--color-muted) truncate'
    desc.textContent = s.description ?? ''
    left.append(trig, desc)

    const actions = document.createElement('div')
    actions.className = 'flex items-center gap-2 shrink-0'
    const editBtn = document.createElement('button')
    editBtn.className =
      'p-2 rounded hover:bg-(--color-panel-2) text-(--color-muted) hover:text-(--color-accent)'
    editBtn.innerHTML = ICON_EDIT
    editBtn.title = 'Edit'
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      editSnippet(s.id)
    })
    const delBtn = document.createElement('button')
    delBtn.className =
      'p-2 rounded hover:bg-(--color-panel-2) text-(--color-muted) hover:text-(--color-accent)'
    delBtn.innerHTML = ICON_DELETE
    delBtn.title = 'Delete'
    delBtn.style.cursor = 'default'
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const deletedId = s.id
      snippets = snippets.filter((x) => x.id !== deletedId)
      await saveSnippets(snippets)
      // If the deleted snippet is currently open in the editor, clear or switch
      if (currentId === deletedId) {
        currentId = null
        if (snippets.length > 0) {
          // Prefer opening the first remaining snippet
          editSnippet(snippets[0].id)
        } else {
          clearEditor()
        }
      }
      renderList()
    })
    actions.append(editBtn, delBtn)
    row.append(handle, left, actions)
    // Clicking anywhere on the row (except delete) opens the editor
    row.addEventListener('click', () => editSnippet(s.id))
    list.appendChild(row)
  }
  attachDragHandlers(list)
  // Overlap warnings
  const warnings = detectOverlapWarnings(snippets)
  const warnEl = qs<HTMLDivElement>('#overlapWarning')
  const hasWarnings = warnings.length > 0
  warnEl.textContent = hasWarnings ? warnings.join(' • ') : ''
  warnEl.classList.toggle('hidden', !hasWarnings)
}

function getDragAfterElement(container: HTMLElement, mouseY: number) {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('.snippet-row:not(.is-dragging)'))
  return rows.reduce<{ offset: number; element: HTMLElement | null }>(
    (closest, child) => {
      const box = child.getBoundingClientRect()
      const offset = mouseY - box.top - box.height / 2
      if (offset < 0 && offset > closest.offset) return { offset, element: child }
      return closest
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element
}

async function persistOrderFromDom(container: HTMLElement, preferId?: string | null) {
  const orderedIds = Array.from(container.querySelectorAll<HTMLElement>('.snippet-row'))
    .map((el) => el.dataset.id)
    .filter(Boolean) as string[]
  const nextSnips = orderedIds
    .map((id) => snippets.find((s) => s.id === id))
    .filter(Boolean) as Snippet[]

  // Skip write if order is unchanged
  const unchanged =
    nextSnips.length === snippets.length && nextSnips.every((s, idx) => s.id === snippets[idx]?.id)
  if (!unchanged) {
    snippets = nextSnips
    await saveSnippets(snippets)
  }

  const activeId = preferId && snippets.some((s) => s.id === preferId) ? preferId : currentId
  if (activeId && snippets.some((s) => s.id === activeId)) {
    currentId = activeId
  } else if (snippets.length > 0) {
    currentId = snippets[0].id
  } else {
    currentId = null
  }

  renderList()
}

function attachDragHandlers(list: HTMLDivElement) {
  if (list.dataset.dragBound === 'true') return
  list.dataset.dragBound = 'true'

  list.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement | null)?.closest('.snippet-row') as HTMLElement | null
    if (!row) return
    row.classList.add('is-dragging')
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', row.dataset.id ?? '')
      e.dataTransfer.setDragImage(row, 0, 0)
      e.dataTransfer.effectAllowed = 'move'
    }
  })

  list.addEventListener('dragover', (e) => {
    e.preventDefault()
    const after = getDragAfterElement(list, e.clientY)
    const active = list.querySelector<HTMLElement>('.snippet-row.is-dragging')
    if (!active) return
    if (!after) list.appendChild(active)
    else list.insertBefore(active, after)
  })

  list.addEventListener('dragleave', () => {
    /* optional highlight cleanup */
  })

  list.addEventListener('drop', async (e) => {
    e.preventDefault()
    const active = list.querySelector<HTMLElement>('.snippet-row.is-dragging')
    const id = active?.dataset.id ?? null
    active?.classList.remove('is-dragging')
    await persistOrderFromDom(list, id)
  })

  list.addEventListener('dragend', async () => {
    const active = list.querySelector<HTMLElement>('.snippet-row.is-dragging')
    const id = active?.dataset.id ?? null
    active?.classList.remove('is-dragging')
    await persistOrderFromDom(list, id)
  })
}

function clearEditor() {
  currentId = null
  qs<HTMLInputElement>('#trigger').value = ''
  qs<HTMLInputElement>('#description').value = ''
  qs<HTMLTextAreaElement>('#body').value = ''
  updateCounter()
  updateSaveEnabled()
}

function editSnippet(id: string) {
  const s = snippets.find((x) => x.id === id)
  if (!s) return
  currentId = id
  qs<HTMLInputElement>('#trigger').value = s.trigger
  qs<HTMLInputElement>('#description').value = s.description ?? ''
  qs<HTMLTextAreaElement>('#body').value = s.body
  updateCounter()
  renderList()
  updateSaveEnabled()
}

function updateCounter() {
  const body = qs<HTMLTextAreaElement>('#body').value
  const chars = countChars(body)
  const limit = Number(qs<HTMLInputElement>('#charLimit').value)
  const c = qs<HTMLDivElement>('#counter')
  c.textContent = `${chars} / ${limit} characters`
  c.style.color = chars > limit ? 'var(--color-accent)' : ''
}

async function saveSnippet() {
  const trigInput = qs<HTMLInputElement>('#trigger')
  const descInput = qs<HTMLInputElement>('#description')
  const bodyInput = qs<HTMLTextAreaElement>('#body')
  const trigger = normalizeTrigger(trigInput.value, settings.triggerPrefix)
  const rawDesc = descInput.value.trim()
  const body = bodyInput.value
  if (!canSaveSnippet(trigger, settings.triggerPrefix, rawDesc, body)) return
  const description = rawDesc
  if (currentId) {
    snippets = snippets.map((s) => (s.id === currentId ? { ...s, trigger, description, body } : s))
  } else {
    const id = crypto.randomUUID()
    snippets = [{ id, trigger, description, body }, ...snippets]
    currentId = id
  }
  await saveSnippets(snippets)
  renderList()
  qs<HTMLDivElement>('#status').textContent = 'Saved'
  setTimeout(() => {
    qs<HTMLDivElement>('#status').textContent = ''
  }, 1500)
}

function updateSaveEnabled() {
  const saveBtn = qs<HTMLButtonElement>('#save')
  const trigInput = qs<HTMLInputElement>('#trigger')
  const descInput = qs<HTMLInputElement>('#description')
  const bodyInput = qs<HTMLTextAreaElement>('#body')
  const trigger = normalizeTrigger(trigInput.value, settings.triggerPrefix)
  const ok = canSaveSnippet(trigger, settings.triggerPrefix, descInput.value, bodyInput.value)
  saveBtn.disabled = !ok
}

async function persistSettings() {
  const enabled = qs<HTMLInputElement>('#enabled').checked
  const theme = qs<HTMLSelectElement>('#theme').value as Settings['theme']
  const newPrefix = qs<HTMLInputElement>('#prefix').value || '/'
  const allowVal = (document.querySelector('#allowlist') as HTMLTextAreaElement | null)?.value || ''
  const blockVal = (document.querySelector('#blocklist') as HTMLTextAreaElement | null)?.value || ''
  const charLimit = Number(qs<HTMLInputElement>('#charLimit').value)
  const autocompleteEnabled = qs<HTMLInputElement>('#autocomplete').checked
  const autoPosSel = document.querySelector('#autoPos') as HTMLSelectElement | null
  const autocompletePosition =
    (autoPosSel?.value as Settings['autocompletePosition']) ||
    settings.autocompletePosition ||
    'auto'
  const autoMaxInput = document.querySelector('#autoMax') as HTMLInputElement | null
  const autocompleteMaxItems = Math.min(
    20,
    Math.max(1, Number(autoMaxInput?.value || settings.autocompleteMaxItems || 8))
  )

  // If prefix changed, update all triggers to keep consistent
  if (settings.triggerPrefix !== newPrefix) {
    const old = settings.triggerPrefix
    snippets = retargetTriggers(snippets, old, newPrefix)
    await saveSnippets(snippets)
    renderList()
  }

  settings = {
    enabled,
    theme,
    triggerPrefix: newPrefix,
    expansionKey: settings.expansionKey || '',
    charLimit,
    autocompleteEnabled,
    autocompletePosition,
    autocompleteMaxItems,
    allowlist: allowVal
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean),
    blocklist: blockVal
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean),
  }
  await writeSettings(settings)
}

async function init() {
  snippets = await getSnippets()
  settings = await getSettings()
  // Apply settings
  qs<HTMLInputElement>('#enabled').checked = settings.enabled
  qs<HTMLSelectElement>('#theme').value = settings.theme
  applyTheme(settings.theme)
  qs<HTMLInputElement>('#prefix').value = settings.triggerPrefix
  const allowEl = document.querySelector('#allowlist') as HTMLTextAreaElement | null
  if (allowEl) allowEl.value = (settings.allowlist || []).join('\n')
  const blockEl = document.querySelector('#blocklist') as HTMLTextAreaElement | null
  if (blockEl) blockEl.value = (settings.blocklist || []).join('\n')
  const charLimitEl = document.querySelector('#charLimit') as HTMLInputElement | null
  if (charLimitEl) charLimitEl.value = String(settings.charLimit)
  const autoEl = document.querySelector('#autocomplete') as HTMLInputElement | null
  if (autoEl) autoEl.checked = settings.autocompleteEnabled
  const autoPos = document.querySelector('#autoPos') as HTMLSelectElement | null
  if (autoPos) autoPos.value = (settings.autocompletePosition || 'auto') as string
  const autoMax = document.querySelector('#autoMax') as HTMLInputElement | null
  if (autoMax) autoMax.value = String(settings.autocompleteMaxItems || 8)
  renderList()
  clearEditor()
  updateSaveEnabled()

  // Events
  qs<HTMLButtonElement>('#newSnippet').addEventListener('click', () => {
    clearEditor()
    currentId = null
    renderList()
    qs<HTMLInputElement>('#trigger').focus()
  })
  const saveBtn = qs<HTMLButtonElement>('#save')
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true
    const prev = saveBtn.textContent || 'Save'
    saveBtn.textContent = 'Saving…'
    await saveSnippet()
    saveBtn.textContent = 'Saved'
    setTimeout(() => {
      saveBtn.textContent = prev
      updateSaveEnabled()
    }, 3000)
  })
  qs<HTMLButtonElement>('#cancel').addEventListener('click', () => clearEditor())
  const trigEl = qs<HTMLInputElement>('#trigger')
  const descEl = qs<HTMLInputElement>('#description')
  const bodyEl = qs<HTMLTextAreaElement>('#body')
  trigEl.addEventListener('blur', () => persistSettings())
  descEl.addEventListener('blur', () => persistSettings())
  trigEl.addEventListener('input', updateSaveEnabled)
  descEl.addEventListener('input', updateSaveEnabled)
  bodyEl.addEventListener('input', () => {
    updateCounter()
    updateSaveEnabled()
  })

  qs<HTMLInputElement>('#enabled').addEventListener('change', persistSettings)
  qs<HTMLSelectElement>('#theme').addEventListener('change', () => {
    applyTheme(qs<HTMLSelectElement>('#theme').value as Settings['theme'])
    persistSettings()
  })
  qs<HTMLInputElement>('#prefix').addEventListener('change', persistSettings)
  const autoToggle = document.querySelector('#autocomplete') as HTMLInputElement | null
  autoToggle?.addEventListener('change', persistSettings)
  const posToggle = document.querySelector('#autoPos') as HTMLSelectElement | null
  posToggle?.addEventListener('change', persistSettings)
  const maxToggle = document.querySelector('#autoMax') as HTMLInputElement | null
  maxToggle?.addEventListener('change', persistSettings)
  // Expansion key input capture
  const keyInput = qs<HTMLInputElement>('#expansionKeyInput')
  const hint = qs<HTMLSpanElement>('#expansionKeyHint')

  function displayKey(k?: string) {
    if (!k) return ''
    if (k === ' ') return 'Space'
    return k
  }
  function storeKey(k: string) {
    // Store exact key value used by KeyboardEvent.key
    settings.expansionKey = k
    writeSettings(settings)
  }
  keyInput.value = displayKey(settings.expansionKey || '')
  hint.textContent = settings.expansionKey ? 'Custom key set' : 'Auto: Space/Enter when empty'

  let listening = false
  keyInput.addEventListener('focus', async () => {
    listening = true
    keyInput.placeholder = 'Press any key…'
    // Clear current key when focusing to enter auto mode until captured
    settings.expansionKey = ''
    await writeSettings(settings)
    keyInput.value = ''
    hint.textContent = 'Auto: Space/Enter when empty'
  })
  keyInput.addEventListener('blur', () => {
    listening = false
    keyInput.placeholder = 'Press a key…'
  })
  window.addEventListener(
    'keydown',
    (e) => {
      if (!listening) return
      // Allow Escape to cancel capture
      if (e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        const k = 'Tab'
        keyInput.value = displayKey(k)
        storeKey(k)
        hint.textContent = 'Custom key set'
        listening = false
        return
      }
      // Allow Escape to cancel capture
      if (e.key === 'Escape') {
        listening = false
        keyInput.blur()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      const k = e.key
      keyInput.value = displayKey(k)
      storeKey(k)
      hint.textContent = 'Custom key set'
    },
    true
  )
  const charInput = document.querySelector('#charLimit') as HTMLInputElement | null
  charInput?.addEventListener('input', () => {
    updateCounter()
    persistSettings()
  })

  // Modal open/close
  const modal = qs<HTMLDivElement>('#settingsModal')
  const backdrop = qs<HTMLDivElement>('#settingsBackdrop')
  const dialog = qs<HTMLDivElement>('#settingsDialog')
  const openGear = qs<HTMLButtonElement>('#openSettingsGear')
  const closeBtn = qs<HTMLButtonElement>('#settingsClose')
  const tabBtnGen = qs<HTMLButtonElement>('#tabBtnGeneral')
  const tabBtnAdv = qs<HTMLButtonElement>('#tabBtnAdvanced')
  const tabGen = qs<HTMLDivElement>('#tabGeneral')
  const tabAdv = qs<HTMLDivElement>('#tabAdvanced')
  let restoreFocusEl: HTMLElement | null = null

  function isVisible(el: HTMLElement): boolean {
    if (!el) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    // If element or its ancestors are hidden, offsetParent can be null (except for fixed)
    if (!el.offsetParent && style.position !== 'fixed') return false
    if (el.getClientRects().length === 0) return false
    return true
  }
  function focusables(): HTMLElement[] {
    const nodes = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    // Filter to visible, tabbable elements only
    const raw = Array.from(nodes).filter(isVisible)
    // Ensure custom tab order: after the last control (e.g., Export), focus the Close (X), then wrap.
    const withoutClose = raw.filter((el) => el !== closeBtn)
    return closeBtn && raw.includes(closeBtn) ? [...withoutClose, closeBtn] : withoutClose
  }
  function onTrapTab(e: KeyboardEvent) {
    if (modal.classList.contains('hidden')) return
    if (e.key !== 'Tab') return
    const list = focusables()
    if (!list.length) return
    const current = document.activeElement as HTMLElement | null
    const idx = current ? list.indexOf(current) : -1
    const last = list.length - 1
    // If focus is outside dialog, move to first/last depending on direction
    if (idx === -1) {
      e.preventDefault()
      ;(e.shiftKey ? list[last] : list[0]).focus()
      return
    }
    // Wrap at ends
    if (!e.shiftKey && idx === last) {
      e.preventDefault()
      list[0].focus()
      return
    }
    if (e.shiftKey && idx === 0) {
      e.preventDefault()
      list[last].focus()
      return
    }
    // Otherwise, move to next/prev within list
    e.preventDefault()
    list[idx + (e.shiftKey ? -1 : 1)].focus()
  }
  function openModal() {
    modal.classList.remove('hidden')
    restoreFocusEl = (document.activeElement as HTMLElement) || null
    window.addEventListener('keydown', onTrapTab, true)
  }
  function closeModal() {
    modal.classList.add('hidden')
    window.removeEventListener('keydown', onTrapTab, true)
    restoreFocusEl?.focus()
  }
  openGear.addEventListener('click', openModal)
  closeBtn.addEventListener('click', closeModal)
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target === backdrop) closeModal()
  })

  function setTab(which: 'general' | 'advanced') {
    const isGen = which === 'general'
    tabGen.classList.toggle('hidden', !isGen)
    tabAdv.classList.toggle('hidden', isGen)
    tabBtnGen.setAttribute('aria-selected', String(isGen))
    tabBtnAdv.setAttribute('aria-selected', String(!isGen))
    tabBtnGen.className = `px-3 py-1.5 rounded border-b-2 ${
      isGen
        ? 'border-(--color-accent) bg-(--color-panel-2)'
        : 'border-transparent hover:bg-(--color-panel-2)'
    }`
    tabBtnAdv.className = `px-3 py-1.5 rounded border-b-2 ${
      !isGen
        ? 'border-(--color-accent) bg-(--color-panel-2)'
        : 'border-transparent hover:bg-(--color-panel-2)'
    }`
  }
  tabBtnGen.addEventListener('click', () => setTab('general'))
  tabBtnAdv.addEventListener('click', () => setTab('advanced'))

  // Close preferences with Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      e.preventDefault()
      closeModal()
    }
  })

  // Open requested snippet from popup, else first
  const openTarget = await getOpenTarget()
  if (openTarget && snippets.find((s) => s.id === openTarget)) {
    editSnippet(openTarget)
    await clearOpenTarget()
  } else if (snippets.length > 0) {
    editSnippet(snippets[0].id)
  }

  // Import/Export
  const importBtn = qs<HTMLButtonElement>('#importBtn')
  const exportBtn = qs<HTMLButtonElement>('#exportBtn')
  const fileInput = qs<HTMLInputElement>('#fileInput')
  importBtn.addEventListener('click', () => {
    // Reset value so selecting the same file twice triggers change
    fileInput.value = ''
    fileInput.click()
  })
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    // Enforce filename restriction
    if (!isValidImportFilename(file.name)) {
      alert(`Warning: Import file must be named exactly "${IMPORT_FILENAME}"`)
      fileInput.value = ''
      return
    }
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      if (
        !confirm(
          'Import will add new snippets, update existing by trigger, and overwrite provided settings keys. Continue?'
        )
      ) {
        qs<HTMLDivElement>('#status').textContent = 'Import cancelled'
        setTimeout(() => {
          qs<HTMLDivElement>('#status').textContent = ''
        }, 1500)
        return
      }
      type ImportResult = { added?: number; updated?: number }
      const res = (await browser.runtime.sendMessage({
        type: 'IMPORT_JSON',
        payload: json,
      })) as ImportResult
      const a = res?.added ?? 0
      const u = res?.updated ?? 0
      qs<HTMLDivElement>('#status').textContent = `Imported (added ${a}, updated ${u})`
      // Refresh local view
      const freshSnips = await getSnippets()
      const freshSettings = await getSettings()
      snippets = freshSnips
      settings = freshSettings
      renderList()
      setTimeout(() => {
        qs<HTMLDivElement>('#status').textContent = ''
      }, 1500)
    } catch {
      qs<HTMLDivElement>('#status').textContent = 'Invalid JSON'
      setTimeout(() => {
        qs<HTMLDivElement>('#status').textContent = ''
      }, 1500)
    }
    // Allow importing the same file again without requiring a different selection
    fileInput.value = ''
  })
  exportBtn.addEventListener('click', async () => {
    const data = await browser.runtime.sendMessage({ type: 'EXPORT_JSON' })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = IMPORT_FILENAME
    a.click()
    URL.revokeObjectURL(url)
  })

  // React to storage changes
  subscribe((changes, area) => {
    if (area !== 'sync' && area !== 'local') return
    if (changes[STORAGE_KEYS.snippets]) {
      snippets = changes[STORAGE_KEYS.snippets].newValue as Snippet[]
      renderList()
      // Keep editor in sync if the current snippet was deleted elsewhere (e.g., from popup)
      if (currentId && !snippets.some((x) => x.id === currentId)) {
        currentId = null
        if (snippets.length > 0) editSnippet(snippets[0].id)
        else clearEditor()
      }
    }
    if (changes[STORAGE_KEYS.settings]) {
      settings = { ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) }
    }
    if (changes[STORAGE_KEYS.openTarget]?.newValue) {
      const target = changes[STORAGE_KEYS.openTarget].newValue as string
      const found = snippets.find((s) => s.id === target)
      if (found) editSnippet(found.id)
      // Best-effort cleanup
      clearOpenTarget()
    }
  })
}

document.addEventListener('DOMContentLoaded', init)

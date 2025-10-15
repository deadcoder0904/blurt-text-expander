import browser from 'webextension-polyfill'

import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants'
// keep local qs helper in this module for minimal diff
import { ICON_DELETE, ICON_EDIT } from '../shared/icons'
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
    row.className = 'flex items-center justify-between gap-3 p-3'
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
    const left = document.createElement('div')
    left.className = 'min-w-0'
    const trig = document.createElement('div')
    trig.className = 'font-mono text-[13px] truncate'
    trig.textContent = s.trigger
    const desc = document.createElement('div')
    desc.className = 'text-sm text-(--color-muted) truncate'
    desc.textContent = s.description ?? ''
    left.append(trig, desc)
    left.addEventListener('click', () => editSnippet(s.id))
    const actions = document.createElement('div')
    actions.className = 'flex items-center gap-2'
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
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      snippets = snippets.filter((x) => x.id !== s.id)
      await saveSnippets(snippets)
      renderList()
    })
    actions.append(editBtn, delBtn)
    row.append(left, actions)
    list.appendChild(row)
  }
  // Overlap warnings
  const warnings = detectOverlapWarnings(snippets)
  const warnEl = qs<HTMLDivElement>('#overlapWarning')
  warnEl.textContent = warnings.length ? warnings.join(' • ') : ''
}

function clearEditor() {
  currentId = null
  qs<HTMLInputElement>('#trigger').value = ''
  qs<HTMLInputElement>('#description').value = ''
  qs<HTMLTextAreaElement>('#body').value = ''
  updateCounter()
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
  const description = descInput.value.trim() || undefined
  const body = bodyInput.value
  if (!trigger || !body) return
  if (currentId) {
    snippets = snippets.map((s) => (s.id === currentId ? { ...s, trigger, description, body } : s))
  } else {
    snippets = [{ id: crypto.randomUUID(), trigger, description, body }, ...snippets]
  }
  await saveSnippets(snippets)
  renderList()
  qs<HTMLDivElement>('#status').textContent = 'Saved'
  setTimeout(() => {
    qs<HTMLDivElement>('#status').textContent = ''
  }, 1500)
}

async function persistSettings() {
  const enabled = qs<HTMLInputElement>('#enabled').checked
  const theme = qs<HTMLSelectElement>('#theme').value as Settings['theme']
  const newPrefix = qs<HTMLInputElement>('#prefix').value || '/'
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
    snippets = snippets.map((s) => {
      let next = s.trigger
      if (next.startsWith(old)) next = newPrefix + next.slice(old.length)
      else next = normalizeTrigger(next, newPrefix)
      return { ...s, trigger: next }
    })
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

  // Events
  qs<HTMLButtonElement>('#newSnippet').addEventListener('click', () => {
    clearEditor()
    currentId = null
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
      saveBtn.disabled = false
    }, 3000)
  })
  qs<HTMLButtonElement>('#cancel').addEventListener('click', () => clearEditor())
  qs<HTMLInputElement>('#trigger').addEventListener('blur', () => persistSettings())
  qs<HTMLInputElement>('#description').addEventListener('blur', () => persistSettings())
  qs<HTMLTextAreaElement>('#body').addEventListener('input', updateCounter)

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
  let restoreFocusEl: HTMLElement | null = null

  function focusables(): HTMLElement[] {
    const nodes = dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    return Array.from(nodes)
  }
  function focusFirst() {
    const list = focusables()
    ;(list[0] ?? closeBtn).focus()
  }
  function onTrapTab(e: KeyboardEvent) {
    if (modal.classList.contains('hidden')) return
    if (e.key !== 'Tab') return
    const list = focusables()
    if (!list.length) return
    const current = document.activeElement as HTMLElement | null
    const idx = Math.max(0, list.indexOf(current as HTMLElement))
    const delta = e.shiftKey ? -1 : 1
    const nextIndex = (idx + delta + list.length) % list.length
    e.preventDefault()
    list[nextIndex].focus()
  }
  function openModal() {
    modal.classList.remove('hidden')
    restoreFocusEl = (document.activeElement as HTMLElement) || null
    setTimeout(focusFirst)
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
  importBtn.addEventListener('click', () => fileInput.click())
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    if (!file) return
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
      const res = await browser.runtime.sendMessage({ type: 'IMPORT_JSON', payload: json })
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
  })
  exportBtn.addEventListener('click', async () => {
    const data = await browser.runtime.sendMessage({ type: 'EXPORT_JSON' })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'blurt-snippets.json'
    a.click()
    URL.revokeObjectURL(url)
  })

  // React to storage changes
  subscribe((changes, area) => {
    if (area !== 'sync' && area !== 'local') return
    if (changes[STORAGE_KEYS.snippets]) {
      snippets = changes[STORAGE_KEYS.snippets].newValue as Snippet[]
      renderList()
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

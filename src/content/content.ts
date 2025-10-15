import browser from 'webextension-polyfill'

import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants'
import {
  getSettings as loadSettingsLocal,
  getSnippets as loadSnippetsLocal,
} from '../shared/storage'
import type { Settings, Snippet } from '../shared/types'
import { getActiveEditable, getWordBeforeCaret, replaceRangeWithText } from '../shared/utils'

let settings: Settings = { ...DEFAULT_SETTINGS }
let snippets: Snippet[] = []
let suggestEl: HTMLDivElement | null = null
let suggestIndex = 0
let suggestItems: Snippet[] = []
let repositionTimer: number | null = null

function themeMode(): 'light' | 'dark' {
  if (settings.theme === 'light') return 'light'
  if (settings.theme === 'dark') return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

async function hydrate() {
  settings = await loadSettingsLocal()
  snippets = await loadSnippetsLocal()
}

function matchTrigger(word: string): Snippet | null {
  const w = word.trim()
  if (!w) return null
  // Require prefix
  if (!w.startsWith(settings.triggerPrefix)) return null
  // Exact match by trigger
  // Prefer longest trigger first to avoid overshadowing
  const sorted = [...snippets].sort((a, b) => b.trigger.length - a.trigger.length)
  return sorted.find((s) => s.trigger === w) ?? null
}

function shouldAutoExpandOnKey(evt: KeyboardEvent): boolean {
  if (!settings.enabled) return false
  if (!settings.expansionKey) {
    // Auto-expand on Space/Enter word boundaries
    return evt.key === ' ' || evt.key === 'Enter'
  }
  return evt.key === settings.expansionKey
}

function onKeydown(evt: KeyboardEvent) {
  const target = getActiveEditable()
  if (!target) return
  // Handle suggestion navigation if open
  if (suggestEl) {
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      evt.preventDefault()
      const delta = evt.key === 'ArrowDown' ? 1 : -1
      suggestIndex = (suggestIndex + delta + suggestItems.length) % suggestItems.length
      renderSuggest()
      return
    }
    if (evt.key === 'Enter' || evt.key === 'Tab') {
      evt.preventDefault()
      applySuggestion(target)
      return
    }
    if (evt.key === 'Escape') {
      hideSuggest()
      return
    }
  }
  if (!shouldAutoExpandOnKey(evt)) return

  // Find current token
  const info = getWordBeforeCaret(target)
  if (!info) return
  const { word, range } = info
  const match = matchTrigger(word)
  if (!match) return

  // Perform replacement — do not force focus or extra characters
  evt.preventDefault()
  replaceRangeWithText(target, range[0], range[1], match.body)
}

function desiredPlacement(target: HTMLElement, el: HTMLElement): 'top' | 'bottom' {
  const pref = (settings.autocompletePosition || 'auto') as 'auto' | 'top' | 'bottom'
  if (pref === 'top' || pref === 'bottom') return pref
  // auto: flip to top if not enough space below
  const rect = target.getBoundingClientRect()
  const estimated = Math.min(240, el.clientHeight || 240)
  const spaceBelow = window.innerHeight - rect.bottom
  return spaceBelow < estimated + 8 ? 'top' : 'bottom'
}

function positionSuggest(target: HTMLElement) {
  if (!suggestEl) return
  const rect = target.getBoundingClientRect()
  const place = desiredPlacement(target, suggestEl)
  const top =
    place === 'bottom'
      ? rect.bottom + window.scrollY
      : rect.top + window.scrollY - suggestEl.offsetHeight
  suggestEl.style.top = `${Math.max(0, top)}px`
  suggestEl.style.left = `${rect.left + window.scrollX}px`
}

function renderSuggest() {
  if (!suggestEl) return
  suggestEl.innerHTML = ''
  const mode = themeMode()
  const rowSelectedBg = mode === 'light' ? 'rgba(255,69,0,0.12)' : 'rgba(255,69,0,0.15)'
  const rowText = mode === 'light' ? '#111827' : '#e5e7eb'
  const rowTextSelected = mode === 'light' ? '#111827' : '#ffffff'
  suggestItems.forEach((s, i) => {
    const row = document.createElement('div')
    row.textContent = `${s.trigger} — ${s.description ?? ''}`
    Object.assign(row.style, {
      padding: '8px 12px',
      cursor: 'pointer',
      background: i === suggestIndex ? rowSelectedBg : 'transparent',
      borderLeft: i === suggestIndex ? '3px solid #ff4500' : '3px solid transparent',
      color: i === suggestIndex ? rowTextSelected : rowText,
      whiteSpace: 'nowrap',
      fontSize: '13px',
    } as CSSStyleDeclaration)
    row.addEventListener('mouseenter', () => {
      suggestIndex = i
      renderSuggest()
    })
    row.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const target = getActiveEditable()
      if (target) applySuggestion(target)
    })
    suggestEl?.appendChild(row)
  })
}

function showSuggest(target: HTMLElement, list: Snippet[]) {
  hideSuggest()
  const limit = Math.max(1, Number(settings.autocompleteMaxItems || 8))
  suggestItems = list.slice(0, limit)
  if (!suggestItems.length) return
  suggestIndex = 0
  suggestEl = document.createElement('div')
  const mode = themeMode()
  const panelBg = mode === 'light' ? '#ffffff' : '#0b0b0c'
  const panelText = mode === 'light' ? '#111827' : '#e5e7eb'
  const panelBorder = mode === 'light' ? '#e5e7eb' : '#2b2d31'
  Object.assign(suggestEl.style, {
    position: 'absolute',
    zIndex: '2147483647',
    background: panelBg,
    color: panelText,
    border: `1px solid ${panelBorder}`,
    borderRadius: '8px',
    padding: '6px 0',
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
    maxHeight: `${Math.max(120, 30 * limit)}px`,
    overflowY: 'auto',
    minWidth: '240px',
    fontFamily: 'ui-sans-serif,system-ui,Segoe UI,Roboto,Inter,sans-serif',
    fontSize: '12px',
  } as CSSStyleDeclaration)
  renderSuggest()
  document.body.appendChild(suggestEl)
  // After mount, we can measure exact height for top placement
  positionSuggest(target)
}

function hideSuggest() {
  if (suggestEl?.parentNode) suggestEl.parentNode.removeChild(suggestEl)
  suggestEl = null
  suggestItems = []
  suggestIndex = 0
}

function applySuggestion(target: HTMLElement) {
  if (!suggestItems.length) return
  const chosen = suggestItems[suggestIndex]
  const info = getWordBeforeCaret(target)
  if (!info) return
  replaceRangeWithText(target, info.range[0], info.range[1], chosen.body)
  hideSuggest()
}

function currentToken(): string {
  const el = getActiveEditable()
  if (!el) return ''
  const info = getWordBeforeCaret(el)
  return info?.word ?? ''
}

function onInput() {
  if (!suggestEl) return
  const token = currentToken()
  const q = token.trim()
  if (!q || !q.startsWith(settings.triggerPrefix)) {
    hideSuggest()
    return
  }
  const term = q.toLowerCase()
  const list = snippets.filter((s) => s.trigger.toLowerCase().startsWith(term))
  if (!list.length) hideSuggest()
  else {
    const limit = Math.max(1, Number(settings.autocompleteMaxItems || 8))
    suggestItems = list.slice(0, limit)
    suggestIndex = 0
    renderSuggest()
    const el = getActiveEditable()
    if (el) {
      if (repositionTimer) window.clearTimeout(repositionTimer)
      repositionTimer = window.setTimeout(() => positionSuggest(el), 60)
    }
  }
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' && area !== 'sync') return
  if (changes[STORAGE_KEYS.settings]?.newValue) {
    settings = { ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEYS.settings].newValue as Settings) }
  }
  if (changes[STORAGE_KEYS.snippets]?.newValue) {
    snippets = changes[STORAGE_KEYS.snippets].newValue as Snippet[]
  }
})

async function init() {
  await hydrate()
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('input', onInput, true)
  window.addEventListener('blur', () => hideSuggest(), true)
  window.addEventListener('resize', () => {
    const target = getActiveEditable()
    if (target && suggestEl) positionSuggest(target)
  })
  // When trigger prefix is pressed, show suggestion list
  window.addEventListener(
    'keypress',
    (e) => {
      if (!settings.enabled || !settings.autocompleteEnabled) return
      if (e.key === settings.triggerPrefix) {
        const target = getActiveEditable()
        if (!target) return
        showSuggest(target, snippets)
      }
    },
    true
  )
}

init()

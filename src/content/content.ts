import browser from 'webextension-polyfill'

import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants'
import {
  autocompleteSuggestions,
  computeNextFocusIndex,
  isAutocompleteEnabledOnSite,
  isSiteEnabledForSettings,
  matchTriggerWithAliases,
} from '../shared/logic'
import { swallowEvent } from '../shared/events'
import {
  getSettings as loadSettingsLocal,
  getSnippets as loadSnippetsLocal,
} from '../shared/storage'
import type { Settings, Snippet } from '../shared/types'
import {
  getActiveEditable,
  getCaretClientRect,
  getWordBeforeCaret,
  replaceRangeWithText,
  ensureTrailingSpace,
} from '../shared/utils'
import { applyWheelToScrollTop, type WheelDeltaMode } from '../shared/scroll'

let settings: Settings = { ...DEFAULT_SETTINGS }
let snippets: Snippet[] = []
let suggestEl: HTMLDivElement | null = null
let suggestIndex = 0
let suggestItems: Snippet[] = []
let repositionTimer: number | null = null
let siteActive = true

const BLURT_EVENT_GUARD = Symbol('blurtEventGuard')

function themeMode(): 'light' | 'dark' {
  if (settings.theme === 'light') return 'light'
  if (settings.theme === 'dark') return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

async function hydrate() {
  settings = await loadSettingsLocal()
  snippets = await loadSnippetsLocal()
  siteActive = isSiteEnabledForSettings(location.hostname, settings)
}

function matchTrigger(word: string): Snippet | null {
  return matchTriggerWithAliases(word, snippets, settings.triggerPrefix)
}

function shouldAutoExpandOnKey(evt: KeyboardEvent): boolean {
  if (!settings.enabled) return false
  if (!settings.expansionKey) {
    // Auto-expand on Space/Enter word boundaries
    return evt.key === ' ' || evt.key === 'Enter'
  }
  return evt.key === settings.expansionKey
}

function wheelDeltaMode(value: number): WheelDeltaMode {
  if (value === 1 || value === 2) return value
  return 0
}

function onWheel(evt: WheelEvent) {
  if (!suggestEl) return
  // Allow browser zoom gestures.
  if (evt.ctrlKey || evt.metaKey) return
  // Trap scrolling to the suggestions list so the underlying page doesn't scroll.
  evt.preventDefault()
  suggestEl.scrollTop = applyWheelToScrollTop(
    suggestEl.scrollTop,
    suggestEl.clientHeight,
    suggestEl.scrollHeight,
    evt.deltaY,
    wheelDeltaMode(evt.deltaMode)
  )
}

function onKeydown(evt: KeyboardEvent) {
  if ((evt as any)[BLURT_EVENT_GUARD]) return
  ;(evt as any)[BLURT_EVENT_GUARD] = true
  if (!siteActive) return
  // Avoid interfering with IME composition
  if (evt.isComposing || evt.key === 'Process') return
  const target = getActiveEditable()
  if (!target) return
  // Handle suggestion navigation if open
  if (suggestEl) {
    // If user presses Space while suggestions are visible, close them
    if (evt.key === ' ') {
      hideSuggest()
      // Do not prevent default; allow the space to be inserted
      // Continue handling below only if expansion is explicitly requested
    }
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      swallowEvent(evt)
      suggestIndex = computeNextFocusIndex(suggestIndex, suggestItems.length, evt.key === 'ArrowUp')
      renderSuggest()
      return
    }
    if (evt.key === 'Enter' || evt.key === 'Tab') {
      swallowEvent(evt)
      applySuggestion(target)
      return
    }
    if (evt.key === 'Escape') {
      swallowEvent(evt)
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
  replaceRangeWithText(target, range[0], range[1], ensureTrailingSpace(match.body))
}

function desiredPlacement(target: HTMLElement, el: HTMLElement): 'top' | 'bottom' {
  const pref = (settings.autocompletePosition || 'auto') as 'auto' | 'top' | 'bottom'
  if (pref === 'top' || pref === 'bottom') return pref
  // auto: flip to top if not enough space below
  const rect = getCaretClientRect(target)
  const estimated = Math.min(240, el.clientHeight || 240)
  const spaceBelow = window.innerHeight - rect.bottom
  return spaceBelow < estimated + 8 ? 'top' : 'bottom'
}

function positionSuggest(target: HTMLElement) {
  if (!suggestEl) return
  const rect = getCaretClientRect(target)
  const place = desiredPlacement(target, suggestEl)
  let top = place === 'bottom' ? rect.bottom : rect.top - suggestEl.offsetHeight
  let left = rect.left
  // Clamp within viewport bounds (fixed positioning)
  const maxTop = window.innerHeight - (suggestEl.offsetHeight || 240) - 8
  const minTop = 0
  top = Math.max(minTop, Math.min(maxTop, top))
  const maxLeft = window.innerWidth - (suggestEl.offsetWidth || 240) - 8
  left = Math.max(0, Math.min(maxLeft, left))
  suggestEl.style.top = `${top}px`
  suggestEl.style.left = `${left}px`
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
    row.addEventListener('mousemove', () => {
      if (suggestIndex === i) return
      suggestIndex = i
      renderSuggest()
    })
    row.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const target = getActiveEditable()
      if (target) applySuggestion(target)
    })
    suggestEl?.appendChild(row)
    if (i === suggestIndex) {
      row.scrollIntoView?.({ block: 'nearest' })
    }
  })
}

function showSuggest(target: HTMLElement, list: Snippet[]) {
  hideSuggest()
  const limit = Math.max(1, Number(settings.autocompleteMaxItems || 8))
  suggestItems = list
  if (!suggestItems.length) return
  suggestIndex = 0
  suggestEl = document.createElement('div')
  suggestEl.dataset.blurtSuggest = 'true'
  const mode = themeMode()
  const panelBg = mode === 'light' ? '#ffffff' : '#0b0b0c'
  const panelText = mode === 'light' ? '#111827' : '#e5e7eb'
  const panelBorder = mode === 'light' ? '#e5e7eb' : '#2b2d31'
  Object.assign(suggestEl.style, {
    position: 'fixed',
    zIndex: '2147483647',
    background: panelBg,
    color: panelText,
    border: `1px solid ${panelBorder}`,
    borderRadius: '8px',
    padding: '6px 0',
    boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
    maxHeight: `${Math.max(120, 30 * limit)}px`,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
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
  replaceRangeWithText(target, info.range[0], info.range[1], ensureTrailingSpace(chosen.body))
  hideSuggest()
}

function currentToken(): string {
  const el = getActiveEditable()
  if (!el) return ''
  const info = getWordBeforeCaret(el)
  return info?.word ?? ''
}

function onInput(evt: Event) {
  if ((evt as any)[BLURT_EVENT_GUARD]) return
  ;(evt as any)[BLURT_EVENT_GUARD] = true
  if (!siteActive) return
  if (!suggestEl) return
  const token = currentToken()
  const q = token.trim()
  if (!q || !q.startsWith(settings.triggerPrefix)) {
    hideSuggest()
    return
  }
  const list = autocompleteSuggestions(q, snippets, settings.triggerPrefix)
  if (!list.length) hideSuggest()
  else {
    suggestItems = list
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
    siteActive = isSiteEnabledForSettings(location.hostname, settings)
    if (!siteActive) hideSuggest()
  }
  if (changes[STORAGE_KEYS.snippets]?.newValue) {
    snippets = changes[STORAGE_KEYS.snippets].newValue as Snippet[]
    // If suggestions are visible, refresh them to reflect updated snippets
    if (suggestEl) {
      const token = currentToken()
      const q = token.trim()
      if (!q || !q.startsWith(settings.triggerPrefix)) {
        hideSuggest()
      } else {
        const list = autocompleteSuggestions(q, snippets, settings.triggerPrefix)
        if (!list.length) hideSuggest()
        else {
          suggestItems = list
          suggestIndex = 0
          renderSuggest()
          const el = getActiveEditable()
          if (el) positionSuggest(el)
        }
      }
    }
  }
})

async function init() {
  window.addEventListener('keydown', onKeydown, true)
  window.addEventListener('input', onInput, true)
  window.addEventListener('wheel', onWheel, { capture: true, passive: false })
  window.addEventListener('blur', () => hideSuggest(), true)
  window.addEventListener('resize', () => {
    const target = getActiveEditable()
    if (target && suggestEl) positionSuggest(target)
  })
  window.addEventListener(
    'scroll',
    () => {
      const target = getActiveEditable()
      if (target && suggestEl) positionSuggest(target)
    },
    true
  )
  // When trigger prefix is pressed, show suggestion list (use keydown for better cross-site consistency)
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isAutocompleteEnabledOnSite(location.hostname, settings)) return
      const ke = e as KeyboardEvent
      if (ke.isComposing || ke.key === 'Process') return
      if (ke.key === settings.triggerPrefix) {
        const target = getActiveEditable()
        if (!target) {
          // Debug: log when no editable target is found
          console.debug('[Blurt] No editable target found for slash command')
          return
        }
        
        // Ensure the target is still valid and has focus
        try {
          if (document.activeElement !== target && !target.contains(document.activeElement)) {
            console.debug('[Blurt] Target lost focus, re-checking active element')
            const newTarget = getActiveEditable()
            if (newTarget) {
              showSuggest(newTarget, snippets)
            }
            return
          }
          showSuggest(target, snippets)
        } catch (error) {
          console.error('[Blurt] Error showing suggestions:', error)
        }
      }
    },
    true
  )

  await hydrate()
}

void init()

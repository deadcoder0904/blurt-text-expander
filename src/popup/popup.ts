import { create, insertMultiple, search as oramaSearch } from '@orama/orama'
import browser from 'webextension-polyfill'

import { STORAGE_KEYS } from '../shared/constants'
import { iconButton, qs } from '../shared/dom'
import { ICON_DELETE, ICON_EDIT } from '../shared/icons'
import { dedupeById } from '../shared/list'
import { aliasesForTrigger, shouldShowAllForQuery } from '../shared/logic'
import { getSettings, getSnippets, saveSettings } from '../shared/storage'
import type { Snippet } from '../shared/types'

function renderResultRow(snippet: Snippet): HTMLElement {
  const row = document.createElement('div')
  row.className = 'flex items-center justify-between gap-3 py-3 cursor-pointer'
  const left = document.createElement('div')
  left.className = 'min-w-0'
  const trig = document.createElement('div')
  trig.className = 'font-mono text-[12px] text-(--color-text) truncate'
  trig.textContent = snippet.trigger
  const desc = document.createElement('div')
  desc.className = 'text-xs text-(--color-muted) truncate'
  desc.textContent = snippet.description ?? ''
  left.append(trig, desc)
  const right = document.createElement('div')
  right.className = 'flex items-center gap-2'
  const edit = iconButton(ICON_EDIT, 'Edit in Settings')
  async function openForEdit() {
    await browser.runtime.sendMessage({ type: 'OPEN_OPTIONS', snippetId: snippet.id })
  }
  edit.addEventListener('click', (e) => {
    e.stopPropagation()
    void openForEdit()
  })
  row.addEventListener('click', openForEdit)
  const del = iconButton(ICON_DELETE, 'Delete')
  // Do not trigger row click when deleting
  del.style.cursor = 'default'
  del.addEventListener('click', async (e) => {
    e.stopPropagation()
    const store = await browser.storage.local.get(STORAGE_KEYS.snippets)
    const list = (store[STORAGE_KEYS.snippets] as Snippet[]) || []
    const next = list.filter((s) => s.id !== snippet.id)
    await browser.storage.local.set({ [STORAGE_KEYS.snippets]: next })
    await loadAndRender()
  })
  right.append(edit, del)
  row.append(left, right)
  return row
}

let db: unknown
let currentPrefix = '/'
let indexedHash = ''
let lastRenderedQuery = ''
let lastRenderedIds: string[] = []
let debounceTimer: number | null = null

function snippetsHash(list: Snippet[]): string {
  return dedupeById(list)
    .map((s) => `${s.id}:${s.trigger}`)
    .join('|')
}

async function buildIndex(list: Snippet[]) {
  const local = await create({
    schema: {
      trigger: 'string',
      description: 'string',
      id: 'string',
      keywords: 'string',
    },
  })
  const docs = dedupeById(list).map((s) => ({
    id: s.id,
    trigger: s.trigger,
    description: s.description ?? '',
    keywords: `${s.trigger} ${s.description ?? ''} ${aliasesForTrigger(s.trigger, '/')
      .filter(Boolean)
      .join(' ')}`,
  }))
  const insert = insertMultiple as unknown as (d: unknown, docs: unknown) => Promise<void>
  await insert(local, docs)
  db = local
  indexedHash = snippetsHash(list)
}

async function ensureIndex(list: Snippet[]) {
  const h = snippetsHash(list)
  if (!db || h !== indexedHash) {
    await buildIndex(list)
  }
}

async function loadAndRender(query = '') {
  const results = qs<HTMLDivElement>('#results')
  let snippets = await getSnippets()
  // If duplicates exist (e.g., from previous versions), clean them for a stable UI/search
  const uniqueSnips = dedupeById(snippets)
  if (uniqueSnips.length !== snippets.length) {
    await browser.storage.local.set({ [STORAGE_KEYS.snippets]: uniqueSnips })
    snippets = uniqueSnips
  }
  await ensureIndex(snippets)
  let final: Snippet[] = snippets
  if (query.trim() && !shouldShowAllForQuery(query, currentPrefix)) {
    const out = (await (oramaSearch as unknown as (d: unknown, opts: unknown) => unknown)(db, {
      term: query,
      properties: ['trigger', 'description', 'keywords'] as unknown as string[],
      tolerance: 1,
    })) as unknown as { hits: Array<{ document: { id: string } }> }
    const ids = new Set(out.hits.map((h) => h.document.id))
    final = snippets.filter((s) => ids.has(s.id))
  }
  const finalIds = final.map((s) => s.id)
  if (
    lastRenderedQuery === query &&
    finalIds.length === lastRenderedIds.length &&
    finalIds.every((v, i) => v === lastRenderedIds[i])
  ) {
    return
  }
  results.innerHTML = ''
  const frag = document.createDocumentFragment()
  for (const snip of final) frag.appendChild(renderResultRow(snip))
  results.appendChild(frag)
  lastRenderedQuery = query
  lastRenderedIds = finalIds
}

async function init() {
  const enabledInput = qs<HTMLInputElement>('#enabled')
  const search = qs<HTMLInputElement>('#search')
  const openSettings = qs<HTMLButtonElement>('#openSettings')
  const blockToggle = qs<HTMLButtonElement>('#blockToggle')

  const settings = await getSettings()
  enabledInput.checked = settings.enabled
  currentPrefix = settings.triggerPrefix
  enabledInput.addEventListener('change', async () => {
    const next = { ...settings, enabled: enabledInput.checked }
    await saveSettings(next)
  })

  search.addEventListener('input', () => {
    if (debounceTimer) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      void loadAndRender(search.value)
    }, 120)
  })
  openSettings.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
  })

  // Helpers for block toggle
  const normalize = (h: string) => (h || '').toLowerCase().replace(/^www\./, '')
  let currentHost = ''
  let normalizedHost = ''
  async function refreshBlockUI() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true })
      const url = tabs?.[0]?.url || ''
      currentHost = url ? new URL(url).hostname : ''
      normalizedHost = normalize(currentHost)
      const s = await getSettings()
      const blocked = (s.blocklist || []).map(normalize).includes(normalizedHost)
      blockToggle.textContent = blocked
        ? `Allow on this site (${normalizedHost})`
        : `Exclude on this site (${normalizedHost || 'site'})`
    } catch {
      currentHost = ''
      normalizedHost = ''
      blockToggle.textContent = 'Exclude on this site (site)'
    }
  }

  blockToggle.addEventListener('click', async () => {
    try {
      if (!normalizedHost) return
      const s = await getSettings()
      const blocked = (s.blocklist || []).map(normalize).includes(normalizedHost)
      const next = {
        ...s,
        blocklist: blocked
          ? (s.blocklist || []).filter((h) => normalize(h) !== normalizedHost) // Allow on this site
          : Array.from(new Set([...(s.blocklist || []), normalizedHost])), // Exclude on this site
      }
      await saveSettings(next)
      await refreshBlockUI()
    } catch {
      // noop (no separate status bar)
    }
  })

  await refreshBlockUI()

  // Import/Export controls were removed from popup; available in Options instead

  await loadAndRender('')

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' && area !== 'sync') return
    if (changes[STORAGE_KEYS.snippets]) await loadAndRender(search.value)
    if (changes[STORAGE_KEYS.settings]) {
      try {
        const s = await getSettings()
        currentPrefix = s.triggerPrefix
        await refreshBlockUI()
      } catch {}
    }
  })
}

document.addEventListener('DOMContentLoaded', init)

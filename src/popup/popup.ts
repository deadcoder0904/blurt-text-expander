import {
  create,
  insertMultiple,
  type Orama,
  search as oramaSearch,
  type Results,
} from '@orama/orama'
import browser from 'webextension-polyfill'

import { STORAGE_KEYS } from '../shared/constants'
import { iconButton, qs } from '../shared/dom'
import { ICON_DELETE, ICON_EDIT } from '../shared/icons'
import { getSettings, getSnippets, saveSettings } from '../shared/storage'
import type { Snippet } from '../shared/types'

function renderResultRow(snippet: Snippet): HTMLElement {
  const row = document.createElement('div')
  row.className = 'flex items-center justify-between gap-3 py-3'
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
  edit.addEventListener('click', openForEdit)
  row.addEventListener('click', openForEdit)
  const del = iconButton(ICON_DELETE, 'Delete')
  del.addEventListener('click', async () => {
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

let db: Orama<{ trigger: string; description: string; id: string }>

async function buildIndex(list: Snippet[]) {
  db = await create<{ trigger: string; description: string; id: string }>({
    schema: {
      trigger: 'string',
      description: 'string',
      id: 'string',
    },
  })
  const docs = list.map((s) => ({ id: s.id, trigger: s.trigger, description: s.description ?? '' }))
  await insertMultiple(db, docs)
}

async function loadAndRender(query = '') {
  const results = qs<HTMLDivElement>('#results')
  results.innerHTML = ''
  const snippets = await getSnippets()
  await buildIndex(snippets)
  let final: Snippet[] = snippets
  if (query.trim()) {
    const out: Results<{ trigger: string; description: string; id: string }> = await oramaSearch(
      db,
      {
        term: query,
        properties: ['trigger', 'description'],
        tolerance: 1,
      }
    )
    const ids = new Set(out.hits.map((h) => h.document.id))
    final = snippets.filter((s) => ids.has(s.id))
  }
  for (const snip of final) results.appendChild(renderResultRow(snip))
}

async function init() {
  const enabledInput = qs<HTMLInputElement>('#enabled')
  const search = qs<HTMLInputElement>('#search')
  const _status = qs<HTMLDivElement>('#status')
  const openSettings = qs<HTMLButtonElement>('#openSettings')

  const settings = await getSettings()
  enabledInput.checked = settings.enabled
  enabledInput.addEventListener('change', async () => {
    const next = { ...settings, enabled: enabledInput.checked }
    await saveSettings(next)
  })

  search.addEventListener('input', () => loadAndRender(search.value))
  openSettings.addEventListener('click', async () => {
    await browser.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
  })

  // Import/Export controls were removed from popup; available in Options instead

  await loadAndRender()

  browser.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' && area !== 'sync') return
    if (changes[STORAGE_KEYS.snippets]) await loadAndRender(search.value)
  })
}

document.addEventListener('DOMContentLoaded', init)

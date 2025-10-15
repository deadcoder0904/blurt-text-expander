import browser from 'webextension-polyfill'

import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants'
import type { Settings, Snippet } from './types'

async function ensureLocalFromSync(keys: string[]) {
  const local = await browser.storage.local.get(keys)
  const missing = keys.filter((k) => !(k in local))
  if (!missing.length) return
  const sync = await browser.storage.sync.get(missing)
  const toCopy: Record<string, unknown> = {}
  for (const k of missing) if (k in sync) toCopy[k] = sync[k]
  if (Object.keys(toCopy).length) await browser.storage.local.set(toCopy)
}

export async function getSettings(): Promise<Settings> {
  await ensureLocalFromSync([STORAGE_KEYS.settings])
  const data = await browser.storage.local.get(STORAGE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.settings] as Partial<Settings> | undefined) }
}

export async function saveSettings(next: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.settings]: next })
}

export async function getSnippets(): Promise<Snippet[]> {
  await ensureLocalFromSync([STORAGE_KEYS.snippets])
  const data = await browser.storage.local.get(STORAGE_KEYS.snippets)
  return ((data[STORAGE_KEYS.snippets] as Snippet[]) || []).slice()
}

export async function saveSnippets(list: Snippet[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.snippets]: list })
}

export async function getOpenTarget(): Promise<string | undefined> {
  const d = await browser.storage.local.get(STORAGE_KEYS.openTarget)
  return d[STORAGE_KEYS.openTarget] as string | undefined
}

export async function setOpenTarget(id?: string): Promise<void> {
  if (!id) return
  await browser.storage.local.set({ [STORAGE_KEYS.openTarget]: id })
}

export async function clearOpenTarget(): Promise<void> {
  await browser.storage.local.remove(STORAGE_KEYS.openTarget)
}

export function subscribe(
  handler: (
    changes: browser.Storage.StorageAreaOnChangedChangesType,
    area: 'local' | 'sync' | 'managed'
  ) => void
) {
  browser.storage.onChanged.addListener(handler)
  return () => browser.storage.onChanged.removeListener(handler)
}

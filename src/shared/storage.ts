import browser from 'webextension-polyfill'

import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants'
import type { Settings, Snippet } from './types'

export async function getSettings(): Promise<Settings> {
  const data = await browser.storage.local.get(STORAGE_KEYS.settings)
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.settings] as Partial<Settings> | undefined) }
}

export async function saveSettings(next: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.settings]: next })
}

export async function getSnippets(): Promise<Snippet[]> {
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
  handler: (changes: Record<string, browser.Storage.StorageChange>, area: string) => void
) {
  const cb = (changes: Record<string, browser.Storage.StorageChange>, areaName: string) =>
    handler(changes, areaName)
  browser.storage.onChanged.addListener(cb)
  return () => browser.storage.onChanged.removeListener(cb)
}

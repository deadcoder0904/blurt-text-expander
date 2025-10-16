import browser from 'webextension-polyfill'

import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../shared/constants'
import { mergeSettingsShallow, mergeSnippetsByTrigger } from '../shared/import'
import { getSettings, getSnippets, setOpenTarget } from '../shared/storage'
import type { Settings, Snippet } from '../shared/types'

// Seed funny examples on install
function seedSnippets(): Snippet[] {
  return [
    {
      id: crypto.randomUUID(),
      trigger: '/sig',
      description: 'Signature of Zog the Diplomat (Alpha Centauri)',
      body: `Best regards,\nZog of Centauri\nAmbassador to the Solar Council\nInterstellar Comms: 7-ALPHA-ZOG\nPS: Please ignore abductions — purely scientific`,
    },
    {
      id: crypto.randomUUID(),
      trigger: '/addr',
      description: 'Martian shipping address (Olympus Mons)',
      body: `Alien Bazaar\nCrate #42, Sector Red Dunes\nOlympus Mons Ridge, Mars\nSolar System 3, Milky Way\nAttn: Kindly avoid atmosphere entry at dawn`,
    },
  ]
}

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return
  const existing = await browser.storage.local.get([STORAGE_KEYS.snippets, STORAGE_KEYS.settings])
  const next: Record<string, unknown> = {}
  if (!Array.isArray(existing[STORAGE_KEYS.snippets])) next[STORAGE_KEYS.snippets] = seedSnippets()
  if (!existing[STORAGE_KEYS.settings]) next[STORAGE_KEYS.settings] = DEFAULT_SETTINGS
  if (Object.keys(next).length) await browser.storage.local.set(next)
})

// Open options page from popup/command
browser.runtime.onMessage.addListener(async (raw: unknown) => {
  const msg = (raw || {}) as { type?: string; snippetId?: string; payload?: unknown }
  if (msg?.type === 'OPEN_OPTIONS') {
    if (msg?.snippetId) await setOpenTarget(String(msg.snippetId))
    await browser.runtime.openOptionsPage()
  }
  if (msg?.type === 'EXPORT_JSON') {
    const [snippets, settings] = await Promise.all([getSnippets(), getSettings()])
    return { snippets, settings }
  }
  if (msg?.type === 'IMPORT_JSON') {
    // Merge snippets (by trigger) instead of overriding entire list.
    // For conflicts on trigger, prefer imported (update).
    // Settings are shallow-merged, only provided keys overwrite existing.
    type ImportPayload = {
      snippets?: Snippet[]
      [STORAGE_KEYS.snippets]?: Snippet[]
      settings?: Partial<Settings>
      [STORAGE_KEYS.settings]?: Partial<Settings>
    }
    const p = msg.payload as unknown as ImportPayload
    const incomingSnippets: Snippet[] | undefined = Array.isArray(p?.snippets)
      ? (p.snippets as Snippet[])
      : Array.isArray(p?.[STORAGE_KEYS.snippets])
        ? (p[STORAGE_KEYS.snippets] as Snippet[])
        : undefined
    const incomingSettings: Partial<Settings> | undefined =
      p?.settings ?? p?.[STORAGE_KEYS.settings]

    let added = 0
    let updated = 0

    if (incomingSnippets) {
      const store = await browser.storage.local.get(STORAGE_KEYS.snippets)
      const existing: Snippet[] = (store?.[STORAGE_KEYS.snippets] as Snippet[]) || []
      const res = mergeSnippetsByTrigger(existing, incomingSnippets)
      added = res.added
      updated = res.updated
      await browser.storage.local.set({ [STORAGE_KEYS.snippets]: res.merged })
    }

    if (incomingSettings) {
      const store = await browser.storage.local.get(STORAGE_KEYS.settings)
      const existing: Settings = {
        ...DEFAULT_SETTINGS,
        ...(store?.[STORAGE_KEYS.settings] as Settings | undefined),
      }
      const mergedSettings: Settings = mergeSettingsShallow(existing, incomingSettings)
      await browser.storage.local.set({ [STORAGE_KEYS.settings]: mergedSettings })
    }

    return { added, updated }
  }
})

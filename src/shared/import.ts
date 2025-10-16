import type { Settings, Snippet } from './types'

export function mergeSnippetsByTrigger(
  existing: Snippet[],
  incoming: Snippet[]
): { merged: Snippet[]; added: number; updated: number } {
  const map = new Map(existing.map((s) => [s.trigger, s] as const))
  let added = 0
  let updated = 0
  for (const s of incoming) {
    const curr = map.get(s.trigger)
    if (curr) {
      map.set(s.trigger, { ...curr, ...s })
      updated++
    } else {
      map.set(s.trigger, s)
      added++
    }
  }
  return { merged: Array.from(map.values()), added, updated }
}

export function mergeSettingsShallow(existing: Settings, incoming?: Partial<Settings>): Settings {
  if (!incoming) return existing
  return { ...existing, ...incoming }
}

export const IMPORT_FILENAME = 'blurt.snippets.json'

export function isValidImportFilename(name: string): boolean {
  return name === IMPORT_FILENAME
}

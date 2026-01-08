import type { Settings, Snippet } from './types'

export function canSaveSnippet(
  trigger: string,
  prefix: string,
  description: string,
  body: string
): boolean {
  const t = (trigger || '').trim()
  const d = (description || '').trim()
  const b = (body || '').trim()
  const hasTrigger = t.length > (prefix?.length || 0)
  return hasTrigger && d.length > 0 && b.length > 0
}

function normalizeHost(value: string): string {
  return (value || '').toLowerCase().replace(/^www\./, '')
}

export function computeNextFocusIndex(
  currentIndex: number,
  length: number,
  shift: boolean
): number {
  if (length <= 0) return 0
  const last = length - 1
  if (currentIndex < 0 || currentIndex >= length) return shift ? last : 0
  if (!shift && currentIndex === last) return 0
  if (shift && currentIndex === 0) return last
  return currentIndex + (shift ? -1 : 1)
}

export function retargetTriggers(
  snippets: Snippet[],
  oldPrefix: string,
  newPrefix: string
): Snippet[] {
  if (oldPrefix === newPrefix) return snippets.slice()
  return snippets.map((s) => {
    let next = s.trigger
    if (next.startsWith(oldPrefix)) next = newPrefix + next.slice(oldPrefix.length)
    else if (!next.startsWith(newPrefix)) next = `${newPrefix}${next.trim()}`
    return { ...s, trigger: next }
  })
}

export function shouldAutoExpand(settings: Settings, key: string): boolean {
  if (!settings.enabled) return false
  const exp = settings.expansionKey || ''
  if (!exp) return key === ' ' || key === 'Enter'
  return key === exp
}

export function matchTriggerPure(
  word: string,
  snippets: Snippet[],
  prefix: string
): Snippet | null {
  const w = word.trim()
  if (!w || !w.startsWith(prefix)) return null
  const sorted = snippets.toSorted((a, b) => b.trigger.length - a.trigger.length)
  return sorted.find((s) => s.trigger === w) ?? null
}

export function desiredPlacementAuto(
  spaceBelow: number,
  estimatedHeight: number
): 'top' | 'bottom' {
  return spaceBelow < estimatedHeight + 8 ? 'top' : 'bottom'
}

export function filterSuggestions(
  term: string,
  snippets: Snippet[],
  prefix: string,
  max: number
): Snippet[] {
  const q = (term || '').trim()
  if (!q || !q.startsWith(prefix)) return []
  const list = snippets.filter((s) => s.trigger.toLowerCase().startsWith(q.toLowerCase()))
  const limit = Math.max(1, Number(max || 8))
  return list.slice(0, limit)
}

export function acronymFromTrigger(trigger: string, prefix: string): string {
  const raw = trigger.startsWith(prefix) ? trigger.slice(prefix.length) : trigger
  const parts = raw.match(/[a-z0-9]+/gi) || []
  return parts
    .map((p) => p[0] ?? '')
    .join('')
    .toLowerCase()
}

export function aliasesForTrigger(trigger: string, prefix: string): string[] {
  const ac = acronymFromTrigger(trigger, prefix)
  const prefixed = `${prefix}${ac}`
  const raw = trigger.startsWith(prefix) ? trigger.slice(prefix.length) : trigger
  const parts = raw.match(/[a-z0-9]+/gi) || []
  const firstLetter = (parts[0]?.[0] ?? '').toLowerCase()
  const digitSuffixMatch = raw.match(/(\d+)\s*$/)
  const digitSuffix = (digitSuffixMatch?.[1] ?? '').toLowerCase()
  const letterNumber = firstLetter && digitSuffix ? `${firstLetter}${digitSuffix}` : ''
  const prefixedLetterNumber = letterNumber ? `${prefix}${letterNumber}` : ''
  const out = new Set<string>()
  if (ac) {
    out.add(ac)
    out.add(prefixed)
  }
  if (letterNumber) {
    out.add(letterNumber)
    out.add(prefixedLetterNumber)
  }
  return Array.from(out)
}

export function autocompleteSuggestions(
  term: string,
  snippets: Snippet[],
  prefix: string,
  max: number
): Snippet[] {
  const q = (term || '').trim().toLowerCase()
  if (!q || !q.startsWith(prefix)) return []
  const limit = Math.max(1, Number(max || 8))
  // Direct startsWith on trigger OR alias exact match (prefixed alias) OR basic subsequence fuzzy
  const out: Snippet[] = []
  const qNoPref = q.slice(prefix.length)
  for (const s of snippets) {
    const trig = s.trigger.toLowerCase()
    if (trig.startsWith(q)) {
      out.push(s)
      continue
    }
    const aliases = aliasesForTrigger(s.trigger, prefix).map((a) => a.toLowerCase())
    if (aliases.includes(q)) {
      out.push(s)
      continue
    }
    // subsequence fuzzy: query letters must appear in order in the trigger (no prefix), allow digits too
    const cand = (s.trigger.startsWith(prefix) ? s.trigger.slice(prefix.length) : s.trigger)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    const qNorm = qNoPref.replace(/[^a-z0-9]/g, '')
    let i = 0
    let j = 0
    while (i < qNorm.length && j < cand.length) {
      if (qNorm[i] === cand[j]) i++
      j++
    }
    if (i === qNorm.length && qNorm.length > 0) out.push(s)
  }
  return out.slice(0, limit)
}

export function matchTriggerWithAliases(
  word: string,
  snippets: Snippet[],
  prefix: string
): Snippet | null {
  const w = (word || '').trim().toLowerCase()
  if (!w) return null
  // Exact trigger match first (prefer longest)
  const sorted = snippets.toSorted((a, b) => b.trigger.length - a.trigger.length)
  const exact = sorted.find((s) => s.trigger.toLowerCase() === w)
  if (exact) return exact
  if (!w.startsWith(prefix)) return null
  // Match alias (prefixed acronym)
  for (const s of sorted) {
    const aliases = aliasesForTrigger(s.trigger, prefix).map((a) => a.toLowerCase())
    if (aliases.includes(w)) return s
  }
  return null
}

export function shouldShowAllForQuery(query: string, prefix: string): boolean {
  const q = (query || '').trim()
  return q.length === 0 || q === prefix
}

export function isSiteEnabledForSettings(host: string, settings: Settings): boolean {
  const h = normalizeHost(host)
  const allow = (settings.allowlist || []).map((x) => normalizeHost(x))
  const block = (settings.blocklist || []).map((x) => normalizeHost(x))
  if (block.includes(h)) return false
  if (allow.length > 0) return allow.includes(h)
  return true
}

export function isAutocompleteEnabledOnSite(host: string, settings: Settings): boolean {
  return (
    !!settings.enabled && !!settings.autocompleteEnabled && isSiteEnabledForSettings(host, settings)
  )
}

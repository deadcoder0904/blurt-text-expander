import { describe, expect, it } from 'bun:test'
import { dedupeById } from '../../src/shared/list'
import {
  acronymFromTrigger,
  aliasesForTrigger,
  canSaveSnippet,
  computeNextFocusIndex,
  desiredPlacementAuto,
  filterSuggestions,
  matchTriggerPure,
  retargetTriggers,
  shouldAutoExpand,
} from '../../src/shared/logic'
import type { Settings, Snippet } from '../../src/shared/types'

const s = (id: string, trigger: string, body = 'x', description?: string): Snippet => ({
  id,
  trigger,
  body,
  description,
})

describe('canSaveSnippet', () => {
  it('requires trigger beyond prefix, description and body', () => {
    expect(canSaveSnippet('/', '/', 'd', 'b')).toBe(false)
    expect(canSaveSnippet('/t', '/', '', 'b')).toBe(false)
    expect(canSaveSnippet('/t', '/', 'd', '')).toBe(false)
    expect(canSaveSnippet('/t', '/', 'd', 'b')).toBe(true)
  })
})

describe('computeNextFocusIndex', () => {
  it('wraps forward at end and backward at start', () => {
    expect(computeNextFocusIndex(2, 3, false)).toBe(0)
    expect(computeNextFocusIndex(0, 3, true)).toBe(2)
  })
  it('handles out-of-range by snapping to ends', () => {
    expect(computeNextFocusIndex(-1, 3, false)).toBe(0)
    expect(computeNextFocusIndex(-1, 3, true)).toBe(2)
  })
})

describe('retargetTriggers', () => {
  it('changes old prefix to new and normalizes others', () => {
    const list = [s('1', '/a'), s('2', 'b')]
    const out = retargetTriggers(list, '/', '#')
    expect(out.find((x) => x.id === '1')?.trigger).toBe('#a')
    expect(out.find((x) => x.id === '2')?.trigger).toBe('#b')
  })
})

describe('shouldAutoExpand', () => {
  const base = {
    enabled: true,
    theme: 'dark',
    triggerPrefix: '/',
    expansionKey: '',
    charLimit: 5000,
    autocompleteEnabled: true,
    autocompletePosition: 'auto',
    autocompleteMaxItems: 8,
  } satisfies Settings
  it('allows Space/Enter when expansionKey empty', () => {
    expect(shouldAutoExpand(base, ' ')).toBe(true)
    expect(shouldAutoExpand(base, 'Enter')).toBe(true)
    expect(shouldAutoExpand(base, 'Tab')).toBe(false)
  })
  it('respects explicit expansionKey', () => {
    const s = { ...base, expansionKey: 'Tab' }
    expect(shouldAutoExpand(s, 'Tab')).toBe(true)
    expect(shouldAutoExpand(s, 'Enter')).toBe(false)
  })
  it('disabled setting prevents expansion', () => {
    const s = { ...base, enabled: false }
    expect(shouldAutoExpand(s, ' ')).toBe(false)
  })
})

describe('matchTriggerPure', () => {
  const list = [s('1', '/a'), s('2', '/addr'), s('3', '/ab')]
  it('requires prefix and prefers longest exact', () => {
    expect(matchTriggerPure('a', list, '/')).toBe(null)
    expect(matchTriggerPure('/a', list, '/')?.id).toBe('1')
    expect(matchTriggerPure('/addr', list, '/')?.id).toBe('2')
  })
})

describe('desiredPlacementAuto', () => {
  it('returns top if not enough space below', () => {
    expect(desiredPlacementAuto(20, 40)).toBe('top')
    expect(desiredPlacementAuto(60, 40)).toBe('bottom')
  })
})

describe('filterSuggestions', () => {
  const list = [s('1', '/a', 'x', 'A'), s('2', '/ab', 'y', 'B'), s('3', '/b', 'z', 'C')]
  it('filters to prefix-start matches and caps to max', () => {
    expect(filterSuggestions('/a', list, '/', 1).length).toBe(1)
    expect(filterSuggestions('/a', list, '/', 10).map((x) => x.id)).toEqual(['1', '2'])
    expect(filterSuggestions('a', list, '/', 10).length).toBe(0)
  })
})

describe('dedupeById', () => {
  it('removes later duplicates and preserves order', () => {
    const input = [s('1', '/a'), s('1', '/a2'), s('2', '/b')]
    const out = dedupeById(input)
    expect(out.map((x) => x.id)).toEqual(['1', '2'])
  })
})

describe('acronymFromTrigger and aliasesForTrigger', () => {
  it('builds acronym and prefixed alias', () => {
    expect(acronymFromTrigger('/rabbit-holes', '/')).toBe('rh')
    expect(aliasesForTrigger('/rabbit-holes', '/')).toEqual(['rh', '/rh'])
  })
})

import { describe, expect, it } from 'bun:test'
import { isAutocompleteEnabledOnSite } from '../../src/shared/logic'
import type { Settings } from '../../src/shared/types'

const base: Settings = {
  enabled: true,
  theme: 'dark',
  triggerPrefix: '/',
  expansionKey: '',
  charLimit: 5000,
  autocompleteEnabled: true,
  autocompletePosition: 'auto',
  autocompleteMaxItems: 8,
  allowlist: [],
  blocklist: [],
}

describe('autocomplete respects site blocklist', () => {
  it('returns false when host is blocked', () => {
    const s = { ...base, blocklist: ['example.com'] }
    expect(isAutocompleteEnabledOnSite('example.com', s)).toBe(false)
    expect(isAutocompleteEnabledOnSite('www.example.com', s)).toBe(false)
  })
  it('returns true when allowed and enabled', () => {
    const s = { ...base }
    expect(isAutocompleteEnabledOnSite('good.com', s)).toBe(true)
  })
  it('returns false when global autocomplete disabled', () => {
    const s = { ...base, autocompleteEnabled: false }
    expect(isAutocompleteEnabledOnSite('good.com', s)).toBe(false)
  })
})

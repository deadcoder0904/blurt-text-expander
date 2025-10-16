import { describe, expect, it } from 'bun:test'
import { isSiteEnabledForSettings } from '../../src/shared/logic'
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

describe('site gating', () => {
  it('blocks when host is in blocklist', () => {
    const s = { ...base, blocklist: ['app.bive.com'] }
    expect(isSiteEnabledForSettings('app.bive.com', s)).toBe(false)
  })
  it('allows only allowlisted when allowlist not empty', () => {
    const s = { ...base, allowlist: ['good.com'] }
    expect(isSiteEnabledForSettings('good.com', s)).toBe(true)
    expect(isSiteEnabledForSettings('other.com', s)).toBe(false)
  })
  it('blocklist overrides allowlist', () => {
    const s = { ...base, allowlist: ['good.com'], blocklist: ['good.com'] }
    expect(isSiteEnabledForSettings('good.com', s)).toBe(false)
  })

  it('normalizes www. for checks', () => {
    const s = { ...base, blocklist: ['example.com'] }
    expect(isSiteEnabledForSettings('www.example.com', s)).toBe(false)
    expect(isSiteEnabledForSettings('example.com', s)).toBe(false)
  })
})

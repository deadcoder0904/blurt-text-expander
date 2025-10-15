import { describe, expect, it } from 'bun:test'
import { countChars, detectOverlapWarnings, normalizeTrigger } from '../../src/shared/utils'

describe('normalizeTrigger', () => {
  it('adds prefix when missing', () => {
    expect(normalizeTrigger('sig', '/')).toBe('/sig')
  })
  it('keeps prefix when present', () => {
    expect(normalizeTrigger('/sig', '/')).toBe('/sig')
  })
  it('trims whitespace and applies prefix', () => {
    expect(normalizeTrigger('  addr  ', '/')).toBe('/addr')
  })
  it('returns empty for empty input', () => {
    expect(normalizeTrigger('   ', '/')).toBe('')
  })
})

describe('detectOverlapWarnings', () => {
  it('warns when one trigger prefixes another', () => {
    const warnings = detectOverlapWarnings([
      { id: '1', trigger: '/a', body: 'x' },
      { id: '2', trigger: '/ab', body: 'y' },
    ])
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain('/a')
    expect(warnings[0]).toContain('/ab')
  })

  it('no warning for disjoint triggers', () => {
    const warnings = detectOverlapWarnings([
      { id: '1', trigger: '/foo', body: 'x' },
      { id: '2', trigger: '/bar', body: 'y' },
    ])
    expect(warnings.length).toBe(0)
  })
})

describe('countChars', () => {
  it('counts characters of text', () => {
    expect(countChars('hello')).toBe(5)
  })
  it('handles empty/undefined safely', () => {
    // @ts-expect-error testing runtime fallback
    expect(countChars(undefined)).toBe(0)
  })
})

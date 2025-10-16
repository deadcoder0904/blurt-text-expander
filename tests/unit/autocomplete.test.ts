import { describe, expect, it } from 'bun:test'
import { autocompleteSuggestions, matchTriggerWithAliases } from '../../src/shared/logic'
import type { Snippet } from '../../src/shared/types'

const s = (id: string, trigger: string, body = 'x', description?: string): Snippet => ({
  id,
  trigger,
  body,
  description,
})

describe('autocompleteSuggestions with aliases', () => {
  const list = [s('1', '/rabbit-holes'), s('2', '/roadmap'), s('3', '/L-Think2')]
  it("suggests '/rabbit-holes' when term is '/rh'", () => {
    const out = autocompleteSuggestions('/rh', list, '/', 8)
    expect(out.some((x) => x.id === '1')).toBe(true)
  })
  it("suggests '/L-Think2' when term is '/L2'", () => {
    const out = autocompleteSuggestions('/L2', list, '/', 8)
    expect(out.some((x) => x.id === '3')).toBe(true)
  })
  it("fuzzy matches '/L-Think2' when term is '/lt' (subsequence)", () => {
    const out = autocompleteSuggestions('/lt', list, '/', 8)
    expect(out.some((x) => x.id === '3')).toBe(true)
  })
})

describe('matchTriggerWithAliases', () => {
  const list = [s('1', '/rabbit-holes', 'body'), s('3', '/L-Think2', 'body')]
  it("matches '/rabbit-holes' when word is '/rh'", () => {
    const m = matchTriggerWithAliases('/rh', list, '/')
    expect(m?.id).toBe('1')
  })
  it("matches '/L-Think2' when word is '/L2'", () => {
    const m = matchTriggerWithAliases('/L2', list, '/')
    expect(m?.id).toBe('3')
  })
})

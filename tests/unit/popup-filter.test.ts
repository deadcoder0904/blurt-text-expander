import { describe, expect, it } from 'bun:test'
import { shouldShowAllForQuery } from '../../src/shared/logic'

describe('popup search query behavior', () => {
  it("returns all when query is '/' (prefix)", () => {
    expect(shouldShowAllForQuery('/', '/')).toBe(true)
  })
  it('filters when query has more than prefix', () => {
    expect(shouldShowAllForQuery('/a', '/')).toBe(false)
  })
})

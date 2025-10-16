import { describe, expect, it } from 'bun:test'
import { mergeSettingsShallow, mergeSnippetsByTrigger } from '../../src/shared/import'
import type { Settings, Snippet } from '../../src/shared/types'

function snip(id: string, trigger: string, body = 'x', description?: string): Snippet {
  return { id, trigger, body, description }
}

describe('mergeSnippetsByTrigger', () => {
  it('adds all when importing into empty', () => {
    const existing: Snippet[] = []
    const incoming: Snippet[] = [snip('1', '/a'), snip('2', '/b')]
    const { merged, added, updated } = mergeSnippetsByTrigger(existing, incoming)
    expect(added).toBe(2)
    expect(updated).toBe(0)
    expect(merged.length).toBe(2)
  })

  it('updates on trigger match and preserves others', () => {
    const existing: Snippet[] = [snip('1', '/a', 'old'), snip('2', '/b', 'keep')]
    const incoming: Snippet[] = [snip('3', '/a', 'new'), snip('4', '/c', 'add')]
    const { merged, added, updated } = mergeSnippetsByTrigger(existing, incoming)
    expect(added).toBe(1) // /c added
    expect(updated).toBe(1) // /a updated
    const aBody = merged.find((s) => s.trigger === '/a')?.body
    expect(aBody).toBe('new')
    expect(merged.some((s) => s.trigger === '/b')).toBe(true)
    expect(merged.some((s) => s.trigger === '/c')).toBe(true)
  })

  it('re-imports after deletion adds again', () => {
    const incoming: Snippet[] = [snip('1', '/a'), snip('2', '/b')]
    // First import into empty
    let res = mergeSnippetsByTrigger([], incoming)
    expect(res.added).toBe(2)
    // Simulate deletion of all snippets
    const afterDelete: Snippet[] = []
    // Import the same payload again
    res = mergeSnippetsByTrigger(afterDelete, incoming)
    expect(res.added).toBe(2)
    expect(res.updated).toBe(0)
    expect(res.merged.length).toBe(2)
  })
})

describe('mergeSettingsShallow', () => {
  it('shallow merges provided keys', () => {
    const existing = {
      enabled: true,
      theme: 'dark',
      triggerPrefix: '/',
      expansionKey: '',
      autocompleteEnabled: true,
      autocompleteMaxItems: 8,
      autocompletePosition: 'auto',
      charLimit: 5000,
    } as unknown as Settings
    const merged = mergeSettingsShallow(existing, { enabled: false, theme: 'light' })
    expect(merged.enabled).toBe(false)
    expect(merged.theme).toBe('light')
    expect(merged.triggerPrefix).toBe('/')
  })
})

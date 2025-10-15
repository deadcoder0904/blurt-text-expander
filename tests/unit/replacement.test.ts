import { describe, expect, it } from 'bun:test'
import { getWordBeforeIndex } from '../../src/shared/utils'

describe('text replacement logic (pure)', () => {
  it('replaces the token before caret without duplicating it', () => {
    const text = 'Hello /si'
    const caret = text.length
    const { word, range } = getWordBeforeIndex(text, caret, caret)
    expect(word).toBe('/si')
    // Simulate replacement with snippet body
    const replacement = 'signature'
    const out = text.slice(0, range[0]) + replacement + text.slice(range[1])
    expect(out).toBe('Hello signature')
  })

  it('handles triggers with longer matches preferring full token', () => {
    const text = 'Type: /sig'
    const caret = text.length
    const { word, range } = getWordBeforeIndex(text, caret, caret)
    expect(word).toBe('/sig')
    const out = `${text.slice(0, range[0])}signature${text.slice(range[1])}`
    expect(out).toBe('Type: signature')
  })
})

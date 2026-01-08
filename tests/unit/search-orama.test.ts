import { create, insertMultiple, search as oramaSearch } from '@orama/orama'

import { describe, expect, it } from 'bun:test'

describe('Orama fuzzy/acronym search for triggers', () => {
  it("finds '/rabbit-holes' when searching for '/rh' via keywords", async () => {
    const db = create({
      schema: {
        trigger: 'string',
        description: 'string',
        id: 'string',
        keywords: 'string',
      },
    })

    const docs = [
      {
        id: '1',
        trigger: '/rabbit-holes',
        description: 'Rabbit holes notes',
        keywords: '/rabbit-holes Rabbit holes notes rh /rh',
      },
    ]
    await insertMultiple(
      db as unknown as Parameters<typeof insertMultiple>[0],
      docs as unknown as Parameters<typeof insertMultiple>[1]
    )

    const out = (await (oramaSearch as unknown as (d: unknown, opts: unknown) => unknown)(db, {
      term: '/rh',
      properties: ['trigger', 'description', 'keywords'] as unknown as string[],
      tolerance: 1,
    })) as unknown as { hits: Array<{ document: { id: string } }> }

    const ids = new Set(out.hits.map((h) => h.document.id))
    expect(ids.has('1')).toBe(true)
  })
})

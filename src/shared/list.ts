export function dedupeById<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of list) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

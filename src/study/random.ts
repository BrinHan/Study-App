// Seeded randomness, so a session's order and choices stay the same when it's resumed.

/** Shuffle with a seed (FNV-1a hash, then a xorshift-style mix per step). */
export function shuffled<T>(items: T[], seed: string): T[] {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const j = Math.abs(h) % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const newSeed = () => Math.random().toString(36).slice(2, 10)

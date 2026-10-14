// Typed answers: forgiving about case, punctuation, a leading article and small typos.

export type TypedResult = 'exact' | 'close' | 'wrong'

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ')
}

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

/** Up to 1 typo for answers of 5 characters or fewer, 2 for longer ones. */
export function checkTyped(input: string, answer: string): TypedResult {
  const given = normalize(input)
  const want = normalize(answer)
  if (!given) return 'wrong'
  if (given === want) return 'exact'
  return levenshtein(given, want) <= (want.length <= 5 ? 1 : 2) ? 'close' : 'wrong'
}

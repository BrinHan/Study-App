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


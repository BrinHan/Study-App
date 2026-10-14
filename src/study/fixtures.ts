// Test helper: build study cards without the generator.
import type { StudyCard } from '../lib/types'
import { newProgress } from './mastery'

export function makeCard(n: number | string, answer: string, extra: Partial<StudyCard> = {}): StudyCard {
  return {
    id: `k:c${n}`, kitId: 'k', type: 'cloze', prompt: `Sentence ${n} about _____.`, answer, hint: '', topic: 'Topic',
    progress: newProgress(), ...extra,
  }
}

export const TERMS = ['mitochondria', 'nucleus', 'ribosome', 'chloroplast', 'Golgi apparatus', 'lysosome', 'vacuole', 'cytoplasm', 'cell wall', 'plasma membrane',
  'ATP', 'glucose', 'enzyme', 'protein', 'lipid', 'DNA', 'RNA', 'chromosome', 'gene', 'osmosis', 'diffusion', 'cilia', 'flagella', 'centriole']

export const makeDeck = (n: number) => Array.from({ length: n }, (_, i) => makeCard(i, TERMS[i % TERMS.length]))

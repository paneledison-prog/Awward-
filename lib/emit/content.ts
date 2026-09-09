import type { ContentMode } from '../types';

/**
 * Placeholder copy that preserves the shape of what it replaces.
 *
 * Swapping real copy for "Lorem ipsum" of a different length collapses the
 * layout it was written for — a 9-word headline becomes 3 words and the hero
 * reflows. Matching word count and punctuation keeps the design intact while
 * removing the source site's actual words.
 */
const WORDS = [
  'build', 'launch', 'scale', 'modern', 'teams', 'platform', 'workflow', 'faster',
  'simple', 'powerful', 'connect', 'design', 'ship', 'product', 'growth', 'data',
  'secure', 'flexible', 'insight', 'system', 'craft', 'signal', 'clarity', 'momentum',
];

function pseudoWord(seed: number, capitalize: boolean): string {
  const word = WORDS[seed % WORDS.length];
  return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
}

/** Deterministic hash so the same source text always yields the same stand-in. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function placeholder(text: string): string {
  if (!text.trim()) return text;
  const seed = hash(text);

  return text
    .split(/(\s+)/)
    .map((token, i) => {
      if (/^\s+$/.test(token) || !/[A-Za-z]/.test(token)) return token;
      const trailing = token.match(/[^A-Za-z0-9]+$/)?.[0] ?? '';
      const capitalize = /^[A-Z]/.test(token);
      return pseudoWord(seed + i * 7, capitalize) + trailing;
    })
    .join('');
}

export function applyMode(text: string, mode: ContentMode): string {
  return mode === 'placeholder' ? placeholder(text) : text;
}

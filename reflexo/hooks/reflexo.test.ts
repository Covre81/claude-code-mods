import { describe, it, expect } from 'vitest';

export function looksLikeRule(text: string): boolean {
  if (!text || text.length > 200) return false;

  // Exclude "não sei" and similar negatives that aren't rules
  if (/^(não sei|nao sei|i don't know)\b/i.test(text)) return false;

  const ruleRegex = /^(não|nao|nunca|sempre|pare de|prefiro|no|don't|always|never|stop)\b/i;
  return ruleRegex.test(text);
}

describe('looksLikeRule', () => {
  it('identifies positive rule patterns', () => {
    expect(looksLikeRule('nunca use sed no Windows')).toBe(true);
    expect(looksLikeRule('sempre use types')).toBe(true);
    expect(looksLikeRule('não use var')).toBe(true);
    expect(looksLikeRule('nao use var')).toBe(true);
    expect(looksLikeRule("don't use var")).toBe(true);
    expect(looksLikeRule('always use types')).toBe(true);
    expect(looksLikeRule('never use sed')).toBe(true);
    expect(looksLikeRule('stop using var')).toBe(true);
    expect(looksLikeRule('prefiro TypeScript')).toBe(true);
    expect(looksLikeRule('pare de usar var')).toBe(true);
    expect(looksLikeRule('no, use X')).toBe(true);
  });

  it('rejects non-rule patterns', () => {
    expect(looksLikeRule('Como faço X?')).toBe(false);
    expect(looksLikeRule('Ola Claude')).toBe(false);
    expect(looksLikeRule('não sei')).toBe(false);
    expect(looksLikeRule('nao sei')).toBe(false);
    expect(looksLikeRule("I don't know")).toBe(false);
  });

  it('rejects long prompts', () => {
    const longPrompt = 'sempre ' + 'a'.repeat(201);
    expect(looksLikeRule(longPrompt)).toBe(false);
  });

  it('rejects empty or null prompts', () => {
    expect(looksLikeRule('')).toBe(false);
  });
});

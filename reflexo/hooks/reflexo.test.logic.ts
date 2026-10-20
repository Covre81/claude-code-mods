export function looksLikeRule(text: string): boolean {
  if (!text || text.length > 200) return false;

  // Exclude "não sei" and similar negatives that aren't rules
  if (/^(não sei|nao sei|i don't know)\b/i.test(text)) return false;

  const ruleRegex = /^(não|nao|nunca|sempre|pare de|prefiro|no|don't|always|never|stop)\b/i;
  return ruleRegex.test(text);
}

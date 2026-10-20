export function looksLikeRule(text: string): boolean {
  if (!text || text.length > 200) return false
  // "não sei" and similar are answers, not rules
  if (/^(não sei|nao sei|i don't know)\b/i.test(text)) return false
  // 'no,' needs the comma: bare 'no' is Portuguese "in the" ("No arquivo X...")
  return /^(?:(?:não|nao|nunca|sempre|pare de|prefiro|don't|always|never|stop)\b|no,)/i.test(text)
}

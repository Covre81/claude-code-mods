export function looksLikeRule(text: string): boolean {
  // One line only: a newline would land in CLAUDE.md as a line of its own, maybe a fake "## " heading.
  if (!text || text.length > 200 || /[\r\n]/.test(text)) return false
  // "não sei", "não entendi", "não funcionou" and similar are answers, not rules
  if (/^(n[ãa]o (sei|entendi|funcion|consegui|deu|rodou)|i don't know)/i.test(text)) return false
  // 'no,' needs the comma: bare 'no' is Portuguese "in the" ("No arquivo X...")
  return /^(?:(?:não|nao|nunca|sempre|pare de|prefiro|don't|always|never|stop)\b|no,)/i.test(text)
}

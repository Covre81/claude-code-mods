export function looksLikeRule(text: string): boolean {
  // One line only: a newline would land in CLAUDE.md as a line of its own, maybe a fake "## " heading.
  if (!text || text.length > 200 || /[\r\n]/.test(text)) return false
  // "não sei", "não entendi", "não funcionou" and similar are answers, not rules
  if (/^(n[ãa]o (sei|entendi|funcion|consegui|deu|rodou)|i don't know)/i.test(text)) return false
  // "não está carregando", "não abriu", "não tem nada": a status report about now, not a standing rule
  if (/^n[ãa]o (est[áa](?=\s|$)|t[áa](?=\s|$)|carreg(a|ou|ando)?\b|apare(ce|ceu|cendo)\b|abr(e|iu|indo)\b|ach(ei|o)\b|tem\b|tinha\b|foi\b|veio\b|mostr(a|ou|ando)\b|salv(a|ou)\b|instal(a|ou)\b|conect(a|ou)\b|compil(a|ou)\b|baix(a|ou)\b)/i.test(text)) return false
  // 'no,' needs the comma: bare 'no' is Portuguese "in the" ("No arquivo X...")
  return /^(?:(?:não|nao|nunca|sempre|pare de|prefiro|don't|always|never|stop)\b|no,)/i.test(text)
}

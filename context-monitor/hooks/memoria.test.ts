import { describe, expect, mock, test } from 'claude-code/testing'

import { formatHits, ftsQuery, parseMarker } from './memoria'

describe('pure parts', () => {
  test('ftsQuery: words quoted and ORed, operators, stopwords and short words gone', () => {
    expect(ftsQuery('Como faço o "statusline" mostrar o modelo? AND NEAR*')).toBe('"faço" OR "statusline" OR "mostrar" OR "modelo"')
    expect(ftsQuery('ok sim não')).toBe(null)
    expect(ftsQuery('a b c d e f g h i j k l alpha beta gamma delta epsilon zeta theta iota kappa')?.split(' OR ').length).toBe(8)
  })

  test('parseMarker reads top-level keys only', () => {
    expect(parseMarker('workspace = "default"\nproject = "JEV-APP-PC"\n\n[briefing]\nproject = "x"')).toEqual({ workspace: 'default', project: 'JEV-APP-PC' })
    expect(parseMarker('[briefing]\nproject = "x"')).toBe(null)
  })

  test('formatHits: maintained pages first, marks stripped, fenced, at most 3', () => {
    const hit = (kind: string, title: string) => ({ project: 'P', path: `${kind}/${title}.md`, title, kind, snippet: `a <mark>b</mark> ${'x'.repeat(400)}` })
    const out = formatHits([hit('session', 's1'), hit('session', 's2'), hit('gotcha', 'g1'), hit('session', 's3')])!
    const lines = out.split('\n').filter(l => l.startsWith('- '))
    expect(lines.length).toBe(3)
    expect(lines[0]!.startsWith('- g1')).toBe(true)
    expect(out.includes('<mark>')).toBe(false)
    expect(out.includes('<!-- ai-memory:untrusted-history:start -->')).toBe(true)
    expect(formatHits([])).toBe(null)
  })
})

const HITS = [{ workspace: 'default', project: 'JEV-APP-PC', path: 'gotchas/x.md', title: 'Roteador', kind: 'gotcha', snippet: 'o roteador cai', rank: -1 }]

test('terminal: a composer prompt gets the notes; slash commands, short and bridge prompts do not', async ($, on) => {
  mock.clock(on)
  const urls: string[] = []
  on('session.cwd', () => ({ value: 'C:/Dev/JEV-APP-PC/src' }) as never)
  on('fs.read', (_$, e) => {
    const path = String((e as { path: string }).path).replace(/\\/g, '/') // the engine hands paths over Windows-style
    return (path === 'C:/Dev/JEV-APP-PC/.ai-memory.toml' ? { value: 'workspace = "default"\nproject = "JEV-APP-PC"' } : { deny: 'ENOENT' }) as never
  })

  on('http.fetch', (_$, e) => {
    urls.push(String((e as { url: string }).url))
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(HITS) } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  let seen: readonly string[] | undefined
  on('prompt.submit', (_$, e) => {
    seen = (e as { context?: readonly string[] }).context
    return { text: '' } as never
  })

  await $.prompt.submit({ text: 'por que o roteador do jev caiu ontem?', wait: false, origin: { kind: 'composer' } } as never)
  expect(seen?.length).toBe(1)
  expect(seen![0]!.includes('Roteador')).toBe(true)
  expect(urls[0]!.includes('project=JEV-APP-PC')).toBe(true)

  for (const [text, kind] of [['/status do roteador agora mesmo', 'composer'], ['roteador?', 'composer'], ['por que o roteador do jev caiu ontem?', 'bridge']]) {
    seen = undefined
    await $.prompt.submit({ text, wait: false, origin: { kind } } as never)
    expect(seen).toBe(undefined)
  }
})

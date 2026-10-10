import { describe, expect, test } from 'claude-code/testing'

import { LINUX } from './linux'
import { parseAnki, parseDeck, pick } from './register'

const ANKI = JSON.stringify([
  ['0001', 'Ter', 'Avere'],
  ['0004', 'Aquele que tem', 'Avente / Abbiente<br><br>pode significar "rico"'],
  ['0005', '', 'vazio'],
  'lixo',
])
const DECK = `# 🗂️ FLASHCARDS DECK — ROAD TO BSCODEV

| id | front | back | topic | stage | created | due | interval(d) | ease | reps | lapses |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 010 | O que causa um "Merge Conflict"? | Dois branches mudam a **exata mesma linha**. | git | 01 | 2026-08-13 | 2026-08-14 | 1 | 2.3 | 0 | 0 |
| 011 | sem resposta |  | git | 01 | 2026-08-13 | 2026-08-14 | 1 | 2.3 | 0 | 0 |
`

describe('parsers', () => {
  test('anki rows become PT→IT cards, html stripped, junk dropped', () => {
    expect(parseAnki(ANKI)).toEqual([
      { src: 'it', front: 'Ter', back: 'Avere' },
      { src: 'it', front: 'Aquele que tem', back: 'Avente / Abbiente / / pode significar "rico"' },
    ])
  })

  test('deck.md rows become dev cards with topic; header, separator and half rows dropped', () => {
    expect(parseDeck(DECK)).toEqual([
      { src: 'dev', front: 'O que causa um "Merge Conflict"?', back: 'Dois branches mudam a exata mesma linha.', topic: 'git' },
    ])
    expect(parseDeck('nothing here')).toEqual([])
  })

  test('pick: half per deck, null when empty', () => {
    const it = [{ src: 'it' as const, front: 'a', back: 'b' }]
    const dev = [{ src: 'dev' as const, front: 'c', back: 'd' }]
    expect(pick([])).toBe(null)
    expect(pick([it, dev], () => 0.1)?.src).toBe('it')
    expect(pick([it, dev], () => 0.9)?.src).toBe('dev')
  })

  test('linux deck: filled, short enough for the band, no repeated fronts', () => {
    expect(LINUX.length > 40).toBe(true)
    for (const c of LINUX) expect(c.src === 'linux' && !!c.topic && !!c.front && !!c.back && c.back.length <= 280).toBe(true)
    expect(new Set(LINUX.map(c => c.front)).size).toBe(LINUX.length)
  })
})

test('terminal: band shows a card only while working, reveal shows the answer, never writes', async ($, on) => {
  const writes: string[] = []
  on('fs.read', (_$, e) => {
    const path = String((e as { path: string }).path)
    return { value: path.endsWith('.json') ? ANKI : DECK } as never
  })
  on('fs.write', (_$, e) => {
    writes.push(String((e as { path: string }).path))
    return { value: undefined } as never
  })
  on('prompt.submit', () => ({ text: '' }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as never
  })

  await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'composer' } } as never)

  const idle = await $.ui.mount({ plugin: 'wait-quiz', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } as never })
  expect((await idle.findAll({ type: 'Button' })).length).toBe(0)

  const busy = await $.ui.mount({ plugin: 'wait-quiz', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true } as never })
  expect((await busy.findAll({ type: 'Button' })).length).toBe(2)
  await busy.press({ key: 'reveal' })
  expect((await busy.findAll({ type: 'Button' })).length).toBe(1)
  expect(writes).toEqual([])
})

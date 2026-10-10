import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card } from '../types'
import { LINUX } from './linux'

// Read-only by construction: this module only ever calls $.fs.read (Italian_Language lost data on 2026-08-09).
const SOURCES = {
  it: 'C:/Dev/Italian_Language/anki_export.json',
  dev: 'C:/Dev/RoadToBSCoDev/flashcards/deck.md',
} as const

const MAX = 280

const card = atom({ plugin: 'wait-quiz', key: 'card' } as const, null)
const isRevealed = atom({ plugin: 'wait-quiz', key: 'isRevealed' } as const, false)

const clean = (s: string) => {
  const t = s.replace(/<br\s*\/?>/gi, ' / ').replace(/<[^>]+>/g, '').replace(/\*\*|`/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > MAX ? `${t.slice(0, MAX - 1)}…` : t
}

/** anki_export.json: `[[id, pt, it], ...]`; asks the Italian for the Portuguese. */
export function parseAnki(raw: string): Card[] {
  const rows = JSON.parse(raw) as unknown
  if (!Array.isArray(rows)) return []
  return rows.flatMap(r =>
    Array.isArray(r) && typeof r[1] === 'string' && typeof r[2] === 'string' && clean(r[1]) && clean(r[2])
      ? [{ src: 'it' as const, front: clean(r[1]), back: clean(r[2]) }]
      : [],
  )
}

/** RoadToBSCoDev deck.md: table rows `| id | front | back | topic | ...`; header and separator rows have no numeric id. */
export function parseDeck(raw: string): Card[] {
  return raw.split('\n').flatMap(line => {
    // ponytail: plain split on `|`; the deck has no escaped pipes today. Split on /(?<!\\)\|/ if one appears.
    const [, id, front, back, topic] = line.split('|').map(c => c.trim())
    return id && /^\d+$/.test(id) && front && back ? [{ src: 'dev' as const, front: clean(front), back: clean(back), ...(topic ? { topic } : {}) }] : []
  })
}

// ponytail: decks held in module memory, re-read on reload; files are a few MB at most.
let decks: Card[][] | undefined

async function loadDecks($: EngineInterface): Promise<Card[][]> {
  if (decks) return decks
  const readOr = (path: string) => $.fs.read(path).catch(() => '')
  const [it, dev] = await Promise.all([readOr(SOURCES.it), readOr(SOURCES.dev)])
  const safe = (f: () => Card[]) => {
    try {
      return f()
    } catch {
      return []
    }
  }
  decks = [safe(() => parseAnki(it)), safe(() => parseDeck(dev)), LINUX].filter(d => d.length > 0)
  return decks
}

/** One deck at a time, evenly: the anki deck is ~200x bigger than the others and would drown them. */
export function pick(ds: Card[][], rnd: () => number = Math.random): Card | null {
  if (!ds.length) return null
  const deck = ds[Math.floor(rnd() * ds.length)]!
  return deck[Math.floor(rnd() * deck.length)] ?? null
}

async function deal($: EngineInterface) {
  const next = pick(await loadDecks($))
  await update($, card, () => next)
  await update($, isRevealed, () => false)
}

const NAME = { it: '🇮🇹 PT→IT', dev: '💻 RoadToDev', linux: '🐧 Linux' } as const
const label = (c: Card) => `${NAME[c.src]}${c.topic ? ` · ${c.topic}` : ''}`

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') await deal($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e)) // a quiz bug must never eat the prompt

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, card)
    if (!e.props.isWorking || e.props.hasSurvey || !c) return next(e)
    const revealed = await read($, isRevealed)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{label(c)}</Text> {c.front}
        </Text>
        {revealed ? <Text color="green">→ {c.back}</Text> : null}
        <Box>
          {revealed ? null : <Button key="reveal" label="Revelar" onPress={() => update($, isRevealed, () => true)} />}
          <Button key="next" label="Outra" onPress={() => deal($)} />
        </Box>
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Card } from '../types'
import { LINUX } from './linux'

// Optional external deck file paths, configurable via environment variables:
// WAIT_QUIZ_ANKI_PATH (e.g. an anki JSON export)
// WAIT_QUIZ_DECK_PATH (e.g. a markdown flashcard deck)
// Captured cards live in the plugin's own $.store, never in the source decks.
const MAX = 280
const CAP_KEY = 'captured'
const CAP_MAX = 500

const card = atom({ plugin: 'wait-quiz', key: 'card' } as const, null)
const isRevealed = atom({ plugin: 'wait-quiz', key: 'isRevealed' } as const, false)
const isEnabledRef = atom({ plugin: 'wait-quiz', key: 'isEnabled' } as const, true)

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
  const readOr = async (path: string | undefined) => {
    if (!path) return ''
    return $.fs.read(path).catch(() => '')
  }
  const ankiPath = await $.env.get('WAIT_QUIZ_ANKI_PATH').catch(() => undefined)
  const deckPath = await $.env.get('WAIT_QUIZ_DECK_PATH').catch(() => undefined)
  const [it, dev] = await Promise.all([readOr(ankiPath), readOr(deckPath)])
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

async function captured($: EngineInterface): Promise<Card[]> {
  const v = await $.store.get(CAP_KEY).catch(() => undefined)
  return Array.isArray(v) ? (v as Card[]) : []
}

/** Validates and appends one card to the captured deck; the reply is what the person or the model reads. */
export function addCard(deck: readonly Card[], raw: { front?: unknown; back?: unknown; topic?: unknown }): { deck: Card[]; reply: string } {
  const front = typeof raw.front === 'string' ? raw.front.trim() : ''
  const back = typeof raw.back === 'string' ? raw.back.trim() : ''
  const topic = typeof raw.topic === 'string' ? raw.topic.trim().slice(0, 40) : ''
  if (!front || !back) return { deck: [...deck], reply: 'Cartão não salvo: frente e verso não podem ficar vazios.' }
  if (front.length > MAX || back.length > MAX) return { deck: [...deck], reply: `Cartão não salvo: frente e verso têm no máximo ${MAX} caracteres cada.` }
  if (deck.some(c => c.front.toLowerCase() === front.toLowerCase())) return { deck: [...deck], reply: `Já existe um cartão com essa frente: "${front}".` }
  // ponytail: oldest dropped past CAP_MAX, keeps the store far under its 4 MiB cap.
  const next = [...deck, { src: 'cap' as const, front, back, ...(topic ? { topic } : {}) }].slice(-CAP_MAX)
  return { deck: next, reply: `📥 Cartão salvo em Capturados (${next.length} no deck): "${front}"` }
}

async function save($: EngineInterface, raw: { front?: unknown; back?: unknown; topic?: unknown }): Promise<string> {
  const { deck, reply } = addCard(await captured($), raw)
  await $.store.set(CAP_KEY, deck)
  return reply
}

/** `/cartao frente | verso | tópico`, the topic optional. */
export function parseCommand(args: string): { front?: string; back?: string; topic?: string } {
  const [front, back, topic] = args.split('|').map(s => s.trim())
  return { front, back, topic }
}

async function deal($: EngineInterface) {
  const cap = await captured($)
  const next = pick([...(await loadDecks($)), ...(cap.length ? [cap] : [])])
  await update($, card, () => next)
  await update($, isRevealed, () => false)
}

const NAME = { it: '🇮🇹 PT→IT', dev: '💻 RoadToDev', linux: '🐧 Linux', cap: '📥 Capturados' } as const
const COLOR = { it: 'green', dev: 'cyan', linux: 'yellow', cap: 'magenta' } as const
const label = (c: Card) => `${NAME[c.src]}${c.topic ? ` · ${c.topic}` : ''}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    if (typeof saved === 'boolean') await update($, isEnabledRef, () => saved)
    await $.command.register({ name: 'cartao', description: 'Salva um cartão de estudo: /cartao frente | verso | tópico' })
    await $.tool.register({
      name: 'salvar_cartao',
      description:
        'Salva um cartão de estudo no deck "Capturados" do usuário, que aparece no quiz enquanto Claude trabalha. Use quando o usuário pedir para guardar algo, ou logo depois de explicar um conceito técnico que ele claramente não conhecia (no máximo um por resposta). Frente: uma pergunta curta. Verso: a resposta em português simples. Até 280 caracteres cada.',
      inputSchema: {
        type: 'object',
        properties: {
          front: { type: 'string', description: 'A pergunta' },
          back: { type: 'string', description: 'A resposta, em português simples' },
          topic: { type: 'string', description: 'Assunto curto, ex.: git, linux, react' },
        },
        required: ['front', 'back'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'wait-quiz',
      description: 'Liga/desliga o quiz na faixa acima do prompt enquanto Claude trabalha.',
      argumentHint: 'on|off',
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'wait-quiz' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `wait-quiz esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /wait-quiz on · /wait-quiz off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    return { text: `wait-quiz ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('command.run', { command: 'cartao' }, async ($, e) => {
    if (!e.args.trim()) return { text: `Uso: /cartao frente | verso | tópico. Capturados até agora: ${(await captured($)).length}.` }
    return { text: await save($, parseCommand(e.args)) }
  })

  on('tool.call', { tool: 'mcp__wait-quiz__salvar_cartao' }, async ($, e) => {
    const reply = await save($, e as { front?: unknown; back?: unknown; topic?: unknown }).catch(() => 'Cartão não salvo: falha ao gravar.')
    return { result: reply }
  })

  on('prompt.submit', async ($, e, next) => {
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && (await read($, isEnabledRef))) await deal($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e)) // a quiz bug must never eat the prompt

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const c = await read($, card)
    if (!e.props.isWorking || e.props.hasSurvey || !c || !(await read($, isEnabledRef))) return next(e)
    const revealed = await read($, isRevealed)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={COLOR[c.src]} paddingX={1}>
        <Text>
          <Text bold color={COLOR[c.src]}>
            {label(c)}
          </Text> {c.front}
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

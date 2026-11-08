import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Suggestion } from '../types'

const band = atom({ plugin: 'next-prompts', key: 'band' } as const, { items: [], note: null } as Band)
const isEnabledRef = atom({ plugin: 'next-prompts', key: 'isEnabled' } as const, true)

/** Past this the context is where the money goes (jev-router telemetry, week to 2026-10-06). */
const CONTEXT_WARN_TOKENS = 200_000
const TRANSCRIPT_CHARS = 4_000
const MAX_COMMANDS = 120

/**
 * The model's answer is untrusted: cloud gemma wraps JSON in a markdown fence
 * and ignores `format`, and any model can invent a slash command. Anything
 * off-shape or naming a command this session doesn't have is dropped.
 */
export function parseSuggestions(raw: string, commands: ReadonlySet<string>): Suggestion[] {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return []
  let list: unknown
  try {
    list = (JSON.parse(json) as { suggestions?: unknown }).suggestions
  } catch {
    return []
  }
  if (!Array.isArray(list)) return []
  return list
    .filter((s): s is Suggestion => typeof s?.label === 'string' && typeof s?.text === 'string' && s.text.trim() !== '')
    // '!' runs a shell command and '#' saves memory in the prompt box: never draft those from a model.
    .filter(s => !/^[!#]/.test(s.text.trim()))
    .filter(s => {
      const cmd = s.text.trim().match(/^\/([\w:-]+)/)?.[1]
      return !cmd || commands.has(cmd)
    })
    .slice(0, 3)
    .map(s => ({ label: s.label.trim().slice(0, 40), text: s.text.trim() }))
}

function transcript(messages: { role: string; text: string }[]): string {
  let out = ''
  for (const m of [...messages].reverse()) {
    if (!m.text.trim()) continue
    const line = `${m.role.toUpperCase()}: ${m.text.trim()}\n`
    if (out.length + line.length > TRANSCRIPT_CHARS) break
    out = line + out
  }
  return out
}

// Credentials never leave the machine inside the transcript. Same patterns as universal-audit-log
// (mods load isolated, so they are copied, not imported).
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '•••'],
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/AIza[\w-]{35}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

/** Where agy lives: AGY_BIN, else ~/.local/bin/agy (Linux; a wrapper there may run it on another host), else the Windows install. */
async function agyPath($: EngineInterface): Promise<string> {
  const explicit = await $.env.get('AGY_BIN').catch(() => undefined)
  if (explicit) return explicit
  const home = await $.env.get('HOME').catch(() => undefined)
  if (home) return `${home.replace(/\/+$/, '')}/.local/bin/agy`
  const local = await $.env.get('LOCALAPPDATA').catch(() => undefined)
  if (local) return `${local}/agy/bin/agy.exe`
  throw new Error('agy not found: set AGY_BIN')
}

/** Gemini through the Antigravity CLI: prompt on stdin only (with -p it answers empty, exit 0); plan mode cannot write. */
async function agyChat($: EngineInterface, model: string, prompt: string): Promise<string> {
  const { exitCode, stdout, stderr } = await $.process.run(
    [await agyPath($), '--mode', 'plan', '--model', model, '--print-timeout', '60s'],
    { stdin: prompt, timeoutMs: 90_000 },
  )
  if (exitCode !== 0 || !stdout.trim()) throw new Error(stderr.trim().split('\n').pop() || `exit ${exitCode}, empty`)
  return stdout
}

/** Rule-based items first, then the model's; `isCurrent` drops an answer a newer turn superseded. */
async function refresh($: EngineInterface, model: string, isCurrent: () => boolean): Promise<void> {
  const rules: Suggestion[] = []
  const { context } = await $.session.usage()
  if ((context.tokens ?? 0) >= CONTEXT_WARN_TOKENS) {
    rules.push({ label: `/compact (ctx ${Math.round((context.tokens ?? 0) / 1000)}k)`, text: '/compact' })
  }

  const commands = (await $.command.list()).map(c => c.name)
  const known = new Set(commands)
  const prompt = `You suggest the user's NEXT prompt in a Claude Code session. Read the recent conversation and propose exactly 3 short next steps the user would plausibly want, in the user's language.
Each suggestion is either a natural-language prompt, or starts with one of these available commands: ${commands.slice(0, MAX_COMMANDS).map(c => `/${c}`).join(' ')}.
Never use a slash command that is not in that list. Be specific to this conversation, not generic.
Return ONLY JSON: {"suggestions":[{"label":"<=40 chars","text":"<full prompt to put in the input box>"}]} with EXACTLY 3 items.

Recent conversation:
${redact(transcript(await $.session.messages()))}`

  let items: Suggestion[] = []
  let note: string | null = null
  try {
    items = parseSuggestions(await agyChat($, model, prompt), known)
    if (items.length === 0) note = `agy ${model}: sem sugestões válidas`
  } catch (err) {
    note = `agy ${model}: ${(err as Error).message.slice(0, 120)}`
  }

  // A newer turn already started its own refresh: this answer is stale.
  if (!isCurrent()) return
  await update($, band, () => ({ items: [...rules, ...items].slice(0, 3), note, picked: [] }))
}

/** The first pick replaces the draft; later ones stack under it, one per line, never twice. */
async function pick($: EngineInterface, indexes: number[]): Promise<void> {
  const { items, picked = [] } = await read($, band)
  const fresh = indexes.filter(i => items[i] && !picked.includes(i))
  if (fresh.length === 0) return
  const text = fresh.map(i => items[i]!.text).join('\n')
  await $.prompt.fill(picked.length === 0 ? { text } : { text: `\n${text}`, mode: 'append' })
  await update($, band, b => ({ ...b, picked: [...picked, ...fresh] }))
}

export const register: Register = (on, options) => {
  const model = String(options.agyModel ?? 'gemini-3.8-flash-high').trim() || 'gemini-3.8-flash-high'
  let generation = 0

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))
    await $.command.register({
      name: 'next-prompts',
      description: 'Liga/desliga as sugestões de próximo passo acima do prompt.',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'next-prompts' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `next-prompts esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /next-prompts on · /next-prompts off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    return { text: `next-prompts ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagents end turns too; only the main conversation's next step matters.
    if (e.agentId || e.isAborted || !(await read($, isEnabledRef))) return result
    // Unawaited: the band fills in when the model answers, the turn never waits on it.
    const mine = ++generation
    void refresh($, model, () => mine === generation).catch(() => undefined)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { items, note, picked = [] } = await read($, band)
    if (e.props.hasSurvey || e.props.isWorking || (items.length === 0 && !note) || !(await read($, isEnabledRef))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    // Stack over whatever the plugins beneath draw (painel's weather), so load order never hides either.
    const below = await next(e)
    const mine = (
      <Box gap={1}>
        <Text dimColor>next:</Text>
        {items.map((s, i) => (
          <Button
            key={`s${i}`}
            label={`${i + 1} ${picked.includes(i) ? '✓ ' : ''}${s.label}`}
            hotkey={String(i + 1)}
            onPress={() => pick($, [i])}
          />
        ))}
        {items.length > 1 ? (
          <Button key="all" label="0 todas" hotkey="0" onPress={() => pick($, items.map((_, i) => i))} />
        ) : null}
        {note ? <Text dimColor>{note}</Text> : null}
      </Box>
    )
    return below.type === 'engine' ? mine : <Box flexDirection="column">{mine}{below}</Box>
  })
}

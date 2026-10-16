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

const OLLAMA_CLOUD = 'https://ollama.com'

/** One place the suggestions can come from: `ask` resolves the model's raw text or throws why not. */
type Source = { name: string; ask: (prompt: string) => Promise<string> }

async function ollamaChat($: EngineInterface, url: string, model: string, prompt: string, key?: string): Promise<string> {
  let res
  try {
    res = await $.http.fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        think: false,
        options: { temperature: 0.3 },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch {
    throw new Error(`offline (${url})`)
  }
  let body: { message?: { content?: string }; error?: string } = {}
  try {
    body = JSON.parse(res.text)
  } catch {}
  if (!res.ok || !body.message?.content) throw new Error(body.error ?? `HTTP ${res.status}`)
  return body.message.content
}

/** Gemini through the Antigravity CLI: prompt on stdin only (with -p it answers empty, exit 0); plan mode cannot write. */
async function agyChat($: EngineInterface, model: string, prompt: string): Promise<string> {
  const base = await $.env.get('LOCALAPPDATA')
  if (!base) throw new Error('LOCALAPPDATA unset')
  const { exitCode, stdout, stderr } = await $.process.run(
    [`${base}/agy/bin/agy.exe`, '--mode', 'plan', '--model', model, '--print-timeout', '60s'],
    { stdin: prompt, timeoutMs: 90_000 },
  )
  if (exitCode !== 0 || !stdout.trim()) throw new Error(stderr.trim().split('\n').pop() || `exit ${exitCode}, empty`)
  return stdout
}

/** Rule-based items first, then the model's; `isCurrent` drops an answer a newer turn superseded. */
async function refresh(
  $: EngineInterface,
  models: string[],
  ollamaUrl: string,
  agyModel: string,
  isCurrent: () => boolean,
): Promise<void> {
  const rules: Suggestion[] = []
  const { context } = await $.session.usage()
  if (context.tokens >= CONTEXT_WARN_TOKENS) {
    rules.push({ label: `/compact (ctx ${Math.round(context.tokens / 1000)}k)`, text: '/compact' })
  }

  const commands = (await $.command.list()).map(c => c.name)
  const known = new Set(commands)
  const prompt = `You suggest the user's NEXT prompt in a Claude Code session. Read the recent conversation and propose exactly 3 short next steps the user would plausibly want, in the user's language.
Each suggestion is either a natural-language prompt, or starts with one of these available commands: ${commands.slice(0, MAX_COMMANDS).map(c => `/${c}`).join(' ')}.
Never use a slash command that is not in that list. Be specific to this conversation, not generic.
Return ONLY JSON: {"suggestions":[{"label":"<=40 chars","text":"<full prompt to put in the input box>"}]} with EXACTLY 3 items.

Recent conversation:
${transcript(await $.session.messages())}`

  // In order of preference, tried every turn: one out of quota or erroring hands over to the
  // next, and the first comes back on its own once its quota resets.
  const sources: Source[] = models.map(model => ({ name: model, ask: p => ollamaChat($, ollamaUrl, model, p) }))
  // A second Ollama account: the local server holds one sign-in, the cloud API takes any account's key.
  const key = await $.env.get('NEXT_PROMPTS_OLLAMA_KEY')
  if (key) {
    for (const model of models) {
      const cloud = model.replace(/-cloud$/, '')
      sources.push({ name: `ollama.com ${cloud}`, ask: p => ollamaChat($, OLLAMA_CLOUD, cloud, p, key) })
    }
  }
  if (agyModel) sources.push({ name: `agy ${agyModel}`, ask: p => agyChat($, agyModel, p) })

  let items: Suggestion[] = []
  let note: string | null = null
  for (const source of sources) {
    try {
      items = parseSuggestions(await source.ask(prompt), known)
      if (items.length > 0) {
        note = null
        break
      }
      note = `${source.name}: sem sugestões válidas`
    } catch (err) {
      note = `${source.name}: ${(err as Error).message.slice(0, 120)}`
    }
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
  const text = fresh.map(i => items[i].text).join('\n')
  await $.prompt.fill(picked.length === 0 ? { text } : { text: `\n${text}`, mode: 'append' })
  await update($, band, b => ({ ...b, picked: [...picked, ...fresh] }))
}

export const register: Register = (on, options) => {
  const models = String(options.model ?? 'gemma4:31b-cloud,gpt-oss:20b-cloud')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean)
  const ollamaUrl = String(options.ollamaUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
  // Empty turns the Gemini fallback off.
  const agyModel = String(options.agyModel ?? 'gemini-3.8-flash-low').trim()
  let generation = 0

  on('session.start', async ($, e, next) => {
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
    return { text: `next-prompts ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagents end turns too; only the main conversation's next step matters.
    if (e.agentId || e.isAborted || !(await read($, isEnabledRef))) return result
    // Unawaited: the band fills in when the model answers, the turn never waits on it.
    const mine = ++generation
    void refresh($, models, ollamaUrl, agyModel, () => mine === generation).catch(() => undefined)
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

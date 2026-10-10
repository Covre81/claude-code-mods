import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Suggestion } from '../types'

const band = atom({ plugin: 'next-prompts', key: 'band' } as const, { items: [], note: null } as Band)

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

/** Rule-based items first, then the model's; `isCurrent` drops an answer a newer turn superseded. */
async function refresh($: EngineInterface, model: string, ollamaUrl: string, isCurrent: () => boolean): Promise<void> {
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

  let items: Suggestion[] = []
  let note: string | null = null
  try {
    const res = await $.http.fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        think: false,
        options: { temperature: 0.3 },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const body = JSON.parse(res.text) as { message?: { content?: string }; error?: string }
    if (!res.ok || !body.message?.content) note = `${model}: ${body.error ?? `HTTP ${res.status}`}`
    else items = parseSuggestions(body.message.content, known)
  } catch {
    note = `Ollama offline (${ollamaUrl})`
  }

  // A newer turn already started its own refresh: this answer is stale.
  if (!isCurrent()) return
  await update($, band, () => ({ items: [...rules, ...items].slice(0, 3), note }))
}

export const register: Register = (on, options) => {
  const model = String(options.model ?? 'gemma4:31b-cloud')
  const ollamaUrl = String(options.ollamaUrl ?? 'http://127.0.0.1:11434').replace(/\/$/, '')
  let generation = 0

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Subagents end turns too; only the main conversation's next step matters.
    if (e.agentId || e.isAborted) return result
    // Unawaited: the band fills in when the model answers, the turn never waits on it.
    const mine = ++generation
    void refresh($, model, ollamaUrl, () => mine === generation).catch(() => undefined)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { items, note } = await read($, band)
    if (e.props.hasSurvey || e.props.isWorking || (items.length === 0 && !note)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box gap={1}>
        <Text dimColor>next:</Text>
        {items.map((s, i) => (
          <Button
            key={`s${i}`}
            label={`${i + 1} ${s.label}`}
            hotkey={String(i + 1)}
            onPress={() => $.prompt.fill({ text: s.text })}
          />
        ))}
        {note ? <Text dimColor>{note}</Text> : null}
      </Box>
    )
  })
}

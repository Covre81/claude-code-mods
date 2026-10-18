/**
 * universal-audit-log — Claude Mod
 *
 * One hook on "*" sees every event: the engine's own (tool.call, prompt.submit,
 * turn.*, ...) and every other plugin's calls on `$` (fs.read, http.fetch,
 * process.run, ...). It records one JSON line per dispatch: the event, who
 * raised it (`next.origin`: plugin and tier), how long it took and whether
 * something beneath denied or threw. The "after" placement, so the outcome is
 * recorded too; denials surface here as the value `next(e)` resolves to.
 *
 * Lines are buffered in memory and flushed to a JSONL file through `$.fs`
 * (there is no append on `$`, so a flush reads the file, keeps its tail under
 * `maxBytes`, and writes it back) at the end of every turn and every
 * `flushEvery` events. The hook is never re-entered for its own `$.fs` calls,
 * so flushing from inside it does not recurse.
 *
 * Seat this plugin FIRST (an org prepends it in managed settings) so nothing
 * beneath it can bypass the log. A hook that fails is skipped by the engine
 * (fail-open, logged in --debug-file), so it never blocks the session.
 *
 * Needs Claude Code >= 2.1.287. Typed
 * against Anthropic's declarations: https://github.com/anthropics/claude-code/tree/main/mods
 *
 * Options:
 *   path:       string    JSONL file, relative to the working directory (default ".claude/logs/mods-audit.jsonl")
 *   skipEvents: string    events not to record, comma-separated (default: the render / log chatter)
 *   flushEvery: number    flush after this many buffered lines (default 50)
 *   maxBytes:   number    keep the file under this many UTF-8 bytes, dropping the oldest lines (default 2 MiB, at most 3 MiB)
 *
 * Vendored from davila7/claude-code-templates (cli-tool/components/mods/observability/universal-audit-log),
 * MIT licensed. Added: an isEnabled toggle (/universal-audit-log on|off) so meus-mods can control it.
 */
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isEnabledRef = atom({ plugin: 'universal-audit-log', key: 'isEnabled' } as const, true)

/** A list option: a string[] or a comma-separated string (what a manifest's `userConfig` string field holds); empty means unset. */
function strings(value: unknown): string[] | undefined {
  const list = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : typeof value === 'string'
      ? value.split(',').map((s) => s.trim()).filter(Boolean)
      : []
  return list.length > 0 ? list : undefined
}

const MAX_FIELD = 200
const encoder = new TextEncoder()
const bytes = (text: string) => encoder.encode(text).length

// Credentials never reach the file. Patterns from scasella/claude-flightdeck
// (hooks/core.ts redact) plus the cofre mod's (hooks/secrets.ts PATTERNS):
// mods are separate packages, so they are copied rather than imported.
const SECRETS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '•••'],
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?\S+/gi, '$1$2•••'],
  [/\b(bearer)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, '$1 •••'],
  [/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abprs])[-_][A-Za-z0-9_-]{8,}/g, '•••'],
  [/AIza[\w-]{35}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g, '•••'],
  [/((?:api[_-]?key|access[_-]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/(--(?:token|password|api-key|secret)[= ])\S+/gi, '$1•••'],
  [/(\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)=)\S+/g, '$1•••'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@]+@/gi, '$1•••@'],
]
export const redact = (s: string) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s)

// redact before cutting: a cut token would no longer match its pattern
const clip = (s: string) => {
  const r = redact(s)
  return r.length > MAX_FIELD ? r.slice(0, MAX_FIELD) + '…' : r
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** What a tool.check input touched (its command, path, pattern...), as Flightdeck's describeInput. */
function describe(input: object): string {
  const i = input as Record<string, unknown>
  return str(i.command) || str(i.file_path) || str(i.path) || str(i.pattern) || str(i.url) || str(i.description)
}

function summarize(e: unknown): Record<string, unknown> {
  if (!e || typeof e !== 'object') return { value: clip(String(e)) }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === 'string') out[k] = clip(v)
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = `[array:${v.length}]`
    else if (v && typeof v === 'object') out[k] = k === 'input' && describe(v) ? clip(describe(v)) : '[object]'
  }
  return out
}

function denialOf(result: unknown): string | undefined {
  if (result && typeof result === 'object' && 'deny' in result && typeof result.deny === 'string') return result.deny
  return undefined
}

export const register: Register = (on, options) => {
  const logPath = typeof options.path === 'string' ? options.path : '.claude/logs/mods-audit.jsonl'
  const skip = new Set<string>(
    strings(options.skipEvents) ??
      // turn.step is a stream (an async generator hook); a plain hook passes it through untouched.
      ['ui.log', 'ui.render', 'ui.resolve', 'ui.invalidate', 'ui.status', 'clock.now', 'turn.step'],
  )
  const flushEvery = typeof options.flushEvery === 'number' ? options.flushEvery : 50
  // $.fs.read stops at 4 MiB: the file must stay under that or the next flush could not read it back
  const maxBytes = Math.min(typeof options.maxBytes === 'number' ? options.maxBytes : 2 * 1024 * 1024, 3 * 1024 * 1024)

  const buffer: string[] = []
  // flushes are read-modify-write: run them one after another, never two at once
  let flushing: Promise<void> = Promise.resolve()

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    if (typeof saved === 'boolean') await update($, isEnabledRef, () => saved)
    await $.command.register({
      name: 'universal-audit-log',
      description: 'Liga/desliga o registro de auditoria de todos os eventos em JSONL.',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'universal-audit-log' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `universal-audit-log esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /universal-audit-log on · /universal-audit-log off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    return { text: `universal-audit-log ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('*', async ($, e, next) => {
    if (skip.has(next.event)) return next(e)
    // $.state is not wired yet at engine.create (the bootstrap event this
    // wildcard hook also sees): fail open and keep logging rather than throw.
    let isEnabled = true
    try {
      isEnabled = await read($, isEnabledRef)
    } catch {
      isEnabled = true
    }
    if (!isEnabled) return next(e)

    const startedAt = Date.now()
    let outcome = 'ok'
    try {
      const result = await next(e)
      const denied = denialOf(result)
      if (denied !== undefined) outcome = `denied: ${denied}`
      return result
    } catch (err) {
      outcome = `threw: ${err instanceof Error ? err.message : String(err)}`
      throw err
    } finally {
      const line =
        JSON.stringify({
          ts: new Date(startedAt).toISOString(),
          event: next.event,
          origin: next.origin,
          durationMs: Date.now() - startedAt,
          outcome,
          input: summarize(e),
        }) + '\n'
      // a record that alone would not fit the file is dropped rather than kept forever
      if (bytes(line) <= maxBytes) buffer.push(line)

      if (next.event === 'turn.complete' || buffer.length >= flushEvery) {
        const pending = buffer.splice(0, buffer.length).join('')
        flushing = flushing.then(async () => {
          try {
            let prior = ''
            if (await $.fs.exists(logPath)) {
              try {
                prior = await $.fs.read(logPath)
              } catch (err) {
                // an existing file that cannot be read back is replaced, and the replacement says so
                $.ui.log(`[universal-audit-log] ${logPath} could not be read back, starting it over: ${err instanceof Error ? err.message : String(err)}`)
              }
            }
            let text = prior + pending
            // The limit is UTF-8 bytes, the size on disk: drop whole lines from the front until the tail fits.
            while (bytes(text) > maxBytes) {
              const cut = text.indexOf('\n')
              if (cut === -1) { text = ''; break }
              text = text.slice(cut + 1)
            }
            await $.fs.write(logPath, text)
          } catch (err) {
            // $.fs withheld by an admin plugin, or the path unwritable: keep the lines for the next flush.
            buffer.unshift(pending)
            $.ui.log(`[universal-audit-log] could not write ${logPath}: ${err instanceof Error ? err.message : String(err)}`)
          }
        })
        await flushing
      }
    }
  })
}

import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

const isEnabledRef = atom({ plugin: 'delegation-dock', key: 'isEnabled' } as const, true)

type Job = { tool: string; startedAt: number; outputPath?: string; isRedirected: boolean }

/** Which delegate a shell command starts, or undefined for any other command. */
export function delegateOf(command: string): string | undefined {
  if (/(^|[\s;&|(/\\"])agy(\.exe)?"?\s/.test(command) && !/agy(\.exe)?\s+(models|--help|-h\b|--version)/.test(command)) return 'agy'
  if (/(^|[\s;&|(/\\"])codex(\.cmd)?"?\s+exec\b/.test(command)) return 'codex'
  if (/(^|[\s;&|(/\\"])ollama(\.exe)?"?\s+run\b/.test(command) || /batch_llm\.py/.test(command)) return 'ollama'
  return undefined
}

/** stdout sent to a file (`> out.txt`): an empty task output then says nothing about agy. */
export const isRedirected = (command: string) => /(^|[^2&>])>>?\s*[^&\s]/.test(command)

export const EMPTY_AGY =
  'delegation-dock: agy terminou com saída VAZIA (exit 0). É a falha silenciosa conhecida do `agy -p` (CLAUDE.md, 2026-10-06): ' +
  'não trate como resposta. Remonte como bundle via stdin, sem -p: `agy --mode plan --model gemini-3.1-pro-high --print-timeout 540s < bundle.txt`.'

export function dockText(jobs: Iterable<Job>, now: number): string | undefined {
  const parts = [...jobs].map(j => `${j.tool} ${Math.round((now - j.startedAt) / 1000)}s`)
  return parts.length ? `⏳ ${parts.join(' · ')}` : undefined
}

// ponytail: module memory; a reload mid-delegation forgets the job (the model still gets its notification).
const jobs = new Map<string, Job>()
let ticker: { cancel: () => void } | undefined
let fg = 0

function refresh($: EngineInterface) {
  $.ui.status(dockText(jobs.values(), Date.now()))
  if (jobs.size && !ticker) ticker = $.clock.every(5000, () => refresh($))
  if (!jobs.size && ticker) {
    ticker.cancel()
    ticker = undefined
  }
}

export const register: Register = on => {
  jobs.clear()

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))
    await $.command.register({
      name: 'delegation-dock',
      description: 'Liga/desliga a linha de status das delegações (agy/codex/ollama).',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'delegation-dock' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `delegation-dock esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /delegation-dock on · /delegation-dock off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    if (arg === 'off') $.ui.status(undefined)
    return { text: `delegation-dock ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!(await read($, isEnabledRef))) return next(e)
    const tool = delegateOf(e.command)
    if (!tool) return next(e)

    const key = `fg${++fg}`
    jobs.set(key, { tool, startedAt: Date.now(), isRedirected: isRedirected(e.command) })
    refresh($)
    const ran = await next(e).finally(() => {
      jobs.delete(key)
      refresh($)
    })
    if (ran.deny !== undefined || ran.isError) return ran

    const out = ran.result as { stdout?: string; backgroundTaskId?: string }
    if (out.backgroundTaskId) {
      const outputPath = /Output is being written to: (.+?\.output)/.exec(out.stdout ?? '')?.[1]
      jobs.set(out.backgroundTaskId, { tool, startedAt: Date.now(), isRedirected: isRedirected(e.command), ...(outputPath ? { outputPath } : {}) })
      refresh($)
      return ran
    }
    if (tool === 'agy' && !isRedirected(e.command) && !out.stdout?.trim()) {
      $.ui.toast('agy devolveu vazio')
      return { ...ran, context: [...(ran.context ?? []), EMPTY_AGY] }
    }
    return ran
  }).catch(($, e, next) => next(e)) // a dock bug must never block the command

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'task-notification') return next(e)
    const id = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]
    const job = id ? jobs.get(id) : undefined
    if (!id || !job) return next(e)

    jobs.delete(id)
    refresh($)
    const completed = /<status>completed<\/status>/.test(e.text)
    if (job.tool !== 'agy' || job.isRedirected || !completed || !job.outputPath) return next(e)
    const text = await $.fs.read(job.outputPath).catch(() => undefined)
    if (text === undefined || text.trim()) return next(e)
    $.ui.toast('agy devolveu vazio')
    return next({ ...e, context: [...(e.context ?? []), EMPTY_AGY] })
  }).catch(($, e, next) => next(e))
}

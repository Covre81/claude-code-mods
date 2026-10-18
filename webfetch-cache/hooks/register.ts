// Vendored from davila7/claude-code-templates (cli-tool/components/mods/productivity/webfetch-cache),
// MIT licensed. Added: an isEnabled toggle (/webfetch-cache on|off) so meus-mods can control it.
import { atom, read, update } from 'claude-code'
import type { Register, ToolCallResult } from 'claude-code'

const isEnabledRef = atom({ plugin: 'webfetch-cache', key: 'isEnabled' } as const, true)

type WebFetchRecord = Extract<ToolCallResult<'WebFetch'>, { result: unknown }>['result']

interface Entry { result: WebFetchRecord; storedAt: number }

// Module state lives for the session (a plugin's module is one worker).
const cache = new Map<string, Entry>()

export const register: Register = (on, options) => {
  const ttlMs = (typeof options.ttlSeconds === 'number' ? options.ttlSeconds : 900) * 1000
  const maxEntries = typeof options.maxEntries === 'number' ? options.maxEntries : 200

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    if (typeof saved === 'boolean') await update($, isEnabledRef, () => saved)
    await $.command.register({
      name: 'webfetch-cache',
      description: 'Liga/desliga o cache de WebFetch repetido na mesma sessão.',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'webfetch-cache' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `webfetch-cache esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /webfetch-cache on · /webfetch-cache off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    if (arg === 'off') cache.clear()
    return { text: `webfetch-cache ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('tool.call', { tool: 'WebFetch' }, async ($, e, next) => {
    if (!e.url || !(await read($, isEnabledRef))) return next(e)
    // WebFetch reads a long page in pieces (`offset`, Claude Code 2.1.290+): each piece is its own entry,
    // or a read past the first page would get the first page back. Not in the typings until they are regenerated (TODO: drop the cast then).
    const offset = (e as { offset?: unknown }).offset
    const key = `${e.url}\n${e.prompt}\n${typeof offset === 'number' ? offset : 0}`
    const now = Date.now()

    const hit = cache.get(key)
    if (hit && now - hit.storedAt < ttlMs) {
      const age = Math.round((now - hit.storedAt) / 1000)
      $.ui.log(`[webfetch-cache] hit for ${e.url} (${age}s old)`)
      // Nothing below this hook runs: no network call.
      return {
        result: hit.result,
        context: [`webfetch-cache served this result from a ${age}s-old cache entry for the same URL, prompt and offset.`],
      }
    }

    const outcome = await next(e)

    // Do not cache a denial or an errored fetch.
    if (outcome.deny === undefined && !outcome.isError) {
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(key, { result: outcome.result, storedAt: now })
    }
    return outcome
  })
}

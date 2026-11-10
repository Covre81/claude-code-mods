import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const isEnabledRef = atom({ plugin: 'colisao', key: 'isEnabled' } as const, true)

const WINDOW_MS = 30 * 60 * 1000
const CONTINUE = 'Continuar'
const CANCEL = 'Cancelar'

type Write = { session: string; at: number }
type Writes = Record<string, Write>

export const normPath = (p: string) => p.replace(/\\/g, '/').toLowerCase()

/** Another session's write on this path inside the window, if any. */
export function collision(writes: Writes, path: string, session: string, now: number): Write | undefined {
  const w = writes[normPath(path)]
  return w && w.session !== session && now - w.at < WINDOW_MS ? w : undefined
}

export function prune(writes: Writes, now: number): Writes {
  return Object.fromEntries(Object.entries(writes).filter(([, w]) => now - w.at < WINDOW_MS))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))
    await $.command.register({
      name: 'colisao',
      description: 'Liga/desliga a pergunta antes de editar arquivo que outra sessão mexeu há pouco.',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'colisao' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `colisao esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /colisao on · /colisao off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on') // $.state is per session; the store survives a restart
    return { text: `colisao ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    if (!(await read($, isEnabledRef))) return next(e)
    const input = e as { file_path?: string; notebook_path?: string }
    const path = input.file_path ?? input.notebook_path
    if (!path) return next(e)

    const session = await $.session.id()
    const now = await $.clock.now()
    const writes = ((await $.store.get('writes')) ?? {}) as Writes
    const other = collision(writes, path, session, now)
    if (other) {
      const mins = Math.max(1, Math.round((now - other.at) / 60_000))
      const choice = await $.ui
        .ask(`Outra sessão do Claude mexeu em ${path} há ${mins} min. Editar mesmo assim pode apagar o trabalho dela.`, {
          header: 'Colisão',
          options: [CONTINUE, CANCEL],
        })
        .catch(() => CONTINUE) // fail open: a maybe-collision never blocks headless runs
      if (choice === CANCEL)
        return { deny: `colisao: outra sessão editou ${path} há ${mins} min e o Bruno cancelou. Não tente de novo; pergunte o que fazer.` }
    }

    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      // ponytail: read-modify-write on a shared store, last writer wins; a lock if missed collisions show up.
      const fresh = ((await $.store.get('writes')) ?? {}) as Writes
      await $.store.set('writes', { ...prune(fresh, now), [normPath(path)]: { session, at: now } })
    }
    return ran
  }).catch(($, e, next) => next(e)) // a colisao bug must never block an edit
}

import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'
import { looksLikeRule } from './rule';

const isEnabledRef = atom({ plugin: 'reflexo', key: 'isEnabled' } as const, true)

const PROJECT = 'Projeto (CLAUDE.md)'
const GLOBAL = 'Global (~/.claude/CLAUDE.md)'
const IGNORE = 'Ignorar'
const HEADING = '## Regras capturadas'

let queuedRule: string | null = null

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))

    const isEnabled = await read($, isEnabledRef)
    $.ui.status(`reflexo: ${isEnabled ? 'on' : 'off'}`)

    await $.command.register({
      name: 'reflexo',
      description: 'Liga/desliga o reflexo (salvar correções como regras).',
      argumentHint: 'on|off',
    })
    return next(e)
  })

  on('command.run', { command: 'reflexo' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await read($, isEnabledRef)
      return { text: `reflexo esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /reflexo on · /reflexo off` }
    }
    await update($, isEnabledRef, () => arg === 'on')
    await $.store.set('isEnabled', arg === 'on')
    const isEnabled = arg === 'on'
    $.ui.status(`reflexo: ${isEnabled ? 'on' : 'off'}`)
    return { text: `reflexo ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, isEnabledRef)) && looksLikeRule(e.text)) queuedRule = e.text
    return next(e) // never blocks or drops the prompt
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e)
    const rule = queuedRule
    queuedRule = null
    if (rule === null) return next(e)
    const answer = await $.ui.ask(`Salvar como regra? "${rule}"`, { header: 'Reflexo', options: [PROJECT, GLOBAL, IGNORE] })
    if (answer === PROJECT) await appendRule($, 'CLAUDE.md', rule) // relative = session cwd
    else if (answer === GLOBAL) {
      const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
      if (home) await appendRule($, `${home}/.claude/CLAUDE.md`, rule)
    }
    return next(e) // IGNORE or free text: nothing written
  }).catch(($, e, next) => next(e)) // fail open: a dismissed ask (rejects) or a write error never blocks the turn
}

/** Appends one line under the heading; never rewrites what is already in the file. */
async function appendRule($: EngineInterface, path: string, rule: string): Promise<void> {
  // Only a missing file counts as empty; any other read error rethrows so nothing is written (fail open upstream).
  const current = await $.fs.read(path).then(r => (typeof r === 'string' ? r : ''), (err: unknown) => {
    const e = err as { code?: string; message?: string }
    if (e?.code === 'ENOENT' || /ENOENT/.test(e?.message ?? '')) return ''
    throw err
  })
  const hasHeading = current.split('\n').some(l => l.trim() === HEADING)
  const eol = current === '' || current.endsWith('\n') ? '' : '\n'
  // ponytail: with the heading present the line goes at end of file, not under the heading; fine for a trailing section.
  const head = hasHeading ? '' : `${current === '' ? '' : '\n'}${HEADING}\n`
  await $.fs.write(path, `${current}${eol}${head}- ${rule}\n`)
}

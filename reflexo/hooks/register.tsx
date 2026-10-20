import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'
import { looksLikeRule } from './rule'

const isEnabledRef = atom({ plugin: 'reflexo', key: 'isEnabled' } as const, true)

const PROJECT = 'Projeto (CLAUDE.md)'
const GLOBAL = 'Global (~/.claude/CLAUDE.md)'
const IGNORE = 'Ignorar'
const HEADING = '## Regras capturadas'

// The rule waits from prompt.submit to the end of that turn; one session runs one turn at a time, so one slot is enough.
let queuedRule: string | null = null

const statusText = (isEnabled: boolean) => `reflexo: ${isEnabled ? 'on' : 'off'}`

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))

    $.ui.status(statusText(await read($, isEnabledRef)))

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
    const isEnabled = arg === 'on'
    await update($, isEnabledRef, () => isEnabled)
    await $.store.set('isEnabled', isEnabled)
    $.ui.status(statusText(isEnabled))
    return { text: `reflexo ${isEnabled ? 'ativado' : 'desativado'}.` }
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
  const lines = current.split('\n')
  const at = lines.findIndex(l => l.trim() === HEADING)
  let end = at === -1 ? -1 : lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l))
  if (end !== -1) {
    // Another section follows: insert after the section's last non-blank line, keep every other line as is.
    while (end > at + 1 && lines[end - 1]!.trim() === '') end--
    const cr = lines[at]!.endsWith('\r') ? '\r' : ''
    lines.splice(end, 0, `- ${rule}${cr}`)
    return $.fs.write(path, lines.join('\n'))
  }
  const eol = current === '' || current.endsWith('\n') ? '' : '\n'
  const head = at !== -1 ? '' : `${current === '' ? '' : '\n'}${HEADING}\n`
  await $.fs.write(path, `${current}${eol}${head}- ${rule}\n`)
}

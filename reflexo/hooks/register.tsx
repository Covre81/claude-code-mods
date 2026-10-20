import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface, On } from 'claude-code'
import { looksLikeRule } from './reflexo.test.logic';

const isEnabledRef = atom({ plugin: 'reflexo', key: 'isEnabled' } as const, true)

let queuedRule: string | null = null;

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
    try {
      if (!(await read($, isEnabledRef))) return next(e)
      if (looksLikeRule(e.text)) {
        queuedRule = e.text;
      }
    } catch (err) {
      return next(err)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    try {
      if (!queuedRule) return next(e)

      const rule = queuedRule;
      queuedRule = null;

      const answer = await $.ui.ask({
        question: 'Salvar como regra?',
        options: ['Projeto (CLAUDE.md)', 'Global (~/.claude/CLAUDE.md)', 'Ignorar'],
      })

      if (!answer || answer === 'Ignorar') {
        return next(e)
      }

      const filePath = answer === 'Projeto (CLAUDE.md)'
        ? (await $.fs.cwd()) + '/CLAUDE.md'
        : (await $.fs.home()) + '/.claude/CLAUDE.md';

      await appendRule($, filePath, rule);
    } catch (err) {
      return next(err)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  return {}
}

async function appendRule($, filePath: string, rule: string) {
  const content = await $.fs.read(filePath).catch(() => '')
  const heading = '## Regras capturadas'

  let newContent;
  if (content.includes(heading)) {
    newContent = content.replace(heading, `${heading}\n- ${rule}`)
  } else {
    newContent = content + (content ? '\n\n' : '') + `${heading}\n- ${rule}`
  }

  await $.fs.write(filePath, newContent)
}

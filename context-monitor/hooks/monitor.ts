import { read, update } from 'claude-code'
import type { Register } from 'claude-code'

/** One switch for painel's band and recording and uso-vivo's box (each file redeclares it); memoria keeps its own (/memoria). */
const MON_KEY = 'context-monitor.isEnabled'

export const register: Register = on => {
  // One plugin may hook session.start only once, so every part's command is declared here.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'monitor', description: 'Liga/desliga a faixa de contexto e uso, o replay e a atividade.', argumentHint: 'on|off' })
    await $.command.register({ name: 'replay', description: 'Mostra, passo a passo, o que o último turno mudou nos arquivos' })
    await $.command.register({ name: 'atividade', description: 'Linha do tempo das ferramentas do último turno, com tokens, custo e limites' })
    await $.command.register({ name: 'memoria', description: 'Liga/desliga a busca no ai-memory antes de cada prompt.', argumentHint: 'on|off' })
    return next(e)
  })

  on('command.run', { command: 'monitor' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== 'on' && arg !== 'off') {
      const isEnabled = await $.settings.get(MON_KEY)
      return { text: `monitor esta ${isEnabled ? 'ativado' : 'desativado'}. Uso: /monitor on · /monitor off` }
    }
    await $.settings.set(MON_KEY, arg === 'on')
    return { text: `monitor ${arg === 'on' ? 'ativado' : 'desativado'}.` }
  })
}

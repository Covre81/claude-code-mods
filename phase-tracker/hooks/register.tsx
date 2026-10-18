import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PhaseId } from '../types'
import { formatBadge, nextPhase, parsePhaseArgs } from './phases'

const isEnabledRef = atom({ plugin: 'phase-tracker', key: 'isEnabled' } as const, true)
const currentRef = atom({ plugin: 'phase-tracker', key: 'current' } as const, 'idle' as PhaseId)
const taskRef = atom({ plugin: 'phase-tracker', key: 'task' } as const, null as string | null)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'fase',
      description: 'Acompanha e gerencia a fase da tarefa atual (spec, test, code, verify, done, next, reset)',
      argumentHint: '<fase|next|reset|on|off> [descricao]',
    })
    return next(e)
  })

  on('command.run', { command: 'fase' }, async ($, e) => {
    const parsed = parsePhaseArgs(e.args)
    if (parsed.error) return { text: parsed.error }

    if (parsed.action === 'on' || parsed.action === 'off') {
      const isEnabled = parsed.action === 'on'
      await update($, isEnabledRef, () => isEnabled)
      return { text: `phase-tracker ${isEnabled ? 'ativado' : 'desativado'}.` }
    }

    if (parsed.action === 'reset') {
      await update($, currentRef, () => 'idle')
      await update($, taskRef, () => null)
      return { text: 'Fase resetada para idle.' }
    }

    if (parsed.action === 'next') {
      const curr = await read($, currentRef)
      const next = nextPhase(curr)
      await update($, currentRef, () => next)
      const task = await read($, taskRef)
      return { text: `Avançado para a fase: ${formatBadge(next, task)}` }
    }

    if (parsed.phase) {
      await update($, currentRef, () => parsed.phase!)
      await update($, taskRef, () => parsed.task ?? null)
      return { text: `Fase definida: ${formatBadge(parsed.phase, parsed.task ?? null)}` }
    }

    const curr = await read($, currentRef)
    const task = await read($, taskRef)
    return { text: `Fase atual: ${formatBadge(curr, task) || 'idle'}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const isEnabled = await read($, isEnabledRef)
    if (!isEnabled) return next(e)

    const current = await read($, currentRef)
    const task = await read($, taskRef)
    const badge = formatBadge(current, task)
    if (!badge) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const below = await next(e)

    const mine = (
      <Box width={e.props.bodyColumns} flexDirection="row">
        <Text color="#4aa3df" bold>
          {badge}
        </Text>
      </Box>
    )

    return below.type === 'engine' ? mine : (
      <Box flexDirection="column">
        {below}
        {mine}
      </Box>
    )
  })
}

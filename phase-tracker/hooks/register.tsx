import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PhaseId } from '../types'
import { formatBadge, nextPhase, parsePhaseArgs } from './phases'

const isEnabledRef = atom({ plugin: 'phase-tracker', key: 'isEnabled' } as const, true)
const currentRef = atom({ plugin: 'phase-tracker', key: 'current' } as const, 'idle' as PhaseId)
const taskRef = atom({ plugin: 'phase-tracker', key: 'task' } as const, null as string | null)

/** Store key of a project's phase: the store is global, so each folder gets its own. */
export const phaseKey = (cwd: string) => `phase:${cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`

// Set at session.start (which re-fires on reload); saves go to the project the phase was loaded from, even after a /cd.
// ponytail: keyed by the start folder, a session opened in a subfolder is a separate project; walk up to the git root if that bites.
let projectKey = phaseKey('')

// $.state is per session: phase and task are mirrored to the store and restored at session.start.
async function savePhase($: EngineInterface) {
  await $.store.set(projectKey, { current: await read($, currentRef), task: await read($, taskRef) })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('isEnabled').catch(() => undefined)
    await update($, isEnabledRef, () => (typeof saved === 'boolean' ? saved : isEnabledRef.initial))
    projectKey = phaseKey(e.cwd)
    const phase = (await $.store.get(projectKey).catch(() => undefined)) as { current?: PhaseId; task?: string | null } | undefined
    await update($, currentRef, () => phase?.current ?? 'idle')
    await update($, taskRef, () => phase?.task ?? null)
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
      await $.store.set('isEnabled', isEnabled) // $.state is per session; the store survives a restart
      return { text: `phase-tracker ${isEnabled ? 'ativado' : 'desativado'}.` }
    }

    if (parsed.action === 'reset') {
      await update($, currentRef, () => 'idle')
      await update($, taskRef, () => null)
      await savePhase($)
      return { text: 'Fase resetada para idle.' }
    }

    if (parsed.action === 'next') {
      const curr = await read($, currentRef)
      const next = nextPhase(curr)
      await update($, currentRef, () => next)
      await savePhase($)
      const task = await read($, taskRef)
      return { text: `Avançado para a fase: ${formatBadge(next, task)}` }
    }

    if (parsed.phase) {
      await update($, currentRef, () => parsed.phase!)
      await update($, taskRef, () => parsed.task ?? null)
      await savePhase($)
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

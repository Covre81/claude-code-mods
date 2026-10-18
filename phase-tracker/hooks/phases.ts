import type { PhaseId } from '../types'

const ORDER: PhaseId[] = ['idle', 'spec', 'test', 'code', 'verify', 'done']

export function nextPhase(current: PhaseId): PhaseId {
  const idx = ORDER.indexOf(current)
  if (idx === -1 || idx === ORDER.length - 1) return 'idle'
  return ORDER[idx + 1]!
}

export type ParsedPhase = {
  phase?: PhaseId
  task?: string
  action?: 'next' | 'reset' | 'off' | 'on'
  error?: string
}

const PHASES: Record<string, PhaseId> = {
  spec: 'spec',
  test: 'test',
  code: 'code',
  verify: 'verify',
  done: 'done',
}

export function parsePhaseArgs(input: string): ParsedPhase {
  const trimmed = input.trim()
  if (!trimmed) return { error: 'Fase ou ação desconhecida: comando vazio' }

  const parts = trimmed.split(/\s+/)
  const head = parts[0]!.toLowerCase()
  const task = parts.slice(1).join(' ').trim() || undefined

  if (head === 'next' || head === 'reset' || head === 'off' || head === 'on') {
    return { action: head }
  }

  if (head in PHASES) {
    return { phase: PHASES[head], task }
  }

  return { error: `Fase ou ação desconhecida: ${head}` }
}

const LABELS: Record<PhaseId, string> = {
  idle: '',
  spec: '[1/4 Spec]',
  test: '[2/4 Test]',
  code: '[3/4 Code]',
  verify: '[4/4 Verify]',
  done: '[✓ Concluído]',
}

export function formatBadge(phase: PhaseId, task: string | null): string {
  if (phase === 'idle') return ''
  const prefix = LABELS[phase]
  return task ? `${prefix} ${task}` : prefix
}

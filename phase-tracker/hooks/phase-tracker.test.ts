import { describe, expect, test } from 'claude-code/testing'

import { formatBadge, nextPhase, parsePhaseArgs } from './phases'

describe('phase-tracker: transição de fases', () => {
  test('nextPhase avança sequencialmente pelas 4 etapas do Karpathy', () => {
    expect(nextPhase('idle')).toBe('spec')
    expect(nextPhase('spec')).toBe('test')
    expect(nextPhase('test')).toBe('code')
    expect(nextPhase('code')).toBe('verify')
    expect(nextPhase('verify')).toBe('done')
    expect(nextPhase('done')).toBe('idle')
  })
})

describe('phase-tracker: parsing de comando /fase', () => {
  test('reconhece fases válidas e extrai a descrição da tarefa', () => {
    expect(parsePhaseArgs('spec Scaffold e premissas')).toEqual({
      phase: 'spec',
      task: 'Scaffold e premissas',
    })
    expect(parsePhaseArgs('test')).toEqual({
      phase: 'test',
      task: undefined,
    })
    expect(parsePhaseArgs('code Implementar register')).toEqual({
      phase: 'code',
      task: 'Implementar register',
    })
  })

  test('suporta comandos especiais: next, reset, done, off, on', () => {
    expect(parsePhaseArgs('next')).toEqual({ action: 'next' })
    expect(parsePhaseArgs('reset')).toEqual({ action: 'reset' })
    expect(parsePhaseArgs('done')).toEqual({ phase: 'done', task: undefined })
    expect(parsePhaseArgs('off')).toEqual({ action: 'off' })
    expect(parsePhaseArgs('on')).toEqual({ action: 'on' })
  })

  test('rejeita argumentos inválidos com erro explícito', () => {
    const res = parsePhaseArgs('banana')
    expect(res.error).toBeDefined()
    expect(res.error).toContain('Fase ou ação desconhecida')
  })
})

describe('phase-tracker: formatação do badge na UI', () => {
  test('retorna string vazia quando idle', () => {
    expect(formatBadge('idle', null)).toBe('')
    expect(formatBadge('idle', 'alguma tarefa')).toBe('')
  })

  test('formata badge compacto com número da fase e tarefa', () => {
    expect(formatBadge('spec', 'Validar premissas')).toBe('[1/4 Spec] Validar premissas')
    expect(formatBadge('test', 'Testes falhando')).toBe('[2/4 Test] Testes falhando')
    expect(formatBadge('code', null)).toBe('[3/4 Code]')
    expect(formatBadge('verify', 'Validar npm test')).toBe('[4/4 Verify] Validar npm test')
    expect(formatBadge('done', 'Feature entregue')).toBe('[✓ Concluído] Feature entregue')
  })
})

import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { describe, expect, test } from 'claude-code/testing'
import { speedLine, stamp, switchLine } from './register'

// 2026-10-18 13:05:09 UTC = 14:05:09 em Londres (BST)
const T = Date.UTC(2026, 9, 18, 13, 5, 9)

describe('stamp', () => {
  test('hora de Londres com segundos', () => {
    expect(stamp(T)).toBe('14:05:09')
  })
})

describe('switchLine', () => {
  test('nada quando não há modelo anterior ou ele é o mesmo', () => {
    expect(switchLine(undefined, 'claude-opus-5-5', T)).toBe(null)
    expect(switchLine('claude-opus-5-5', 'claude-opus-5-5', T)).toBe(null)
  })
  test('marca de/para com a hora', () => {
    expect(switchLine('claude-opus-5-5', 'gpt-oss:20b-cloud', T)).toBe('⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gpt-oss:20b-cloud')
  })
})

function stub(on: On, models: string[]) {
  const logged: string[] = []
  on('clock.now', () => ({ value: T }) as never)
  // eslint-disable-next-line require-yield
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { model: models.shift() } as never }
  })
  on('ui.log', (_$, e) => {
    logged.push((e as { text: string }).text)
    return { value: undefined } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  return logged
}

async function step($: Engine, agentId?: string) {
  const s = $.turn.step({ turnId: 't', index: 0, model: 'x', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for (;;) if ((await s.next()).done) return
}

describe('turn.step', () => {
  test('loga só quando o modelo que respondeu muda, e ignora subagente', async ($, on) => {
    const logged = stub(on, ['claude-opus-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'gpt-oss:20b-cloud'])
    await step($)
    await step($)
    await step($, 'sub-1')
    await step($)
    expect(logged).toEqual(['⇄ 14:05:09 modelo trocado: claude-opus-5-5 → gpt-oss:20b-cloud'])
  })
})

describe('speedLine', () => {
  test('TTFT e tok/s do passo', () => {
    expect(speedLine(0, 800, 2800, 100)).toBe('⚡ TTFT 800ms · 50.0 tok/s')
  })
  test('sem primeiro token não há linha', () => {
    expect(speedLine(0, null, 2800, 100)).toBe(null)
  })
  test('tempo zero ou sem tokens: taxa some, nunca Infinity', () => {
    expect(speedLine(0, 800, 800, 100)).toBe('⚡ TTFT 800ms')
    expect(speedLine(0, 800, 2800, 0)).toBe('⚡ TTFT 800ms')
    expect(speedLine(0, 800, 2800, null)).toBe('⚡ TTFT 800ms')
  })
})

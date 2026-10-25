import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { collision, normPath, prune } from './register'

const MIN = 60_000

describe('pure helpers', () => {
  test('normPath folds slashes and case (Windows paths)', () => {
    expect(normPath('C:\\Dev\\App\\a.ts')).toBe('c:/dev/app/a.ts')
  })

  test('collision only for another session inside 30 min', () => {
    const w = { 'c:/a.ts': { session: 'A', at: 0 } }
    expect(collision(w, 'C:\\a.ts', 'B', 29 * MIN)?.session).toBe('A')
    expect(collision(w, 'C:\\a.ts', 'A', 1 * MIN)).toBe(undefined)
    expect(collision(w, 'C:\\a.ts', 'B', 30 * MIN)).toBe(undefined)
    expect(collision(w, 'C:\\b.ts', 'B', 1 * MIN)).toBe(undefined)
  })

  test('prune drops entries 30 min or older', () => {
    expect(prune({ x: { session: 'A', at: 0 }, y: { session: 'A', at: 10 * MIN } }, 35 * MIN)).toEqual({ y: { session: 'A', at: 10 * MIN } })
  })
})

type World = { session: string; now: number; answer: string | null; asked: string[]; wrote: number }

/** Shared store across "sessions": the test flips `w.session` to play the other one. */
function world(on: On, w: World) {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get((e as { key: string }).key) }) as never)
  on('store.set', (_$, e) => {
    store.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined } as never
  })
  on('session.id', () => ({ value: w.session }) as never)
  on('clock.now', () => ({ value: w.now }) as never)
  on('tool.call', (_$, e) => {
    if ((e as { tool: string }).tool === 'AskUserQuestion') {
      if (w.answer === null) throw new Error('dismissed')
      const q = (e as { questions: { question: string }[] }).questions[0]!.question
      w.asked.push(q)
      return { result: { answers: { [q]: w.answer } } } as never
    }
    w.wrote++
    return { result: 'ok' } as never
  })
}

const edit = (file_path: string) => ({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }) as never

test('another session wrote 10 min ago: asks, Cancelar denies', async ($, on) => {
  const w: World = { session: 'A', now: 0, answer: 'Cancelar', asked: [], wrote: 0 }
  world(on, w)
  await $.tool.call(edit('C:\\Dev\\a.ts'))
  w.session = 'B'
  w.now = 10 * MIN
  const r = (await $.tool.call(edit('C:/Dev/a.ts'))) as { deny?: string }
  expect(w.asked.length).toBe(1)
  expect(w.asked[0]!.includes('10 min')).toBe(true)
  expect(String(r.deny).includes('outra sessão')).toBe(true)
  expect(w.wrote).toBe(1)
})

test('Continuar lets the edit through and records it for this session', async ($, on) => {
  const w: World = { session: 'A', now: 0, answer: 'Continuar', asked: [], wrote: 0 }
  world(on, w)
  await $.tool.call(edit('C:/Dev/a.ts'))
  w.session = 'B'
  w.now = 5 * MIN
  await $.tool.call(edit('C:/Dev/a.ts'))
  await $.tool.call(edit('C:/Dev/a.ts')) // now B owns the record: no second question
  expect(w.asked.length).toBe(1)
  expect(w.wrote).toBe(3)
})

test('same session or older than 30 min: no question', async ($, on) => {
  const w: World = { session: 'A', now: 0, answer: 'Cancelar', asked: [], wrote: 0 }
  world(on, w)
  await $.tool.call(edit('C:/Dev/a.ts'))
  w.now = 1 * MIN
  await $.tool.call(edit('C:/Dev/a.ts'))
  w.session = 'B'
  w.now = 40 * MIN
  await $.tool.call(edit('C:/Dev/a.ts'))
  expect(w.asked.length).toBe(0)
  expect(w.wrote).toBe(3)
})

test('a question that cannot be shown lets the edit through (fail open)', async ($, on) => {
  const w: World = { session: 'A', now: 0, answer: null, asked: [], wrote: 0 }
  world(on, w)
  await $.tool.call(edit('C:/Dev/a.ts'))
  w.session = 'B'
  w.now = 1 * MIN
  await $.tool.call(edit('C:/Dev/a.ts'))
  expect(w.wrote).toBe(2)
})

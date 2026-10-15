// Run with: claude plugin test webfetch-cache
import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

type World = { fetched: number[] }

function fakeEngine(on: On, w: World) {
  on('ui.log', () => ({ value: undefined }) as never)
  on('tool.call', { tool: 'WebFetch' }, async (_$, e) => {
    const offset = (e as unknown as { offset?: number }).offset ?? 0
    w.fetched.push(offset)
    return { result: { text: `page at ${offset}` } } as never
  })
}

type Fetch = { result?: { text: string } }

const fetch = async ($: { tool: { call: (args: unknown) => Promise<unknown> } }, offset?: number): Promise<Fetch> =>
  (await $.tool.call({ tool: 'WebFetch', url: 'https://example.com/long', prompt: 'summarize', ...(offset === undefined ? {} : { offset }) })) as Fetch

describe('webfetch-cache', () => {
  test('a repeated fetch is served from the cache', async ($, on) => {
    const w: World = { fetched: [] }
    fakeEngine(on, w)
    await fetch($ as never)
    const again = await fetch($ as never)
    expect(w.fetched).toEqual([0])
    expect(again.result?.text).toBe('page at 0')
  })

  test('a read further down the page is not answered with the first page', async ($, on) => {
    const w: World = { fetched: [] }
    fakeEngine(on, w)
    await fetch($ as never)
    const next = await fetch($ as never, 100_000)
    expect(w.fetched).toEqual([0, 100_000])
    expect(next.result?.text).toBe('page at 100000')
    // and that piece is cached on its own
    await fetch($ as never, 100_000)
    expect(w.fetched).toEqual([0, 100_000])
  })

  test('/webfetch-cache off clears the cache and stops short-circuiting WebFetch', async ($, on) => {
    const w: World = { fetched: [] }
    fakeEngine(on, w)
    await fetch($ as never)
    expect(w.fetched).toEqual([0])

    const off = await $.command.run({ command: 'webfetch-cache', args: 'off' })
    expect((off as { text?: string }).text).toBe('webfetch-cache desativado.')

    await fetch($ as never)
    expect(w.fetched).toEqual([0, 0])
  })

  test('/webfetch-cache with no argument reports the current state', async ($, on) => {
    fakeEngine(on, { fetched: [] })
    const status = await $.command.run({ command: 'webfetch-cache', args: '' })
    expect((status as { text?: string }).text).toBe('webfetch-cache esta ativado. Uso: /webfetch-cache on · /webfetch-cache off')
  })
})

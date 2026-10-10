import { describe, expect, test } from 'claude-code/testing'

import { summarize } from './register'

describe('summarize', () => {
  test('Edit counts added and removed lines', () => {
    const l = summarize('Edit', { file_path: 'a.ts', old_string: 'x\ny', new_string: 'x\ny\nz\nw' }, null)
    expect(l).toEqual({ glyph: '●', tool: 'Edit', target: 'a.ts', note: '+4 −2' })
  })

  test('Bash collapses whitespace and cuts long commands', () => {
    const l = summarize('Bash', { command: `npm   test ${'x'.repeat(200)}` }, null)
    expect(l?.target.startsWith('npm test x')).toBe(true)
    expect(l?.target.length).toBe(70)
  })

  test('Grep and Read summarize their result, tolerating unknown shapes', () => {
    expect(summarize('Grep', { pattern: 'x' }, { numFiles: 3 })?.note).toBe('3 arquivos')
    expect(summarize('Glob', { pattern: 'x' }, { numFiles: 1 })?.note).toBe('1 arquivo')
    expect(summarize('Read', { file_path: 'a' }, { file: { numLines: 212 } })?.note).toBe('212 linhas')
    expect(summarize('Read', { file_path: 'a' }, 'weird')?.note).toBeUndefined()
  })

  test('unknown tools and missing input fall through to the engine block', () => {
    expect(summarize('mcp__x__y', {}, null)).toBeNull()
    expect(summarize('Read', undefined, null)?.target).toBe('')
  })
})

import { describe, expect, test } from 'claude-code/testing'

import { bar, kilo, tone, topCats, usageLine } from './register'

describe('uso-vivo', () => {
  test('bar clamps and fills proportionally', () => {
    expect(bar(0)).toBe('░░░░░░░░░░')
    expect(bar(50)).toBe('█████░░░░░')
    expect(bar(250)).toBe('██████████')
  })
  test('tone thresholds 75/90', () => {
    expect([tone(74), tone(75), tone(89), tone(90)]).toEqual(['green', 'yellow', 'yellow', 'red'])
  })
  test('kilo and topCats order by size', () => {
    expect(kilo(950)).toBe('950')
    expect(kilo(12345)).toBe('12.3k')
    expect(topCats([{ name: 'a', tokens: 10 }, { name: 'b', tokens: 2000 }, { name: 'z', tokens: 0 }])).toBe('b 2k · a 10')
  })
  test('usageLine lists 5h, 7d and cost; missing limits are skipped', () => {
    const l = usageLine([{ kind: 'five_hour', percentUsed: 6, resetsAt: '2026-10-11T01:10:00.000Z' }], 1.234)
    expect(l.length).toBe(2)
    expect(l[0].text.startsWith('5h █')).toBe(true)
    expect(l[1].text).toBe('sessão $1.23')
  })
})

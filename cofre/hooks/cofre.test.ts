import { describe, expect, mock, test } from 'claude-code/testing'

import { detect, ensureGitignore, envNames, envValues, isSecretFile, maskDeep, secretReadTarget, upsertEnv } from './secrets'

// Fictitious values only, built with repeat() so no literal looks like a real key.
const FAKE = {
  anthropic: `sk-ant-api03-${'a'.repeat(30)}`,
  openai: `sk-proj-${'b'.repeat(30)}`,
  google: `AIza${'c'.repeat(35)}`,
  jwt: `eyJ${'d'.repeat(12)}.eyJ${'e'.repeat(12)}.${'f'.repeat(12)}`,
  github: `ghp_${'g'.repeat(36)}`,
  aws: `AKIA${'H'.repeat(16)}`,
  'private-key': '-----BEGIN RSA PRIVATE KEY-----',
}

describe('detect', () => {
  test('one hit per kind, sample is a short prefix', () => {
    for (const [kind, value] of Object.entries(FAKE)) expect([kind, detect(`x ${value} y`).map(h => h.kind)]).toEqual([kind, [kind]])
    expect(detect(FAKE.google)[0]!.sample).toBe('AIzacc…')
  })

  test('hashes, UUIDs and short sk- pass', () => {
    for (const text of ['commit 3f9a1c0b7e2d4f6a8b0c1d2e3f4a5b6c7d8e9f01', '123e4567-e89b-12d3-a456-426614174000', 'sk-short', 'task-ant-x', 'risk-assessment-for-the-whole-project-plan'])
      expect([text, detect(text)]).toEqual([text, []])
  })
})

describe('isSecretFile', () => {
  test('env, keys and credentials yes; templates and public keys no', () => {
    for (const p of ['.env', 'app/.env.local', 'C:\\Dev\\x\\.env.production', 'server.pem', 'tls.key', 'credentials.json', 'credentials-prod.json', '~/.ssh/id_rsa', 'id_ed25519'])
      expect([p, isSecretFile(p)]).toEqual([p, true])
    for (const p of ['.env.example', '.env.sample', '.env.template', 'id_rsa.pub', 'environment.ts', 'src/env.ts', 'keys.md'])
      expect([p, isSecretFile(p)]).toEqual([p, false])
  })
})

const VAL = `fake-${'x'.repeat(16)}`
const ENV = `# comentário\nOPENAI_API_KEY=${VAL}\nexport QUOTED="${VAL} 2"\nPORT=3000\n`

describe('.env', () => {
  test('names and long values, quotes stripped', () => {
    expect(envNames(ENV)).toEqual(['OPENAI_API_KEY', 'QUOTED', 'PORT'])
    expect(envValues(ENV)).toEqual([VAL, `${VAL} 2`])
  })

  test('upsertEnv replaces or appends, quotes when needed, keeps $ literal', () => {
    expect(upsertEnv('A=1\nB=2\n', 'B', 'novo')).toBe('A=1\nB=novo\n')
    expect(upsertEnv('A=1', 'C', 'tem espaço')).toBe('A=1\nC="tem espaço"\n')
    expect(upsertEnv('', 'D', 'a"b\\c')).toBe('D="a\\"b\\\\c"\n')
    expect(upsertEnv('E=old\n', 'E', 'x$&y')).toBe('E=x$&y\n')
  })

  test('ensureGitignore adds .env once', () => {
    expect(ensureGitignore('node_modules')).toBe('node_modules\n.env\n')
    expect(ensureGitignore('')).toBe('.env\n')
    for (const g of ['.env\n', 'dist\n.env*\n', '*.env\n', '/.env\n']) expect(ensureGitignore(g)).toBe(g)
  })
})

describe('maskDeep', () => {
  test('masks env values and detected keys anywhere, keeps the shape', () => {
    const out = maskDeep({ stdout: `v=${VAL}`, list: [`k ${FAKE.google}`, 3], nested: { ok: 'PORT=3000' } }, [VAL])
    expect(out).toEqual({ stdout: 'v=••••', list: ['k ••••', 3], nested: { ok: 'PORT=3000' } })
  })

  test('hides a whole private key block', () => {
    expect(maskDeep('a\n-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\nb', [])).toBe('a\n••••\nb')
  })
})

describe('secretReadTarget', () => {
  test('reader verb plus secret file', () => {
    expect(secretReadTarget('cat .env')).toBe('.env')
    expect(secretReadTarget('cd app && Get-Content "app/.env.local" | Select -First 3')).toBe('app/.env.local')
    expect(secretReadTarget('type C:\\x\\server.pem')).toBe('C:\\x\\server.pem')
  })

  test('writes, copies and git pass', () => {
    for (const c of ['cp .env.example .env', 'echo X=1 >> .env', 'git add .env', 'cat README.md', 'cat .env.example'])
      expect([c, secretReadTarget(c)]).toEqual([c, null])
  })
})

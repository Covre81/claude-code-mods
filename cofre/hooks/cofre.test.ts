import { describe, expect, mock, test } from 'claude-code/testing'

import { detect, isSecretFile } from './secrets'

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

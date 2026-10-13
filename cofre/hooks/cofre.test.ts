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

  test('quoted value followed by a comment yields the bare value', () => {
    const X = 'x'.repeat(12)
    expect(envValues(`K1="${X}" # note\nK2='${X}' # note\n`)).toEqual([X, X])
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

function world(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const ran: string[] = []
  on('fs.list', () => ({ value: [{ name: '.env', kind: 'file', size: 80 }, { name: '.env.example', kind: 'file', size: 10 }] }) as never)
  on('fs.read', () => ({ value: ENV }) as never)
  on('tool.call', (_$, e) => {
    const tool = (e as { tool: string }).tool
    ran.push(tool)
    return { result: tool === 'Read' ? { type: 'text', file: { filePath: '.env', content: ENV } } : { stdout: `valor ${VAL} e ${FAKE.github}`, stderr: '' } } as never
  })
  return ran
}

test('Read of .env shows names with masked values and no raw text field', async ($, on) => {
  world(on)
  const res = (await $.tool.call({ tool: 'Read', file_path: '.env' } as never)) as { result?: unknown; text?: string }
  const json = JSON.stringify(res.result)
  expect(json.includes('OPENAI_API_KEY=••••')).toBe(true)
  expect(json.includes('PORT=3000')).toBe(true)
  expect(json.includes(VAL)).toBe(false)
  expect(res.text).toBe(undefined)
})

test('shell reads, key files, grep on secrets and @mentions are refused', async ($, on) => {
  const ran = world(on)
  on('prompt.mention', () => ({ type: null }) as never)
  const cat = (await $.tool.call({ tool: 'Bash', command: 'cat .env' } as never)) as { deny?: string }
  expect(String(cat.deny).includes('OPENAI_API_KEY')).toBe(true)
  expect(String(cat.deny).includes(VAL)).toBe(false)
  expect(typeof ((await $.tool.call({ tool: 'Read', file_path: 'C:/x/id_rsa' } as never)) as { deny?: string }).deny).toBe('string')
  expect(typeof ((await $.tool.call({ tool: 'Grep', pattern: 'KEY', path: '.env' } as never)) as { deny?: string }).deny).toBe('string')
  expect(ran).toEqual([])
  const mention = (await $.prompt.mention({ mention: '@.env', path: '.env' } as never)) as { deny?: string }
  expect(typeof mention.deny).toBe('string')
})

test('a pasted key is held; #ok sends it without the prefix', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  const held = (await $.prompt.submit({ text: `minha chave ${FAKE.google}`, wait: false, origin: { kind: 'composer' } } as never)) as { drop?: string }
  expect(String(held.drop).includes('google')).toBe(true)
  expect(String(held.drop).includes(FAKE.google)).toBe(false)
  const sent = (await $.prompt.submit({ text: `#ok minha chave ${FAKE.google}`, wait: false, origin: { kind: 'composer' } } as never)) as { text?: string }
  expect(sent.text).toBe(`minha chave ${FAKE.google}`)
  const plain = (await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'composer' } } as never)) as { text?: string }
  expect(plain.text).toBe('oi')
})

test('shell output carrying a secret comes back masked', async ($, on) => {
  world(on)
  const res = (await $.tool.call({ tool: 'PowerShell', command: 'echo $env:X' } as never)) as { result?: { stdout: string } }
  expect(res.result?.stdout).toBe('valor •••• e ••••')
})

test('terminal: /chave writes .env, guards .gitignore, never echoes the value', async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { '.gitignore': 'node_modules\n', '.env': 'OTHER=1\n' }
  on('fs.read', (_$, e) => {
    const p = (e as { path: string }).path.split(/[\\/]/).pop()!
    return (p in files ? { value: files[p] } : { deny: 'ENOENT' }) as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path: string; text: string }
    files[path.split(/[\\/]/).pop()!] = text
    return { value: undefined } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, {}) as never)

  const bad = (await $.command.run({ command: 'chave', args: 'minha chave', origin: { kind: 'composer' }, presentation: 'text' } as never)) as { text?: string }
  expect(String(bad.text).startsWith('Uso:')).toBe(true)

  const run = $.command.run({ command: 'chave', args: 'TESTE_KEY', origin: { kind: 'composer' }, presentation: 'text' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'cofre', surface: 'terminal', component: 'Pane', requestId: 'cofre', props: {} as never })
  await pane.input({ key: 'valor', text: `fake value ${'z'.repeat(8)}`, kind: 'submit' })
  await clock.advance(300)
  const out = (await run) as { text?: string }

  expect(out.text).toBe('🔐 TESTE_KEY gravada no .env · .gitignore atualizado')
  expect(files['.gitignore']).toBe('node_modules\n.env\n')
  expect(files['.env']).toBe(`OTHER=1\nTESTE_KEY="fake value ${'z'.repeat(8)}"\n`)
})

import type { EngineInterface, Register } from 'claude-code'

import { detect, ensureGitignore, envNames, envValues, isEnvFile, isSecretFile, maskDeep, secretReadTarget, upsertEnv } from './secrets'

type Call = Record<string, unknown> & { tool?: unknown }
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Values of the session folder's .env files, plus the one being read. ponytail: reread per call, no cache; .env files are tiny. */
async function secretValues($: EngineInterface, extra?: string): Promise<string[]> {
  const local = (await $.fs.list().catch(() => [])).filter(f => f.kind === 'file' && isEnvFile(f.name)).map(f => f.name)
  const paths = extra && !local.includes(extra) ? [...local, extra] : local
  const texts = await Promise.all(paths.map(p => $.fs.read(p).catch(() => '')))
  return texts.flatMap(t => envValues(String(t)))
}

/** Why this call must not run, or null. A Read of .env runs and gets masked instead. */
async function refusal($: EngineInterface, call: Call): Promise<string | null> {
  const tool = str(call.tool)
  const target =
    tool === 'Read' ? str(call.file_path) : tool === 'Grep' ? ([str(call.path), str(call.glob)].find(isSecretFile) ?? '') : (secretReadTarget(str(call.command)) ?? '')
  if (!target || !isSecretFile(target)) return null
  if (tool === 'Read' && isEnvFile(target)) return null
  const names = isEnvFile(target) ? envNames(String(await $.fs.read(target).catch(() => ''))) : []
  return `Arquivo de segredo (${target}): conteúdo oculto pelo cofre.${names.length ? ` Variáveis definidas: ${names.join(', ')}.` : ''} Use os nomes; os valores ficam só no disco.`
}

const PANE = 'cofre'
const NAME = /^[A-Z_][A-Z0-9_]*$/
const WAIT_MS = 10 * 60 * 1000

// The value the Input hands back; null while waiting, '' when cancelled. One /chave at a time.
let pending: { name: string; value: string | null } | null = null

async function save($: EngineInterface, name: string, value: string): Promise<string> {
  // .gitignore first: a .env must never exist on disk un-ignored, not even for a moment.
  const ignore = String(await $.fs.read('.gitignore').catch(() => ''))
  const ignored = ensureGitignore(ignore)
  if (ignored !== ignore) await $.fs.write('.gitignore', ignored)
  const env = String(await $.fs.read('.env').catch(() => ''))
  await $.fs.write('.env', upsertEnv(env, name, value))
  return `🔐 ${name} gravada no .env${ignored !== ignore ? ' · .gitignore atualizado' : ''}`
}

export const register: Register = on => {
  on('tool.call', { tool: ['Read', 'Grep', 'Bash', 'PowerShell'] }, async ($, e, next) => {
    const call = e as unknown as Call
    const why = await refusal($, call)
    if (why) return { deny: why }
    const r = await next(e)
    if (r.deny !== undefined || r.result === undefined) return r
    const extra = str(call.tool) === 'Read' && isEnvFile(str(call.file_path)) ? str(call.file_path) : undefined
    const masked = maskDeep(r.result, await secretValues($, extra))
    // A hook's own result carries no `text`/`ref`: spreading r would hand the model the raw text core rendered.
    return JSON.stringify(masked) === JSON.stringify(r.result) ? r : ({ result: masked, context: r.context, isError: r.isError } as typeof r)
  }).catch(() => ({ deny: 'O cofre falhou ao conferir esta chamada e reteve o resultado por segurança.' }))

  on('prompt.mention', ($, e, next) => (isSecretFile(e.path) ? { deny: 'arquivo de segredo: o cofre não anexa o conteúdo' } : next(e))).catch(() => ({
    deny: 'o cofre falhou ao conferir a menção',
  }))

  on('prompt.submit', ($, e, next) => {
    if (/^#ok\b/.test(e.text)) return next({ ...e, text: e.text.replace(/^#ok\s*/, '') })
    const hit = detect(e.text)[0]
    if (!hit) return next(e)
    return { drop: `🔐 Isso parece uma chave ${hit.kind} (${hit.sample}). Use /chave NOME para gravar no .env sem passar pelo chat. Para enviar mesmo assim, comece a mensagem com #ok` }
  }).catch(($, e, next) => (next.called ? next(e) : { drop: 'o cofre falhou ao conferir o prompt' })) // fail closed: a key must not reach the model unchecked

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'chave', description: 'Grava uma chave de API no .env sem ela passar pelo chat: /chave NOME' })
    return next(e)
  })

  on('command.run', { command: 'chave' }, async ($, e) => {
    const name = e.args.trim()
    if (!NAME.test(name)) return { text: 'Uso: /chave NOME (maiúsculas, números e _), ex.: /chave OPENAI_API_KEY' }
    if (pending) return { text: 'Já tem um /chave aberto.' }
    const p: { name: string; value: string | null } = { name, value: null }
    pending = p
    try {
      if (!(await $.ui.open({ id: PANE, title: 'Cofre', focus: true, closeOnEscape: true, rows: 6 })).isPlaced) return { text: 'Terminal estreito demais para o campo do cofre.' }
      const startedAt = await $.clock.now()
      while (p.value === null) {
        if ((await $.clock.now()) - startedAt > WAIT_MS) return { text: `${name} não gravada: ninguém respondeu em 10 minutos.` }
        await $.clock.sleep(250)
      }
      return { text: p.value ? await save($, name, p.value) : `${name} não gravada.` }
    } finally {
      pending = null
      await $.ui.close({ id: PANE }).catch(() => undefined)
    }
  })

  on('ui.close', ($, e, next) => {
    if (e.id === PANE && pending && pending.value === null) pending.value = ''
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    const p = pending
    if (e.requestId !== PANE || !p) return next(e)
    const { Box, Input, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1}>
        <Text bold color="green">
          🔐 Cofre · {p.name}
        </Text>
        <Input key="valor" label="Cole o valor e tecle Enter" autoFocus submitLabel="gravar" onSubmit={v => void (p.value ??= v.trim())} />
        <Text dimColor wrap="wrap">
          Vai para o .env desta pasta e não entra na conversa com o Claude. Esc cancela.
        </Text>
      </Box>
    )
  })
}

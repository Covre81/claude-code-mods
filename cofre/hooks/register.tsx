import type { EngineInterface, Register } from 'claude-code'

import { envNames, envValues, isEnvFile, isSecretFile, maskDeep, secretReadTarget } from './secrets'

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
}

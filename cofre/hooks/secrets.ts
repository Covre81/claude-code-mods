// Pure rules of the cofre: what a secret looks like, which files hold one, and how to hide it.

export type Hit = { kind: string; sample: string }

// ponytail: fixed provider prefixes, no entropy scoring (false positives on hashes and UUIDs); add a row when a new provider shows up.
const PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['anthropic', /(?<![\w-])sk-ant-[\w-]{20,}/g],
  ['openai', /(?<![\w-])sk-(?!ant-)(?:proj-)?[\w-]{20,}/g],
  ['google', /AIza[\w-]{35}/g],
  ['jwt', /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g],
  ['github', /ghp_[A-Za-z0-9]{36}|github_pat_\w{22,}/g],
  ['aws', /AKIA[0-9A-Z]{16}/g],
  // The whole block when its END is there, so masking hides the key body, not just the header.
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----)?/g],
]

export function detect(text: string): Hit[] {
  return PATTERNS.flatMap(([kind, re]) => [...text.matchAll(re)].map(m => ({ kind, sample: `${m[0].slice(0, 6)}…` })))
}

const baseName = (path: string) => (path.replace(/["']/g, '').split(/[\\/]/).pop() ?? '').toLowerCase()

export const isEnvFile = (path: string) => /^\.env(\..+)?$/.test(baseName(path)) && !/\.(example|sample|template)$/.test(baseName(path))

const SSH_PUBLIC = /^(config.*|known_hosts.*|authorized_keys.*|environment|.*\.pub)$/

export function isSecretFile(path: string): boolean {
  const base = baseName(path)
  const full = path.replace(/["']/g, '').replace(/\\/g, '/').toLowerCase()
  if (isEnvFile(path)) return true
  if (base.endsWith('.pub')) return false
  // Anything private under .ssh, whatever its name (zimaos_vaio, id_covrepc...).
  if (/(^|\/)\.ssh\//.test(full)) return !SSH_PUBLIC.test(base)
  if (base === 'config.toml') return /(^|\/)\.ai-memory\//.test(full)
  if (base === 'auth.json') return /(^|\/)\.codex\//.test(full)
  return (
    /\.(pem|key|p12|pfx|jks|keystore)$/.test(base) ||
    /^\.?credentials.*\.json$/.test(base) ||
    /^id_[\w-]+$/.test(base) ||
    ['oauth_creds.json', '.netrc', '.pgpass'].includes(base)
  )
}

export const MASK = '••••'

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/

function unquote(raw: string): string {
  const v = raw.trim()
  // Read up to the closing quote and ignore what follows, so `"x" # note` still yields x.
  const dq = /^"((?:[^"\\]|\\.)*)"/.exec(v)
  if (dq) return dq[1]!.replace(/\\(["\\])/g, '$1')
  const sq = /^'([^']*)'/.exec(v)
  if (sq) return sq[1]!
  return v.replace(/\s+#.*$/, '')
}

const envEntries = (text: string) =>
  text.split(/\r?\n/).flatMap(line => {
    const m = ENV_LINE.exec(line)
    return m ? [{ name: m[1]!, value: unquote(m[2]!) }] : []
  })

export const envNames = (text: string) => envEntries(text).map(e => e.name)

/** Values worth masking: 8+ chars, so PORT=3000 or DEBUG=true stay readable. */
export const envValues = (text: string) => envEntries(text).map(e => e.value).filter(v => v.length >= 8)

export function maskText(text: string, values: readonly string[]): string {
  let out = text
  for (const v of [...values].sort((a, b) => b.length - a.length)) out = out.split(v).join(MASK)
  for (const [, re] of PATTERNS) out = out.replace(re, MASK)
  return out
}

/** Masks every string inside a tool's result and keeps its shape, so core's schema check still passes. */
export function maskDeep<T>(value: T, values: readonly string[]): T {
  if (typeof value === 'string') return maskText(value, values) as T
  if (Array.isArray(value)) return value.map(v => maskDeep(v, values)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, values)])) as T
  return value
}

// Anything that prints or decodes a file's bytes. Writers (cp, echo >>) and git stay out: the output mask and the guarda cover those.
const READERS = new Set([
  'cat', 'type', 'get-content', 'gc', 'more', 'less', 'head', 'tail', 'source', '.',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'awk', 'gawk', 'sed', 'nl', 'tac', 'bat', 'batcat', 'view', 'vim', 'vi', 'nano',
  'base64', 'base32', 'xxd', 'od', 'hexdump', 'strings', 'diff', 'cmp', 'sort', 'uniq', 'cut', 'paste', 'column', 'jq', 'yq',
  'python', 'python3', 'node', 'perl', 'ruby', 'php', 'select-string', 'sls',
])

/** The secret file a shell command reads, or null. */
export function secretReadTarget(command: string): string | null {
  // ponytail: plain token split, not the guarda's classify; the output mask is the real net.
  const tokens = command
    .split(/[\s;|&()<>]+/)
    .map(t => t.replace(/^["']|["']$/g, ''))
    .filter(Boolean)
  if (!tokens.some(t => READERS.has(t.toLowerCase()))) return null
  return tokens.find(isSecretFile) ?? null
}

/** `.env` text with NAME set to value; double quotes when the value has a space, #, quote or backslash. */
export function upsertEnv(env: string, name: string, value: string): string {
  const line = `${name}=${/[\s#"'\\]/.test(value) ? `"${value.replace(/[\\"]/g, c => `\\${c}`)}"` : value}`
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=.*$`, 'm')
  if (re.test(env)) return env.replace(re, () => line)
  return `${env}${env && !env.endsWith('\n') ? '\n' : ''}${line}\n`
}

const COVERS_ENV = new Set(['.env', '/.env', '.env*', '/.env*', '*.env'])

export function ensureGitignore(text: string): string {
  if (text.split(/\r?\n/).some(l => COVERS_ENV.has(l.trim()))) return text
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}.env\n`
}

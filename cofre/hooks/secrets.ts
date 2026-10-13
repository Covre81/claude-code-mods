// Pure rules of the cofre: what a secret looks like, which files hold one, and how to hide it.

export type Hit = { kind: string; sample: string }

// ponytail: fixed provider prefixes, no entropy scoring (false positives on hashes and UUIDs); add a row when a new provider shows up.
const PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['anthropic', /sk-ant-[\w-]{20,}/g],
  ['openai', /sk-(?!ant-)(?:proj-)?[\w-]{20,}/g],
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

export function isSecretFile(path: string): boolean {
  const base = baseName(path)
  if (isEnvFile(path)) return true
  if (base.endsWith('.pub')) return false
  return /\.(pem|key)$/.test(base) || /^credentials.*\.json$/.test(base) || /^id_(rsa|ed25519)/.test(base)
}

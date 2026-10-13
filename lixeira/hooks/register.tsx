import type { Register } from 'claude-code'

export type Shell = 'bash' | 'powershell'

// ponytail: copy of guarda's tokenize/PREFIXES — plugins load isolated, an import across mods may not exist when installed.
function tokenize(text: string): string[] {
  const words: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(text); m; m = re.exec(text)) words.push(m[1] ?? m[2] ?? m[3] ?? '')
  return words
}

const PREFIXES = new Set(['sudo', 'command', 'exec', 'env', 'nohup', 'time', 'then', 'do', 'else', '!'])
const PS_DELETE = /(?:^|[;|{(\n]|&&)\s*(?:remove-item|rm|del|erase|ri|rd|rmdir)(?=\s|$|[;|)}])/i

/** Does the line run rm (Bash) or a Remove-Item alias (PowerShell) as a command? A false positive only adds a harmless prefix. */
export function hasDelete(command: string, shell: Shell): boolean {
  if (shell === 'powershell') return PS_DELETE.test(command)
  return command.split(/&&|\|\||;|\||\n/).some(seg => {
    const words = tokenize(seg.trim().replace(/^[({]+\s*/, ''))
    while (words.length && (PREFIXES.has(words[0]!) || /^[A-Za-z_]\w*=/.test(words[0]!))) words.shift()
    return words[0] === 'rm'
  })
}

/** The command with the delete shadowed by the mod's scripts in `hooks` (a folder without single quotes). */
export function rewrite(command: string, shell: Shell, hooks: string): string {
  if (shell === 'powershell') return `. '${hooks}/remove-item.ps1'; ${command}`
  return `rm() { powershell.exe -NoProfile -NonInteractive -File '${hooks}/lixeira.ps1' "$@"; }; ${command}`
}

export const register: Register = () => {}

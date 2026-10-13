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
  // A shadow that fails to load (moved, ExecutionPolicy) stops the line instead of letting the real Remove-Item run.
  if (shell === 'powershell') return `try { . '${hooks}/remove-item.ps1' } catch { throw 'lixeira: a sombra nao carregou; nada foi apagado' }; ${command}`
  return `rm() { powershell.exe -NoProfile -NonInteractive -File '${hooks}/lixeira.ps1' "$@"; }; ${command}`
}

export const register: Register = on => {
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    const sh: Shell = e.tool === 'Bash' ? 'bash' : 'powershell'
    const command = String(e.command ?? '')
    const hooks = `${$.plugin.root.replace(/\\/g, '/')}/hooks`
    if (hooks.includes("'") || !hasDelete(command, sh)) return next(e)
    return next({ ...e, command: rewrite(command, sh, hooks) } as typeof e)
  }).catch(($, e, next) =>
    // Before next: let the original run (a lixeira bug must not block the shell; guarda still holds rm -rf).
    // After next: the rewritten delete already ran — running the original now would delete for good.
    next.called ? { deny: 'A lixeira falhou depois de rodar o comando. Confira o resultado antes de repetir.' } : next(e),
  )
}

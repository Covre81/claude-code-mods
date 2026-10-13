# Lixeira — design

Origem: vídeo "A Maior Atualização do Claude Code Desde as Skills" (Macks Wendhell,
youtube.com/watch?v=Q5vEzupdjpc), [02:22]: "outro mod que envia esses arquivos para a
lixeira em vez de excluí-los definitivamente".

Segundo de quatro subprojetos (cofre → lixeira → cache frio → painel de fases).

## Objetivo

Todo `rm` que o Claude roda no Bash e todo `Remove-Item`/`del`/`rm`/`rd` que roda no
PowerShell manda os arquivos para a Lixeira do Windows em vez de apagar de vez. Para
recuperar: abrir a Lixeira e clicar em Restaurar.

Decidido com o usuário em 2026-10-13:
- destino: Lixeira do Windows (não uma pasta própria);
- cobertura: Bash `rm` (com ou sem `-rf`) e PowerShell; arquivo sobrescrito pelo `Write`
  fica fora;
- o `guarda` continua segurando `rm -rf` para perguntar.

## Abordagem

O gancho reescreve o comando antes de rodar (`next({ ...e, command })`, permitido:
index.d.ts:12665, "a rewrite is checked against Bash's schema"). Ele coloca na frente
da linha uma definição que troca `rm` pelo script do mod. O shell continua expandindo
glob, `$VAR` e `cd`, e o script recebe os caminhos já resolvidos.

Descartadas:
- O hook mover os arquivos e responder no lugar do Bash: não expande glob/variável, e
  `{ result }` exige o schema do Bash, que é `unknown` (mesmo motivo do cofre).
- Um `rm` próprio no PATH: vale para o computador todo e mexe em settings.

## Estrutura

Mod novo `lixeira/`, mesmo layout do `guarda/`: `.claude-plugin/plugin.json`,
`hooks/hooks.json`, `hooks/register.tsx`, `hooks/lixeira.test.ts`, `tsconfig.json`, e
o script `hooks/lixeira.ps1`.

## Componentes

### 1. Detector e reescritor (puro, exportado, testado)

`hasDelete(command, shell: 'bash' | 'powershell'): boolean`:
- Bash: algum segmento da linha (separadores `&&`, `||`, `;`, `|`, quebra de linha;
  prefixos `sudo`, `env`, `VAR=x` etc. pulados, mesma regra do `commands()` do guarda)
  tem `rm` como comando.
- PowerShell: algum token (sem diferenciar maiúscula) é `Remove-Item`, `rm`, `del`,
  `erase`, `ri`, `rd`, `rmdir` em posição de comando (início da linha ou depois de
  `;`, `|`, `{`, `(`, `&&`, `||`).
- `grep rm`, `npm run rm-cache`, `echo "rm x"` e `./rm.sh` não contam.

`rewrite(command, shell, scriptPath): string`: devolve `prefixo + command`.
- Bash: `rm() { powershell.exe -NoProfile -NonInteractive -File '<scriptPath>' -- "$@"; }; `
  O `--` separa os argumentos para o script ler as próprias flags. O script converte
  caminhos `/c/...` para `C:\...`.
- PowerShell: `function Remove-Item { [CmdletBinding()] param(...) process { & '<scriptPath>' ... } }; `
  com `Path` aceitando pipeline e propriedade (`FullName`, `PSPath`, `LiteralPath`),
  e as chaves `-Recurse` e `-Force`. Testado em 2026-10-13 no PowerShell 5.1, o único
  instalado: `rm`, `del`, `ri`, `erase`, `rmdir`, `rd`, `Remove-Item` e
  `"x","y" | Remove-Item` caem na função.
- O caminho do script vem de `$.plugin.root`, com aspas simples. Um caminho que tenha
  aspas simples faz o gancho desistir e devolver `next(e)` intacto.

### 2. `lixeira.ps1`

Recebe flags e caminhos e imita o `rm` real, porque o modelo raciocina pela saída:

| situação | comportamento |
|---|---|
| arquivo | `DeleteFile(p, OnlyErrorDialogs, SendToRecycleBin)` |
| pasta com `-r`/`-R`/`--recursive` (ou `-Recurse` no PowerShell) | `DeleteDirectory(p, OnlyErrorDialogs, SendToRecycleBin)` |
| pasta sem recursivo | erro `rm: cannot remove 'p': Is a directory`, item fica |
| inexistente | erro `rm: cannot remove 'p': No such file or directory`; com `-f`, silêncio |
| falha (arquivo travado, sem permissão) | mensagem de erro, segue para o próximo item |
| junction / link de pasta | sai só o link; o alvo fica intacto (testado 2026-10-13) |

- Saída: código 0 se tudo saiu, 1 se algum item falhou. `try/catch` em cada item
  (testado: sem ele, a exceção do arquivo travado sai com código 0).
- Ao final, em stderr: `🗑 N itens enviados para a Lixeira do Windows`. É stderr para
  não misturar com a saída de um comando encadeado num pipe.
- Flags desconhecidas (`-i`, `-v`, `--`) são ignoradas, sem erro.
- Roda sem `-ExecutionPolicy Bypass`: a política desta máquina (`CurrentUser
  RemoteSigned`) aceita script local (testado 2026-10-13).

### 3. Gancho (`tool.call`, Bash e PowerShell)

1. `hasDelete` falso → `next(e)`.
2. Verdadeiro → `next({ ...e, command: rewrite(...) })`.
3. Erro no gancho → `.catch` devolve `next(e)` com o comando original (fail open).
   Motivo: um bug da lixeira não pode travar todo comando do Claude, e o `guarda`
   continua segurando o `rm -rf` destrutivo.

### 4. Ordem com o `guarda`

- `lixeira` entra por último em `CLAUDE_CODE_PLUGIN_DIRS`. O primeiro da lista é o
  gancho mais externo (index.d.ts:3918), então o `guarda` vê o comando original e
  segura o `rm -rf` antes da reescrita.
- O `guarda` não tem como saber se a lixeira está ligada: não há API para um plugin
  consultar outro. Por isso o texto `EXPLAIN.rm` do guarda fica neutro: "Apaga
  arquivos ou pastas com tudo dentro. Com o mod lixeira ligado vão para a Lixeira do
  Windows; sem ele, não tem Ctrl+Z." A nota do painel continua igual.

## Limites conhecidos

- Não cobertos (apagam de vez, como hoje): `xargs rm`, `find -exec rm`, `find -delete`,
  `/usr/bin/rm`, `\rm`, `command`/`env`/`exec`/`nohup rm`, `bash -c "rm …"`, `echo $(rm a)`,
  `sleep 1 & rm a` (o `&` simples não separa), scripts (`rimraf`),
  `Microsoft.PowerShell.Management\Remove-Item`, `$null = Remove-Item x`, `& Remove-Item`,
  `[IO.File]::Delete`, `cmd /c del`, `git clean`/`git rm` (o `guarda` cuida dos `git` destrutivos).
- Drive de rede, UNC ou removível: recusado ("drive sem Lixeira; nada foi apagado"), porque lá
  o Windows apagaria de vez em silêncio.
- PowerShell: `-Filter`/`-Include`/`-Exclude` são recusados sem apagar; o caminho é
  `Get-ChildItem … | Remove-Item`. `Env:`, `HKCU:` e outros providers vão para o cmdlet real
  (não há Lixeira para eles).
- Custo: ~0,8 s por chamada de `rm` (início do PowerShell). Um laço com centenas de
  `rm` separados fica lento.
- [INFERIDO, não testado sem encher o disco] Pasta maior que o limite da Lixeira
  (padrão de alguns % do disco) pode ser apagada de vez pelo Windows. O tamanho não é
  medido antes, porque em `node_modules` isso leva muitos segundos. O `guarda` já para
  todo `rm -rf` para o usuário ver.
- Só Windows: o mod não faz nada útil em outro sistema (`powershell.exe` ausente → o
  `rm` falha com erro visível, não apaga).

## Fora de escopo

- Arquivo sobrescrito pelo `Write`/`Edit`.
- Comando `/lixeira` para listar ou restaurar (a Lixeira do Windows já faz isso).
- Esvaziar a Lixeira automaticamente.

## Testes

`lixeira/hooks/lixeira.test.ts` (padrão do `guarda.test.ts`, `claude plugin test`):
- `hasDelete` Bash: `rm a`, `rm -rf dist`, `cd x && rm *.log`, `sudo rm a` sim;
  `grep rm a`, `npm run rm-cache`, `echo "rm x"`, `./rm.sh` não.
- `hasDelete` PowerShell: `Remove-Item a`, `del a`, `rd x -Recurse`,
  `gci *.tmp | Remove-Item` sim; `Get-Item rm`, `Write-Host del` não.
- `rewrite` começa com o prefixo e termina com o comando original, intacto.
- Gancho: comando sem `rm` chega a `next` igual; com `rm`, chega reescrito; erro no
  gancho deixa o original passar.

Teste real do script (no plano, rodado no scratchpad, nunca em pasta do usuário):
arquivo, pasta com `-r`, pasta sem `-r`, inexistente com e sem `-f`, junction (o alvo
sobrevive), com os itens conferidos na Lixeira via `Shell.Application`.

Teste manual depois de ligar: numa sessão nova, pedir ao Claude para apagar um arquivo
de teste. Conferir se ele está na Lixeira e se o modo `auto` não gerou prompt ou negação
extra por causa do prefixo.

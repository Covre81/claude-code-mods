# Cofre — design

Origem: vídeo "A Maior Atualização do Claude Code Desde as Skills" (Macks Wendhell,
youtube.com/watch?v=Q5vEzupdjpc), mod 2 "cofre de chaves". Os prompts originais
estão atrás de cadastro na comunidade do autor e não foram usados; este desenho
parte da transcrição e da API de mods (`claude-code` index.d.ts).

Primeiro de quatro subprojetos (cofre → lixeira → cache frio → painel de fases),
cada um com spec e plano próprios. O mod 1 do vídeo (faixa da sessão) já existe
como `uso-vivo` + `painel`.

## Objetivo

Segredo (chave de API, token, JWT do Supabase) nunca passa pela conversa com o
modelo: nem colado pelo usuário, nem lido de arquivo, nem impresso por comando,
nem commitado.

## Estrutura

- Mod novo `cofre/` (mesmo layout de `guarda/`: `.claude-plugin/`, `hooks/hooks.json`,
  `hooks/register.tsx`, `hooks/cofre.test.ts`, `tsconfig.json`).
- Alerta de commit entra no `guarda` como novo `Risk` (`secret-commit`), reaproveitando
  o painel de "segurar". Motivo: o `guarda` já intercepta `git` em `tool.call`; um
  segundo mod segurando o mesmo comando abriria dois painéis concorrentes.

## Componentes

### 1. Detector (puro, exportado, testado)

`detect(text): { kind: string; sample: string }[]` — padrões fixos:

| kind | padrão |
|---|---|
| anthropic | `sk-ant-[\w-]{20,}` |
| openai | `sk-(proj-)?[A-Za-z0-9_-]{20,}` (depois de excluir `sk-ant-`) |
| google | `AIza[0-9A-Za-z_-]{35}` |
| jwt | `eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}` |
| github | `ghp_[A-Za-z0-9]{36}`, `github_pat_[A-Za-z0-9_]{22,}` |
| aws | `AKIA[0-9A-Z]{16}` |
| private-key | `-----BEGIN [A-Z ]*PRIVATE KEY-----` |

`sample` é só o prefixo (até 6 caracteres) + `…`, para mensagens. Sem detecção
por entropia (falso positivo em hash/UUID). Ver `ponytail:` no código.

`isSecretFile(path)`: basename `.env` ou `.env.*` (exceto `.env.example`,
`.env.sample`, `.env.template`), `*.pem`, `*.key`, `credentials*.json`, `id_rsa*`,
`id_ed25519*` (exceto `*.pub`).

`envNames(text)`: de um conteúdo `.env`, as linhas `NOME=valor` viram `NOME=••••`;
comentários e linhas vazias ficam como estão.

### 2. Comando `/chave NOME`

- `NOME` obrigatório, `^[A-Z_][A-Z0-9_]*$`; senão responde o uso correto.
- Abre pane `cofre` com `Input` (`autoFocus`, `submitLabel: 'gravar'`).
- `onSubmit(value)`:
  1. valor vazio → fecha sem gravar.
  2. `.gitignore` da pasta atual: se não houver linha que cubra `.env`
     (`.env`, `.env*`, `*.env`), acrescenta `.env`.
  3. `.env` da pasta atual: substitui a linha `NOME=...` se existir, senão acrescenta.
     Valor com espaço, `#` ou aspas é gravado entre aspas duplas, escapando `"` e `\`.
  4. fecha a pane; toast `🔐 NOME gravada no .env` (+ `· .gitignore atualizado` se mudou).
- O texto do comando devolvido ao transcript cita só o nome, nunca o valor.
- Limite conhecido: `Input` não tem modo senha; o valor aparece na tela durante a
  colagem, mas não entra no transcript nem chega ao modelo.

### 3. Leitura de arquivo secreto (`tool.call`)

- `Read` com `isSecretFile(file_path)` → `{ result }` com `envNames(conteúdo)` para
  `.env*`; para os demais (`.pem`, `.key`…) `{ deny }` "arquivo de segredo, conteúdo
  oculto pelo cofre".
- `Grep` cujo `path`/`glob` mira arquivo secreto → `{ deny }`.
- `Bash`/`PowerShell` cujo comando lê arquivo secreto com `cat|type|Get-Content|gc|
  more|less|head|tail` → `{ deny }` com a lista de nomes (`envNames`) quando é `.env*`.
- `prompt.mention` (`@.env`) → `{ deny }` com a mesma mensagem.
- Erro no gancho → `.catch` nega (fail closed).

### 4. Máscara nas saídas (`tool.call`, depois de `next(e)`)

- Ferramentas: `Bash`, `PowerShell`, `Read`, `Grep`.
- Valores a mascarar: os do `.env*` da pasta da sessão com 8+ caracteres (cache por
  `mtime`) + tudo que `detect` acha.
- Troca cada ocorrência por `••••` no texto do resultado e devolve `{ result }`.
- Erro no gancho → `.catch` devolve o resultado de `next` se já houver, senão nega.
- Limite conhecido: valor transformado (base64, URL-encoded) não é reconhecido.

### 5. Segredo colado no prompt (`prompt.submit`)

- `detect(e.text)` não vazio → `{ drop }` com aviso: "parece uma chave {kind}
  ({sample}). Use /chave NOME. Para enviar mesmo assim, comece com #ok".
- Texto começando com `#ok` → remove o `#ok` e deixa passar.
- Erro no gancho → deixa passar (não trava a digitação).

### 6. Commit com segredo (`guarda`, novo `Risk` `secret-commit`)

- `git add <args>`: roda `git add -n <args>`; arquivos com `isSecretFile` na saída →
  risco.
- `git commit` (inclusive `-a`): `git diff --cached --name-only` (+ `git diff
  --name-only` quando `-a`); arquivo secreto → risco.
- Painel do guarda lista os arquivos; texto em `EXPLAIN`: "Coloca um arquivo de
  segredo no histórico do git. Mesmo apagado depois, continua nos commits antigos."
- `isSecretFile` é importado de `cofre` (um só lugar para a regra).

## Fora de escopo

- Criptografar `.env` em disco.
- Cofre central compartilhado entre projetos.
- Detecção por entropia.

## Testes

Arquivo `cofre/hooks/cofre.test.ts` (padrão de `guarda.test.ts`, `claude plugin test`),
sempre com valores fictícios:

- `detect`: um positivo por kind; negativos: hash de commit de 40 hex, UUID, `sk-` curto.
- `isSecretFile`: `.env`, `.env.local` sim; `.env.example`, `id_rsa.pub` não.
- `/chave TESTE` grava em `.env` simulado, substitui valor existente, acrescenta `.env`
  ao `.gitignore` quando falta e não duplica quando já está.
- `Read` de `.env` devolve só nomes; `Bash` `cat .env` negado.
- Saída de `Bash` contendo valor do `.env` chega mascarada.
- Prompt com `AIza…` falso é segurado; com `#ok` passa sem o prefixo.
- `guarda`: `git add .env` vira `secret-commit`; `git add src/` sem segredo passa.

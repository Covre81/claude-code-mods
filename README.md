# claude-mods

Mods de function hooks para o [Claude Code](https://claude.com/claude-code): segurança no shell, guarda de segredos, telemetria de sessão, painéis de contexto e ferramentas de fluxo de trabalho. Cada mod é um plugin isolado, com testes próprios, e você liga só os que quiser.

## Mods

### Segurança

| Mod | O que faz |
|---|---|
| `guarda` | Segura comandos Bash arriscados (`rm -rf`, `git reset --hard`, force push, dependência nova) e pede confirmação explicando o impacto. |
| `lixeira` | Manda alvos de `rm` / `Remove-Item` para a Lixeira do Windows em vez de apagar de vez. |
| `cofre` | Mantém chaves de API fora da conversa: `/chave` grava no `.env`, leitura de arquivo de segredo mostra só os nomes, saídas são mascaradas e chaves coladas ficam retidas. |
| `atomic-commit-guard` | Bloqueia commit que mistura diretórios de topo, foge do Conventional Commits ou não tem `Co-Authored-By`. |
| `universal-audit-log` | Um hook em `*` que registra cada evento (tool calls, prompts, turnos, fs/http/process de outros plugins) com redação de segredos. |

### Sessão e contexto

| Mod | O que faz |
|---|---|
| `context-monitor` | Clima do contexto e uso acima do prompt, painéis de replay e atividade, motivo em linguagem simples antes de cada edição, notas do ai-memory. |
| `cache-frio` | Pergunta antes de mandar prompt numa conversa grande cujo prompt cache já esfriou. |
| `session-telemetry` | Hora em cada resposta, TTFT e tok/s por passo, e aviso quando o modelo que responde muda. |
| `session-time-machine` | `/timemachine`: a sessão como linha do tempo de prompts, tool calls e fins de turno. |
| `turn-inspector` | Painel lateral que mostra a sessão turno a turno: cada requisição ao modelo e o que ela levou. |
| `clean-view` | Cada tool call bem-sucedida vira uma linha (`Edit arquivo +12 −3`); erros e chamadas em curso mantêm o bloco completo. |
| `webfetch-cache` | Responde WebFetch repetido (mesma URL e prompt) a partir do cache da sessão. |

### Agentes e fluxo

| Mod | O que faz |
|---|---|
| `agent-flow` | Desenha ao vivo o fluxo de agentes: contexto do loop principal, árvore de subagentes, o que cada um recebeu e devolveu. |
| `agent-radar` | Uma linha por subagente rodando, acima do prompt; `/radar` abre o painel com as mensagens de cada um. |
| `delegation-dock` | Entrada na status line com as delegações em curso (agy/codex/ollama) e aviso quando uma volta vazia. |
| `phase-tracker` | Acompanha a fase atual (Spec → Red Test → Surgical Code → Verification). |
| `next-prompts` | Faixa com 3 sugestões de próximo passo geradas por um modelo Ollama; aperte uma para rascunhar. |
| `git-sidebar` | Painel estilo lazygit: worktrees e branches locais, troca de branch e abertura de worktree. |
| `wait-quiz` | Enquanto o Claude trabalha, uma faixa mostra um cartão de estudo para revisar. |
| `meus-mods` | Painel central: atalhos acima do prompt e `/mods` com o estado de cada mod. |

## Instalação

Requer um Claude Code com suporte a mods (function hooks).

```bash
git clone https://github.com/Covre81/claude-mods.git ~/.claude/mods
```

Ligue os mods listando as pastas, com caminho absoluto, em `CLAUDE_CODE_PLUGIN_DIRS` no `env` de `~/.claude/settings.json`. No Windows o separador é `;`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:/Users/me/.claude/mods/guarda;C:/Users/me/.claude/mods/cofre;C:/Users/me/.claude/mods/session-telemetry"
  }
}
```

A ordem importa: o último da lista fica mais perto do engine. O `lixeira`, por exemplo, deve vir depois do `guarda`, para o `guarda` ver o `rm -rf` original primeiro.

Vários mods têm um comando para ligar e desligar sem reiniciar (`/webfetch-cache on|off`, `/radar-toggle`, `/telemetria`…); `/mods` mostra o estado de todos.

## Desenvolvimento

Cada mod segue o mesmo layout:

```
<mod>/
  .claude-plugin/plugin.json   manifesto
  .claude-plugin/types/        tipos do engine (git-ignored, ver abaixo)
  hooks/hooks.json             quais hooks o mod registra
  hooks/register.ts(x)         o código
  hooks/*.test.ts(x)           testes
```

Os tipos do engine não vão para o repositório. Para tipar e testar um mod, copie `.claude-plugin/types` de um mod que já os tenha, ou gere-os com o seu Claude Code.

Os testes rodam no próprio Claude Code, não em vitest/jest:

```bash
claude plugin test guarda               # um mod
for d in */hooks/hooks.json; do claude plugin test "${d%%/*}"; done   # todos
```

Commits seguem o [Conventional Commits](https://www.conventionalcommits.org/), um mod por commit (o `atomic-commit-guard` cobra isso).

## Créditos

Seis mods (`agent-flow`, `git-sidebar`, `session-time-machine`, `turn-inspector`, `universal-audit-log`, `webfetch-cache`) vêm de [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates), e o `agent-radar` vem de [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods), ambos sob licença MIT e adaptados aqui. Os avisos de copyright estão em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Licença

[MIT](LICENSE)

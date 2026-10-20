# Erick Castilio's 9 mods: gap plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the useful gaps between the 9 mods in "9 mods para Claude Code - Erick Castilio" (links checked 2026-10-16) and this repo, without duplicating what we already have.

**Source:** `~/Downloads/9 mods para Claude Code - Erick Castilio.md`

**Tech Stack:** TypeScript (Claude Code mod API, `claude-code/testing`).

---

## Comparison (decided 2026-10-20)

| # | Their mod | Ours | Verdict |
|---|---|---|---|
| 06 | Blast Radius | `guarda` (adapted from it, @569c528) | **Have, ours is wider**: PowerShell, secret-commit, new dependencies, Windows-safe. Nothing to do. |
| 09 | Replay Theater | `context-monitor` `/replay` (adapted from it) | **Have.** Nothing to do. |
| 05 | Cache Tax | `cache-frio` | **Improve**: we only ask at submit time. Missing: time left before the cache goes cold, shown before it happens. `/keepwarm` = spike only (Task 5). |
| 01 | Savvy Progress | `agent-radar`, `agent-flow`, `context-monitor` (session cost) | **Improve `agent-radar`**: model and tokens per subagent. Task progress bar only if the engine exposes task events (Task 2 spike). |
| 07 | Reflect | none (`context-monitor/memoria.ts` only *reads* ai-memory) | **Missing**: new mod `reflexo` (Task 3). |
| 04 | File Tree | `git-sidebar` covers worktrees/branches, not files | **Missing**: a files tab in `git-sidebar` (Task 4). |
| 03 | You Should Know | built-in | **Test only** (Task 6). Requires a direct Anthropic session; all traffic goes through jev-router, so it probably won't run. |
| 02 | Claude Skins | `clean-view` owns tool-call rendering | **Discard**: cosmetic, competes with clean-view for the same rendering. |
| 08 | Terminal Browser | claude-in-chrome | **Discard**: needs Kitty graphics + WSL on Windows; experimental. |

## Global Constraints

- **Third-party code (Tasks 4, 5, and any upstream read):** clone into the scratchpad, run `skillspector scan <path> --no-llm`, separate real findings from false positives, check the license (MIT/Apache only), and record repo + commit. Mods run `$.process`/`$.fs`, so this is mandatory. Adapted code gets a header comment `// Adapted from <repo> @<sha> (<license>)` like `guarda/hooks/register.tsx:6`.
- **Commits:** `atomic-commit-guard` allows one top-level directory per commit. The mod's folder is one commit; `README.md`/`CHANGELOG.md`/`THIRD_PARTY_NOTICES.md` (repo root) are a separate commit. Conventional Commits, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **New mods publish their state on `session.start`** (see a6a344f, 3a3fb04), otherwise `/mods` shows them as off. Copy the `isEnabledRef` + `$.store` pattern from `cache-frio/hooks/register.tsx:4-37`, with an `on|off` command.
- **Types are git-ignored:** copy `cofre/.claude-plugin/types` into a new mod before type checking.
- **Verify per task:** `claude plugin test <mod>` from the repo root, and `npx -y -p typescript@5.6.3 tsc --noEmit -p .` inside the mod.
- **Enabling a new mod** means adding its path to `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`. That is the user's settings: ask before editing.
- User-facing text in PT-BR, code/comments/commits in English (match the repo).

---

### Task 0: Security scan of upstream sources

**User decision (2026-10-20):** after tests pass, new mods may be added to `CLAUDE_CODE_PLUGIN_DIRS` without asking again.

- [ ] Clone into `<scratchpad>/upstream/`: `data-goblin/claude-code-filetree`, `karanb192/cache-tax`, `BayramAnnakov/claude-reflect`, `JohnnyVizz/claude-kit`.
- [ ] `skillspector scan <each> --no-llm`; write findings + license + HEAD sha to `<scratchpad>/upstream/REPORT.md`.
- [ ] Stop and report to the user if any license is not MIT/Apache or any finding is real.

Nothing is installed or committed in this task. Upstream code is read as reference, never run.

### Task 1: `cache-frio` shows the time left before the cache goes cold

**Why:** today the warning arrives after the damage (the cache is already cold). Cache Tax's real value is seeing it coming.

**Files:** `cache-frio/hooks/register.tsx`, `cache-frio/hooks/*.test.ts`

- [ ] Write the failing test: a pure `minutesLeft({ idleMs })` returns `60 - idle` floored at 0; `isCold` unchanged.
- [ ] Show in the status line (pattern of `delegation-dock`, which already uses a status line entry) `cache: 12 min` only when context > `MIN_TOKENS` and the last answer came from the main loop. Hidden when the mod is off.
- [ ] Refresh it on a `$.clock` timer at most once a minute; no timer while idle-cold (it's already gone).
- [ ] No money estimate: prices vary by model and jev-router mixes models. `context-monitor` already shows real session cost from `$.session.usage().cost`. ponytail: add $ only if the host starts exposing the cache-write price.
- [ ] Verify: tests green; manual check that the line counts down.

Commit: `feat(cache-frio): show minutes left before the prompt cache goes cold`

### Task 2: `agent-radar` shows model and tokens per subagent

**Files:** `agent-radar/hooks/register.tsx`, its test

- [ ] **Spike first:** grep `agent-radar/.claude-plugin/types/index.d.ts` for what subagent events carry (`model`, `usage`). Also grep for any task/todo event (`TaskCreate`, `TodoWrite` tool calls are visible via `tool.call`). Write findings at the top of the task as a note.
- [ ] If `model`/`usage` exist: failing test first, then append `· sonnet · 42k tok` to the subagent line. If they don't, stop this step and say so; don't estimate.
- [ ] Progress bar (Savvy): only if `tool.call` on `TaskCreate`/`TaskUpdate` (or `TodoWrite`) gives the list and statuses. Then one line `3/7 tarefas` in the same radar band, not a new mod. Otherwise drop it.
- [ ] Verify: `claude plugin test agent-radar`.

Commit: `feat(agent-radar): show each subagent's model and tokens`

### Task 3: new mod `reflexo` (Reflect, minimal)

**Why:** corrections like "não, use X" or "sempre faça Y" are lost between sessions unless someone writes them to CLAUDE.md.

**Design (minimum):**
- `prompt.submit` hook: a pure `looksLikeRule(text)` regex (PT-BR + EN: `^(não|nao|nunca|sempre|pare de|prefiro|no,|don't|always|never|stop)\b`, short prompts ≤ 200 chars). No model call. ponytail: regex misses paraphrases; add the free Ollama cloud model used by `next-prompts` only if the miss rate bites.
- On match, never block the prompt: queue the text. On `turn.complete`, `$.ui.ask` "Salvar como regra?" with options `Projeto (CLAUDE.md)`, `Global (~/.claude/CLAUDE.md)`, `Ignorar`. Nothing is written without that explicit answer.
- Writing appends one line `- <text>` under a `## Regras capturadas` heading via `$.fs`. Never rewrites the file.
- `/reflexo on|off`, state published on `session.start`.

**Files:** `reflexo/.claude-plugin/plugin.json`, `reflexo/tsconfig.json`, `reflexo/hooks/hooks.json`, `reflexo/hooks/register.tsx`, `reflexo/hooks/reflexo.test.ts`

- [ ] Failing tests: `looksLikeRule` positives/negatives (include "não sei" → false, long prompts → false); hook never drops the prompt; nothing written when the answer is `Ignorar` or the ask is dismissed.
- [ ] Implement; fail open (`.catch(($, e, next) => next(e))`) like `cache-frio`.
- [ ] Verify tests + tsc; manual: type "nunca use sed no Windows", confirm the ask, confirm the line in a scratch CLAUDE.md (use a test project, not the real one).
- [ ] Ask the user before adding it to `CLAUDE_CODE_PLUGIN_DIRS`.

Commits: `feat(reflexo): offer to save a correction as a CLAUDE.md rule`, then `docs(readme): list reflexo`

### Task 4: "Arquivos" tab in `git-sidebar` (File Tree, adapted from data-goblin)

**Depends on:** Task 0 clean for that repo. **Decided by the user (2026-10-20):** a tab inside `git-sidebar`, not a separate mod.

**Files:** `git-sidebar/hooks/register.tsx` (+ a new `git-sidebar/hooks/filetree.ts` for the pure parts if register.tsx would pass ~500 lines), their tests

- [ ] Read upstream `<scratchpad>/upstream/claude-code-filetree` as reference only.
- [ ] Add a tab switch to the existing pane: `Branches` (today's view, unchanged) and `Arquivos`.
- [ ] `Arquivos`: tree of the session cwd (collapsed dirs, skip `.git`/`node_modules`), files read/written this session marked (from `tool.call` on `Read`/`Edit`/`Write`), git status marks from `git status --porcelain` via `$.process` (git only, like `guarda`).
- [ ] Failing tests first for the pure parts: paths -> tree rows, porcelain -> marks, touched-set from tool calls.
- [ ] Credit in `THIRD_PARTY_NOTICES.md` (separate commit, root dir).
- [ ] Verify: `claude plugin test git-sidebar`, tsc.

Commits: `feat(git-sidebar): add a files tab marking what Claude read and wrote`, then `docs: credit claude-code-filetree`

### Task 5: Spike — `/keepwarm` (no code promised)

Keeping the cache warm is cheap in theory (a cache read ≈ 0.1× vs a 1h write ≈ 2×), but two things are unverified:
- [ ] Does the mod API let a mod send a model request on its own? Read cache-tax's source to see which `$` call it uses.
- [ ] Would jev-router route a tiny keepalive to `gpt-oss:20b-cloud` (which warms nothing on Anthropic's side)? Read ai-memory `decisions/jev-router-operating-decisions.md` (project `JEV-APP-PC`).
- [ ] Report to the user with a go/no-go. Implementation becomes its own plan only on go.

### Task 6: Test You Should Know (one line)

- [ ] User runs `/plugin enable cc-plugin-you-should-know@builtin` in a session and does a long task. Expected [INFERIDO]: no notes, because the session goes through jev-router, not directly to Anthropic. Record the result; no code.

# OSE Community Repository — Agent Instructions

This repository is the home for community-related discussions, governance processes, and shared resources for projects under the Open Source Europe (OSE) umbrella. Content is licensed under CC-BY-4.0, except `automation/`, which holds software licensed under MIT.

## Authorship Rules

- **NEVER add `Co-Authored-By:` with yourself as a co-author of any commit.** Agents are assistants and tools — they are not authors. Only humans can be authors of commits.
- AI assistance disclosure belongs in the pull request description using the exact format below — not in commit authorship metadata:
  ```
  Generated-by: <Agent Name and Version> following [AI Policy](https://github.com/opensourceeurope/.github/blob/main/AI-POLICY.md)
  ```

## Development Workflow

- **Never edit or develop on `main`.** Every change goes through a topic branch and a
  pull request. A `PreToolUse` hook enforces this: the shared main checkout is read-only
  for edits, and edits on `main`/`master` are denied in any worktree.
- Create a worktree per topic — `.claude/scripts/worktree.sh new <branch-name>` makes
  `.worktrees/<branch-name>` off a freshly fetched `origin/main` — then work in that
  directory. A single checkout has one `HEAD`, so concurrent sessions sharing it fight
  over the branch; a worktree pins one branch to one directory.
- `.claude/scripts/worktree.sh list` / `rm <branch-name>` manage them. `.worktrees/` is
  gitignored.

## Handling Secrets

- **Never print a secret to check it.** Print a length, with an explicit `if` —
  `${V:+set}${V:-EMPTY}` and similar expansions resolve to the *value* whenever
  the variable is set, and that leaked a live API key into a session transcript
  here. Use `if [ -n "$V" ]; then echo "set, ${#V} chars"; else echo EMPTY; fi`.
- **Never paste a secret into a chat, issue, commit or agent transcript.** If one
  lands there, it is burned: rotate it rather than hoping. Two host passwords and
  one API key were lost this way in a single session.
- **Set a secret where it is read**, not through a pipeline you cannot see: a TTY
  prompt on the target host, or an editor on the file. A piped `read` that
  captures nothing writes an empty value and every step still reports success.
- **Confirm by effect, not by echo** — e.g. `docker compose up -d` printing
  `Recreated` rather than `Running` proves the value changed.
- Secrets live in four places and nowhere else: `.env` on the host (mode 600),
  n8n's own credential store, an operator's own machine outside any repo and mode
  600 (`~/.ovh.conf`, `~/.n8n-api-key`), or the shared password vault. **Never in
  this repo** — `.env`, `.env.*` and `ovh.conf` are gitignored, and `.env.example`
  holds names only.
- A credential belongs on whichever machine actually uses it. Do not move one
  onto a server for the feeling of safety: the API calls are TLS-protected either
  way, and the detour just forces every command through `ssh`.

## Shell Scripts

- Task scripts (`automation/infra/*.sh`, `.claude/scripts/*.sh`) use
  `set -euo pipefail`. Hooks (`.claude/hooks/*.sh`) deliberately use only
  `set -u`: a hook that aborts partway through would emit a wrong allow/deny
  decision instead of no decision.
- Under `pipefail`, **never use `grep -q` in a pipeline**: it exits on the first
  match, the upstream command dies of SIGPIPE, and the pipeline reports failure
  *because* the pattern was found. Use `grep -c` and test the count. This has
  already caused a verification script to declare a perfectly good backup
  broken.

## Commit Conventions

- Use conventional commits: `feat:`, `fix:`, `docs:`, `ci:`, `chore:`
- Two licences apply by path: everything under `automation/` is MIT (software);
  everything else is CC-BY-4.0 (content). Do not introduce material that is
  incompatible with the licence of the path you are touching.

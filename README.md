<!--
Agents: this README is the scaffold's placeholder. Once the project is fleshed out, rewrite it for this project: what it is, how to run it, and the few things a newcomer must know. Keep it short, move component details into nested READMEs, and delete this comment.
-->

# boardgame-pandemic-legacy-season-0

Created on 2026-11-25 with [setup-new-app](https://github.com/smirea/stefan-utils/tree/master/scripts/setup-new-app) (`--type client-server`). `.github/CI.md` describes the CI checks.

SvelteKit UI, Bun API, and shared TypeScript contracts in a Bun workspace.

- `apps/ui/`: SvelteKit 5 SPA with TanStack Query and Tailwind CSS v4
- `apps/server/`: Bun API that also serves the built UI
- `packages/shared/`: types and helpers used by both

```sh
bun install            # also installs the git hooks
bun run env:generate   # after editing .env or .env.local
bun run dev            # UI and API, with reload
```

The UI runs at http://boardgame-pandemic-legacy-season-0.localhost and proxies `/api/*` to the API.

Configuration lives in the root `.env` (tracked schema and defaults) and `.env.local` (ignored local values), managed by `env-manager`. Secrets belong to `apps/server`; browser settings are public.

`AGENTS.md` and each folder's `AGENTS.md` cover conventions, the environment setup, and agent worktrees.

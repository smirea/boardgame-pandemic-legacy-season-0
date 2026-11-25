# boardgame-pandemic-legacy-season-0

The extracted Pandemic Legacy: Season 0 game lives in [docs/game](docs/game/README.md): every workshop component, the rulebook, the images, and the meshes, one record per piece. That README is the map.

[docs/game/rules/rulebook.md](docs/game/rules/rulebook.md) is the field manual with every rule sticker in its slot. An HTML comment before each sticker says which card unlocks it.

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

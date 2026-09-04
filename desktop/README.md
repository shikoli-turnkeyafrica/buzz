# Buzz

Desktop chat shell with:

- Tauri + React + TypeScript + Vite
- Tailwind CSS
- shadcn/ui-ready shared components
- Biome (lint/format/check)
- Feature-driven frontend structure

## Scripts

- `pnpm dev` - run the web frontend
- `pnpm tauri dev` - run the desktop app
- `pnpm build` - typecheck and build frontend
- `pnpm typecheck` - TypeScript checks
- `pnpm lint` - Biome lint
- `pnpm format` - Biome format (write)
- `pnpm check` - Biome check

## Structure

- `src/shared` - reusable app-wide code (`ui`, `lib`, `styles`)
- `src/features` - feature modules (vertical slices)
- `src/app` - top-level app composition

## Cybercare Commons brand layer (Cybota fork)

This fork ships Buzz as **Cybercare Commons**. The brand is spelled in
exactly two files:

- `src/brand.ts` — product name, short name, vendor, deep-link scheme,
  legal URLs.
- `src-tauri/src/brand.rs` — product name, app identifier, keyring
  service, log prefix, scheme, and the Buzz identifiers migrated from.

Config files that cannot import a constant (`src-tauri/tauri.conf.json`,
`index.html`, `.github/workflows/windows-canary.yml`) carry literals;
`src/brandConfig.test.mjs` asserts they agree with `brand.ts`.

**Rebasing on upstream:** every branded string is a conflict site, and
each one resolves the same way — take upstream's sentence, then swap the
product word for the constant. `src/brandStrings.test.mjs` walks the
whole frontend and fails if a user-facing "Buzz" survives, so a missed
conflict is caught by the suite rather than by a screenshot.

**Deliberately still named "buzz":** crate names (`buzz-desktop`,
`buzz_lib`), sidecar binaries (`buzz-acp`, `buzz-agent`,
`buzz-dev-mcp`, `buzz-cli`), `BUZZ_*` environment variables, and the
`data-buzz-sidebar` / `buzz-theme-gradient-*` DOM hooks. The first three
are read by the sidecar bundler and the agent kernel's secret scrubber;
the last are invisible plumbing. Renaming any of them costs real
breakage for no visible gain.

**On first launch** the app copies an existing Buzz install's data
directory and adopts its keyring blob (`src-tauri/src/migration.rs`), so
an existing identity — and the room admissions attached to it — survives
the identifier change. The copy is one-way and marker-gated; Buzz stays
runnable.

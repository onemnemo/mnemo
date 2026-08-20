# mnemo-web (React and TypeScript)

`mnemo-web` is the user interface: a React and TypeScript single page app built with
Vite and styled with Tailwind. It reaches the backend through the Host HTTP API.

## Structure

- Small, swappable modules. See `00-principles.md` and `02-naming-and-structure.md`.
- Keep the data layer free of React. `api.ts` and `store.ts` export functions and state, not
  hooks that assume a component tree.
- Separate the item list from the thing that renders it. A menu shown from a `...` button and
  from a right-click consumes one exported item builder.
- Pure logic (tree building, mapping, command building, tallying) lives in its own module,
  imports no React, and is tested.

## Styling and design tokens

The design system is a hand-authored token set in `src/styles/tokens.css`, exposed to Tailwind
through the `@theme` block in `src/index.css`.

- Use the tokens: `ink`, `ink-2`, `ink-3`, `ink-icon`, `canvas`, `canvas-sunken`,
  `frame-hover`, `frame-active`, `line`, `shadow-pop`, `animate-pop-in`, `scroll-thin`, and
  the rest defined in `tokens.css`.
- Reach for an existing token before adding a new one.
- No hex colors and no `rgba()` in component code.
- No `bg-card` or `text-card-foreground`. That shadcn token set does not match this theme and
  is dead code wherever it survives.
- Do not add a consumer to `legacy-tokens.css`. It is a shim being deleted.

## Components and libraries

- Icons come from the `AppIcon` wrapper in `src/components/icon`, never from a direct
  `lucide-react` import, so the icon set stays one file's decision. Some surfaces use the real
  Mnemo SVGs; keep that art rather than substituting a lucide lookalike.
- Popovers, dropdowns, and context menus use Radix. Do not hand-roll portals, anchoring, or
  flip logic.
- Server state goes through React Query. The library key and a single entity's key are
  separate keys: a mutation must invalidate both, or an open page shows stale data.
- Update endpoints such as `PUT /api/decks/{id}` are full replaces. Send unchanged fields back
  or they are cleared.

## Internationalization

Every user-facing string is a translation key, present in all five shipped languages:
`en`, `de`, `es`, `ja`, `nb`.

- Shared strings: `Mnemo.Infrastructure/Languages/<lang>.json`.
- Module strings: `Mnemo.Infrastructure/Modules/<Module>/Translations/<lang>.json`.
- `mnemo-web` fetches these through its `src/i18n` layer rather than bundling its own copies.
- Translate inside components with the `useT()` hook.
- **Read the target JSON and confirm the namespace before adding a key.** Do not assume the
  namespace matches the module name. A shipped bug did exactly this: keys registered under
  `Keybinds` were read with the `Notes` namespace, and every user saw raw key strings.
- Non-English bundles are seeded from English at startup, so a missing key degrades to English
  instead of showing a raw key. That is a safety net, not permission to skip languages.
- Add keys with a targeted edit against a unique anchor. Never rewrite a whole translation
  file; more than one author appends to it.
- The Host caches translations at startup. Editing a translation JSON has no effect until the
  Host restarts, so do not conclude your key is wrong.

## Gotchas worth knowing before you debug them

- Emoji literals use the VS16 presentation form. The bare form looks identical and matches
  nothing.
- Old saved content renders through new views. Normalize legacy shapes at load and never
  restore view state from disk. See `01-architecture.md`.

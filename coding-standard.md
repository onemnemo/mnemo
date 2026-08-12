# Mnemo Coding Standard

This file is the source of truth for project conventions.  

## Priority Rules

1. Architecture boundary is strict: `Core` (interfaces/models only, zero implementation deps), `Infrastructure` (implementations), `UI` (presentation).
2. Mnemo.UI (the Avalonia app) uses MVVM: logic in ViewModels/services, not in views/code-behind. mnemo-web (the React app) follows its own rules; see the mnemo-web sections below.
3. Service dependencies use DI and interfaces.
4. Async I/O must be truly async (`Task`/`Task<T>`, cancellation support, no `.Result`/`.Wait()`).
5. Do not swallow exceptions.
6. For Avalonia layout controls: `StackPanel` and `Grid` do not get `Padding` or `CornerRadius`; use `Margin` or wrap in `Border`.
7. mnemo-web styling uses the design tokens in `src/styles/tokens.css`, never raw hex colors, `rgba()`, or the dead `bg-card` / `text-card-foreground` class names.

## Naming

### Required
- PascalCase for classes, interfaces, methods, properties, and public members.
- Prefix interfaces with `I` (example: `IAIService`).
- Suffix async methods with `Async` (example: `LoadDataAsync`).
- Use singular class names (example: `TaskScheduler`).
- Use descriptive names.

### Avoid
- Non-standard abbreviations (acceptable: common ones like `ctx`; avoid `mgr`).
- Hungarian notation (`strName`, `intCount`).
- Underscores in public identifiers (private fields may use `_fieldName`).

## Architecture and Layering

### Required
- Keep `Mnemo.Core` dependency-light and implementation-free.
- Put implementation code in `Mnemo.Infrastructure`.
- Keep presentation concerns in `Mnemo.UI`.
- Keep modules extensible via `IModule` auto-discovery.
- Register extension tools through `IFunctionRegistry`.

### Avoid
- God objects.
- Circular dependencies between layers.
- Hard-coded module registration.
- Leaking implementation details across boundaries.

## Code Organization

### Required
- One class/interface per file unless there is a strong reason.
- Use focused namespaces (typical patterns):
  - `Mnemo.Core.Services`
  - `Mnemo.Core.Models`
  - `Mnemo.Infrastructure.*`
  - `Mnemo.UI.Components.*`
- Keep namespace depth reasonable (typically <= 4 levels).
- Use `partial` only where it naturally belongs (for example, code-behind patterns).

## Async, Concurrency, and Task Execution

### Required
- Use `async`/`await` for all I/O and long-running async workflows.
- Accept `CancellationToken` for cancellable/long operations.
- Use `ConfigureAwait(false)` in non-UI/library code when appropriate.
- Use `TaskExecutionMode.Exclusive` for resource-heavy tasks (for example local AI inference).
- Use `TaskExecutionMode.Parallel` for lightweight independent I/O tasks.
- Support progress reporting when useful (`IProgress<T>`).

### Avoid
- Blocking waits on async (`.Result`, `.Wait()`).
- Ignoring cancellation once token is passed in.

## Error Handling

### Required
- Throw exceptions for exceptional failures.
- Use `Result<T>` or `bool` for expected non-exception flow.
- Log with context (prefer structured logging).
- Handle exceptions at clear boundaries (UI, service/API boundary).

### Avoid
- Silent catches.
- Exceptions as control flow.
- Catching broad `Exception` without handling and logging context.

## UI and Avalonia

### Required
- Prefer built-in Avalonia controls.
- Bind to dynamic theme values (brushes).
- Keep views declarative and bind to ViewModels.
- Localize UI strings (no hard-coded user-facing text).
- Keep UI thread responsive.

### Avoid
- Business logic in code-behind.
- Creating custom controls when styles/templates are enough.
- Applying unsupported layout styling:
  - Do not set `Padding` on `StackPanel` or `Grid`.
  - Do not set `CornerRadius` on `StackPanel` or `Grid`.
  - Instead: set `Margin` and/or wrap with `Border`.

mnemo-web is the primary user interface: a React and TypeScript single-page app, built with
Vite and styled with Tailwind CSS. It talks to Mnemo.Host over its HTTP API rather than
binding directly to the .NET services the Avalonia app uses. The sections below are its own
conventions, separate from the Avalonia rules above.

## mnemo-web Naming

### Required
- React component files: `PascalCase.tsx`, one component per file (example: `DeckRow.tsx`).
- Logic and data modules: `kebab-case.ts`, or a single lowercase word (example: `block-commands.ts`, `store.ts`, `api.ts`).
- Hooks: `use<Thing>` in a file named `use<Thing>.ts` (example: `useDailyActivity.ts`).
- Types and interfaces: `PascalCase`, no `I` prefix (example: `NoteSummary`, not `INoteSummary`).
- Tests: colocated as `<name>.test.ts` or `<name>.test.tsx`, next to the file they cover.
- Imports: use the `@/` alias (for example `import { AppIcon } from "@/components/icon"`), configured in `tsconfig.json` and `vite.config.ts`. Never reach up with `../../..`.

## mnemo-web Code Structure

### Required
- Small, swappable modules. A reader should be able to change one file without reading its neighbours.
- Keep data layers free of React so the data source can change without touching the UI.
- When the same menu or action list appears in more than one place (for example a `...` button and a right-click menu), have both consumers read from one exported item builder instead of duplicating the list. `mindmap/library/components/MapCard.tsx` exporting `MapMenuItems` is the existing example of this.
- Prefer adding a new file over growing an existing one. A file passing roughly 400 lines because of your change is a sign to split it.
- Import icons only through the `AppIcon` wrapper in `src/components/icon`, not directly from `lucide-react`, so icon usage stays swappable from one place.

### Avoid
- God components that mix data fetching, business logic, and rendering.
- Duplicated menu or action lists that can drift out of sync with each other.
- Relative parent traversal (`../../..`) where the `@/` alias reaches the same file.

## mnemo-web Styling and Design Tokens

The design system is a hand-authored set of tokens in `src/styles/tokens.css`, exposed to
Tailwind through the `@theme` block in `src/index.css`.

### Required
- Use the design tokens: `ink`, `ink-2`, `ink-3`, `ink-icon`, `canvas`, `canvas-sunken`, `frame-hover`, `frame-active`, `line`, `shadow-pop`, `animate-pop-in`, `scroll-thin`, and the others defined in `tokens.css`.
- Reach for an existing token before adding a new one.

### Avoid
- Hex colors or `rgba()` values in component code.
- The `bg-card` / `text-card-foreground` class names; that shadcn token set does not match this theme and is dead code where it still appears.
- Adding new consumers of `legacy-tokens.css`. It is a compatibility shim for modules not yet moved onto the current token set, not a place for new work.

## mnemo-web Comments

### Required
- Comment the why, and only when the why is not obvious from the code.
- Write like an engineer explaining a constraint to the next engineer.

### Avoid
- Narrating your own reasoning ("first we normalise, then we map").
- Changelog-style comments ("changed from X", "added for the release").
- `TODO`, `FIXME`, or `HACK` markers; raise the follow-up separately instead.
- Em dashes or en dashes, in comments or in any user-facing string (UI copy, translation text, error messages). Use a comma, parentheses, or a new sentence instead.

## mnemo-web Internationalization

### Required
- Every user-facing string is a translation key, present in all five shipped languages: `en`, `de`, `es`, `ja`, `nb`.
- Shared strings live in `Mnemo.Infrastructure/Languages/<lang>.json`; module-specific strings live in `Mnemo.UI/Modules/<Module>/Translations/<lang>.json`. mnemo-web fetches these through its `src/i18n` API layer rather than bundling its own copies.
- Match the namespace the file's other keys already use; read the target JSON before adding a key rather than assuming it matches the module name.
- Translate strings inside components with the `useT()` hook.

### Avoid
- Hard-coded user-facing text.
- Assuming a namespace without checking the target file; a mismatched namespace renders as a raw key to the user instead of translated text.

## mnemo-web Linting and Testing

### Required
- Lint with `npm run lint` (oxlint). `.oxlintrc.json` enables the `react`, `typescript`, and `oxc` rule sets, including `react/rules-of-hooks`.
- Test with `npm run test` (vitest). Tests are colocated with the code they cover.
- Add `// @vitest-environment jsdom` at the top of a test file that touches the DOM; vitest's default environment is not jsdom, and there is no project-wide override.
- Component tests render with `react-dom/client`'s `createRoot` and `react`'s `act`, and clean up (`unmount`, remove the container) in `afterEach`.

### Avoid
- Assuming `@testing-library/react` is available; the project does not depend on it.
- Leaving a mounted test root uncleaned between tests.

## Storage and Data

### Required
- SQLite for runtime data.
- `.mnemo` ZIP for portable exports.
- Separate runtime storage from packaged/export storage.
- Version schemas and keep migration paths.

### Avoid
- Large binary payloads in SQLite (store files and reference paths/ids).
- Mixing runtime and packaged concerns.

## Performance and Lifecycle

### Required
- Profile before optimizing.
- Lazy-load heavy resources.
- Cache expensive computations where justified.
- Use correct concurrent data structures (`ConcurrentDictionary`, etc.).
- Prevent leaks (unsubscribe events, dispose resources).

### Avoid
- Premature optimization.
- Loading all data at startup by default.

## Testing

### Required
- Unit test business logic.
- Mock dependencies through interfaces.
- Cover edge cases and failure paths.

### Avoid
- Tests coupled to implementation details.
- Tests requiring external services without test doubles.

## Documentation

### Required
- XML docs for public APIs where useful.
- Explain complex business rules and non-obvious algorithms.
- Keep module-level docs current.

### Avoid
- Comments that restate obvious code.
- Untracked TODOs.
- Docs that duplicate code without adding intent.
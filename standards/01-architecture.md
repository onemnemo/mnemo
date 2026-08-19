# Architecture and layering

## The map

| Project | What it is | May depend on |
|---|---|---|
| `Mnemo.Core` | Interfaces, models, contracts, enums. Zero implementation dependencies. | nothing |
| `Mnemo.Infrastructure` | Concrete implementations: storage, AI, knowledge management, services. | Core |
| `Mnemo.Host` | The loopback HTTP API and the desktop shell that hosts the web UI. | Core, Infrastructure |
| `Mnemo.UI` | The Avalonia presentation layer and the module tree. | Core, Infrastructure |
| `mnemo-web` | The React single page app, the primary user interface. | the Host HTTP API |

Rules that do not bend:

- `Mnemo.Core` never depends on `Infrastructure`, `Host`, or `UI`. It holds no implementation.
- Implementation lives in `Infrastructure`. Presentation lives in `UI` and `mnemo-web`.
- No circular dependencies between layers, ever.
- Implementation details do not leak across a boundary. A Core interface must not expose a
  type that only one implementation could satisfy.
- `mnemo-web` talks to the Host over HTTP. It does not bind to .NET services directly.

## Dependency injection

- Services are consumed through interfaces and injected by constructor.
- No hard-coded singletons, no service locator, no static mutable state standing in for a
  dependency.
- A class that news up its own collaborators cannot be tested or swapped. Inject instead.

## Modules and extension points

Features are self-contained modules implementing `IModule`, auto-discovered at startup, that
register their services, routes, and tools in `InitializeAsync()`. Nothing is registered by
editing a central list.

When you add a feature, add its module. When you add a capability that other features will
want, add a registry rather than a switch:

- Extension tools register through `IFunctionRegistry`.
- Block types contribute schema, renderer, serializers, and slash entry from one module.
  A closed enum touched in six places is the shape being replaced, not copied.
- If adding your feature required editing three unrelated files, the seam is missing. Add it.

Known gap, deliberately deferred: analytics has no module extension seam. Statistics schema
registration is reachable only through the AI tools hook, so the Host never runs it. Fixing
that is its own piece of work; do not build new statistics extensibility on the current seam
in the meantime.

## Seams and swappability

Before merging a feature, answer: if we replaced the storage, the model provider, the icon
set, or the rendering strategy tomorrow, how many files change? If the answer is more than
the seam plus its registration, the seam is in the wrong place.

- Keep the data layer free of React so the data source can change without touching the UI.
- Keep pure logic (tree building, tallying, mapping, command building) in modules that import
  neither React nor the HTTP client. These are the parts worth testing and the parts most
  likely to be reused.
- Wrap third party dependencies at one point of contact.

## Persisted data

Views render whatever the store gives them, including rows written by versions of the code
that no longer exist. Treat storage as a public contract.

- SQLite for runtime data, `.mnemo` ZIP for portable exports, and keep the two concerns
  separate.
- Do not store large binaries in SQLite. Store the file and reference its path or id.
- Version schemas and keep a migration path. The schema uses `CREATE TABLE IF NOT EXISTS` and
  never alters an existing file, so a new column has to be added on open, guarded by
  `PRAGMA table_info`. `FlashcardStore.EnsureSchemaVersionAsync` is the pattern.
- **Persisted enums are append only.** `BlockType` and friends are on disk in real user data.
  Inserting a member renumbers everything after it. Check how the converter serializes before
  touching one.
- **Normalize legacy shapes at load**, not in the view. Any pass that restyles persisted
  content must first read the hydrate path and list every persisted field that reaches the
  view.
- **Never restore view state from disk.** Expansion, selection, and scroll position are
  transient.
- An identifier that has been backfilled into real user data is frozen. Note short ids use a
  fixed alphabet and length and are guarded by a test; if more space is ever needed, mint
  longer ids for new objects only.

## Security invariants

These were found by adversarial review and must not be weakened:

- Unsafe link schemes are gated at the link mark itself, in both `getAttrs` and `toDOM`, not
  only in the clipboard sanitizer. A crafted payload reconstructs marks through
  `Slice.fromJSON`, which never runs `getAttrs`, so the render-time guard is the load-bearing
  one. Route every new URL-bearing attribute through the same allowlist.
- The internal paste handler must never throw. A throw skips `preventDefault`, and the
  browser native-pastes the raw unsanitized HTML.

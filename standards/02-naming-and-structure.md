# Naming and folder structure

One set of conventions for the whole project. A contributor who has read one module should be
able to predict the shape of the next one.

## Where things go

```
Mnemo.Core/            Models/  Services/ (interfaces)  Enums/  Identity/
Mnemo.Infrastructure/  Services/ (implementations)  Storage/  AI/  Languages/
Mnemo.Host/            the loopback HTTP API, endpoints per feature, the desktop shell
mnemo-web/src/         one folder per feature, plus components/ lib/ styles/ i18n/
standards/             this document set
```

Inside a `mnemo-web` feature folder, keep the same subdivision everywhere:

```
src/<feature>/
  api.ts                 the HTTP layer for this feature, no React
  store.ts               client state, no React components
  <domain>/              pure logic modules, framework free
  components/            presentation, one component per file
  <feature>.test.ts      colocated tests next to what they cover
```

Rules:

- Namespaces stay focused and shallow, typically no deeper than four levels:
  `Mnemo.Core.Services`, `Mnemo.Core.Models`, `Mnemo.Infrastructure.Storage`.
- One class or interface per file unless there is a strong reason. One React component per
  file, always.
- Prefer a new file over a growing one. Roughly 400 lines is the point at which a file that
  your change is growing should be split instead.
- Feature words are consistent across layers. A feature called `flashcards` in the web tree is
  `Flashcards` in the module tree, `FlashcardStore` in Infrastructure, and `flashcards` as a
  commit scope. Do not rename a concept as it crosses a boundary.

## Naming table

| Kind | Convention | Example |
|---|---|---|
| C# class, method, property, public member | PascalCase | `TaskScheduler`, `LoadDataAsync` |
| C# interface | `I` prefix | `IFlashcardStore`, `IAIService` |
| C# async method | `Async` suffix | `LoadDataAsync` |
| C# private field | `_camelCase` | `_scheduler` |
| C# service, endpoints, handler | `<Feature>Service.cs`, `<Feature>Endpoints.cs`, `<Feature>Handler.cs` | `SettingsEndpoints.cs` |
| React component file | `PascalCase.tsx`, one component per file | `DeckRow.tsx` |
| Logic or data module (TS) | `kebab-case.ts`, or one lowercase word | `block-commands.ts`, `store.ts`, `api.ts` |
| Hook | `use<Thing>` in `use<Thing>.ts` | `useDailyActivity.ts` |
| TypeScript type or interface | PascalCase, **no** `I` prefix | `NoteSummary` |
| Test | colocated `<name>.test.ts` or `.test.tsx` | `columns.test.ts` |
| Imports (web) | the `@/` alias | `import { AppIcon } from "@/components/icon"` |

Class names are singular. Names are descriptive.

## Avoid

- Non-standard abbreviations. Common ones such as `ctx` are fine; `mgr`, `hdlr`, `svc` are not.
- Hungarian notation (`strName`, `intCount`).
- Underscores in public identifiers.
- The `I` prefix on TypeScript types. It is a C# convention and does not cross over.
- Relative parent traversal (`../../..`) anywhere the `@/` alias reaches the same file.
- God objects and god components. If a class or component fetches data, decides business
  rules, and renders, it is three things wearing one name.
- Duplicated menu or action lists. Export one item builder and let both call sites consume it.
  `mindmap/library/components/MapCard.tsx` exporting `MapMenuItems` is the existing pattern.
- A folder whose name says nothing (`utils/`, `helpers/`, `misc/`) collecting unrelated code.
  Name the concern.

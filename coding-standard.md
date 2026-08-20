# Mnemo coding standard

The standard lives in [standards/](standards/), split by topic. Start with
[standards/README.md](standards/README.md).

| File | Covers |
|---|---|
| [00-principles.md](standards/00-principles.md) | Engineering philosophy: build for the future, no temporary solutions, modularity, efficiency, build vs depend, consistency, evidence |
| [01-architecture.md](standards/01-architecture.md) | Layer map and dependency rules, DI, modules and registries, seams, persisted data, security invariants |
| [02-naming-and-structure.md](standards/02-naming-and-structure.md) | Folder layout, the naming table for C# and TypeScript, file size, what to avoid |
| [03-dotnet.md](standards/03-dotnet.md) | C#, async and cancellation, errors, lifecycle |
| [04-web.md](standards/04-web.md) | React and TypeScript, design tokens, component libraries, internationalization |
| [05-testing-and-verification.md](standards/05-testing-and-verification.md) | What gets a test, how to run things, verifying for real, performance claims |
| [06-comments-and-copy.md](standards/06-comments-and-copy.md) | Comment style, the no-dash rule, user-facing copy |
| [07-git.md](standards/07-git.md) | Commit format, body shape, granularity, when to commit, pull requests |

## The short version

1. Architecture boundaries are strict: `Mnemo.Core` holds interfaces and models with zero
   implementation dependencies, `Mnemo.Infrastructure` holds implementations, `Mnemo.Host`
   serves the loopback API, `mnemo-web` is presentation.
2. Dependencies go through interfaces and constructor injection.
3. Async I/O is truly async. No `.Result`, no `.Wait()`, cancellation honoured.
4. Exceptions are never swallowed.
5. Small, swappable modules. Prefer a new file over a growing one.
6. No temporary solutions, and no `TODO`, `FIXME`, or `HACK` markers.
7. Every user-facing string is a translation key in all five languages.
8. `mnemo-web` styles with the design tokens in `src/styles/tokens.css`, never raw colors.
9. No em dashes or en dashes in comments, commits, or anything a user can read.
10. Commits are `type(scope): subject`, with no trailers.

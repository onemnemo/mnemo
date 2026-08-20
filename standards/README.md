# Mnemo standards

The source of truth for how this project is built. Read the file that covers what you are
about to touch. [AGENTS.md](../AGENTS.md) at the repository root is the short version.

| File | Covers |
|---|---|
| [00-principles.md](00-principles.md) | Engineering philosophy: build for the future, no temporary solutions, modularity, efficiency, build vs depend, consistency, evidence |
| [01-architecture.md](01-architecture.md) | Layer map and dependency rules, DI, modules and registries, seams, persisted data, security invariants |
| [02-naming-and-structure.md](02-naming-and-structure.md) | Folder layout, the naming table for C# and TypeScript, file size, what to avoid |
| [03-dotnet.md](03-dotnet.md) | C#, async and cancellation, errors, lifecycle |
| [04-web.md](04-web.md) | React and TypeScript, design tokens, component libraries, internationalization |
| [05-testing-and-verification.md](05-testing-and-verification.md) | What gets a test, how to run things, verifying for real, performance claims |
| [06-comments-and-copy.md](06-comments-and-copy.md) | Comment style, the no-dash rule, user-facing copy |
| [07-git.md](07-git.md) | Commit format, body shape, granularity, when to commit, pull requests |

If a rule here conflicts with a principle in `00-principles.md`, the principle wins and the
rule needs fixing. Say so rather than working around it.

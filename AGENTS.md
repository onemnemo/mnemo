# Agent contract

This file is the entry point for automated coding tools. Many contributors prepare changes
with one, and this exists so the tool picks up the project's standard before it writes a line
rather than after review. If you are reading by hand, go straight to
[standards/](standards/).

Read this before the first edit.

## What Mnemo is

A free, open source learning platform (flashcards, notes, mind maps, AI study tools) built to
put tools that are normally behind steep paywalls into everyone's hands. Access and quality
come before profit. It is built by one person, and it is meant to genuinely help people, so
craftsmanship matters more than shipping something quickly.

Stack: .NET 10, a loopback HTTP host, a React and TypeScript single page app in `mnemo-web`
served through a PhotinoX window, SQLite for runtime data.

## The standard

`standards/` is the source of truth. Read the file that covers what you are about to touch.

- `standards/00-principles.md` engineering philosophy
- `standards/01-architecture.md` layers, DI, modules, persisted data, security invariants
- `standards/02-naming-and-structure.md` folder layout and the naming table
- `standards/03-dotnet.md` C#, async, errors
- `standards/04-web.md` React, tokens, internationalization
- `standards/05-testing-and-verification.md` tests, and what a performance claim requires
- `standards/06-comments-and-copy.md` comments and user-facing copy
- `standards/07-git.md` commits and pull requests

## Non-negotiables

If you read nothing else, read these.

1. **No em dashes or en dashes.** Not in code comments, not in commit messages, not in any
   string a user can read. Use a comma, parentheses, or a new sentence.
2. **No `TODO`, `FIXME`, or `HACK`.** The tree has zero of these. File the follow-up as an
   issue instead.
3. **No internal document references in code or commits.** No milestone identifiers, no
   section numbers, no plan or spec filenames. Those files are local and private; a commit or
   a comment is read by strangers.
4. **No trailers on commits or pull requests.** No `Co-Authored-By`, no attribution lines.
   The commit author is the author.
5. **Commit format is `type(scope): subject`**, lowercase imperative. Bundle related work;
   do not commit every tiny step.
6. **Commit at logical boundaries without asking. Ask before pushing** or before anything
   else that leaves the machine.
7. **Every user-facing string is a translation key** in `en`, `de`, `es`, `ja`, `nb`.
8. **No raw colors in `mnemo-web`.** Use the design tokens.
9. **Icons go through `AppIcon`**, never a direct `lucide-react` import.
10. **A performance number needs a proof of correct output from the same run.** A render
    optimization that renders nothing always wins the benchmark.

## Working rules

- Comment the why, and only when the why is not obvious. Most code needs no comment.
- Prefer a new file over a growing one. Around 400 lines is the point to split.
- Build for what the product is becoming, not for today's data. Do not ship a stopgap without
  isolating it behind one seam and writing the follow-up down.
- Verify against real saved data, not a fresh profile. Old rows render through new views.
- Report what you actually ran and what it produced. If something is skipped or failing, say
  so plainly.

## Verification

From `mnemo-web`:

```bash
npx tsc -b && npx oxlint src && npx vitest run
```

.NET tests run from PowerShell (git bash mangles the `/p:` argument form), and need a scratch
`OutDir` when a debugger or the running app holds a lock on `Mnemo.Host/bin`. Details in
`standards/05-testing-and-verification.md`.

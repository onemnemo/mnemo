# Git, commits, and pull requests

The audience for a commit message is somebody reading this repository on GitHub who has never
seen the author's machine. Everything below follows from that.

## Subject line

The format is mandatory, not optional:

```
type(scope): subject
```

Subject is lowercase and imperative. A bare `overview: build edit mode` is wrong; it must be
`feat(overview): build edit mode`.

```
feat(notes): teach the sidebar tree to drag folders into folders
fix(host): answer 409 with the stored version on stale note writes
perf(notes): mint identity for a pasted run in one grouped step
```

- Types in use: `feat`, `fix`, `perf`, `refactor`, `test`, `chore`.
- Scope is the feature area: `notes`, `flashcards`, `mindmap`, `overview`, `settings`,
  `onboarding`, `host`, `web`, `chrome`, `i18n`, `dnd`, `stats`, `release`, `repo`.
- The subject says what changed for a user, not which function was edited.

## Body

A one-line summary of the change, then bullets, one per distinct part.

- Bullets are terse by default: state what changed.
- Add a reason to a bullet **only** when the change is non-obvious, a bug fix, a migration, a
  workaround, or a deliberate divergence. Features skew terse, fixes keep the why.
- Skip the summary line when there is a single bullet or the subject already says it all.
  Do not bullet a single-idea change.
- A small self-evident change gets a one-line body, or none at all.
- The body is a plain changelog: what changed, plus the one load-bearing reason it matters.
  Not an essay, not a design document, not a thought process written out longhand. Cut
  editorializing, process narration ("I first tried"), and rhetorical flourish. State the fact
  and stop.

```
fix(notes): read the paste progress strings from the namespace they live in

The overlay used the Notes namespace, but the three clipboard keys are
registered under Keybinds, so every user saw raw key strings whenever
more than one image was pasted.
```

## Hard rules

- **No em dashes or en dashes**, in the subject or the body. Commas, parentheses, or a new
  sentence. Self-check this before every commit.
- **No references to local-only material.** No section numbers, no milestone identifiers, no
  plan or spec filenames, no "per the spec" or "per the plan". Those files are not visible to
  anyone reading the repository.
- **No trailers.** No `Co-Authored-By`, no attribution lines of any kind, in commits or in
  pull request bodies. The commit author is the author.
- The message must stand alone for a first-time reader.

## Granularity

Bundle related work into one commit. Do not commit every tiny step.

- A milestone lands in roughly two or three commits along its natural seams: one per
  user-visible surface, or one per layer. Not eight.
- A pure-logic module and the component that is its only consumer belong in the same commit.
- A shared primitive touched on the way belongs with whatever needed it, unless it stands on
  its own.
- A trivial follow-up that refines the commit before it should be folded into that parent
  rather than added as its own commit.
- The goal is a git history that is genuinely good to read, so the same standard applies
  retroactively when curating a branch.

## When to commit

- Commit at a **logical boundary**: a working, verified unit such as a layer, a user-visible
  surface, or a self-contained backend change. Build it, run the tests, then commit.
- Never commit a mid-refactor state or an unverified change.
- Anything pushed is public history. Read the message and the diff once more before it leaves
  the machine.
- Never use `--no-verify` or skip signing. If a hook fails, fix the cause.
- Do not amend or rewrite commits that have been pushed.

## Pull requests

Same rules as commit bodies: self-contained for a first-time reader, no dashes, no trailers.

# Comments and user-facing copy

## Comments

Comment the **why**, and only when the why is not obvious from the code. A file with no
comments is a fine outcome. Most code should not need one.

Good:

```ts
// The sweeper runs before the first save, so an empty note is normal, not a fault.
if (!items.length) return null
```

```csharp
/// <summary>Look up a template by id. Returns null if none matches.</summary>
```

Bad, and why:

```ts
// We check this first because otherwise the loop below would crash when the array is empty.
// (narrating your own reasoning; the code already says this)

// Added error handling here for the alpha release.
// (changelog comment; git already records when and why)

// Toolbar with a dropshadow and a glowing border
// (restates the obvious; the markup already says this)
```

Rules:

- No narration of your own reasoning. Not "first we normalise, then we map", not "this is
  tricky because", not "we need to handle the case where".
- No changelog comments. Not "changed from X", not "previously this used Y".
- **A comment stands on its own.** No milestone identifiers, no section numbers, no plan or
  spec filenames, no issue ids. A pointer to a document the reader does not have open says
  nothing. Name the thing instead: "the formatting toolbar", "the read path", "the schema
  layer".
- No `TODO`, `FIXME`, or `HACK`. The repo has zero of these. Raise the follow-up as an issue
  instead.
- Keep it short. A file header is a few lines, not an essay. Pick the one or two non-obvious
  facts a maintainer needs and cut the rest. A long multi-section header with "## Why X"
  narration is notes to self, not documentation.
- If a comment only says what the next line says, delete it.
- Sound like an engineer explaining a constraint to the next engineer. No padding, no
  incidental detail.
- XML `<summary>` on public members, covering behavior plus edge cases, is wanted.

## No em dashes or en dashes. Anywhere a person can read.

This is a house voice rule, not a formatting preference, and it is absolute.

It covers:

- Code comments and doc blocks.
- Commit messages, PR titles, and PR bodies.
- Every user-facing string: UI copy, translation JSON in all five languages, error messages,
  tooltips, README, NOTICE, release notes, changelog entries.

Rewrite the sentence with a comma, parentheses, or a new sentence. Do not substitute a hyphen
or a double hyphen as a disguise; that just looks broken.

Two em dashes survive on purpose as rendered placeholder glyphs in the flashcards deck view
and the keybind overlay. Those are UI content, not prose.

## User-facing copy

- Every string is a translation key, present in `en`, `de`, `es`, `ja`, `nb`. See
  `04-web.md` for where they live and how to add one.
- Write copy the way the product should sound: plain, direct, no filler.
- When porting copy out of a design prototype, expect to rewrite rather than transliterate.
  Prototype strings carry dashes and are English only.

# Testing and verification

## What gets a test

- Business logic in Infrastructure, and every pure function in the web tree: tree building,
  grade tallying, mappers, command builders, parsers, schedulers.
- Edge cases and failure paths, not only the happy path.
- UI wiring does not need a test. A new pure function does.
- Mock dependencies through their interfaces. Do not couple a test to an implementation
  detail; it should survive a rewrite of the thing it covers.
- Do not require an external service without a test double.

## Running things

Web, from `mnemo-web`:

```bash
npx tsc -b && npx oxlint src && npx vitest run
```

- Lint is oxlint through `npm run lint`. `.oxlintrc.json` enables the `react`, `typescript`,
  and `oxc` rule sets including `react/rules-of-hooks`.
- Tests are vitest through `npm run test`, colocated with the code they cover.
- A test that touches the DOM needs `// @vitest-environment jsdom` at the top of the file.
  There is no project-wide override.
- Component tests render with `createRoot` from `react-dom/client` and `act` from `react`, and
  clean up in `afterEach` (unmount, remove the container). `@testing-library/react` is not a
  dependency; do not assume it.

.NET:

```bash
dotnet build MnemoApp.sln
dotnet test MnemoApp.sln
```

- Run .NET tests from PowerShell. Git bash mangles the `/p:` argument form.
- A debugger or a running app often locks `Mnemo.Host/bin`, which fails the copy step even
  though compilation succeeded. Redirect the whole build with a scratch `OutDir`, keeping the
  trailing backslash and using a path without spaces. Passing `-o` on the test project alone
  is not enough, because referenced projects still build into their own `bin`.
- To check that something compiles without touching the locked output, build the single
  project into a scratch output folder.

## Verifying a change for real

- Verify against real persisted data, not a fresh profile. Legacy rows are where a restyle
  breaks, and a fresh profile has none of them.
- When a visual change is reported as broken, ask whether the screenshot shows old content
  before assuming the new styling is at fault.
- Say what you ran and what it produced. If part of the suite was skipped, say that.

## Performance claims

Two rules, both learned the expensive way.

**A performance number needs a proof of correct output from the same run.**
Prove non-blank, correct rendering from engine truth (a computed-style or equivalent readback,
not the component's own bookkeeping, not element bounds, not "the screenshot looked fine
earlier"). Name the count and its expected value, and treat a near-zero as void rather than as
a result. A culling change once reported a flawless 600 of 600 frames with a supporting trace,
and the page was blank. A rendering optimization that renders nothing always wins, so the
best-looking result is exactly the one that most needs the proof. When comparing two
configurations, the output counts must match between them, or the comparison is not
like for like.

**Never compare runs across process launches.**
Run both arms inside one process, separated by a state reset, with the order balanced
(A-B-B-A, then B-A-A-B on another pass). Machine drift over a heavy session was several times
larger than the effect being measured: the same scene walked from 1409ms to 2859ms mount time,
and two consecutive repeats of one configuration gave 60 and 47 over-budget frames against an
earlier 9. An idle calibration gate does not catch this, because sixty idle frames hit 60fps
even on a loaded machine. Record a work signal instead and refuse to compare across a gap in
it. Toggle the arm at runtime and prove the toggle fired in the run that produced the numbers.
If the toggle is CSS, make it idempotent, and count drawn boxes with `getClientRects()` rather
than computed display, because a descendant of a hidden element still reports its own display.

When analysing a trace, read every thread. A scan of one thread that merely totalled the
others missed a 165ms GPU task and produced a confident wrong conclusion.

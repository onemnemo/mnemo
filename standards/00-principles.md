# Engineering principles

The rules in the other files follow from these. When a rule and a principle appear to
disagree, the principle wins and the rule is wrong; say so and fix the rule.

## 1. Build for the Mnemo that exists in three years

Design for the product's goal, not for today's data or today's feature list.

- Measurements of the current corpus describe the present, not the target. The Notes editor
  is meant to hold tens of thousands of blocks at 60fps; a survey showing that real notes
  average 90 blocks is not an argument against virtualization, it is a description of the
  starting point.
- Ask what the surface is trying to become before concluding that a piece of engineering is
  unnecessary.
- Prefer the shape that keeps growing over the shape that is smallest today. A registry of
  block types beats an enum touched in six places, even when there are only four types.

## 2. No temporary solutions

A stopgap that ships becomes the architecture. If a shortcut is genuinely unavoidable,
it is not finished until all three of these are true:

1. It is isolated behind one seam, so replacing it touches one file.
2. A comment at that seam says what it is standing in for and what would replace it.
3. The follow-up is filed as an issue, with what is wrong, why it matters, and what a fix
   involves.

Never leave a `TODO`, `FIXME`, or `HACK` marker in the tree. The repo has zero of these and
keeps it that way. An untracked marker is a promise nobody can find.

Corollaries:

- Do not write code whose purpose is to be replaced next sprint, unless it is a spike, in
  which case it is deleted rather than merged.
- Do not paper over a data problem in the view. Fix it where the data is produced or
  normalized, not where it is rendered.
- Do not add a compatibility shim without an owner and a removal condition.
  `legacy-tokens.css` is an existing shim being deleted; never add a consumer to it.

## 3. Modular by default

The standing requirement is that a reader can swap one file without reading its neighbours.

- Small, focused modules with clear seams. A file passing roughly 400 lines because of your
  change is a signal to split it, not a reason to keep appending.
- Prefer adding a file over growing one.
- Keep data layers free of the UI framework so the data source can change without touching
  the presentation.
- One definition, many consumers. When the same list, menu, or rule appears in two places,
  export one builder and have both call it.
- Name and structure so a later engineer can replace an implementation without touching
  call sites. Interfaces in `Mnemo.Core`, implementations in `Mnemo.Infrastructure`, is the
  same idea expressed at the project level.

## 4. Efficiency is a feature, and it is measured

Performance on large documents and large maps is the headline differentiator, not a polish
item. That does not license premature optimization; it means the cost of a design is part of
choosing it.

- Choose the algorithm and the data shape with scale in mind, before writing the code.
- Optimize an existing path only after profiling it.
- Every performance claim needs a proof of correct output taken in the same run that produced
  the numbers. See `05-testing-and-verification.md`; a rendering optimization that renders
  nothing always wins the benchmark.
- Lazy-load heavy resources. Do not load everything at startup by default.
- Cache when the cost is real and the invalidation is understood.

## 5. Own what defines the product

Reach for a dependency when the problem is solved, boring, and not ours. Build it ourselves
when the thing is part of what makes Mnemo good.

Build it ourselves when:

- The behavior is a differentiator (the block editor's text engine, the mindmap canvas, the
  scheduler, the spell checker with its own dictionary).
- The library forces a data model we would have to fight or convert on every call.
- The library is heavy relative to the slice we need.
- The license is incompatible with a permissively licensed open source product, or the
  provenance is unclear.
- We would end up wrapping it so thoroughly that the wrapper is the real implementation.

Take the dependency when:

- It is a well-tested solution to a hard, generic problem (SQLite, ProseMirror's document
  model, Radix's accessibility and positioning primitives, a PDF or typesetting engine).
- It is a build or test tool rather than shipped behavior.
- Writing it ourselves would mean reimplementing a specification, not a feature.

Either way, put it behind our own seam so the choice is reversible. Icons go through
`AppIcon`, never a direct `lucide-react` import, precisely so the icon set is one file's
decision.

## 6. Fidelity to intent, not to the old implementation

The React port matches the design intent of the Avalonia app, not its warts. Where the
existing solution is flimsy, make the port better or write the finding down. Never faithfully
reproduce something bad because it is what the reference does.

## 7. One rule everywhere

The same naming, the same layout, the same conventions across every module and both
languages. A contributor who has read one module should be able to predict the shape of the
next one. Inconsistency costs more than any individual convention is worth, so follow the
existing pattern even when you would have chosen differently, and change it everywhere at
once when it is genuinely wrong.

## 8. Claims need evidence

State what you ran and what it produced. "Tests pass" means you ran them. A performance
number without a correctness proof is void. A conclusion drawn from one thread of a trace,
or one arm of a comparison, is a guess wearing a number.

/**
 * Registry validation rejections.
 *
 * One test per rule in validate.ts, each asserting the specific issue code
 * rather than just "it threw" — a code is what a module author greps for, and
 * a rule that fires under the wrong circumstances is as much a bug as one
 * that never fires. Also covers aggregation (three problems, one error) and
 * the two coverage flags, which are validate.ts concerns rather than
 * build.ts's, so they live here rather than in registry.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { buildBlockRegistry } from './build';
import { validateRegistry } from './validate';
import type { AnyMarkModule } from './types';
import type { TextStyle } from '../../model/types';
import {
  baseNodes,
  buildOrThrowIssues,
  headingModule,
  makeTestBlockModule,
  makeTestInlineModule,
  paragraphModule,
  strongMark,
  testMarkSpec,
} from './fixtures';

describe('node and wire-type rules', () => {
  it('flags duplicate-node-name when two modules claim the same nodeName', () => {
    const a = makeTestBlockModule({ nodeName: 'dup', wireTypes: ['Text'] });
    const b = makeTestBlockModule({ nodeName: 'dup', wireTypes: ['Quote'] });
    const issues = buildOrThrowIssues({ blocks: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-node-name')).toBe(true);
  });

  it('flags duplicate-wire-owner when two modules claim the same wire type', () => {
    const a = makeTestBlockModule({ nodeName: 'a', wireTypes: ['Text'] });
    const b = makeTestBlockModule({ nodeName: 'b', wireTypes: ['Text'] });
    const issues = buildOrThrowIssues({ blocks: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-wire-owner')).toBe(true);
  });

  it('flags no-wire-types when a module claims none', () => {
    const a = makeTestBlockModule({ nodeName: 'a', wireTypes: [] });
    const issues = buildOrThrowIssues({ blocks: [a] });
    expect(issues.some((i) => i.code === 'no-wire-types')).toBe(true);
  });

  it('flags reserved-node-name when a module claims a base schema node', () => {
    const a = makeTestBlockModule({ nodeName: 'text', wireTypes: ['Text'] });
    const issues = buildOrThrowIssues({ blocks: [a] }, { baseNodes });
    expect(issues.some((i) => i.code === 'reserved-node-name')).toBe(true);
  });
});

describe('common-attr shadowing', () => {
  it('flags shadowed-common-attr when a module redeclares sid', () => {
    // sid is merged in from commonBlockAttrs; a module restating it is either
    // shadowing that default or expecting an override that will never happen.
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      node: { group: 'block', attrs: { sid: { default: 'nope' } } },
    });
    const issues = buildOrThrowIssues({ blocks: [a] });
    expect(issues.some((i) => i.code === 'shadowed-common-attr')).toBe(true);
  });

  it('flags shadowed-common-attr when a module redeclares meta', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      node: { group: 'block', attrs: { meta: { default: {} } } },
    });
    const issues = buildOrThrowIssues({ blocks: [a] });
    expect(issues.some((i) => i.code === 'shadowed-common-attr')).toBe(true);
  });

  it('does not flag a module that declares only its own attrs', () => {
    const issues = validateRegistry({ blocks: [headingModule] }, { baseNodes });
    expect(issues.some((i) => i.code === 'shadowed-common-attr')).toBe(false);
  });
});

describe('content-expression resolution', () => {
  it('flags unresolved-content-reference when content names an unregistered node', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      node: { content: 'ghost+', group: 'block' },
    });
    const issues = buildOrThrowIssues({ blocks: [a] }, { baseNodes });
    expect(issues.some((i) => i.code === 'unresolved-content-reference')).toBe(true);
  });

  it('does not flag a content expression that references a declared group rather than a node', () => {
    // heading and paragraph both write 'line block*', where 'block' is a
    // group the modules declare themselves, not a node named "block" - the
    // obvious false-positive risk for this check.
    const issues = validateRegistry({ blocks: [headingModule, paragraphModule] }, { baseNodes });
    expect(issues.some((i) => i.code === 'unresolved-content-reference')).toBe(false);
  });
});

describe('input trigger rules', () => {
  it('flags stateful-input-trigger for a global-flagged pattern', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      inputTriggers: [{ id: 't1', match: /foo$/g, handler: () => null }],
    });
    const issues = buildOrThrowIssues({ blocks: [a] });
    expect(issues.some((i) => i.code === 'stateful-input-trigger')).toBe(true);
  });

  it('flags stateful-input-trigger for a sticky-flagged pattern', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      inputTriggers: [{ id: 't1', match: /foo$/y, handler: () => null }],
    });
    const issues = buildOrThrowIssues({ blocks: [a] });
    expect(issues.some((i) => i.code === 'stateful-input-trigger')).toBe(true);
  });

  it('flags unanchored-input-trigger when the pattern has no trailing $', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      inputTriggers: [{ id: 't1', match: /foo/, handler: () => null }],
    });
    const issues = buildOrThrowIssues({ blocks: [a] });
    expect(issues.some((i) => i.code === 'unanchored-input-trigger')).toBe(true);
  });

  it('flags unanchored-input-trigger for an escaped-$ pattern like the display-math trigger', () => {
    // The bug this guards against: `/\$\$/`.source is "\$\$", which
    // `endsWith('$')` naively reports as anchored even though neither `$` is
    // the end-of-input anchor - both are escaped, literal dollar signs. The
    // fix strips escapes before checking, so this pattern strips down to the
    // empty string and correctly comes back unanchored.
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Equation'],
      inputTriggers: [{ id: 't1', match: /\$\$/, handler: () => null }],
    });
    const issues = buildOrThrowIssues({ blocks: [a] });
    expect(issues.some((i) => i.code === 'unanchored-input-trigger')).toBe(true);
  });

  it('accepts a genuinely anchored pattern whose source happens to end a group just before the $', () => {
    // The symmetric risk to the case above: an escape-stripping fix must not
    // over-correct and start rejecting patterns that really are anchored just
    // because a syntax character (here the group's closing paren) sits next
    // to the anchor.
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      inputTriggers: [{ id: 't1', match: /(?:foo|bar)$/, handler: () => null }],
    });
    // Not buildOrThrowIssues: this module is valid, so buildBlockRegistry
    // succeeds and there is no RegistryValidationError to unwrap.
    const issues = validateRegistry({ blocks: [a] });
    expect(issues.some((i) => i.code === 'unanchored-input-trigger')).toBe(false);
  });
});

describe('cross-module id uniqueness', () => {
  it('flags duplicate-command-id', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      commands: [{ id: 'cmd.x', command: () => false, label: 'X' }],
    });
    const b = makeTestBlockModule({
      nodeName: 'b',
      wireTypes: ['Quote'],
      commands: [{ id: 'cmd.x', command: () => false, label: 'X again' }],
    });
    const issues = buildOrThrowIssues({ blocks: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-command-id')).toBe(true);
  });

  it('flags duplicate-input-trigger-id', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      inputTriggers: [{ id: 'trig.x', match: /a$/, handler: () => null }],
    });
    const b = makeTestBlockModule({
      nodeName: 'b',
      wireTypes: ['Quote'],
      inputTriggers: [{ id: 'trig.x', match: /b$/, handler: () => null }],
    });
    const issues = buildOrThrowIssues({ blocks: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-input-trigger-id')).toBe(true);
  });

  it('flags duplicate-invariant-id', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      invariants: [{ id: 'inv.x', order: 0, apply: () => null }],
    });
    const b = makeTestBlockModule({
      nodeName: 'b',
      wireTypes: ['Quote'],
      invariants: [{ id: 'inv.x', order: 0, apply: () => null }],
    });
    const issues = buildOrThrowIssues({ blocks: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-invariant-id')).toBe(true);
  });

  it('flags duplicate-slash-label', () => {
    const a = makeTestBlockModule({
      nodeName: 'a',
      wireTypes: ['Text'],
      slash: { label: 'Same', keywords: [], icon: 'square', group: 'basic', insert() {} },
    });
    const b = makeTestBlockModule({
      nodeName: 'b',
      wireTypes: ['Quote'],
      slash: { label: 'Same', keywords: [], icon: 'square', group: 'basic', insert() {} },
    });
    const issues = buildOrThrowIssues({ blocks: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-slash-label')).toBe(true);
  });
});

describe('inline atom rules', () => {
  it('flags duplicate-inline-node-name when two inline modules claim the same nodeName', () => {
    const a = makeTestInlineModule({ nodeName: 'dup-inline', spanKind: 'equation' });
    const b = makeTestInlineModule({ nodeName: 'dup-inline', spanKind: 'fraction' });
    const issues = buildOrThrowIssues({ blocks: [], inlines: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-inline-node-name')).toBe(true);
  });

  it('flags duplicate-span-kind when two inline modules claim the same spanKind', () => {
    const a = makeTestInlineModule({ nodeName: 'eq-a', spanKind: 'equation' });
    const b = makeTestInlineModule({ nodeName: 'eq-b', spanKind: 'equation' });
    const issues = buildOrThrowIssues({ blocks: [], inlines: [a, b] });
    expect(issues.some((i) => i.code === 'duplicate-span-kind')).toBe(true);
  });

  it('flags node-name-collision when a block module and an inline module share a nodeName', () => {
    // Block and inline nodes share one PM schema namespace, so this is not
    // merely confusing - it is the same failure shape as duplicate-node-name,
    // just crossing the block/inline boundary instead of staying within it.
    const block = makeTestBlockModule({ nodeName: 'shared', wireTypes: ['Text'] });
    const inline = makeTestInlineModule({ nodeName: 'shared', spanKind: 'equation' });
    const issues = buildOrThrowIssues({ blocks: [block], inlines: [inline] });
    expect(issues.some((i) => i.code === 'node-name-collision')).toBe(true);
  });
});

describe('mark rules', () => {
  it('flags duplicate-mark-name', () => {
    const m1: AnyMarkModule = { markName: 'dup', mark: testMarkSpec(), styleKey: 'bold' };
    const m2: AnyMarkModule = { markName: 'dup', mark: testMarkSpec(), styleKey: 'italic' };
    const issues = buildOrThrowIssues({ blocks: [], marks: [m1, m2] });
    expect(issues.some((i) => i.code === 'duplicate-mark-name')).toBe(true);
  });

  it('flags duplicate-style-key when two marks claim the same TextStyle field', () => {
    const m1: AnyMarkModule = { markName: 'a', mark: testMarkSpec(), styleKey: 'bold' };
    const m2: AnyMarkModule = { markName: 'b', mark: testMarkSpec(), styleKey: 'bold' };
    const issues = buildOrThrowIssues({ blocks: [], marks: [m1, m2] });
    expect(issues.some((i) => i.code === 'duplicate-style-key')).toBe(true);
  });

  it('flags unknown-style-key when styleKey is not a TextStyle field', () => {
    const m1: AnyMarkModule = {
      markName: 'a',
      mark: testMarkSpec(),
      styleKey: 'bogus' as unknown as keyof TextStyle,
    };
    const issues = buildOrThrowIssues({ blocks: [], marks: [m1] });
    expect(issues.some((i) => i.code === 'unknown-style-key')).toBe(true);
  });

  it('flags asymmetric-mark-attrs when only one of toAttrs/fromAttrs is declared', () => {
    const m1: AnyMarkModule = {
      markName: 'a',
      mark: testMarkSpec(),
      styleKey: 'linkUrl',
      toAttrs: (value) => (value === null ? null : { href: value as string }),
      // fromAttrs intentionally omitted
    };
    const issues = buildOrThrowIssues({ blocks: [], marks: [m1] });
    expect(issues.some((i) => i.code === 'asymmetric-mark-attrs')).toBe(true);
  });
});

describe('aggregation', () => {
  it('reports every problem in one error rather than stopping at the first', () => {
    const dup1 = makeTestBlockModule({ nodeName: 'dup', wireTypes: ['Text'] });
    const dup2 = makeTestBlockModule({ nodeName: 'dup', wireTypes: ['Quote'] }); // duplicate-node-name
    const noWire = makeTestBlockModule({ nodeName: 'no-wire', wireTypes: [] }); // no-wire-types
    const badTrigger = makeTestBlockModule({
      nodeName: 'bad-trigger',
      wireTypes: ['Divider'],
      inputTriggers: [{ id: 'bt', match: /x$/g, handler: () => null }], // stateful-input-trigger
    });

    const issues = buildOrThrowIssues({ blocks: [dup1, dup2, noWire, badTrigger] });
    const codes = issues.map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining(['duplicate-node-name', 'no-wire-types', 'stateful-input-trigger']),
    );
    expect(issues.length).toBeGreaterThan(1);
  });
});

describe('coverage flags', () => {
  it('accepts a partial module list when requireCompleteWireCoverage is off', () => {
    expect(() => buildBlockRegistry({ blocks: [paragraphModule] }, { baseNodes })).not.toThrow();
  });

  it('reports incomplete-wire-coverage naming the missing types when it is on', () => {
    const issues = validateRegistry(
      { blocks: [paragraphModule] },
      { baseNodes, requireCompleteWireCoverage: true },
    );
    const issue = issues.find((i) => i.code === 'incomplete-wire-coverage');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('Heading1');
    expect(issue!.message).toContain('Divider');
  });

  it('accepts a partial mark list when requireCompleteStyleCoverage is off', () => {
    expect(() => buildBlockRegistry({ blocks: [], marks: [strongMark] })).not.toThrow();
  });

  it('reports incomplete-style-coverage naming the missing fields when it is on', () => {
    const issues = validateRegistry(
      { blocks: [], marks: [strongMark] },
      { requireCompleteStyleCoverage: true },
    );
    const issue = issues.find((i) => i.code === 'incomplete-style-coverage');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('linkUrl');
    expect(issue!.message).toContain('italic');
  });
});

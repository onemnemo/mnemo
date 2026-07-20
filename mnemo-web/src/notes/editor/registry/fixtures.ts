/**
 * Shared fixtures for the block registry test suite.
 *
 * `heading` and `paragraph` here are test doubles, not the real block
 * modules — they exist to exercise the registry contract (wire-type fan-in,
 * sid round-tripping, the build-time bind) against real ProseMirror NodeSpecs
 * and real Schema instances, never against faked PM nodes. `makeTestBlockModule`
 * exists because validate.ts's rejection tests each need a module that is
 * otherwise valid except for the one rule under test, and restating every
 * BlockModule field for each of those would bury the one field that matters.
 * `makeTestInlineModule` is the same idea for the inline-atom registry.
 *
 * Exported from its own file (rather than living inside registry.test.ts)
 * because the real module suites need the same base nodes
 * and the same "otherwise valid" module builders.
 */

import type { MarkSpec, Node as PMNode, NodeSpec } from 'prosemirror-model';
import { buildBlockRegistry } from './build';
import { RegistryValidationError } from './validate';
import type { RegistryInput, RegistryIssue, ValidateOptions } from './validate';
import type {
  AiSegment,
  AnyBlockModule,
  AnyMarkModule,
  EstimateContext,
  InlineModule,
  SerializeContext,
} from './types';
import type { Block, BlockType } from '../../model/types';

// ---------------------------------------------------------------------------
// Base schema nodes. The schema layer owns these for real; stood up here so a test can
// build a real Schema without pulling in the whole editor bootstrap.
// ---------------------------------------------------------------------------

export const baseNodes: Readonly<Record<string, NodeSpec>> = Object.freeze({
  doc: { content: 'block+' },
  text: { group: 'inline' },
  line: { content: 'inline*' },
});

// ---------------------------------------------------------------------------
// Context stubs. Modules in this file don't have block children or inline
// atoms of their own, so these throw if actually exercised — a test that
// needs a working toChild/estimateChild belongs in the real module suite,
// not here.
// ---------------------------------------------------------------------------

export function testEstimateContext(overrides: Partial<EstimateContext> = {}): EstimateContext {
  return {
    availableWidth: 720,
    estimateChild() {
      throw new Error('estimateChild is not implemented in this fixture context');
    },
    ...overrides,
  };
}

export function testSerializeContext(overrides: Partial<SerializeContext> = {}): SerializeContext {
  return {
    toChild() {
      throw new Error('toChild is not implemented in this fixture context');
    },
    fromChild() {
      throw new Error('fromChild is not implemented in this fixture context');
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// heading: four wire types, one schema node, the headline registry contract.
//
// Does NOT declare `sid` in its own `node.attrs`: that attr is merged in by
// `buildBlockRegistry` from `commonBlockAttrs`, and a module restating it is
// now a validation error (`shadowed-common-attr`), not a harmless override.
// ---------------------------------------------------------------------------

const headingLevelByWireType: Readonly<Record<string, number>> = Object.freeze({
  Heading1: 1,
  Heading2: 2,
  Heading3: 3,
  Heading4: 4,
});

const headingWireTypeByLevel: Readonly<Record<number, BlockType>> = Object.freeze({
  1: 'Heading1',
  2: 'Heading2',
  3: 'Heading3',
  4: 'Heading4',
});

function headingPlainText(node: PMNode): string {
  return node.firstChild ? node.firstChild.textContent : '';
}

function headingAiSegments(node: PMNode): readonly AiSegment[] {
  const text = headingPlainText(node);
  return text.length === 0 ? [] : [{ kind: 'prose', text, offset: 0 }];
}

/** Content is `line block*`; text starts one position past the line's own opening token. */
function headingPositionOf(_node: PMNode, offset: number): number {
  return offset + 1;
}

export const headingModule: AnyBlockModule = {
  nodeName: 'heading',
  wireTypes: ['Heading1', 'Heading2', 'Heading3', 'Heading4'],
  node: {
    content: 'line block*',
    group: 'block',
    attrs: { level: { default: 1 } },
  },
  serialize: {
    toNode(block, schema) {
      const level = headingLevelByWireType[block.type] ?? 1;
      const line = schema.nodes.line.create();
      return schema.nodes.heading.create({ level, sid: block.sid }, line);
    },
    fromNode(node) {
      const level = node.attrs.level as number;
      return {
        id: '',
        sid: (node.attrs.sid as string) ?? '',
        type: headingWireTypeByLevel[level] ?? 'Heading1',
        spans: [],
        payload: { kind: 'empty' },
        meta: {},
        order: 0,
        children: null,
      };
    },
    toMarkdown(node) {
      const level = node.attrs.level as number;
      return `${'#'.repeat(level)} ${headingPlainText(node)}`;
    },
  },
  project: {
    plainText: headingPlainText,
    aiSegments: headingAiSegments,
    positionOf: headingPositionOf,
  },
  // Reads `this.nodeName` on purpose: the registry test suite uses this to
  // prove `buildBlockRegistry` binds `estimateHeight` to the module at build
  // time rather than handing the hot path an unbound method that throws the
  // moment it is called through `registry.estimators`.
  estimateHeight(node) {
    return this.nodeName.length + headingPlainText(node).length;
  },
};

// ---------------------------------------------------------------------------
// paragraph: one wire type, deliberately `this`-free so it can double as the
// hot-path fixture — a module whose estimator and view read nothing off
// `this` makes "zero property reads after build" a meaningful assertion
// rather than a fluke of what happens not to be exercised.
// ---------------------------------------------------------------------------

function paragraphPlainText(node: PMNode): string {
  return node.firstChild ? node.firstChild.textContent : '';
}

function paragraphAiSegments(node: PMNode): readonly AiSegment[] {
  const text = paragraphPlainText(node);
  return text.length === 0 ? [] : [{ kind: 'prose', text, offset: 0 }];
}

function paragraphPositionOf(_node: PMNode, offset: number): number {
  return offset + 1;
}

export const paragraphModule: AnyBlockModule = {
  nodeName: 'paragraph',
  wireTypes: ['Text'],
  node: {
    content: 'line block*',
    group: 'block',
  },
  realizedView() {
    return { dom: {} as unknown as HTMLElement };
  },
  serialize: {
    toNode(block, schema) {
      const line = schema.nodes.line.create();
      return schema.nodes.paragraph.create({ sid: block.sid }, line);
    },
    fromNode(node) {
      return {
        id: '',
        sid: (node.attrs.sid as string) ?? '',
        type: 'Text',
        spans: [],
        payload: { kind: 'empty' },
        meta: {},
        order: 0,
        children: null,
      };
    },
    toMarkdown(node) {
      return paragraphPlainText(node);
    },
  },
  project: {
    plainText: paragraphPlainText,
    aiSegments: paragraphAiSegments,
    positionOf: paragraphPositionOf,
  },
  estimateHeight(node) {
    return 20 + paragraphPlainText(node).length;
  },
};

// ---------------------------------------------------------------------------
// Marks: one boolean flag, one attrs-carrying mark, to exercise both shapes
// validate.ts checks (symmetric toAttrs/fromAttrs, style-key coverage).
// ---------------------------------------------------------------------------

export const strongMark: AnyMarkModule = {
  markName: 'strong',
  mark: {
    parseDOM: [{ tag: 'strong' }],
    toDOM() {
      return ['strong', 0];
    },
  },
  styleKey: 'bold',
  markdown: { open: '**', close: '**' },
};

export const linkMark: AnyMarkModule = {
  markName: 'link',
  mark: {
    attrs: { href: { default: null } },
    toDOM(mark) {
      return ['a', { href: mark.attrs.href as string }, 0];
    },
  },
  styleKey: 'linkUrl',
  toAttrs(value) {
    return value === null ? null : { href: value as string };
  },
  fromAttrs(attrs) {
    return (attrs.href as string | null) ?? null;
  },
};

/** An innocuous mark spec for fixtures that only need *some* MarkSpec. */
export function testMarkSpec(): MarkSpec {
  return {};
}

// ---------------------------------------------------------------------------
// Inline atoms: the smallest real InlineModule, for the assembled-registry
// tests. Rejection tests use `makeTestInlineModule` below instead, same
// reasoning as `makeTestBlockModule`.
// ---------------------------------------------------------------------------

export const equationInlineModule: InlineModule = {
  nodeName: 'equationSpan',
  spanKind: 'equation',
  node: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { latex: { default: '' } },
  },
  serialize: {
    toNode(span, schema) {
      const latex = typeof span === 'object' && span !== null ? (span as { latex?: string }).latex ?? '' : '';
      return schema.nodes.equationSpan.create({ latex });
    },
    fromNode(node) {
      return { kind: 'equation', latex: (node.attrs.latex as string) ?? '' };
    },
  },
  projectText(node) {
    return (node.attrs.latex as string) ?? '';
  },
};

// ---------------------------------------------------------------------------
// Block construction helper.
// ---------------------------------------------------------------------------

export function makeBlock(type: BlockType, sid: string, overrides: Partial<Block> = {}): Block {
  return {
    id: 'test-block',
    sid,
    type,
    spans: [],
    payload: { kind: 'empty' },
    meta: {},
    order: 0,
    children: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Minimal module builders for validate.ts's rejection tests.
// ---------------------------------------------------------------------------

type BlockModuleFixture = Partial<AnyBlockModule> & Pick<AnyBlockModule, 'nodeName' | 'wireTypes'>;

export function makeTestBlockModule(overrides: BlockModuleFixture): AnyBlockModule {
  const nodeName = overrides.nodeName;
  const base: AnyBlockModule = {
    nodeName,
    wireTypes: overrides.wireTypes,
    node: { group: 'block' },
    serialize: {
      toNode() {
        throw new Error(`${nodeName} fixture: toNode is not implemented`);
      },
      fromNode() {
        throw new Error(`${nodeName} fixture: fromNode is not implemented`);
      },
      toMarkdown() {
        return '';
      },
    },
    project: {
      plainText() {
        return '';
      },
      aiSegments() {
        return [];
      },
      positionOf() {
        return 0;
      },
    },
    estimateHeight() {
      return 1;
    },
  };
  return { ...base, ...overrides };
}

type InlineModuleFixture = Partial<InlineModule> & Pick<InlineModule, 'nodeName' | 'spanKind'>;

export function makeTestInlineModule(overrides: InlineModuleFixture): InlineModule {
  const nodeName = overrides.nodeName;
  const base: InlineModule = {
    nodeName,
    spanKind: overrides.spanKind,
    node: { group: 'inline', inline: true, atom: true },
    serialize: {
      toNode() {
        throw new Error(`${nodeName} fixture: toNode is not implemented`);
      },
      fromNode() {
        throw new Error(`${nodeName} fixture: fromNode is not implemented`);
      },
    },
    projectText() {
      return '';
    },
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Runs `buildBlockRegistry` expecting it to reject the input, and hands back
// the issues rather than the error — every rejection test wants the former
// and would otherwise repeat this try/catch itself.
// ---------------------------------------------------------------------------

export function buildOrThrowIssues(
  input: RegistryInput,
  options: ValidateOptions = {},
): readonly RegistryIssue[] {
  try {
    buildBlockRegistry(input, options);
  } catch (error) {
    if (error instanceof RegistryValidationError) return error.issues;
    throw error;
  }
  throw new Error('expected buildBlockRegistry to throw RegistryValidationError');
}

/**
 * Registry assembly and contract tests.
 *
 * Covers: the Heading1-4 fan-in (the headline criterion, four wire types
 * must resolve to one schema node and one PM node must carry any of them
 * without losing its wire identity or its sid), the shapes `buildBlockRegistry`
 * bakes (invariant order, slash/command ownership, node-spec insertion order,
 * frozen output, common-attr merging, inline-atom assembly), the hot-path
 * guarantee that a keystroke never reads a module property, the `this`-binding
 * of every contribution declared as a method, and the `contract.ts` helpers a
 * real module's own tests lean on.
 *
 * Validation *rejections* live in registry.validate.test.ts, this file is
 * about what a valid module list produces, not about catching an invalid one.
 */

import { Schema } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { buildBlockRegistry } from './build';
import { checkHeightEstimate, checkProjectionConsistency, withoutDom } from './contract';
import type { AnyBlockModule, InvariantContext } from './types';
import type { RealizedBlockViewArgs } from './types';
import {
  baseNodes,
  equationInlineModule,
  headingModule,
  makeBlock,
  makeTestBlockModule,
  paragraphModule,
  testEstimateContext,
  testSerializeContext,
} from './fixtures';

const headingWireTypes = ['Heading1', 'Heading2', 'Heading3', 'Heading4'] as const;

describe('heading: four wire types, one schema node', () => {
  const registry = buildBlockRegistry({ blocks: [headingModule, paragraphModule] }, { baseNodes });
  const schema = new Schema({ nodes: registry.nodeSpecs, marks: registry.markSpecs });

  it('resolves every Heading wire type to the same module instance', () => {
    for (const type of headingWireTypes) {
      expect(registry.byWireType.get(type)).toBe(headingModule);
    }
  });

  it('contributes exactly one node-spec key for all four wire types', () => {
    const headingKeys = Object.keys(registry.nodeSpecs).filter((k) => k === 'heading');
    expect(headingKeys).toEqual(['heading']);
  });

  it('constructs a real Schema from the assembled specs', () => {
    expect(schema.nodes.heading).toBeDefined();
    expect(schema.nodes.paragraph).toBeDefined();
    expect(schema.nodes.doc).toBeDefined();
  });

  it('round-trips every Heading level back to its own BlockType', () => {
    for (const type of headingWireTypes) {
      const block = makeBlock(type, 'sid-round-trip');
      const node = headingModule.serialize.toNode(block, schema, testSerializeContext());
      const back = headingModule.serialize.fromNode(node, testSerializeContext());
      expect(back.type).toBe(type);
    }
  });

  it('carries sid unchanged through that same round trip', () => {
    // A dropped sid here re-mints an id the user has already seen in chat
    // history, so this is checked per level rather than once for "heading".
    for (const type of headingWireTypes) {
      const block = makeBlock(type, `sid-${type}`);
      const node = headingModule.serialize.toNode(block, schema, testSerializeContext());
      const back = headingModule.serialize.fromNode(node, testSerializeContext());
      expect(back.sid).toBe(block.sid);
    }
  });
});

describe('common attrs are merged into every block node spec', () => {
  it('merges id/sid/order/meta into a module node spec alongside its own attrs', () => {
    const registry = buildBlockRegistry({ blocks: [headingModule] }, { baseNodes });
    const attrs = registry.nodeSpecs.heading?.attrs;
    expect(attrs).toBeDefined();
    // heading only declares `level` itself; id/sid/order/meta come entirely
    // from the merge in buildBlockRegistry, not from the module.
    expect(Object.keys(attrs!).sort()).toEqual(['id', 'level', 'meta', 'order', 'sid']);
  });
});

describe('inline atom assembly', () => {
  it('adds an inline module node spec to the assembled nodeSpecs', () => {
    const registry = buildBlockRegistry(
      { blocks: [paragraphModule], inlines: [equationInlineModule] },
      { baseNodes },
    );
    expect(registry.nodeSpecs.equationSpan).toBe(equationInlineModule.node);
  });

  it('resolves an inline module by its spanKind through inlineBySpanKind', () => {
    const registry = buildBlockRegistry(
      { blocks: [paragraphModule], inlines: [equationInlineModule] },
      { baseNodes },
    );
    expect(registry.inlineBySpanKind.get('equation')).toBe(equationInlineModule);
  });
});

describe('assembly', () => {
  const moduleA = makeTestBlockModule({
    nodeName: 'inv-a',
    wireTypes: ['Quote'],
    invariants: [{ id: 'a1', order: 5, apply: () => null }],
    slash: { label: 'A Label', keywords: [], icon: 'square', group: 'basic', insert() {} },
  });
  const moduleB = makeTestBlockModule({
    nodeName: 'inv-b',
    wireTypes: ['Divider'],
    invariants: [{ id: 'b1', order: 1, apply: () => null }],
    commands: [{ id: 'cmd.b', command: () => false, label: 'B command' }],
  });
  const moduleC = makeTestBlockModule({
    nodeName: 'inv-c',
    wireTypes: ['Code'],
    invariants: [{ id: 'c1', order: 5, apply: () => null }],
  });

  const registry = buildBlockRegistry({ blocks: [moduleA, moduleB, moduleC] }, { baseNodes });

  it('sorts invariants by order, breaking ties on registration order', () => {
    // a1 and c1 share order 5; a1 must win the tie because moduleA registers
    // before moduleC. If this ever comes back ['b1', 'c1', 'a1'] the sort
    // stopped being stable.
    expect(registry.invariants.map((i) => i.id)).toEqual(['b1', 'a1', 'c1']);
  });

  it('tags each slash entry with its owning nodeName', () => {
    const entry = registry.slash.find((s) => s.label === 'A Label');
    expect(entry?.nodeName).toBe('inv-a');
  });

  it('keys commands by id and tags them with their owning nodeName', () => {
    expect(registry.commands.get('cmd.b')?.nodeName).toBe('inv-b');
  });

  it('puts base nodes first, then modules in registration order', () => {
    expect(Object.keys(registry.nodeSpecs)).toEqual(['doc', 'text', 'line', 'inv-a', 'inv-b', 'inv-c']);
  });

  it('freezes the returned registry', () => {
    expect(Object.isFrozen(registry)).toBe(true);
  });

  it('tags inputTriggers and invariants entries with their owning nodeName', () => {
    // slash and command entries have always carried nodeName; inputTriggers
    // and invariants entries need the same provenance, since a keystroke
    // handler that misbehaves is otherwise untraceable to its module.
    const registryWithTrigger = buildBlockRegistry(
      {
        blocks: [
          makeTestBlockModule({
            nodeName: 'trig-owner',
            wireTypes: ['Text'],
            inputTriggers: [{ id: 'ti1', match: /x$/, handler: () => null }],
            invariants: [{ id: 'inv1', order: 0, apply: () => null }],
          }),
        ],
      },
      { baseNodes },
    );
    expect(registryWithTrigger.inputTriggers[0]?.nodeName).toBe('trig-owner');
    expect(registryWithTrigger.invariants[0]?.nodeName).toBe('trig-owner');
  });
});

describe('hot path: estimator and realized-view lookups never touch the module', () => {
  it('reads no property off the module once build has returned', () => {
    let getCount = 0;
    const proxied = new Proxy(paragraphModule, {
      get(target, prop, receiver) {
        getCount++;
        return Reflect.get(target, prop, receiver);
      },
    });

    const registry = buildBlockRegistry({ blocks: [proxied] }, { baseNodes });
    const schema = new Schema({ nodes: registry.nodeSpecs, marks: registry.markSpecs });
    const node = schema.nodes.paragraph.create({ sid: 'x' }, schema.nodes.line.create());

    // Everything above reads the module (repeatedly) to assemble the
    // registry. That is expected and paid once; only what happens after this
    // point is the hot path the comment in build.ts promises is free.
    getCount = 0;

    const estimator = registry.estimators.get('paragraph');
    const realize = registry.realizedViews.get('paragraph');
    expect(estimator).toBeDefined();
    expect(realize).toBeDefined();

    const estimate = estimator!(node, testEstimateContext());
    const view = realize!({} as unknown as RealizedBlockViewArgs<Record<string, unknown>>);

    expect(getCount).toBe(0);
    expect(estimate).toBeGreaterThan(0);
    expect(view.dom).toBeDefined();
  });
});

describe('estimateHeight binding', () => {
  it('binds `this` at build time, so a method reading its own module still works through the hot-path map', () => {
    // heading's estimateHeight reads `this.nodeName`. If buildBlockRegistry
    // handed out `module.estimateHeight` unbound, `this` would be undefined
    // at the call below and this would throw instead of returning a number.
    const registry = buildBlockRegistry({ blocks: [headingModule] }, { baseNodes });
    const schema = new Schema({ nodes: registry.nodeSpecs, marks: registry.markSpecs });
    const node = schema.nodes.heading.create(
      { level: 2, sid: 'x' },
      schema.nodes.line.create(null, schema.text('hi')),
    );

    const estimator = registry.estimators.get('heading')!;
    expect(estimator(node, testEstimateContext())).toBe('heading'.length + 'hi'.length);
  });
});

describe('this-binding for method-style contributions', () => {
  // build.ts binds slash.insert, input-trigger handlers and invariant applies
  // to their own contribution objects, because spreading a contribution into
  // an entry object otherwise rebinds `this` to the copy.
  //
  // Each test asserts `this` *identity*, not a property read off it. That
  // distinction matters: the spread copies every data property onto the entry,
  // so a method reading `this.label` returns the right value whether or not it
  // was bound, and a test written that way passes against the unfixed code.
  // Only comparing `this` to the original object can tell the two apart, 
  // confirmed by reverting the bind and watching these fail.
  //
  // no-this-alias is off here for the same reason: capturing `this` is the
  // assertion, not an artefact of avoiding an arrow function.
  /* oxlint-disable typescript/no-this-alias */

  it('binds slash.insert to its own SlashContribution object', () => {
    let capturedThis: unknown;
    const slash = {
      label: 'Slash Owner',
      keywords: [],
      icon: 'square' as const,
      group: 'basic' as const,
      insert() {
        capturedThis = this;
      },
    };
    const module = makeTestBlockModule({
      nodeName: 'slash-owner',
      wireTypes: ['Text'],
      slash,
    });

    const registry = buildBlockRegistry({ blocks: [module] }, { baseNodes });
    const entry = registry.slash.find((s) => s.nodeName === 'slash-owner')!;
    entry.insert({} as unknown as EditorState, () => {});

    expect(capturedThis).toBe(slash);
  });

  it('binds inputTriggers[].handler to its own InputTriggerContribution object', () => {
    let capturedThis: unknown;
    const trigger = {
      id: 'trig-this',
      match: /x$/,
      handler() {
        capturedThis = this;
        return null;
      },
    };
    const module = makeTestBlockModule({
      nodeName: 'trigger-owner',
      wireTypes: ['Text'],
      inputTriggers: [trigger],
    });

    const registry = buildBlockRegistry({ blocks: [module] }, { baseNodes });
    const entry = registry.inputTriggers.find((t) => t.nodeName === 'trigger-owner')!;
    entry.handler({} as unknown as EditorState, 'x'.match(/x/)!, 0, 1);

    expect(capturedThis).toBe(trigger);
  });

  it('binds invariants[].apply to its own InvariantContribution object', () => {
    let capturedThis: unknown;
    const invariant = {
      id: 'inv-this',
      order: 0,
      apply() {
        capturedThis = this;
        return null;
      },
    };
    const module = makeTestBlockModule({
      nodeName: 'invariant-owner',
      wireTypes: ['Text'],
      invariants: [invariant],
    });

    const registry = buildBlockRegistry({ blocks: [module] }, { baseNodes });
    const entry = registry.invariants.find((i) => i.nodeName === 'invariant-owner')!;
    entry.apply({} as unknown as InvariantContext);

    expect(capturedThis).toBe(invariant);
  });
  /* oxlint-enable typescript/no-this-alias */
});

describe('contract helpers', () => {
  const contractSchema = new Schema({ nodes: { ...baseNodes, paragraph: paragraphModule.node } });

  function textNode(text: string) {
    return contractSchema.nodes.paragraph.create(
      { sid: '' },
      contractSchema.nodes.line.create(null, text.length > 0 ? contractSchema.text(text) : undefined),
    );
  }

  describe('checkProjectionConsistency', () => {
    it('reports nothing for a module whose segments partition plainText correctly', () => {
      expect(checkProjectionConsistency(paragraphModule, textNode('hello'))).toEqual([]);
    });

    it('reports segment-offset when a segment does not start where the previous one ended', () => {
      const gapModule: AnyBlockModule = makeTestBlockModule({
        nodeName: 'gap',
        wireTypes: ['Text'],
        project: {
          plainText: () => 'hello',
          aiSegments: () => [{ kind: 'prose', text: 'ello', offset: 1 }],
          positionOf: () => 0,
        },
      });
      const violations = checkProjectionConsistency(gapModule, textNode('hello'));
      expect(violations.map((v) => v.check)).toEqual(['segment-offset']);
    });

    it('reports segment-text when the declared text does not appear at its offset', () => {
      const mismatchModule: AnyBlockModule = makeTestBlockModule({
        nodeName: 'mismatch',
        wireTypes: ['Text'],
        project: {
          plainText: () => 'hello',
          aiSegments: () => [{ kind: 'prose', text: 'HELLO', offset: 0 }],
          positionOf: () => 0,
        },
      });
      const violations = checkProjectionConsistency(mismatchModule, textNode('hello'));
      expect(violations.map((v) => v.check)).toEqual(['segment-text']);
    });

    it('reports segment-coverage when segments stop short of the end of plainText', () => {
      const shortModule: AnyBlockModule = makeTestBlockModule({
        nodeName: 'short',
        wireTypes: ['Text'],
        project: {
          plainText: () => 'hello',
          aiSegments: () => [{ kind: 'prose', text: 'hel', offset: 0 }],
          positionOf: () => 0,
        },
      });
      const violations = checkProjectionConsistency(shortModule, textNode('hello'));
      expect(violations.map((v) => v.check)).toEqual(['segment-coverage']);
    });
  });

  describe('checkHeightEstimate', () => {
    it('reports estimate-dom-free when estimateHeight touches document', () => {
      const domTouching: AnyBlockModule = makeTestBlockModule({
        nodeName: 'dom-touch',
        wireTypes: ['Text'],
        estimateHeight() {
          return document.title.length + 1;
        },
      });
      const violations = checkHeightEstimate(domTouching, textNode('hello'));
      expect(violations.map((v) => v.check)).toEqual(['estimate-dom-free']);
    });

    it('reports estimate-value when estimateHeight returns a non-positive number', () => {
      const zeroHeight: AnyBlockModule = makeTestBlockModule({
        nodeName: 'zero-height',
        wireTypes: ['Text'],
        estimateHeight() {
          return 0;
        },
      });
      const violations = checkHeightEstimate(zeroHeight, textNode('hello'));
      expect(violations.map((v) => v.check)).toEqual(['estimate-value']);
    });

    it('reports estimate-threw (not estimate-dom-free) when estimateHeight throws an ordinary error', () => {
      // An estimator can be buggy without ever touching the DOM - a typo'd
      // property read, a null deref. Misreporting that as estimate-dom-free
      // would send whoever reads the violation looking for a DOM touch that
      // was never there instead of the actual defect.
      const buggy: AnyBlockModule = makeTestBlockModule({
        nodeName: 'buggy-estimate',
        wireTypes: ['Text'],
        estimateHeight() {
          throw new TypeError('cannot read properties of undefined');
        },
      });
      const violations = checkHeightEstimate(buggy, textNode('hello'));
      expect(violations.map((v) => v.check)).toEqual(['estimate-threw']);
    });
  });

  describe('withoutDom', () => {
    it('restores the previous document/window values afterwards, on both the return path and the throw path', () => {
      const globals = globalThis as Record<string, unknown>;
      const sentinelDoc = { marker: 'sentinel-doc' };
      const sentinelWin = { marker: 'sentinel-win' };
      const originalDoc = globals.document;
      const originalWin = globals.window;
      globals.document = sentinelDoc;
      globals.window = sentinelWin;

      try {
        // Note: no `expect()` calls while inside the trapped region below -
        // vitest's own assertion machinery introspects its argument (e.g. to
        // format a failure message) and that introspection itself trips the
        // trap, throwing before the assertion can even run.
        let trapped = false;
        withoutDom(() => {
          try {
            void (globals.document as { marker: string }).marker;
          } catch {
            trapped = true;
          }
          return null;
        });
        expect(trapped).toBe(true);
        expect(globals.document).toBe(sentinelDoc);
        expect(globals.window).toBe(sentinelWin);

        expect(() =>
          withoutDom(() => {
            throw new Error('boom');
          }),
        ).toThrow('boom');
        expect(globals.document).toBe(sentinelDoc);
        expect(globals.window).toBe(sentinelWin);
      } finally {
        globals.document = originalDoc;
        globals.window = originalWin;
      }
    });
  });
});

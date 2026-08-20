/**
 * Registry assembly: read the module list once, bake the lookups the editor
 * uses forever.
 *
 * Everything a hot path needs is pre-extracted into a flat structure here, so
 * a keystroke, a scroll frame or a NodeView update never walks the module list
 * or reads a module property. That is the whole point of doing this at mount:
 * the abstraction costs O(block types) once, and zero per frame.
 *
 * Schema construction itself stays with the schema layer, which owns the base nodes and the
 * concrete `Schema` generic. This produces the `nodeSpecs`/`markSpecs` it feeds
 * to `new Schema(...)` and nothing more.
 *
 * "Assembled once" is the property this delivers, and it is the one that
 * matters. It is not deep immutability: `Object.freeze` does not stop `Map#set`
 * (Map data lives in internal slots) and the `ReadonlyMap` types are erased at
 * runtime. Wrapping every map to enforce that would put an indirection in the
 * hot path to prevent a bug nobody has written.
 */

import type { MarkSpec, Node as PMNode, NodeSpec } from 'prosemirror-model';
import {
  RegistryValidationError,
  validateRegistry,
  type RegistryInput,
  type ValidateOptions,
} from './validate';
import { commonBlockAttrs } from './types';
import type {
  AnyBlockModule,
  AnyMarkModule,
  BlockModule,
  CommandContribution,
  EstimateContext,
  InlineModule,
  InputTriggerContribution,
  InvariantContribution,
  RealizedBlockView,
  RealizedBlockViewArgs,
  SlashContribution,
} from './types';
import type { BlockType, TextStyle } from '../../model/types';

/** A contribution plus the module that supplied it. */
export interface SlashEntry extends SlashContribution {
  readonly nodeName: string;
}

export interface CommandEntry extends CommandContribution {
  readonly nodeName: string;
}

/**
 * Input triggers keep their owner because this is the one contribution list
 * genuinely walked per keystroke, without it, every module's regex runs
 * against every text input regardless of which block type the caret is in.
 */
export interface InputTriggerEntry extends InputTriggerContribution {
  readonly nodeName: string;
}

/** Same, so the pipeline can skip invariants whose node type is untouched. */
export interface InvariantEntry extends InvariantContribution {
  readonly nodeName: string;
}

export type HeightEstimator = (node: PMNode, ctx: EstimateContext) => number;
export type RealizedViewFactory = (
  args: RealizedBlockViewArgs<Record<string, unknown>>,
) => RealizedBlockView;

export interface BlockRegistry {
  readonly modules: readonly AnyBlockModule[];
  readonly marks: readonly AnyMarkModule[];
  readonly inlines: readonly InlineModule[];

  readonly byNodeName: ReadonlyMap<string, AnyBlockModule>;
  /** Derived from `wireTypes`, so Heading1 through Heading4 all resolve to the one heading module. */
  readonly byWireType: ReadonlyMap<BlockType, AnyBlockModule>;
  readonly markByStyleKey: ReadonlyMap<keyof TextStyle, AnyMarkModule>;
  readonly inlineBySpanKind: ReadonlyMap<string, InlineModule>;

  /**
   * Ready for `new Schema({ nodes, marks })`, with `commonBlockAttrs` already
   * merged into every block spec.
   *
   * Insertion order is preserved and is meaningful: ProseMirror picks the first
   * node matching a content expression when it has to fill one, so base nodes
   * come first and modules follow in registration order.
   */
  readonly nodeSpecs: Readonly<Record<string, NodeSpec>>;
  readonly markSpecs: Readonly<Record<string, MarkSpec>>;

  /** Hot path. Pre-bound so a lookup never touches the owning module. */
  readonly estimators: ReadonlyMap<string, HeightEstimator>;
  /** Hot path, same reason. Absent for modules that render via `toDOM`. */
  readonly realizedViews: ReadonlyMap<string, RealizedViewFactory>;

  readonly slash: readonly SlashEntry[];
  readonly commands: ReadonlyMap<string, CommandEntry>;
  readonly inputTriggers: readonly InputTriggerEntry[];
  /** Sorted by `order`, ties broken by registration order. */
  readonly invariants: readonly InvariantEntry[];
}

export type BuildOptions = ValidateOptions;

/**
 * Validates and assembles. Throws `RegistryValidationError` listing every
 * problem at once rather than failing on the first.
 */
export function buildBlockRegistry(
  input: RegistryInput,
  options: BuildOptions = {},
): BlockRegistry {
  const issues = validateRegistry(input, options);
  if (issues.length > 0) throw new RegistryValidationError(issues);

  const modules = input.blocks;
  const marks = input.marks ?? [];
  const inlines = input.inlines ?? [];

  const byNodeName = new Map<string, AnyBlockModule>();
  const byWireType = new Map<BlockType, AnyBlockModule>();
  const estimators = new Map<string, HeightEstimator>();
  const realizedViews = new Map<string, RealizedViewFactory>();
  const nodeSpecs: Record<string, NodeSpec> = { ...(options.baseNodes ?? {}) };
  const slash: SlashEntry[] = [];
  const commands = new Map<string, CommandEntry>();
  const inputTriggers: InputTriggerEntry[] = [];
  const invariants: InvariantEntry[] = [];

  for (const module of modules) {
    byNodeName.set(module.nodeName, module);
    for (const wire of module.wireTypes) byWireType.set(wire, module);

    // Merged rather than left to each module: the negative controls showed a
    // dropped `sid` or `meta` declaration silently fails the corpus round trip,
    // and 17 authors remembering is worse odds than one merge.
    nodeSpecs[module.nodeName] = {
      ...module.node,
      attrs: { ...commonBlockAttrs, ...(module.node.attrs ?? {}) },
    };

    // Anything the interface declares as a *method* is bound here, because
    // spreading a contribution into an entry object would otherwise rebind
    // `this` to the copy.
    estimators.set(module.nodeName, module.estimateHeight.bind(module));
    if (module.realizedView) {
      realizedViews.set(module.nodeName, module.realizedView.bind(module) as RealizedViewFactory);
    }

    for (const entry of module.slash ?? []) {
      slash.push({
        ...entry,
        nodeName: module.nodeName,
        insert: entry.insert.bind(entry),
      });
    }
    for (const command of module.commands ?? []) {
      commands.set(command.id, {
        ...command,
        nodeName: module.nodeName,
        isAvailable: command.isAvailable?.bind(command),
      });
    }
    for (const trigger of module.inputTriggers ?? []) {
      inputTriggers.push({
        ...trigger,
        nodeName: module.nodeName,
        handler: trigger.handler.bind(trigger),
      });
    }
    for (const invariant of module.invariants ?? []) {
      invariants.push({
        ...invariant,
        nodeName: module.nodeName,
        apply: invariant.apply.bind(invariant),
      });
    }
  }

  const inlineBySpanKind = new Map<string, InlineModule>();
  for (const inline of inlines) {
    nodeSpecs[inline.nodeName] = inline.node;
    inlineBySpanKind.set(inline.spanKind, inline);
    if (inline.realizedView) {
      realizedViews.set(inline.nodeName, inline.realizedView.bind(inline) as RealizedViewFactory);
    }
  }

  const markSpecs: Record<string, MarkSpec> = {};
  const markByStyleKey = new Map<keyof TextStyle, AnyMarkModule>();
  for (const mark of marks) {
    markSpecs[mark.markName] = mark.mark;
    markByStyleKey.set(mark.styleKey, mark);
  }

  // Array.prototype.sort is stable, which is what makes "ties break on
  // registration order" a guarantee rather than an observation.
  invariants.sort((a, b) => a.order - b.order);

  return Object.freeze({
    modules: Object.freeze([...modules]),
    marks: Object.freeze([...marks]),
    inlines: Object.freeze([...inlines]),
    byNodeName,
    byWireType,
    markByStyleKey,
    inlineBySpanKind,
    nodeSpecs: Object.freeze(nodeSpecs),
    markSpecs: Object.freeze(markSpecs),
    estimators,
    realizedViews,
    slash: Object.freeze(slash),
    commands,
    inputTriggers: Object.freeze(inputTriggers),
    invariants: Object.freeze(invariants),
  });
}

/**
 * Narrows a module to its own attr shape at the point of definition, so a
 * module body gets real types without the collection needing them.
 */
export function defineBlockModule<TAttrs extends Record<string, unknown>>(
  module: BlockModule<TAttrs>,
): AnyBlockModule {
  return module as AnyBlockModule;
}

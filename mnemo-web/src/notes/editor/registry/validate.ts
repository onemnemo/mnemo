/**
 * Registry validation.
 *
 * Everything here runs once, at editor construction, and reports every problem
 * it finds rather than throwing on the first, a module list with three
 * mistakes should take one fix cycle, not three.
 *
 * The checks are the ones that fail late and confusingly if left to ProseMirror
 * or, worse, to runtime: a wire type owned by two modules silently routes to
 * whichever module the mapper happens to index second, and a content expression
 * naming a node nobody registered throws from deep inside `new Schema` with no
 * mention of which module wrote it.
 */

import type { NodeSpec } from 'prosemirror-model';
import type { AnyBlockModule, AnyMarkModule, InlineModule } from './types';
import { commonBlockAttrNames } from './types';
import { allBlockTypes, defaultTextStyle, type BlockType } from '../../model/types';

export interface RegistryIssue {
  readonly code: string;
  readonly message: string;
  /** The `nodeName` or `markName` at fault, when the issue belongs to one. */
  readonly module?: string;
}

export class RegistryValidationError extends Error {
  readonly issues: readonly RegistryIssue[];

  constructor(issues: readonly RegistryIssue[]) {
    const detail = issues.map((i) => `  - [${i.code}] ${i.message}`).join('\n');
    super(`Block registry is invalid (${issues.length} issue(s)):\n${detail}`);
    this.name = 'RegistryValidationError';
    this.issues = issues;
  }
}

/** Everything registered, in one bag so the list can grow without a signature churn. */
export interface RegistryInput {
  readonly blocks: readonly AnyBlockModule[];
  readonly marks?: readonly AnyMarkModule[];
  readonly inlines?: readonly InlineModule[];
}

export interface ValidateOptions {
  /**
   * Node names the registry knows about but no module owns, the base schema's
   * `doc`, `text` and `line`. Content expressions may reference them, and a
   * module may not claim one.
   */
  readonly baseNodes?: Readonly<Record<string, NodeSpec>>;
  /**
   * Require every `BlockType` to be owned by some module.
   *
   * Off by default because the registry ships before the modules do: it
   * assembles whatever exists, and this turns on once all 17 wire types
   * have a home.
   */
  readonly requireCompleteWireCoverage?: boolean;
  /** Same, for the 12 `TextStyle` fields against the mark modules. */
  readonly requireCompleteStyleCoverage?: boolean;
}

/** Identifiers in a PM content expression, minus the digits in `{2,3}` counts. */
function referencedNames(expression: string): string[] {
  const tokens = expression.match(/[\w-]+/g) ?? [];
  return tokens.filter((t) => !/^\d+$/.test(t));
}

function groupsOf(spec: NodeSpec): string[] {
  return typeof spec.group === 'string' ? spec.group.split(/\s+/).filter(Boolean) : [];
}

/**
 * Whether a pattern is anchored to the end of the input.
 *
 * Escapes are stripped first: `/\$\$/`, the display-math trigger, ends in a
 * `$` character while being completely unanchored, so a plain `endsWith('$')`
 * accepts exactly the pattern this check exists to reject.
 */
function isEndAnchored(pattern: RegExp): boolean {
  return pattern.source.replace(/\\./g, '').endsWith('$');
}

/** Collects duplicate values, so the message can name every offender at once. */
function findDuplicates<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const seen = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = seen.get(k);
    if (bucket) bucket.push(item);
    else seen.set(k, [item]);
  }
  for (const [k, bucket] of seen) {
    if (bucket.length < 2) seen.delete(k);
  }
  return seen;
}

export function validateRegistry(
  input: RegistryInput,
  options: ValidateOptions = {},
): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const modules = input.blocks;
  const marks = input.marks ?? [];
  const inlines = input.inlines ?? [];
  const baseNodes = options.baseNodes ?? {};

  for (const [name, dupes] of findDuplicates(modules, (m) => m.nodeName)) {
    issues.push({
      code: 'duplicate-node-name',
      module: name,
      message: `${dupes.length} modules declare nodeName "${name}"; each schema key needs exactly one owner.`,
    });
  }

  // Block and inline node names share one schema namespace.
  const inlineVsBlock = findDuplicates(
    [...modules.map((m) => m.nodeName), ...inlines.map((i) => i.nodeName)],
    (n) => n,
  );
  for (const [name] of inlineVsBlock) {
    if (modules.some((m) => m.nodeName === name) && inlines.some((i) => i.nodeName === name)) {
      issues.push({
        code: 'node-name-collision',
        module: name,
        message: `"${name}" is declared as both a block node and an inline node; they share one schema namespace.`,
      });
    }
  }

  for (const module of modules) {
    if (Object.hasOwn(baseNodes, module.nodeName)) {
      issues.push({
        code: 'reserved-node-name',
        module: module.nodeName,
        message: `nodeName "${module.nodeName}" is a base schema node and cannot be claimed by a module.`,
      });
    }
    if (module.wireTypes.length === 0) {
      issues.push({
        code: 'no-wire-types',
        module: module.nodeName,
        message: `Module "${module.nodeName}" claims no wire types, so nothing can ever map to it. An inline atom belongs in the inline registry, not here.`,
      });
    }
    // The common attrs are merged in at assembly. A module redeclaring one is
    // either shadowing it with a different default or expecting an override
    // that will not happen; both are worth failing on.
    for (const name of commonBlockAttrNames) {
      if (module.node.attrs && Object.hasOwn(module.node.attrs, name)) {
        issues.push({
          code: 'shadowed-common-attr',
          module: module.nodeName,
          message: `"${module.nodeName}" redeclares the common attr "${name}"; it is merged in automatically and must not be restated.`,
        });
      }
    }
  }

  // Wire ownership is the check that matters most: a type claimed twice routes
  // to whichever module indexed last, and the loser's blocks silently change
  // shape on the next save.
  const wireOwners = new Map<BlockType, string[]>();
  for (const module of modules) {
    for (const wire of module.wireTypes) {
      const owners = wireOwners.get(wire);
      if (owners) owners.push(module.nodeName);
      else wireOwners.set(wire, [module.nodeName]);
    }
  }
  for (const [wire, owners] of wireOwners) {
    if (owners.length > 1) {
      issues.push({
        code: 'duplicate-wire-owner',
        message: `Wire type "${wire}" is claimed by ${owners.join(', ')}; it must have exactly one owner.`,
      });
    }
  }

  if (options.requireCompleteWireCoverage) {
    const missing = allBlockTypes.filter((t) => !wireOwners.has(t));
    if (missing.length > 0) {
      issues.push({
        code: 'incomplete-wire-coverage',
        message: `No module owns these wire types: ${missing.join(', ')}.`,
      });
    }
  }

  // A content expression naming an unregistered node throws from inside
  // `new Schema` without saying which module wrote it. Catch it here, where the
  // module is still in hand.
  const knownNames = new Set<string>([
    ...Object.keys(baseNodes),
    ...modules.map((m) => m.nodeName),
    ...inlines.map((i) => i.nodeName),
  ]);
  for (const spec of Object.values(baseNodes)) {
    for (const group of groupsOf(spec)) knownNames.add(group);
  }
  for (const module of modules) {
    for (const group of groupsOf(module.node)) knownNames.add(group);
  }
  for (const inline of inlines) {
    for (const group of groupsOf(inline.node)) knownNames.add(group);
  }
  const withContent = [
    ...modules.map((m) => ({ name: m.nodeName, spec: m.node })),
    ...inlines.map((i) => ({ name: i.nodeName, spec: i.node })),
  ];
  for (const { name, spec } of withContent) {
    const content = spec.content;
    if (typeof content !== 'string') continue;
    for (const referenced of referencedNames(content)) {
      if (!knownNames.has(referenced)) {
        issues.push({
          code: 'unresolved-content-reference',
          module: name,
          message: `Content expression "${content}" on "${name}" references "${referenced}", which is neither a registered node nor a declared group.`,
        });
      }
    }
  }

  for (const module of modules) {
    for (const trigger of module.inputTriggers ?? []) {
      // A `g`/`y` regex carries `lastIndex` between calls, so a module-level
      // pattern starts its next match wherever the previous one stopped.
      if (trigger.match.global || trigger.match.sticky) {
        issues.push({
          code: 'stateful-input-trigger',
          module: module.nodeName,
          message: `Input trigger "${trigger.id}" uses a ${trigger.match.global ? 'g' : 'y'} flag; its lastIndex would leak between keystrokes.`,
        });
      }
      if (!isEndAnchored(trigger.match)) {
        issues.push({
          code: 'unanchored-input-trigger',
          module: module.nodeName,
          message: `Input trigger "${trigger.id}" must be anchored to the caret with a trailing "$", or it fires on a match anywhere in the block.`,
        });
      }
    }
  }

  const commands = modules.flatMap((m) =>
    (m.commands ?? []).map((c) => ({ id: c.id, owner: m.nodeName })),
  );
  for (const [id, dupes] of findDuplicates(commands, (c) => c.id)) {
    issues.push({
      code: 'duplicate-command-id',
      message: `Command id "${id}" is declared by ${dupes.map((d) => d.owner).join(', ')}.`,
    });
  }

  const triggers = modules.flatMap((m) =>
    (m.inputTriggers ?? []).map((t) => ({ id: t.id, owner: m.nodeName })),
  );
  for (const [id, dupes] of findDuplicates(triggers, (t) => t.id)) {
    issues.push({
      code: 'duplicate-input-trigger-id',
      message: `Input trigger id "${id}" is declared by ${dupes.map((d) => d.owner).join(', ')}.`,
    });
  }

  const invariants = modules.flatMap((m) =>
    (m.invariants ?? []).map((i) => ({ id: i.id, owner: m.nodeName })),
  );
  for (const [id, dupes] of findDuplicates(invariants, (i) => i.id)) {
    issues.push({
      code: 'duplicate-invariant-id',
      message: `Invariant id "${id}" is declared by ${dupes.map((d) => d.owner).join(', ')}.`,
    });
  }

  const slashEntries = modules
    .filter((m) => m.slash)
    .map((m) => ({ label: m.slash!.label, owner: m.nodeName }));
  for (const [label, dupes] of findDuplicates(slashEntries, (s) => s.label)) {
    issues.push({
      code: 'duplicate-slash-label',
      message: `Slash label "${label}" is used by ${dupes.map((d) => d.owner).join(', ')}; the menu could not tell them apart.`,
    });
  }

  for (const [name, dupes] of findDuplicates(inlines, (i) => i.nodeName)) {
    issues.push({
      code: 'duplicate-inline-node-name',
      module: name,
      message: `${dupes.length} inline modules declare nodeName "${name}".`,
    });
  }

  for (const [kind, dupes] of findDuplicates(inlines, (i) => i.spanKind)) {
    issues.push({
      code: 'duplicate-span-kind',
      message: `Span kind "${kind}" is claimed by ${dupes.map((d) => d.nodeName).join(', ')}; it must have exactly one owner.`,
    });
  }

  for (const [name, dupes] of findDuplicates(marks, (m) => m.markName)) {
    issues.push({
      code: 'duplicate-mark-name',
      module: name,
      message: `${dupes.length} mark modules declare markName "${name}".`,
    });
  }

  for (const [key, dupes] of findDuplicates(marks, (m) => m.styleKey)) {
    issues.push({
      code: 'duplicate-style-key',
      message: `TextStyle field "${key}" is claimed by ${dupes.map((d) => d.markName).join(', ')}; the mapper would write it twice.`,
    });
  }

  for (const mark of marks) {
    if (!Object.hasOwn(defaultTextStyle, mark.styleKey)) {
      issues.push({
        code: 'unknown-style-key',
        module: mark.markName,
        message: `Mark "${mark.markName}" maps to "${mark.styleKey}", which is not a TextStyle field.`,
      });
    }
    if ((mark.toAttrs === undefined) !== (mark.fromAttrs === undefined)) {
      issues.push({
        code: 'asymmetric-mark-attrs',
        module: mark.markName,
        message: `Mark "${mark.markName}" declares only one of toAttrs/fromAttrs; a value that converts one way and not the other is lost on the round trip.`,
      });
    }
  }

  if (options.requireCompleteStyleCoverage) {
    const covered = new Set(marks.map((m) => m.styleKey));
    const missing = Object.keys(defaultTextStyle).filter(
      (k) => !covered.has(k as keyof typeof defaultTextStyle),
    );
    if (missing.length > 0) {
      issues.push({
        code: 'incomplete-style-coverage',
        message: `No mark module owns these TextStyle fields: ${missing.join(', ')}.`,
      });
    }
  }

  return issues;
}

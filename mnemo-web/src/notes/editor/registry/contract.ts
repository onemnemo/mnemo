/**
 * Contract checks a module must satisfy, written so they can fail.
 *
 * Two of the registry's load-bearing rules — "segments partition plainText" and
 * "estimateHeight must not touch the DOM" — are otherwise just comments, and a
 * comment has never stopped anyone. These turn them into assertions the block modules'
 * module tests can run against every module as it is written, which is the
 * moment the fix is cheap.
 *
 * Test-time only. Nothing in the editor imports this at runtime.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { AnyBlockModule, EstimateContext } from './types';

export interface ContractViolation {
  readonly check: string;
  readonly message: string;
}

/** Marks an error as raised by the DOM trap rather than by the code under test. */
const domTrapMarker = Symbol('registry.domTrap');

function isDomTrapError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && domTrapMarker in error;
}

/**
 * Checks that `aiSegments` partitions `plainText` in order and without gaps.
 *
 * If they can disagree, find and the AI read surface search different strings,
 * and a range resolved against one lands somewhere else in the other.
 */
export function checkProjectionConsistency(
  module: AnyBlockModule,
  node: PMNode,
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const plain = module.project.plainText(node);
  const segments = module.project.aiSegments(node);

  let cursor = 0;
  for (const [index, segment] of segments.entries()) {
    if (segment.offset !== cursor) {
      violations.push({
        check: 'segment-offset',
        message: `Segment ${index} (${segment.kind}) declares offset ${segment.offset} but the previous segments end at ${cursor}; segments must partition plainText without gaps or overlap.`,
      });
    }
    const slice = plain.slice(segment.offset, segment.offset + segment.text.length);
    if (slice !== segment.text) {
      violations.push({
        check: 'segment-text',
        message: `Segment ${index} (${segment.kind}) text ${JSON.stringify(segment.text)} does not appear at offset ${segment.offset} of plainText, which holds ${JSON.stringify(slice)}.`,
      });
    }
    cursor = segment.offset + segment.text.length;
  }

  if (cursor !== plain.length) {
    violations.push({
      check: 'segment-coverage',
      message: `Segments cover ${cursor} of ${plain.length} plainText characters; the remainder would be invisible to find and to the AI read surface.`,
    });
  }

  return violations;
}

/**
 * Runs `fn` with `document` and `window` replaced by traps that throw on any
 * access, so code that reaches for layout fails loudly here instead of quietly
 * costing a forced reflow per block in production.
 *
 * Every global is restored, including when `fn` throws and including the case
 * where the global did not exist to begin with (the normal one under vitest's
 * node environment). Note that the trap fires on *any* property access, so
 * nothing that inspects `document`/`window` — an assertion library formatting a
 * failure message, for instance — may run inside `fn`.
 */
export function withoutDom<T>(fn: () => T): T {
  const globals = globalThis as Record<string, unknown>;
  const poisoned = ['document', 'window'] as const;
  const saved = poisoned.map((name) => ({
    name,
    descriptor: Object.getOwnPropertyDescriptor(globals, name),
  }));

  const restore = () => {
    for (const { name, descriptor } of saved) {
      if (descriptor) Object.defineProperty(globals, name, descriptor);
      else delete globals[name];
    }
  };

  const trap = (name: string) =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          const error = new Error(
            `Touched ${name}.${String(prop)} inside a DOM-free region.`,
          );
          throw Object.assign(error, { [domTrapMarker]: true });
        },
      },
    );

  // Inside the try: if defining the second global throws — some environments
  // make one of these non-configurable — the first must still be restored, or
  // every later test in the run fails against a poisoned global.
  try {
    for (const name of poisoned) {
      Object.defineProperty(globals, name, {
        value: trap(name),
        configurable: true,
        writable: true,
      });
    }
    return fn();
  } finally {
    restore();
  }
}

const defaultEstimateContext: EstimateContext = {
  availableWidth: 720,
  estimateChild: () => 0,
};

/** `estimateHeight`, run under the DOM trap and checked for a usable number. */
export function checkHeightEstimate(
  module: AnyBlockModule,
  node: PMNode,
  ctx: EstimateContext = defaultEstimateContext,
): ContractViolation[] {
  let height: number;
  try {
    height = withoutDom(() => module.estimateHeight(node, ctx));
  } catch (error) {
    if (isDomTrapError(error)) {
      return [{ check: 'estimate-dom-free', message: (error as Error).message }];
    }
    // An ordinary failure in the estimator is a different defect, and reporting
    // it as a DOM violation would send the reader looking for the wrong thing.
    return [
      {
        check: 'estimate-threw',
        message: `estimateHeight threw: ${String(error)}`,
      },
    ];
  }

  if (!Number.isFinite(height) || height <= 0) {
    return [
      {
        check: 'estimate-value',
        message: `estimateHeight returned ${height}; a shelled block needs a positive finite height or it reserves no space and the scrollbar lies.`,
      },
    ];
  }
  return [];
}

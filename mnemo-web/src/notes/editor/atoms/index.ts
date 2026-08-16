/**
 * Inline atom rendering, attached to the pure schema modules.
 *
 * `schema/inlines.ts` deliberately holds only the atoms' data conversion, it
 * knows nothing about KaTeX or the DOM. The views live here and are grafted on
 * at assembly, so the schema module stays differentially testable and the render
 * dependency stays out of it. Composing rather than editing the modules in place
 * keeps that separation a fact of the wiring rather than a convention.
 */

import type { InlineModule } from '../registry/types';
import { equationView } from './equation-view';
import { fractionView } from './fraction-view';

const viewBySpanKind: Record<InlineModule['spanKind'], InlineModule['realizedView']> = {
  equation: equationView,
  fraction: fractionView,
};

/** Returns the modules with each atom's `realizedView` attached. */
export function withAtomViews(modules: readonly InlineModule[]): readonly InlineModule[] {
  return modules.map((module) => {
    const realizedView = viewBySpanKind[module.spanKind];
    return realizedView ? { ...module, realizedView } : module;
  });
}

export { equationView } from './equation-view';
export { fractionView } from './fraction-view';
export { renderMath, fallbackClass } from './katex';
export { mountEquationEditor } from './equation-editor';
export type {
  ArrowEscape,
  EquationEditorHandle,
  EquationEditorOptions,
} from './equation-editor';
export { insertEquation } from './commands';

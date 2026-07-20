/**
 * `InlineSpan[]` <-> ProseMirror inline content.
 *
 * One converter handles text spans and inline atoms alike, because both carry a
 * `TextStyle` and both must express it the same way. Splitting style handling
 * between the block mapper and each atom module is how a bold word and a bold
 * equation drift apart.
 *
 * Style is applied through `Mark.addToSet` rather than by building the array
 * directly. `addToSet` inserts by `type.rank`, which is schema declaration
 * order, so the serialized mark array is identical regardless of the order the
 * fields happen to be read in. That is what makes the round trip byte-stable
 * without a separate canonicalization pass.
 */

import { Mark, type Node as PMNode } from 'prosemirror-model';
import type { AnyMarkModule, BlockSchema, InlineModule } from '../registry/types';
import { plainSpan } from '../../model/spans';
import {
  defaultTextStyle,
  type InlineSpan,
  type TextSpan,
  type TextStyle,
} from '../../model/types';

/** Writable view of `TextStyle` for assembly; the result is handed out frozen in shape only. */
type MutableStyle = Record<string, unknown>;

export interface InlineMapper {
  /**
   * Inline children for a `line` node. Empty spans produce empty content.
   *
   * `withMarks: false` is for a `codeLine`, whose `marks: ""` forbids them
   * structurally — the spans still convert, they just arrive unstyled. Atoms
   * are converted either way; dropping them is data loss, dropping their marks
   * is the documented restriction.
   */
  toInline(
    spans: readonly InlineSpan[],
    schema: BlockSchema,
    options?: { readonly withMarks?: boolean },
  ): PMNode[];
  /** Reads a `line` (or `codeLine`) node's content back into spans. */
  fromInline(line: PMNode): InlineSpan[];
}

export function createInlineMapper(
  markModules: readonly AnyMarkModule[],
  inlineModules: readonly InlineModule[],
): InlineMapper {
  const marksByName = new Map(markModules.map((m) => [m.markName, m]));
  const inlineByKind = new Map(inlineModules.map((m) => [m.spanKind, m]));
  const inlineByNode = new Map(inlineModules.map((m) => [m.nodeName, m]));

  function marksFor(style: TextStyle, schema: BlockSchema): readonly Mark[] {
    let set = Mark.none;
    for (const module of markModules) {
      const value = style[module.styleKey];
      // A module with `toAttrs` owns the whole question of whether the value
      // means "no mark"; a flag module means it exactly when the value is true.
      const attrs = module.toAttrs ? module.toAttrs(value) : value === true ? {} : null;
      if (attrs === null) continue;
      const type = schema.marks[module.markName];
      set = type.create(attrs).addToSet(set);
    }
    return set;
  }

  function styleFor(marks: readonly Mark[]): TextStyle {
    const style: MutableStyle = { ...defaultTextStyle };
    for (const mark of marks) {
      const module = marksByName.get(mark.type.name);
      // An unknown mark cannot be represented on the wire at all. Skipping is
      // the only option, and the registry's coverage check is what keeps this
      // branch unreachable in practice.
      if (!module) continue;
      style[module.styleKey] = module.fromAttrs
        ? module.fromAttrs(mark.attrs as Record<string, unknown>)
        : true;
    }
    return style as unknown as TextStyle;
  }

  return {
    toInline(spans, schema, options) {
      const withMarks = options?.withMarks ?? true;
      const out: PMNode[] = [];
      for (const span of spans) {
        const marks = withMarks ? marksFor(span.style, schema) : Mark.none;
        if (span.kind === 'text') {
          // PM's `TextNode` constructor throws on empty text, which is exactly
          // the guarantee we want — but Mnemo promises every block has at least
          // one span, so an empty one is normal input, not an error. Dropping it
          // here is correct: the inverse re-synthesizes it.
          if (span.text.length === 0) continue;
          out.push(schema.text(span.text, marks));
          continue;
        }
        const module = inlineByKind.get(span.kind);
        if (!module) continue;
        out.push(module.serialize.toNode(span, schema).mark(marks));
      }
      return out;
    },

    fromInline(line) {
      const spans: InlineSpan[] = [];
      line.content.forEach((child) => {
        const style = styleFor(child.marks);
        if (child.isText) {
          const span: TextSpan = { kind: 'text', text: child.text ?? '', style };
          spans.push(span);
          return;
        }
        const module = inlineByNode.get(child.type.name);
        if (!module) return;
        const span = module.serialize.fromNode(child) as InlineSpan;
        spans.push({ ...span, style });
      });
      // The one canonical empty-block shape: a single empty, default-styled
      // text span. PM allows a genuinely empty line; the wire format does not.
      return spans.length > 0 ? spans : [plainSpan('')];
    },
  };
}

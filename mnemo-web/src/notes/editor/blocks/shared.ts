/**
 * The scaffolding every block module shares.
 *
 * All fourteen modules have the same structural job — carry a line, carry block
 * children, carry the common attrs — and differ only in their typed attrs,
 * their wire type and payload, and how they render. Writing that structure out
 * fourteen times would mean fourteen chances to drop `sid`, mis-order children,
 * or forget that a block with no spans still needs one empty span back.
 *
 * So the factory owns the structure and each module declares only its
 * differences. What is left in a module file is the part a reader actually
 * needs: what this block type *is*.
 */

import type { AttributeSpec, Node as PMNode, NodeSpec } from 'prosemirror-model';
import type {
  AiSegment,
  AnyBlockModule,
  BlockProjection,
  BlockSchema,
  EstimateContext,
  MdContext,
  SerializeContext,
  SlashContribution,
  CommandContribution,
  InputTriggerContribution,
  InvariantContribution,
} from '../registry/types';
import type { Block, BlockPayload, BlockType, InlineSpan } from '../../model/types';
import type { InlineMapper } from '../mapper/inline';

/**
 * Rough type metrics for shelled height estimation.
 *
 * These are estimates for blocks that are not on screen and have never been
 * measured. Wrong-but-cheap is the requirement: the real height replaces this
 * the moment the block realizes, and a single `getBoundingClientRect` in an
 * estimator turns startup into a forced-layout storm.
 */
export const metrics = {
  bodyLineHeight: 26,
  bodyCharWidth: 8.2,
  blockPaddingY: 8,
  headingLineHeight: [0, 44, 36, 30, 27] as const,
  headingCharWidth: [0, 17, 14, 11.5, 10] as const,
} as const;

/** Height of `text` wrapped at `width`, at the given line height and character width. */
export function wrappedHeight(
  text: string,
  width: number,
  lineHeight: number,
  charWidth: number,
): number {
  const perLine = Math.max(1, Math.floor(width / charWidth));
  // Hard line breaks count even when they do not fill a line.
  const hardLines = text.split('\n');
  let lines = 0;
  for (const line of hardLines) lines += Math.max(1, Math.ceil(line.length / perLine));
  return lines * lineHeight + metrics.blockPaddingY;
}

export interface BlockDefinition<TAttrs extends Record<string, unknown>> {
  readonly nodeName: string;
  readonly wireTypes: readonly BlockType[];

  /** Which line node holds the inline content. `codeLine` forbids marks structurally. */
  readonly lineKind?: 'line' | 'codeLine';
  /** Overrides the default `"<lineKind> block*"`. Must still start with a line. */
  readonly content?: string;
  /** Type-specific attrs only; the common four are merged in at registry assembly. */
  readonly attrs?: Record<string, AttributeSpec>;
  /**
   * The rest of the `NodeSpec`, as an explicit allowlist rather than an `Omit`.
   *
   * `NodeSpec` carries an `any` index signature, so `Omit` widens to it and
   * every `toDOM`/`parseDOM` callback silently loses its parameter types. The
   * allowlist also states what a module is actually allowed to set: `content`,
   * `attrs` and `group` are the factory's, not the module's.
   */
  readonly nodeOptions?: Pick<
    NodeSpec,
    'parseDOM' | 'toDOM' | 'defining' | 'isolating' | 'atom' | 'selectable' | 'draggable'
  >;

  /** Typed attrs read off the wire block. */
  attrsFrom(block: Block): TAttrs;
  /** The wire type and payload this node represents. */
  wireFrom(node: PMNode): { type: BlockType; payload: BlockPayload };
  /**
   * What goes in the line, when it is not simply `block.spans`.
   *
   * Two block types store one string twice: `Code` keeps its source in both
   * `spans[0].text` and `payload.source`, and `Image` keeps its caption in both
   * `spans[0].text` and `payload.alt`. For those the payload is authoritative on
   * read, and both fields are written on save.
   */
  spansFor?(block: Block): readonly InlineSpan[];

  toMarkdown(node: PMNode, ctx: MdContext, inline: string): string;
  /** Defaults to one `prose` segment covering the whole projection. */
  segmentsFor?(node: PMNode, text: string): readonly AiSegment[];
  /** Defaults to wrapped body text plus the children's heights. */
  estimate?(node: PMNode, ctx: EstimateContext, text: string): number;

  readonly slash?: SlashContribution;
  readonly commands?: readonly CommandContribution[];
  readonly inputTriggers?: readonly InputTriggerContribution[];
  readonly invariants?: readonly InvariantContribution[];
}

/** The line is always the first child; block children always follow it. */
export function lineOf(node: PMNode): PMNode | null {
  const first = node.firstChild;
  if (!first) return null;
  return first.type.name === 'line' || first.type.name === 'codeLine' ? first : null;
}

/** The block's own text, ignoring its block children. */
export function lineText(node: PMNode): string {
  const line = lineOf(node);
  return line ? line.textContent : '';
}

/** The block children, i.e. everything after the mandatory line. */
export function blockChildrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child, _offset, index) => {
    if (index === 0 && (child.type.name === 'line' || child.type.name === 'codeLine')) return;
    out.push(child);
  });
  return out;
}

/**
 * What a block module needs from the rest of the editor.
 *
 * Passed in rather than imported so the modules stay pure functions of what
 * they are assembled with. The alternative — a module-level registry the atoms
 * write into at import time — is the exact hidden coupling the block registry
 * exists to remove, and it makes two schemas in one process impossible.
 */
export interface BlockDeps {
  readonly inline: InlineMapper;
  /** What an inline atom contributes to a text projection; '' if unknown. */
  projectAtom(node: PMNode): string;
}

/** Builds the module against the dependencies its serializer and projection need. */
export function defineBlock<TAttrs extends Record<string, unknown>>(
  def: BlockDefinition<TAttrs>,
  deps: BlockDeps,
): AnyBlockModule {
  const inline = deps.inline;
  const lineKind = def.lineKind ?? 'line';
  const content = def.content ?? `${lineKind} block*`;

  function projectPlainText(node: PMNode): string {
    const line = lineOf(node);
    if (!line) return '';
    let text = '';
    line.content.forEach((child) => {
      if (child.isText) {
        text += child.text ?? '';
        return;
      }
      // An atom contributes its source to the projection while occupying one
      // PM position — the reason text offsets and PM positions need `positionOf`
      // to cross between them rather than simple addition.
      text += deps.projectAtom(child);
    });
    return text;
  }

  const project: BlockProjection = {
    plainText: projectPlainText,
    aiSegments(node) {
      const text = projectPlainText(node);
      if (def.segmentsFor) return def.segmentsFor(node, text);
      return text.length > 0 ? [{ kind: 'prose', text, offset: 0 }] : [];
    },
    /**
     * Text offset -> position measured from this block node's own start, so a
     * caller adds `getPos()` to get an absolute document position.
     *
     * The block starts at 0, the line node opens at 1, and the line's content
     * begins at 2 — hence the base below.
     */
    positionOf(node, offset) {
      const line = lineOf(node);
      if (!line) return 1;
      let textSeen = 0;
      let pos = 2;
      let result: number | null = null;
      line.content.forEach((child) => {
        if (result !== null) return;
        if (child.isText) {
          const length = (child.text ?? '').length;
          if (offset <= textSeen + length) {
            result = pos + (offset - textSeen);
            return;
          }
          textSeen += length;
          pos += length;
          return;
        }
        const length = deps.projectAtom(child).length;
        // An offset landing inside an atom's projected source has no finer
        // position than the atom itself; clamp to its start.
        if (offset < textSeen + length) {
          result = pos;
          return;
        }
        textSeen += length;
        pos += 1;
      });
      return result ?? pos;
    },
  };

  const node: NodeSpec = {
    ...def.nodeOptions,
    content,
    group: 'block',
    attrs: def.attrs,
  };

  return {
    nodeName: def.nodeName,
    wireTypes: def.wireTypes,
    node,

    serialize: {
      toNode(block: Block, schema: BlockSchema, ctx: SerializeContext): PMNode {
        const spans = def.spansFor ? def.spansFor(block) : block.spans;
        const lineNode = schema.nodes[lineKind].create(
          null,
          // A code line forbids marks structurally, so styled spans arrive
          // unstyled. Their text and any inline atoms still come through —
          // there is no wire field a mark would have survived in, but a dropped
          // atom is content the other side keeps.
          inline.toInline(spans, schema, { withMarks: lineKind !== 'codeLine' }),
        );
        const children = (block.children ?? []).map((child) => ctx.toChild(child));
        return schema.nodes[def.nodeName].create(
          {
            id: block.id,
            sid: block.sid,
            order: block.order,
            meta: block.meta,
            ...def.attrsFrom(block),
          },
          [lineNode, ...children],
        );
      },

      fromNode(node: PMNode, ctx: SerializeContext): Block {
        const line = lineOf(node);
        const { type, payload } = def.wireFrom(node);
        const children = blockChildrenOf(node).map((child) => ctx.fromChild(child));
        return {
          id: String(node.attrs.id ?? ''),
          sid: String(node.attrs.sid ?? ''),
          type,
          spans: line ? inline.fromInline(line) : [],
          payload,
          // Copied, not aliased. PM nodes are persistent and shared, so handing
          // out the live attr object lets any consumer that mutates the returned
          // block's meta mutate the document itself — and the default `meta` is
          // one object shared by every node that omits it, so the blast radius
          // is every such block in the note.
          meta: { ...((node.attrs.meta ?? {}) as Record<string, unknown>) },
          order: Number(node.attrs.order) || 0,
          // Null and empty are different on the wire: null means "not a
          // container", and an empty array is a shape the C# writer never emits.
          children: children.length > 0 ? children : null,
        };
      },

      toMarkdown(node: PMNode, ctx: MdContext): string {
        const line = lineOf(node);
        return def.toMarkdown(node, ctx, line ? ctx.serializeInline(line) : '');
      },
    },

    project,

    estimateHeight(node: PMNode, ctx: EstimateContext): number {
      const text = projectPlainText(node);
      if (def.estimate) return def.estimate(node, ctx, text);
      let height = wrappedHeight(
        text,
        ctx.availableWidth,
        metrics.bodyLineHeight,
        metrics.bodyCharWidth,
      );
      for (const child of blockChildrenOf(node)) height += ctx.estimateChild(child);
      return height;
    },

    slash: def.slash,
    commands: def.commands,
    inputTriggers: def.inputTriggers,
    invariants: def.invariants,
  };
}

/** Builds a `projectAtom` from the inline modules a schema was assembled with. */
export function atomProjector(
  inlineModules: readonly { nodeName: string; projectText(node: PMNode): string }[],
): (node: PMNode) => string {
  const byName = new Map(inlineModules.map((m) => [m.nodeName, m]));
  return (node) => byName.get(node.type.name)?.projectText(node) ?? '';
}

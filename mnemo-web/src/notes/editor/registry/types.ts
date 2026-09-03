/**
 * The internal block registry: one module per block type, carrying everything
 * that block type needs to exist.
 *
 * The registry is compile-time-ish, not runtime. It is read exactly once, at
 * editor construction, to bake a flat set of node specs, estimators, command
 * and slash indexes. Nothing looks the registry up during a keystroke, a scroll
 * frame, or a NodeView update, the indirection is paid once, at mount, and is
 * O(number of block types).
 *
 * This is internal, not a public plugin API. Adding a block type is one module
 * plus one line in the module list; it is deliberately not a promise that a
 * third party can drop a block type in from outside the bundle.
 */

import type {
  AttributeSpec,
  Mark,
  MarkSpec,
  MarkType,
  Node as PMNode,
  NodeSpec,
  NodeType,
} from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView, ViewMutationRecord } from 'prosemirror-view';
import type { IconName } from '@/components/icon/icon-registry';
import type { Block, BlockType, TextStyle } from '../../model/types';
import type { BlockRegistry } from './build';
import type { PortalRegistry } from '../view/portal-registry';

/** Dispatches a transaction. Mirrors ProseMirror's own command signature. */
export type Dispatch = (tr: Transaction) => void;

/**
 * Attrs every block node carries, merged into each module's `NodeSpec` by
 * `buildBlockRegistry` so no module can forget one.
 *
 * These are the fields whose loss is silent and expensive. The negative
 * controls showed that dropping the `meta` or `sid` declaration turns the
 * corpus round trip red on every note that uses them, and a re-minted `sid` is
 * an identifier the user has already seen in chat history. Declaring them in
 * one place makes that a property the registry enforces rather than one 17
 * module authors have to remember.
 *
 * `meta` is opaque passthrough and must be replaced, never mutated in place:
 * the default is one shared object across every node that omits it.
 */
export const commonBlockAttrs = {
  /** Durable GUID storage key. */
  id: { default: '' },
  /** Short id, unique within the note; the only id crossing the AI boundary. */
  sid: { default: '' },
  /**
   * Never read by the editor, whose order is document position. The mapper
   * rewrites it to that position on every save, because every reader on the
   * other side of the wire sorts by it.
   */
  order: { default: 0 },
  /** Opaque passthrough bag. Never destructured by the editor. */
  meta: { default: {} as Record<string, unknown> },
} satisfies Record<string, AttributeSpec>;

export const commonBlockAttrNames: readonly string[] = Object.keys(commonBlockAttrs);

/**
 * A typed slice of a block's canonical text projection.
 *
 * Segments are how find, word count, the outline and the AI read surface all
 * see the same document. The projection deliberately includes more than prose:
 * code source and equation LaTeX are searchable and addressable, each tagged so
 * a consumer can include or exclude a kind rather than guessing from context.
 *
 * There is no `caption` kind. Every real image block in the corpus stores its
 * caption in `spans[0].text` *and* in `payload.alt`, byte-identical, one piece
 * of text stored twice. Emitting both as segments would make find return two
 * hits for one string, one of which has no editable location.
 */
export type AiSegmentKind = 'prose' | 'code' | 'equation' | 'imageAlt';

export interface AiSegment {
  readonly kind: AiSegmentKind;
  readonly text: string;
  /**
   * Where `text` starts inside the block's `plainText(node)` projection.
   *
   * Segments partition that string in order and without gaps. If the two
   * projections could disagree, find and the AI surface would be searching
   * different strings and a reference resolved against one would land wrong in
   * the other, the exact failure class the shared projection exists to remove.
   *
   * This is a *text* offset, not a ProseMirror position: an equation atom
   * contributes one caret position but many characters of LaTeX, so the two
   * spaces are not related by addition. Use `positionOf` to cross over.
   */
  readonly offset: number;
}

export interface BlockProjection {
  /**
   * The block's own canonical text, its line content only, never its block
   * children. Children are separate blocks with their own sids and their own
   * projections, so including them here would make every container's text
   * overlap its descendants' and give find two locations for one hit.
   */
  plainText(node: PMNode): string;
  aiSegments(node: PMNode): readonly AiSegment[];
  /**
   * Converts an offset in `plainText` to a ProseMirror position relative to the
   * start of this block's content.
   *
   * Required because the mapping is not addition: inline atoms render as their
   * LaTeX in the projection (so search can find it) while occupying exactly one
   * PM position. Replace needs a real PM range for its decoration and its
   * transaction, so the inverse has to exist somewhere; putting it on the
   * module keeps it next to the projection that defined the offsets.
   */
  positionOf(node: PMNode, offset: number): number;
}

/**
 * Lets a module convert its block children without knowing which modules own
 * them.
 *
 * Containers are the reason this exists. A `ColumnGroup`'s `fromNode` has to
 * return a complete `Block`, children included, but those children belong to
 * other modules and PM nodes are immutable, so there is no way to return a
 * shell for an outer mapper to fill. Without a dispatcher a recursive container
 * is simply not expressible, and it has to be.
 */
export interface SerializeContext {
  /** Converts a child block through its owning module. */
  toChild(block: Block): PMNode;
  /** Converts a child node back through its owning module. */
  fromChild(node: PMNode): Block;
}

/**
 * Markdown serialization context, supplied by the serializer that walks the doc.
 *
 * A module renders its own wrapper and delegates everything else, it must not
 * reach into child nodes itself, or nested blocks would bypass their own
 * module's serializer. The real serializer may widen this.
 */
export interface MdContext {
  /** Block nesting depth; 0 at the top level. */
  readonly depth: number;
  /** Serializes this node's block children through their own modules. */
  serializeChildren(node: PMNode): string;
  /** Serializes this node's inline content, marks included. */
  serializeInline(node: PMNode): string;
  /** Escapes markdown control characters in literal text. */
  escapeText(text: string): string;
}

/**
 * One token from the markdown parser.
 *
 * Kept structural on purpose: the real module chooses the parser, and pinning a library's
 * token class here would make that choice for it.
 */
export interface MdToken {
  readonly type: string;
  readonly content: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly children?: readonly MdToken[];
}

/**
 * What a height estimate is allowed to depend on.
 *
 * Width is here because height is a function of it for anything that wraps, and
 * the layout signature names available width alongside font and zoom.
 * `estimateChild` is here because a column container's height is the lane
 * maximum, not the sum of its descendants, it cannot be computed without the
 * other modules' estimators, which do not exist until assembly finishes.
 */
export interface EstimateContext {
  readonly availableWidth: number;
  estimateChild(node: PMNode): number;
}

/**
 * Handles the editor was constructed with, passed to realized views.
 *
 * `Page` has to resolve the referenced note's title (deliberately never copied
 * into the payload) and `Image` has to resolve an asset path behind the
 * bearer-guarded API. Without a handle here the only way to reach either is a
 * module-level singleton import, which is the coupling the registry exists to
 * prevent. The atom and image views widen this as they need more.
 */
export interface EditorServices {
  /** Resolves a note title for an embedded page reference. */
  resolveNoteTitle(noteId: string): string | undefined;
  /**
   * The referenced note's own emoji, when it has one and the mount can reach it.
   * A page row falls back to the neutral document icon, so a supplier that
   * cannot answer costs nothing.
   */
  resolveNoteEmoji?(noteId: string): string | undefined;
  /** Absent wherever no note library is mounted, which is what a test and a preview get. */
  readonly notes?: NoteReferenceServices;
  /**
   * Loads a stored asset reference as an object URL usable in `src`. Async because the
   * bytes sit behind the bearer-guarded API, and rejecting is the "cannot resolve" answer,
   * a view renders its placeholder rather than a broken image.
   */
  loadAssetUrl(path: string): Promise<string>;
  /**
   * Uploads a picked or pasted image and resolves to the reference the block stores in its
   * `path` attr. The bytes land on disk before any save, the way the desktop copies a
   * picked file the moment it is chosen; an upload whose insert never persists becomes an
   * orphan the host sweeps once no open session could redo it.
   */
  uploadAsset(file: File): Promise<string>;
  /**
   * Where a realized view mounts React chrome, when the host has a React tree to
   * mount it into.
   *
   * Absent in a test harness and anywhere the editor is rendered without the
   * portal layer beside it, so a view that wants React chrome must still render
   * without it. What that costs is the interactive chrome, never the block: the
   * code block's toolbar and the table's handles are things you reach for, and a
   * surface that cannot host them is a surface nobody is reaching on.
   */
  readonly portals?: PortalRegistry;
  /**
   * The registry the editor was assembled from, for a view whose own body acts on the block
   * rather than on its content.
   *
   * The image is the case: a press on the picture selects the block the way the gutter grip does,
   * and the selection algebra is registry-shaped (what counts as a block, and in what order).
   * Absent wherever a view is built without one, and a view that wants it must still render.
   */
  readonly registry?: BlockRegistry;
}

/**
 * The note library a page reference is answered from, when the mount can reach it.
 *
 * `resolveNoteTitle` on its own cannot tell a deleted note from a library that
 * has not arrived yet, and a card reading "Missing note" about a note that
 * exists is a lie the user would act on. A supplier that knows the difference
 * says so here. Omitted, every card resolves once at build and no page block can
 * be created, which is what a test harness and a read-only preview want.
 */
export interface NoteReferenceServices {
  /** False while the note list is still in flight. */
  isLoaded(): boolean;
  /** Calls back whenever `resolveNoteTitle` could answer differently; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Creates the nested note a new page block points at, resolving to its id. */
  createChild(): Promise<string>;
}

/**
 * The outer DOM and lifecycle every block node gets, realized or not.
 *
 * This is a semantic boundary, not a promise that one NodeView instance mutates
 * its own `contentDOM` in place: controlled NodeView recreation through public
 * APIs is an acceptable implementation, private `ViewDesc` traversal is not.
 *
 * Anything written back after realization, a measured height above all, must
 * go through the CSSOM or a ProseMirror transaction, never a bare DOM mutation
 * on a descendant of `view.dom`. ProseMirror's own MutationObserver reads such
 * a write as an unrecognized external change and defensively tears down and
 * rebuilds nearby NodeViews; measurement showed the same blocks being reconstructed
 * up to 13 times each because of a single inline style assignment.
 */
export interface BlockShellHost {
  readonly mode: 'realized' | 'shelled';
  requestMode(mode: 'realized' | 'shelled'): void;
  destroy(): void;
}

export interface RealizedBlockViewArgs<TAttrs> {
  readonly node: PMNode;
  readonly view: EditorView;
  /** ProseMirror returns undefined once the node is gone from the document. */
  readonly getPos: () => number | undefined;
  readonly attrs: TAttrs;
  readonly host: BlockShellHost;
  readonly services: EditorServices;
}

/**
 * The realized body of a block. The shell host owns the wrapper around it, so a
 * module returns only the part that differs per block type.
 */
export interface RealizedBlockView {
  readonly dom: HTMLElement;
  /** Omitted by blocks with no editable inline content (divider, sketch). */
  readonly contentDOM?: HTMLElement | null;
  /** Returns false to ask for a rebuild instead of an in-place update. */
  update?(node: PMNode): boolean;
  /**
   * Return true to tell ProseMirror a DOM mutation is this view's own work.
   *
   * Without it, any write the view makes to its own DOM outside a transaction,
   * a live drag preview, a KaTeX re-render, reads to the editor's
   * MutationObserver as an external change, and it defensively rebuilds the
   * NodeView mid-gesture. Selection pseudo-records must return false, or the
   * caret stops working inside the view's content.
   */
  ignoreMutation?(mutation: ViewMutationRecord): boolean;
  destroy?(): void;
}

export type RealizedBlockViewFactory<TAttrs> = (
  args: RealizedBlockViewArgs<TAttrs>,
) => RealizedBlockView;

/**
 * The two sections the menu draws, separated by a rule and in this order.
 * `text` is the block a paragraph can become, `insert` is everything that puts
 * something new on the page.
 */
export type SlashGroup = 'text' | 'insert';

/**
 * One row of the slash menu, contributed by the block it creates.
 *
 * A row is an icon tile, a name and a one-line description, grouped under its
 * section heading, so the menu reads like a palette of what a block can become
 * rather than a bare list of words.
 */
export interface SlashContribution {
  /** i18n key in the `NotesEditor` namespace, not display text. */
  readonly label: string;
  /**
   * i18n key for a one-line description, drawn under the name and folded into
   * the search text so a user who types "bulleted" finds the bullet list
   * without knowing its name.
   */
  readonly description: string;
  /** The tile glyph, a project icon resolved through `AppIcon`. */
  readonly icon: IconName;
  /** The markdown shortcut for the same conversion, kept as search text. */
  readonly hint?: string;
  /** Extra search terms beyond the label, description, hint and node name. */
  readonly keywords?: readonly string[];
  readonly group: SlashGroup;
  /** Async is allowed: Page must await child-note creation before committing. */
  insert(state: EditorState, dispatch: Dispatch, context?: SlashInsertContext): void | Promise<void>;
}

/**
 * What the menu hands a row beyond the state it picked in.
 *
 * `state` is a snapshot, which is all a synchronous row needs. A row that has to
 * await something first cannot build its step from that snapshot: the document
 * may have moved on while the request was in flight, and applying a step mapped
 * against the older document is how positions land in the wrong place. Those
 * rows read `currentState` after the await instead.
 */
export interface SlashInsertContext {
  readonly services: EditorServices;
  readonly currentState: () => EditorState;
}

/**
 * One entry in the command catalog.
 *
 * Carries its own presentation because the catalog is the single source for the
 * keymap, the toolbar, the slash menu, the context menu and the shortcut help.
 * If label and icon lived somewhere else, those five surfaces would drift.
 */
export interface CommandContribution {
  /** Stable and module-namespaced, e.g. `heading.setLevel2`. */
  readonly id: string;
  readonly command: Command;
  /** i18n key, not display text, the catalog is rendered in five surfaces. */
  readonly label: string;
  readonly icon?: IconName;
  /**
   * Whether the command applies to the current state. Distinct from whether it
   * would succeed: a disabled toolbar button needs a reason to show, and
   * `command(state)` returning false cannot supply one.
   */
  isAvailable?(state: EditorState): boolean;
  /**
   * Default chords, in the app's keybind token form.
   *
   * Editor keybinds ultimately resolve through the server-owned keybind
   * registry, which merges user overrides under manifest defaults. These are
   * the defaults a module ships with, not the final binding, the view layer wires the two
   * together, and until it does nothing dispatches them.
   */
  readonly keys?: readonly string[];
}

export interface InputTriggerContribution {
  readonly id: string;
  /**
   * Matched against the text between the block start and the caret, so it must
   * be anchored to the end with `$`.
   *
   * Must not carry the `g` or `y` flag. Those make the regex stateful through
   * `lastIndex`, and a stateful module-level pattern reused across calls
   * silently starts matching from wherever the previous call stopped.
   */
  readonly match: RegExp;
  handler(
    state: EditorState,
    match: RegExpMatchArray,
    from: number,
    to: number,
  ): Transaction | null;
}

export interface InvariantContext {
  /** State after the transactions being reacted to have been applied. */
  readonly state: EditorState;
  readonly transactions: readonly Transaction[];
  /** Document ranges those transactions touched, in the new document's space. */
  readonly changedRanges: readonly { readonly from: number; readonly to: number }[];
  /** The accumulating transaction to append steps to. */
  readonly tr: Transaction;
}

export interface InvariantContribution {
  readonly id: string;
  /**
   * Explicit pipeline position, low first. Ties break on module registration
   * order. Invariants that can retrigger each other must be ordered so the
   * pipeline converges rather than relying on repeated passes.
   */
  readonly order: number;
  /**
   * Returns the transaction to append, or null to contribute nothing.
   *
   * Must be range-local: read only what `changedRanges` covers. An invariant
   * that scans the whole document here misses the frame budget for every block
   * type, not just its own.
   */
  apply(ctx: InvariantContext): Transaction | null;
}

export interface BlockModule<TAttrs extends Record<string, unknown> = Record<string, never>> {
  /** Stable ProseMirror schema key. Several wire types may map to one node. */
  readonly nodeName: string;

  /**
   * The C# wire discriminants this module owns; `heading` owns Heading1 through Heading4.
   *
   * The mapper is derived from this, so one schema key can serve several enum
   * values without either side pretending the mapping is 1:1.
   */
  readonly wireTypes: readonly BlockType[];

  /**
   * Contributed to the single Schema. `marks`/`content` exactly as PM expects.
   *
   * `commonBlockAttrs` are merged in at assembly; a module declaring one itself
   * is a validation error, not an override.
   */
  readonly node: NodeSpec;

  /**
   * Optional specialized realized renderer. Every materialized block is wrapped
   * in the generic shell host regardless; a module without one renders through
   * its NodeSpec's own `toDOM`.
   *
   * Declared as a method rather than a `RealizedBlockViewFactory` property on
   * purpose: method parameters are checked bivariantly, which is what lets
   * modules with different `TAttrs` sit in one `AnyBlockModule[]`. As a
   * property it would be contravariant and no two block types could share a
   * list.
   */
  realizedView?(args: RealizedBlockViewArgs<TAttrs>): RealizedBlockView;

  /**
   * The wire discriminant this specific node represents.
   *
   * `wireTypes` says what a module *may* produce; this says which one a given
   * node *is*, which only differs for heading. Separate from `fromNode` because
   * the outline needs the type of every block in the document and nothing else,
   * going through `fromNode` would serialize the whole note, spans and
   * payloads included, to read one enum per block.
   */
  wireTypeOf(node: PMNode): BlockType;

  /** Model <-> doc. Pure, synchronous, no editor access. Differentially testable. */
  readonly serialize: {
    toNode(block: Block, schema: BlockSchema, ctx: SerializeContext): PMNode;
    fromNode(node: PMNode, ctx: SerializeContext): Block;
    toMarkdown(node: PMNode, ctx: MdContext): string;
    fromMarkdown?(token: MdToken, schema: BlockSchema): PMNode | null;
  };

  /** Canonical semantic projection shared by find, word count, outline and AI. */
  readonly project: BlockProjection;

  /**
   * Height of a shelled instance in px, from attrs, text length and the context
   * only.
   *
   * MUST NOT touch the DOM. One `getBoundingClientRect` in here turns
   * initialization and every layout invalidation into a forced-layout storm.
   * Wrong-but-cheap beats right-but-slow: the real height replaces this on
   * first realization.
   */
  estimateHeight(node: PMNode, ctx: EstimateContext): number;

  readonly slash?: readonly SlashContribution[];
  readonly commands?: readonly CommandContribution[];
  readonly inputTriggers?: readonly InputTriggerContribution[];
  readonly invariants?: readonly InvariantContribution[];
}

/**
 * A block module of unspecified attr shape, the type collections use.
 *
 * Modules are written against their own `TAttrs` and stored together as this.
 */
export type AnyBlockModule = BlockModule<Record<string, unknown>>;

/**
 * An inline atom: a PM inline *node*, not a block and not a mark.
 *
 * Equation and fraction spans are atomic, one caret position regardless of
 * content, so they cannot be marks, and they own no `BlockType`, so they
 * cannot be blocks. They get their own flat registry rather than being
 * smuggled in as base nodes, which would leave them with no realized view once
 * their KaTeX renderers are built.
 */
export interface InlineModule {
  readonly nodeName: string;
  /** The `InlineSpan.kind` this module owns. */
  readonly spanKind: 'equation' | 'fraction';
  readonly node: NodeSpec;
  /**
   * Atoms carry their `TextStyle` through `node.marks` even where the spec sets
   * `marks: "_"`, that flag governs permitted *content*, not the node's own
   * marks array.
   */
  readonly serialize: {
    toNode(span: unknown, schema: BlockSchema): PMNode;
    fromNode(node: PMNode): unknown;
  };
  /** What this atom contributes to the containing block's text projection. */
  projectText(node: PMNode): string;
  realizedView?(args: RealizedBlockViewArgs<Record<string, unknown>>): RealizedBlockView;
}

/**
 * The schema a module serializes against.
 *
 * Typed with ProseMirror's own `NodeType`/`MarkType` rather than its `Schema`
 * class so that the schema layer, which owns the base nodes and therefore the concrete
 * schema generic, can supply its own without this file importing it, and
 * without every module body needing a cast to use it.
 */
export interface BlockSchema {
  nodes: Record<string, NodeType>;
  marks: Record<string, MarkType>;
  /**
   * Text nodes have no other constructor: `NodeType.create` throws on a text
   * type, so a serializer that builds inline content needs this specifically.
   */
  text(text: string, marks?: readonly Mark[] | null): PMNode;
}

/**
 * A mark module: flatter than a block by design.
 *
 * Marks have no renderer, no height model and no slash entry, so folding them
 * into `BlockModule` would be symmetry for its own sake. Each maps to exactly
 * one `TextStyle` field, which is what makes the mapper's mark handling total
 * rather than a switch someone has to remember to extend.
 *
 * Generic in the field it owns so `toAttrs`/`fromAttrs` speak that field's real
 * type instead of the union of all of them.
 */
export interface MarkModule<K extends keyof TextStyle = keyof TextStyle> {
  readonly markName: string;
  readonly mark: MarkSpec;
  /** The single `TextStyle` field this mark represents. */
  readonly styleKey: K;
  /**
   * Attrs for the mark given a style value, or null when the value means
   * "no mark" (false for a flag, null for a color or href).
   *
   * Omit for a plain boolean flag whose mark carries no attrs.
   */
  toAttrs?(value: TextStyle[K]): Record<string, unknown> | null;
  /** Inverse of `toAttrs`; omit alongside it. */
  fromAttrs?(attrs: Record<string, unknown>): TextStyle[K];
  /** Markdown delimiters, when the mark has a markdown representation at all. */
  readonly markdown?: { readonly open: string; readonly close: string };
}

/** A mark module of unspecified field, the type collections use. */
export type AnyMarkModule = MarkModule<keyof TextStyle>;

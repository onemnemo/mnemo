/**
 * The command catalog — its shape, and that its availability/active readouts
 * agree with the commands they describe. Every readout is exercised against a
 * real editor state built through the mapper, the same document shape the app
 * produces, so the catalog cannot claim a button state the toggle would contradict.
 */

import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import {
  defaultTextStyle,
  type Block,
  type BlockPayload,
  type BlockType,
  type TextStyle,
} from '../../model/types';
import { hasIcon } from '../../../components/icon/icon-registry';
import { isFormatActive } from '../marks/commands';
import {
  COMMANDS_BY_ID,
  EDITOR_COMMANDS,
  isCommandEnabled,
  type DirectCommand,
  type SwatchCommand,
} from './catalog';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

type SpanSpec = { text: string; style?: Partial<TextStyle> };

function blockOf(type: BlockType, spans: Block['spans'], payload: BlockPayload): Block {
  return { id: 'id-1', sid: 's0001', type, spans, payload, meta: {}, order: 0, children: null };
}

function textBlock(spans: SpanSpec[]): Block {
  return blockOf(
    'Text',
    spans.map((s) => ({ kind: 'text', text: s.text, style: { ...defaultTextStyle, ...s.style } })),
    { kind: 'empty' },
  );
}

function stateOf(block: Block): EditorState {
  const result = mapper.toDoc([block]);
  if (!result.ok) throw new Error(`quarantined: ${result.reason.message}`);
  return EditorState.create({ doc: result.doc, schema });
}

function selectAll(state: EditorState): EditorState {
  let from = -1;
  let to = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText || node.isAtom) {
      if (from < 0) from = pos;
      to = pos + node.nodeSize;
    }
    return !node.isText && !node.isAtom;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function caretInFirstRun(state: EditorState): EditorState {
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText) pos = at + 1;
    return pos < 0;
  });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

const direct = (id: string) => COMMANDS_BY_ID.get(id) as DirectCommand;
const swatchCmd = (id: string) => COMMANDS_BY_ID.get(id) as SwatchCommand;

describe('EDITOR_COMMANDS shape', () => {
  it('lists every current command once, in toolbar order', () => {
    expect(EDITOR_COMMANDS.map((c) => c.id)).toEqual([
      'editor.undo',
      'editor.redo',
      'editor.bold',
      'editor.italic',
      'editor.underline',
      'editor.strikethrough',
      'editor.highlight',
      'editor.code',
      'editor.color.background',
      'editor.color.foreground',
      'editor.subscript',
      'editor.superscript',
      'editor.equation',
      'editor.clearMarks',
    ]);
  });

  it('indexes by id, and misses cleanly', () => {
    expect(COMMANDS_BY_ID.get('editor.bold')?.id).toBe('editor.bold');
    expect(COMMANDS_BY_ID.get('nope')).toBeUndefined();
    expect(COMMANDS_BY_ID.size).toBe(EDITOR_COMMANDS.length);
  });

  it('gives every command a label key and a group', () => {
    for (const command of EDITOR_COMMANDS) {
      expect(command.titleKey).toMatch(/^notes\.command\./);
      expect(command.group).toBeTruthy();
    }
  });

  it('references only icons that actually ship', () => {
    // A typo in an icon name would render nothing; assert each resolves to a
    // real ported SVG rather than trusting the string.
    for (const command of EDITOR_COMMANDS) {
      if (command.icon) expect(hasIcon(command.icon), command.icon).toBe(true);
    }
  });
});

describe('active readouts agree with the applier', () => {
  it('a flag reads active only where its mark is set', () => {
    const bolded = selectAll(stateOf(textBlock([{ text: 'hi', style: { bold: true } }])));
    const plain = selectAll(stateOf(textBlock([{ text: 'hi' }])));
    expect(direct('editor.bold').isActive?.(bolded)).toBe(true);
    expect(direct('editor.bold').isActive?.(plain)).toBe(false);
    expect(direct('editor.italic').isActive?.(bolded)).toBe(false);
  });

  it('a script flag reads its own state', () => {
    const sub = selectAll(stateOf(textBlock([{ text: 'x', style: { subscript: true } }])));
    expect(direct('editor.subscript').isActive?.(sub)).toBe(true);
    expect(direct('editor.superscript').isActive?.(sub)).toBe(false);
  });

  it('the insert and escape commands carry no active readout', () => {
    expect(direct('editor.equation').isActive).toBeUndefined();
    expect(direct('editor.clearMarks').isActive).toBeUndefined();
  });

  it("a swatch's active token is the one in force, or null when mixed/absent", () => {
    const one = selectAll(stateOf(textBlock([{ text: 'hi', style: { backgroundColor: 'swatch3' } }])));
    const none = selectAll(stateOf(textBlock([{ text: 'hi' }])));
    const mixed = selectAll(
      stateOf(
        textBlock([
          { text: 'a', style: { backgroundColor: 'swatch3' } },
          { text: 'b', style: { backgroundColor: 'swatch5' } },
        ]),
      ),
    );
    expect(swatchCmd('editor.color.background').activeToken(one)).toBe('swatch3');
    expect(swatchCmd('editor.color.background').activeToken(none)).toBeNull();
    expect(swatchCmd('editor.color.background').activeToken(mixed)).toBeNull();
  });

  it("activeToken is isFormatActive narrowed to a candidate — no readout asymmetry", () => {
    const one = selectAll(stateOf(textBlock([{ text: 'hi', style: { backgroundColor: 'swatch3' } }])));
    const token = swatchCmd('editor.color.background').activeToken(one);
    expect(token).toBe('swatch3');
    expect(isFormatActive(one, 'backgroundColor', token ?? undefined)).toBe(true);
    expect(isFormatActive(one, 'backgroundColor', 'swatch5')).toBe(false);
  });
});

describe('availability is the command dry-run', () => {
  it('marks and inserts are available in ordinary prose', () => {
    const state = caretInFirstRun(stateOf(textBlock([{ text: 'hi' }])));
    expect(isCommandEnabled(direct('editor.bold'), state)).toBe(true);
    expect(isCommandEnabled(direct('editor.equation'), state)).toBe(true);
    expect(isCommandEnabled(swatchCmd('editor.color.background'), state)).toBe(true);
  });

  it('a mark is unavailable inside a code block, and so its button would disable', () => {
    const code = caretInFirstRun(stateOf(blockOf('Code', [], { kind: 'code', language: 'text', source: 'hi' })));
    expect(isCommandEnabled(direct('editor.bold'), code)).toBe(false);
    expect(isCommandEnabled(swatchCmd('editor.color.background'), code)).toBe(false);
  });
});

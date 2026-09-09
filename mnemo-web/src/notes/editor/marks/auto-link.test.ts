// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import { block, span } from '../mapper/fixtures';
import { createDocumentMapper } from '../mapper/document';
import { createEditorSchema } from '../schema';
import type { TextStyle } from '../../model/types';
import { autoLinkPlugin } from './auto-link';

const { schema, registry } = createEditorSchema();
const mapper = createDocumentMapper(schema, registry);

beforeAll(() => {
  (document as Document & { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
});

afterEach(() => {
  document.body.replaceChildren();
});

function mount(text: string, style: Partial<TextStyle> = {}): EditorView {
  const mapped = mapper.toDoc([block('Text', [span(text, style)])]);
  if (!mapped.ok) throw new Error('fixture did not map');
  let end = 0;
  mapped.doc.descendants((node, pos) => {
    if (node.isText) end = pos + node.nodeSize;
    return true;
  });
  const state = EditorState.create({
    schema,
    doc: mapped.doc,
    selection: TextSelection.create(mapped.doc, end),
    plugins: [autoLinkPlugin()],
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  return new EditorView(host, { state });
}

function plugin(view: EditorView): Plugin {
  return view.state.plugins[0];
}

function type(view: EditorView, text: string): boolean {
  const pos = view.state.selection.from;
  const owner = plugin(view);
  const handler = owner.props.handleTextInput;
  return Boolean(handler?.call(owner, view, pos, pos, text, () => view.state.tr));
}

function hrefs(view: EditorView): string[] {
  const values: string[] = [];
  view.state.doc.descendants((node) => {
    if (!node.isText) return true;
    const mark = node.marks.find((candidate) => candidate.type === schema.marks.link);
    if (mark) values.push(String(mark.attrs.href));
    return false;
  });
  return values;
}

describe('autoLinkPlugin', () => {
  it('links a URL when whitespace completes it', () => {
    const view = mount('Visit https://www.mnemo.one/');

    expect(type(view, ' ')).toBe(true);
    expect(view.state.doc.textContent).toBe('Visit https://www.mnemo.one/ ');
    expect(hrefs(view)).toEqual(['https://www.mnemo.one/']);
  });

  it('links an email address as mailto', () => {
    const view = mount('Write to hello@mnemo.one');

    expect(type(view, ' ')).toBe(true);
    expect(hrefs(view)).toEqual(['mailto:hello@mnemo.one']);
  });

  it('keeps sentence punctuation outside the link', () => {
    const view = mount('Visit https://www.mnemo.one/.');

    expect(type(view, ' ')).toBe(true);
    const anchor = view.dom.querySelector('a');
    expect(anchor?.textContent).toBe('https://www.mnemo.one/');
    expect(view.state.doc.textContent).toBe('Visit https://www.mnemo.one/. ');
  });

  it('links before Enter without claiming the structural key', () => {
    const view = mount('https://www.mnemo.one/');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    const owner = plugin(view);
    expect(owner.props.handleKeyDown?.call(owner, view, event)).toBe(false);
    expect(hrefs(view)).toEqual(['https://www.mnemo.one/']);
  });

  it('respects an explicitly suppressed URL', () => {
    const view = mount('https://www.mnemo.one/', { suppressAutoLink: true });

    expect(type(view, ' ')).toBe(false);
    expect(hrefs(view)).toEqual([]);
  });

  it('does not link URL-shaped inline code', () => {
    const view = mount('https://www.mnemo.one/', { code: true });

    expect(type(view, ' ')).toBe(false);
    expect(hrefs(view)).toEqual([]);
  });
});

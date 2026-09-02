// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

import { createEditorSchema } from '../editor/schema';
import { blockIdentityPlugin } from '../editor/pipeline/block-identity';
import { blockSelectionKey, blockSelectionPlugin } from '../selection/block-selection-plugin';
import { clipboardPlugin } from './clipboard-plugin';
import { clearStashedSlice, readStashedSlice } from './internal-buffer';
import { silentPasteProgress, type PasteProgressReporter } from './paste-progress';
import type { PasteAssetSupport } from './stage-assets';
import { MNEMO_CLIPBOARD_MIME, MNEMO_NONCE_ATTR } from './write-clipboard';

const { schema, registry, inline } = createEditorSchema();
const plugin = clipboardPlugin(registry, inline);

const line = (text?: string) => schema.nodes.line.create(null, text ? schema.text(text) : null);
const para = (text: string, sid: string) => schema.nodes.paragraph.create({ sid, id: sid }, line(text));
const docOf = (...blocks: PMNode[]) => schema.nodes.doc.create(null, blocks);

const views: EditorView[] = [];

function mount(doc: PMNode, sids?: readonly string[]): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({ schema, doc, plugins: [blockSelectionPlugin(registry), plugin] }),
  });
  views.push(view);
  if (sids && sids.length > 0) {
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(sids), anchorSid: sids[0] },
      }),
    );
  }
  return view;
}

function fakeClipboard(): DataTransfer & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    setData: (type: string, data: string) => store.set(type, data),
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer & { store: Map<string, string> };
}

function fire(view: EditorView, kind: 'copy' | 'cut'): { data: DataTransfer & { store: Map<string, string> }; prevented: boolean; handled: boolean } {
  const data = fakeClipboard();
  let prevented = false;
  const event = { clipboardData: data, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
  const handler = plugin.props.handleDOMEvents![kind]!;
  const handled = Boolean((handler as (this: Plugin, v: EditorView, e: ClipboardEvent) => boolean).call(plugin, view, event));
  return { data, prevented, handled };
}

/** Mounts with the identity plugin too, so a paste mints fresh sids like the real editor. */
function mountFull(doc: PMNode): EditorView {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const view = new EditorView(el, {
    state: EditorState.create({
      schema,
      doc,
      plugins: [blockIdentityPlugin(registry), blockSelectionPlugin(registry), plugin],
    }),
  });
  views.push(view);
  return view;
}

function firePaste(view: EditorView, data: DataTransfer): boolean {
  const event = { clipboardData: data, preventDefault: () => {} } as unknown as ClipboardEvent;
  const handler = plugin.props.handlePaste!;
  return Boolean((handler as (this: Plugin, v: EditorView, e: ClipboardEvent) => boolean).call(plugin, view, event));
}

/** Every top-level paragraph reading `text`, paired with its sid. */
function paragraphsReading(view: EditorView, text: string): { sid: string; id: string }[] {
  const out: { sid: string; id: string }[] = [];
  view.state.doc.forEach((node) => {
    if (node.type.name === 'paragraph' && node.textContent === text) {
      out.push({ sid: String(node.attrs.sid), id: String(node.attrs.id) });
    }
  });
  return out;
}

/** Every link mark's href in the document, in order. */
function hrefsIn(view: EditorView): string[] {
  const out: string[] = [];
  view.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === 'link') out.push(String(mark.attrs.href));
    }
    return true;
  });
  return out;
}

const nonceOf = (html: string): string | undefined =>
  new RegExp(`${MNEMO_NONCE_ATTR}="([^"]+)"`).exec(html)?.[1];

describe('clipboardPlugin copy/cut', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  it('writes three fidelity tiers and stashes the exact slice under the nonce', () => {
    const view = mount(docOf(para('one', 's1'), para('two', 's2')), ['s1']);
    const { data, prevented, handled } = fire(view, 'copy');

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    const html = data.getData('text/html');
    expect(html).toContain(MNEMO_NONCE_ATTR);
    expect(data.getData('text/plain')).toBe('one');
    // The private MIME carries the exact slice as JSON, keyed by the same nonce.
    const nonce = nonceOf(html);
    expect(nonce).toBeTruthy();
    const payload = JSON.parse(data.getData(MNEMO_CLIPBOARD_MIME));
    expect(payload.nonce).toBe(nonce);
    expect(payload.mode).toBe('blocks');
    expect(payload.slice).toBeTruthy();

    const stashed = readStashedSlice(nonce!);
    expect(stashed?.mode).toBe('blocks');
    expect(stashed?.slice.content.child(0).attrs.sid).toBe('s1');
  });

  it('copies dispatches no document change', () => {
    const view = mount(docOf(para('one', 's1')), ['s1']);
    const before = view.state.doc;
    fire(view, 'copy');
    expect(view.state.doc).toBe(before);
  });

  it('cut writes the payload and then deletes the selected block as one step', () => {
    const view = mount(docOf(para('one', 's1'), para('two', 's2')), ['s1']);
    const { data, handled } = fire(view, 'cut');

    expect(handled).toBe(true);
    expect(data.getData('text/plain')).toBe('one');
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.child(0).attrs.sid).toBe('s2');
  });

  it('declines when there is nothing to copy', () => {
    const view = mount(docOf(para('', 's1')));
    const { handled, prevented } = fire(view, 'copy');
    expect(handled).toBe(false);
    expect(prevented).toBe(false);
  });
});

describe('clipboardPlugin paste', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  it('pastes a copied block back with a fresh, minted identity', () => {
    const view = mountFull(docOf(para('one', 's1'), para('two', 's2')));

    // Copy the first block, then drop the caret at the end and paste.
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(['s1']), anchorSid: 's1' },
      }),
    );
    const { data } = fire(view, 'copy');
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePaste(view, data)).toBe(true);

    const ones = paragraphsReading(view, 'one');
    expect(ones).toHaveLength(2); // the original and the pasted copy
    const original = ones.find((b) => b.sid === 's1');
    const pasted = ones.find((b) => b.sid !== 's1');
    expect(original).toBeTruthy();
    // The copy was reidentified: the identity plugin minted a fresh, non-empty sid.
    expect(pasted?.sid).toBeTruthy();
    expect(pasted?.sid).not.toBe('s1');
    expect(pasted?.id).toBeTruthy();
    expect(pasted?.id).not.toBe('s1');
  });

  it('replaces an active block selection with the pasted run instead of inserting beside it', () => {
    const view = mountFull(docOf(para('one', 's1'), para('two', 's2'), para('three', 's3')));

    // Copy block one.
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(['s1']), anchorSid: 's1' },
      }),
    );
    const { data } = fire(view, 'copy');

    // Select block two, then paste over it: "two" is replaced, not appended beside.
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(['s2']), anchorSid: 's2' },
      }),
    );
    expect(firePaste(view, data)).toBe(true);

    const out: string[] = [];
    view.state.doc.forEach((node) => out.push(node.textContent));
    expect(out).toEqual(['one', 'one', 'three']);
  });

  it('rebuilds from our trusted HTML when the session buffer is gone', () => {
    const view = mountFull(docOf(para('one', 's1'), para('two', 's2')));
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(['s1']), anchorSid: 's1' },
      }),
    );
    const { data } = fire(view, 'copy');
    // Simulate a copy that outlived its run: the nonce is on the clipboard, the
    // stashed slice is gone, so paste must reconstruct from the HTML.
    clearStashedSlice();
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePaste(view, data)).toBe(true);

    const ones = paragraphsReading(view, 'one');
    expect(ones).toHaveLength(2);
    const pasted = ones.find((b) => b.sid !== 's1');
    expect(pasted?.sid).toBeTruthy();
    expect(pasted?.sid).not.toBe('s1');
  });
});

describe('clipboardPlugin external paste', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  it('sanitises and inserts foreign HTML, dropping script and image', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    const foreign = fakeClipboard();
    foreign.setData('text/html', '<p>pasted</p><script>alert(1)</script><img src="http://t/x.png">');
    foreign.setData('text/plain', 'pasted');

    expect(firePaste(view, foreign)).toBe(true);
    const text = view.state.doc.textContent;
    expect(text).toContain('pasted');
    expect(text).not.toContain('alert');
    // No image node made it in from the remote <img>.
    let images = 0;
    view.state.doc.descendants((node) => {
      if (node.type.name === 'image') images += 1;
      return true;
    });
    expect(images).toBe(0);
  });

  it('claims an over-large HTML paste and degrades to its plain text', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    const foreign = fakeClipboard();
    foreign.setData('text/html', `<p>${'a'.repeat(2_100_000)}</p>`);
    foreign.setData('text/plain', 'plain fallback');

    expect(firePaste(view, foreign)).toBe(true);
    expect(view.state.doc.textContent).toContain('plain fallback');
  });

  it('prefers structured markdown on text/plain over an editor\'s trivially wrapped HTML', () => {
    const view = mountFull(docOf(para('', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    // A markdown editor puts the literal syntax on both surfaces: the HTML just
    // wraps it in a <p>. The markdown reading wins, so it becomes real blocks
    // rather than a paragraph of verbatim "# Heading - one - two".
    const clip = fakeClipboard();
    clip.setData('text/plain', '# Heading\n- one\n- two');
    clip.setData('text/html', '<p># Heading\n- one\n- two</p>');

    expect(firePaste(view, clip)).toBe(true);
    const types: string[] = [];
    view.state.doc.forEach((node) => types.push(node.type.name));
    expect(types).toEqual(['heading', 'bulletItem', 'bulletItem']);
  });

  it('keeps semantic HTML when the plain text carries no markdown structure', () => {
    const view = mountFull(docOf(para('', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    // A web page: the plain text is just the rendered words, no markdown syntax,
    // so the real <h1> is respected rather than the plain text winning.
    const clip = fakeClipboard();
    clip.setData('text/plain', 'Real Heading');
    clip.setData('text/html', '<h1>Real Heading</h1>');

    expect(firePaste(view, clip)).toBe(true);
    expect(view.state.doc.child(0).type.name).toBe('heading');
    expect(view.state.doc.child(0).textContent).toBe('Real Heading');
  });

  it('keeps rich HTML when a line of its rendered text merely reads like markdown', () => {
    const view = mountFull(docOf(para('', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    // A numbered step on a docs page: the rendered text carries the literal "1. ",
    // which is no reason to throw away the page's heading and its link.
    const clip = fakeClipboard();
    clip.setData('text/plain', 'Setup\n1. Install the CLI first.');
    clip.setData('text/html', '<h1>Setup</h1><p>1. Install the <a href="https://cli.test">CLI</a> first.</p>');

    expect(firePaste(view, clip)).toBe(true);
    const types: string[] = [];
    view.state.doc.forEach((node) => types.push(node.type.name));
    expect(types).toContain('heading');
    expect(hrefsIn(view)).toEqual(['https://cli.test']);
  });

  it('keeps the links of a list whose plain text carries its own numbering', () => {
    const view = mountFull(docOf(para('', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    const clip = fakeClipboard();
    clip.setData('text/plain', '1. First\n2. Second');
    clip.setData(
      'text/html',
      '<ol><li><a href="https://one.test">First</a></li><li><a href="https://two.test">Second</a></li></ol>',
    );

    expect(firePaste(view, clip)).toBe(true);
    expect(view.state.doc.textContent).toContain('First');
    expect(hrefsIn(view)).toEqual(['https://one.test', 'https://two.test']);
  });
});

describe('clipboardPlugin plain-text markdown paste', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  /** A clipboard carrying only plain text, the OS paste with no HTML or private MIME. */
  function plainText(text: string): DataTransfer {
    const data = fakeClipboard();
    data.setData('text/plain', text);
    return data;
  }

  const blockTypes = (view: EditorView): string[] => {
    const out: string[] = [];
    view.state.doc.forEach((node) => out.push(node.type.name));
    return out;
  };

  const markNames = (view: EditorView): string[] => {
    const out: string[] = [];
    view.state.doc.descendants((node) => {
      for (const mark of node.marks) out.push(mark.type.name);
      return true;
    });
    return out;
  };

  it('folds a single plain line into the current line at the caret', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePaste(view, plainText('world'))).toBe(true);
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.textContent).toBe('startworld');
  });

  it('interprets inline markdown while merging one line', () => {
    const view = mountFull(docOf(para('start ', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePaste(view, plainText('**bold**'))).toBe(true);
    expect(view.state.doc.textContent).toBe('start bold');
    expect(markNames(view)).toContain('strong');
  });

  it('turns a multi-block markdown document into real blocks with minted ids', () => {
    const view = mountFull(docOf(para('', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePaste(view, plainText('# Heading\n- one\n- two'))).toBe(true);
    expect(blockTypes(view)).toEqual(['heading', 'bulletItem', 'bulletItem']);
    view.state.doc.forEach((node) => {
      expect(String(node.attrs.sid)).not.toBe('');
      expect(String(node.attrs.id)).not.toBe('');
    });
  });

  it('reads a fenced code block from pasted text', () => {
    const view = mountFull(docOf(para('', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePaste(view, plainText('```ts\nconst x = 1;\n```'))).toBe(true);
    expect(blockTypes(view)).toEqual(['codeBlock']);
    const code = view.state.doc.child(0);
    expect(code.attrs.language).toBe('ts');
    expect(code.textContent).toBe('const x = 1;');
  });

  it('keeps a paste inside a code line literal, not re-parsed as markdown', () => {
    const codeBlock = schema.nodes.codeBlock.create(
      { sid: 'c', id: 'c', language: 'js' },
      schema.nodes.codeLine.create(null, schema.text('hi')),
    );
    const view = mountFull(docOf(codeBlock));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    // A fence pasted into code must stay text, never open a nested code block.
    expect(firePaste(view, plainText('```md'))).toBe(true);
    expect(blockTypes(view)).toEqual(['codeBlock']);
    expect(view.state.doc.child(0).textContent).toContain('```md');
  });

  it('strips an unsafe link but keeps a safe one on the plain-text path', () => {
    const unsafe = mountFull(docOf(para('', 's1')));
    unsafe.dispatch(unsafe.state.tr.setSelection(Selection.atEnd(unsafe.state.doc)));
    expect(firePaste(unsafe, plainText('[click](javascript:alert(1))'))).toBe(true);
    expect(unsafe.state.doc.textContent).toContain('click');
    expect(markNames(unsafe)).not.toContain('link');

    const safe = mountFull(docOf(para('', 's2')));
    safe.dispatch(safe.state.tr.setSelection(Selection.atEnd(safe.state.doc)));
    expect(firePaste(safe, plainText('[ok](https://ok.test)'))).toBe(true);
    const hrefs: string[] = [];
    safe.state.doc.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === 'link') hrefs.push(String(mark.attrs.href));
      return true;
    });
    expect(hrefs).toEqual(['https://ok.test']);
  });

  it('leaves genuinely empty text to the editor default', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
    expect(firePaste(view, plainText('   '))).toBe(false);
  });
});

describe('clipboardPlugin paste hardening', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  /** The JSON a hostile page would put under the private MIME, with a link mark href. */
  function craftedPayload(href: string): string {
    const mark = schema.marks.link.create({ href });
    const block = schema.nodes.paragraph.create(
      { sid: 'a', id: 'a' },
      schema.nodes.line.create(null, schema.text('click me', [mark])),
    );
    const slice = new Slice(Fragment.fromArray([block]), 0, 0);
    return JSON.stringify({ v: 1, nonce: 'attacker', mode: 'blocks', slice: slice.toJSON() });
  }


  it('strips a javascript: link carried in a crafted private-MIME payload', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    const hostile = fakeClipboard();
    hostile.setData(MNEMO_CLIPBOARD_MIME, craftedPayload('javascript:alert(document.cookie)'));

    expect(firePaste(view, hostile)).toBe(true);
    // The text lands, but no link mark (and certainly no javascript: href) with it.
    expect(view.state.doc.textContent).toContain('click me');
    expect(hrefsIn(view)).toEqual([]);
  });

  it('keeps a safe link from a private-MIME payload', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    const clip = fakeClipboard();
    clip.setData(MNEMO_CLIPBOARD_MIME, craftedPayload('https://ok.test'));

    expect(firePaste(view, clip)).toBe(true);
    expect(hrefsIn(view)).toEqual(['https://ok.test']);
  });

  it('does not throw on a malformed private-MIME payload; it degrades to the sanitised HTML', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    const hostile = fakeClipboard();
    // A well-formed envelope whose slice references a node type that does not
    // exist: Slice.fromJSON throws, and handlePaste must not.
    hostile.setData(
      MNEMO_CLIPBOARD_MIME,
      JSON.stringify({ v: 1, nonce: 'attacker', mode: 'blocks', slice: { openStart: 0, openEnd: 0, content: [{ type: 'nope' }] } }),
    );
    hostile.setData('text/html', '<p>fallback</p>');

    expect(() => firePaste(view, hostile)).not.toThrow();
    expect(view.state.doc.textContent).toContain('fallback');
  });

  it('rejects an out-of-range open-depth payload without throwing, degrading to HTML', () => {
    const view = mountFull(docOf(para('start', 's1')));
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    const hostile = fakeClipboard();
    // Deserializes fine, but throws only when placed (replaceSelection descends
    // 99 non-existent open levels): the placement guard must catch it and fall
    // through to the sanitised HTML rather than let handlePaste throw.
    hostile.setData(
      MNEMO_CLIPBOARD_MIME,
      JSON.stringify({ v: 1, nonce: 'attacker', mode: 'text', slice: { openStart: 99, openEnd: 99, content: [{ type: 'text', text: 'a' }] } }),
    );
    hostile.setData('text/html', '<p>recovered</p>');

    let handled: boolean | undefined;
    expect(() => { handled = firePaste(view, hostile); }).not.toThrow();
    expect(handled).toBe(true);
    expect(view.state.doc.textContent).toContain('recovered');
  });
});

describe('clipboardPlugin paste image staging', () => {
  beforeEach(() => clearStashedSlice());
  afterEach(() => {
    for (const view of views.splice(0)) view.destroy();
    document.body.innerHTML = '';
  });

  /** A support that restages any non-remote reference, capturing what it uploads. */
  function stagingSupport(overrides: Partial<PasteAssetSupport> = {}): PasteAssetSupport {
    return {
      canStage: (path) => !path.startsWith('http'),
      loadBytes: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
      upload: (file) => Promise.resolve(`staged-${file.name}`),
      ...overrides,
    };
  }

  function mountStaging(
    doc: PMNode,
    support: PasteAssetSupport,
    progress: PasteProgressReporter = silentPasteProgress,
  ): { view: EditorView; plugin: Plugin } {
    const staging = clipboardPlugin(registry, inline, support, progress);
    const el = document.createElement('div');
    document.body.appendChild(el);
    const view = new EditorView(el, {
      state: EditorState.create({
        schema,
        doc,
        plugins: [blockIdentityPlugin(registry), blockSelectionPlugin(registry), staging],
      }),
    });
    views.push(view);
    return { view, plugin: staging };
  }

  function firePasteOn(view: EditorView, staging: Plugin, data: DataTransfer): boolean {
    const event = { clipboardData: data, preventDefault: () => {} } as unknown as ClipboardEvent;
    const handler = staging.props.handlePaste!;
    return Boolean((handler as (this: Plugin, v: EditorView, e: ClipboardEvent) => boolean).call(staging, view, event));
  }

  function markdownImage(text: string): DataTransfer {
    const data = fakeClipboard();
    data.setData('text/plain', text);
    return data;
  }

  const imagePaths = (view: EditorView): string[] => {
    const out: string[] = [];
    view.state.doc.descendants((node) => {
      if (node.type.name === 'image') out.push(String(node.attrs.path));
      return true;
    });
    return out;
  };

  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('restages a pasted markdown image to a fresh id before inserting it', async () => {
    const { view, plugin: staging } = mountStaging(docOf(para('', 's1')), stagingSupport());
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePasteOn(view, staging, markdownImage('![cap](old.png)'))).toBe(true);
    // The image is not in yet: staging is asynchronous, so it claims first.
    expect(imagePaths(view)).toEqual([]);

    await flush();
    expect(imagePaths(view)).toEqual(['staged-image.png']);
  });

  it('keeps the original reference when the re-upload fails', async () => {
    const support = stagingSupport({ upload: () => Promise.reject(new Error('too large')) });
    const { view, plugin: staging } = mountStaging(docOf(para('', 's1')), support);
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePasteOn(view, staging, markdownImage('![cap](old.png)'))).toBe(true);
    await flush();
    expect(imagePaths(view)).toEqual(['old.png']);
  });

  it('inserts nothing when the paste is cancelled mid-stage', async () => {
    let cancel = () => {};
    const progress: PasteProgressReporter = {
      begin: (_total, onCancel) => {
        cancel = onCancel;
      },
      advance: () => {},
      end: () => {},
    };
    // The first upload cancels the paste; the batch aborts before the second image
    // and the run is never inserted.
    const support = stagingSupport({
      upload: (file) => {
        cancel();
        return Promise.resolve(`staged-${file.name}`);
      },
    });
    const { view, plugin: staging } = mountStaging(docOf(para('', 's1')), support, progress);
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePasteOn(view, staging, markdownImage('![a](one.png)\n![b](two.png)'))).toBe(true);
    await flush();
    expect(imagePaths(view)).toEqual([]);
    expect(view.state.doc.childCount).toBe(1); // the original empty paragraph only
  });

  it('leaves a remote image reference unstaged and synchronous', () => {
    // A reference the app cannot fetch is not restaged, so the paste stays on the
    // synchronous path and the reference is inserted verbatim.
    const { view, plugin: staging } = mountStaging(docOf(para('', 's1')), stagingSupport());
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePasteOn(view, staging, markdownImage('![cap](http://remote/x.png)'))).toBe(true);
    expect(imagePaths(view)).toEqual(['http://remote/x.png']);
  });

  it('restages an image block copied inside the app, so the copy owns its own asset', async () => {
    const imageBlock = schema.nodes.image.create({ path: 'orig.png', sid: 'i1', id: 'i1' }, line('cap'));
    const { view, plugin: staging } = mountStaging(docOf(imageBlock, para('after', 's2')), stagingSupport());

    // Select the image block and copy it through this plugin, then paste at the end.
    view.dispatch(
      view.state.tr.setMeta(blockSelectionKey, {
        type: 'set',
        selection: { selected: new Set(['i1']), anchorSid: 'i1' },
      }),
    );
    const data = fakeClipboard();
    const copyEvent = { clipboardData: data, preventDefault: () => {} } as unknown as ClipboardEvent;
    (staging.props.handleDOMEvents!.copy as (this: Plugin, v: EditorView, e: ClipboardEvent) => boolean).call(
      staging,
      view,
      copyEvent,
    );
    view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));

    expect(firePasteOn(view, staging, data)).toBe(true);
    await flush();

    const paths = imagePaths(view);
    expect(paths).toContain('orig.png'); // the original stays put
    expect(paths).toContain('staged-image.png'); // the paste got its own fresh copy
    expect(paths).toHaveLength(2);
  });
});

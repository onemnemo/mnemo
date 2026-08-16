/**
 * Restaging pasted images: each pasted image gets its own fresh copy of the bytes
 * it references, so the paste owns its assets rather than borrowing the source's.
 *
 * A copied image block carries a reference to a stored asset, not the pixels. Pasting
 * it as-is would leave two blocks pointing at one file, so deleting or replacing one
 * image, or the note it came from, could pull the bytes out from under the other. The
 * desktop copies each pasted image into a new file; here each is re-uploaded to a
 * fresh managed id and its `path` is rewritten before the block is inserted.
 *
 * Only references this app can actually fetch are staged. A pasted `![](http://…)`,
 * a data URI or a broken path is left exactly as written, to resolve or degrade to a
 * placeholder the way it would have anyway. Staging is best effort per image: an
 * upload that fails leaves the original reference, matching the desktop; only a user
 * cancel abandons the whole paste, before anything is inserted.
 */

import { Fragment } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';

import type { EditorServices } from '../editor/registry/types';
import { loadNoteAssetBlob, noteAssetRequestPath } from '../assets/api';

/**
 * The reference-loading and uploading the clipboard needs, injected rather than
 * imported so the paste path is testable without a network.
 */
export interface PasteAssetSupport {
  /** True for a reference whose bytes this app can fetch and therefore restage. */
  canStage(path: string): boolean;
  /** Fetches a stored reference's raw bytes. */
  loadBytes(path: string, signal: AbortSignal): Promise<Blob>;
  /** Uploads bytes as a new managed asset and resolves to its stored reference. */
  upload(file: File): Promise<string>;
}

/** The real support, built over the editor's services and the note asset API. */
export function defaultPasteAssetSupport(services: EditorServices): PasteAssetSupport {
  return {
    canStage: (path) => noteAssetRequestPath(path) !== null,
    loadBytes: (path, signal) => loadNoteAssetBlob(path, signal),
    upload: (file) => services.uploadAsset(file),
  };
}

/**
 * The distinct, restageable image references in a fragment, in first-seen order.
 *
 * Returns nothing without support: a plugin built for a context that cannot upload
 * (a test, a read-only mount) simply pastes references unchanged rather than failing.
 */
export function collectStageablePaths(
  content: Fragment,
  support: PasteAssetSupport | undefined,
): string[] {
  if (!support) return [];
  const seen = new Set<string>();
  content.descendants((node) => {
    if (node.type.name !== 'image') return true;
    const path = String(node.attrs.path ?? '');
    if (path !== '' && support.canStage(path)) seen.add(path);
    return true;
  });
  return [...seen];
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

/**
 * A filename whose extension matches the fetched bytes.
 *
 * The upload endpoint reads the stored extension from the filename and rejects an
 * image whose bytes do not match it, so the content type of what we fetched is the
 * authority; the reference's own extension is only the fallback.
 */
function uploadFileName(path: string, blobType: string): string {
  const fromMime = MIME_EXTENSIONS[blobType];
  if (fromMime) return `image${fromMime}`;
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
  return `image${/^\.[a-z0-9]+$/.test(ext) ? ext : '.png'}`;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function aborted(): DOMException {
  return new DOMException('Paste cancelled', 'AbortError');
}

/**
 * Re-uploads each reference to a fresh managed id, returning old-path to new-id.
 *
 * Sequential, so progress advances one image at a time and a cancel is seen between
 * uploads rather than only at the end. A single image failing to load or upload is
 * swallowed, its path simply absent from the map so the caller keeps the original;
 * an abort rejects the whole batch so nothing is inserted.
 */
export async function stageImageAssets(
  paths: readonly string[],
  support: PasteAssetSupport,
  signal: AbortSignal,
  onStaged?: (done: number) => void,
): Promise<Map<string, string>> {
  const staged = new Map<string, string>();
  let done = 0;
  for (const path of paths) {
    if (signal.aborted) throw aborted();
    try {
      const blob = await support.loadBytes(path, signal);
      if (signal.aborted) throw aborted();
      const file = new File([blob], uploadFileName(path, blob.type), { type: blob.type || 'image/png' });
      const newId = await support.upload(file);
      if (signal.aborted) throw aborted();
      if (newId) staged.set(path, newId);
    } catch (err) {
      if (isAbort(err)) throw err;
      // A single image that will not stage keeps its original reference.
    }
    onStaged?.(++done);
  }
  return staged;
}

/** Rebuilds a fragment with every staged image's `path` swapped for its new id. */
export function remapImagePaths(content: Fragment, staged: Map<string, string>): Fragment {
  if (staged.size === 0) return content;
  return mapFragment(content, staged);
}

function mapFragment(fragment: Fragment, staged: Map<string, string>): Fragment {
  const mapped: PMNode[] = [];
  fragment.forEach((node) => mapped.push(mapNode(node, staged)));
  return Fragment.fromArray(mapped);
}

function mapNode(node: PMNode, staged: Map<string, string>): PMNode {
  const children = node.content.size > 0 ? mapFragment(node.content, staged) : node.content;
  if (node.type.name === 'image') {
    const next = staged.get(String(node.attrs.path ?? ''));
    if (next) return node.type.create({ ...node.attrs, path: next }, children, node.marks);
  }
  return children === node.content ? node : node.copy(children);
}

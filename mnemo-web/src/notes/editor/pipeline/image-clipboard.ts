/**
 * Turns image files pasted or dropped into the editor into image blocks.
 *
 * This is the port of the desktop's OS-clipboard and drag-drop image paths: a screenshot
 * paste, a file copied from the file manager, a file dragged out of a folder. The bytes are
 * uploaded first and the blocks inserted only when storage has them, so the document never
 * references an asset that does not exist; a failed upload inserts nothing. Every file in
 * one gesture lands in one transaction, one undo step.
 *
 * Files win over any accompanying HTML on purpose. Copying an image in a browser puts both
 * a bitmap and an `<img src="http…">` fragment on the clipboard; the fragment would paste a
 * hotlink to a remote server, the bitmap becomes a local asset like the desktop makes.
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorServices } from '../registry/types';
import { asOwnUndoStep } from '../history';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']);

function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((file) => IMAGE_TYPES.has(file.type));
}

/** The gap after the top-level block containing `pos`, where a new block can sit. */
function topLevelBoundaryAfter(doc: PMNode, pos: number): number {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  return $pos.depth === 0 ? clamped : $pos.after(1);
}

function insertUploaded(view: EditorView, assetIds: readonly string[], requestedPos: number): void {
  const { image, line } = view.state.schema.nodes;
  if (!image || !line) return;

  // The document may have moved on while the upload ran; the boundary is computed
  // against what it says now, clamped rather than trusted.
  const boundary = topLevelBoundaryAfter(view.state.doc, requestedPos);
  const nodes = assetIds.map((assetId) => image.create({ path: assetId }, line.create()));

  const tr = view.state.tr.insert(boundary, nodes);
  // Into the last image's caption, so typing right after a paste labels it.
  const size = nodes.reduce((sum, node) => sum + node.nodeSize, 0);
  tr.setSelection(TextSelection.near(tr.doc.resolve(boundary + size - 1), -1));
  view.dispatch(asOwnUndoStep(tr).scrollIntoView());
}

function uploadAndInsert(
  view: EditorView,
  services: EditorServices,
  files: readonly File[],
  requestedPos: number,
): void {
  // Failed uploads drop out individually: five screenshots where one exceeds the size
  // limit should still paste four blocks.
  void Promise.all(files.map((file) => services.uploadAsset(file).catch(() => null))).then(
    (results) => {
      const assetIds = results.filter((id): id is string => id !== null);
      if (assetIds.length === 0 || view.isDestroyed) return;
      insertUploaded(view, assetIds, requestedPos);
    },
  );
}

/**
 * Claims pastes and drops that carry image files; everything else falls through to the
 * editor's normal content handling.
 */
export function imageClipboardPlugin(services: EditorServices): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const files = imageFiles(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        uploadAndInsert(view, services, files, view.state.selection.head);
        return true;
      },
      handleDrop(view, event) {
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const drop = view.posAtCoords({ left: event.clientX, top: event.clientY });
        uploadAndInsert(view, services, files, drop?.pos ?? view.state.selection.head);
        return true;
      },
    },
  });
}

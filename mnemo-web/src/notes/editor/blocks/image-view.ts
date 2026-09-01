/**
 * The image block's renderer: an empty block is a card that opens the file picker, a filled
 * one shows its bytes with resize and alignment chrome, and the caption line stays editable
 * ProseMirror content below the media.
 *
 * ## The media is view-owned, the caption is not
 *
 * Everything above the caption, the placeholder card, the `<img>`, the resize pill, the
 * alignment buttons, is DOM this view draws and mutates outside transactions (a resize drag
 * previews by writing the img's width style). `ignoreMutation` claims all of it; only the
 * caption, the node's mandatory line handed to ProseMirror as `contentDOM`, is editor
 * content. This is the same split the checklist view draws around its checkbox.
 *
 * ## The `path` attr is a reference, the bytes come from the services
 *
 * `loadAssetUrl` resolves managed uploads, desktop-era absolute paths and legacy
 * `attachment:` references alike; anything unresolvable renders as a labeled missing-image
 * card that keeps the stored reference in the document untouched, and offers a relink. A
 * failed reference is never silently rewritten, the file might reappear (a restored backup,
 * a synced profile) and the reference must still name it.
 *
 * ## One undo step per gesture
 *
 * Choosing a file, releasing a resize drag, and clicking an alignment each commit a single
 * `setNodeMarkup` wrapped as its own undo step, the desktop's Begin/Commit bracket.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import type { ImageCrop } from '../../../components/ui/image-editor/geometry';
import { readCrop } from '../../model/image-crop';
import { asOwnUndoStep } from '../history';
import { lineText } from './shared';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';

const ROOT = 'notes-image';

/** The desktop's resize clamp: never below a usable hit target, never past its hard cap. */
const MIN_WIDTH = 80;
const MAX_WIDTH_CAP = 1600;

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
}

function pathOf(node: PMNode): string {
  return String(node.attrs.path ?? '');
}

function widthOf(node: PMNode): number {
  return Number(node.attrs.width) || 0;
}

function alignOf(node: PMNode): string {
  const align = String(node.attrs.align ?? 'left');
  return align === 'center' || align === 'right' ? align : 'left';
}

function cropOf(node: PMNode): ImageCrop | null {
  return readCrop(node.attrs.crop);
}

/** Whether the media has to be rebuilt, which only a different window calls for. */
function sameCrop(a: ImageCrop | null, b: ImageCrop | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.aspect === b.aspect;
}

/**
 * The stored window drawn without measuring anything.
 *
 * The frame reserves the shape from `aspect`, and scaling the source to 100/w by
 * 100/h percent of it distorts by exactly nothing, because the window always
 * matches the frame it was cut for. No natural size, no load event, no reflow when
 * the bytes land. This is the React renderer's math in the vanilla DOM this view
 * owns; the two are deliberately separate because a NodeView cannot mount a
 * component for something this small.
 */
function applyCropLayout(img: HTMLImageElement, crop: ImageCrop): void {
  img.style.width = `${String(100 / crop.w)}%`;
  img.style.height = `${String(100 / crop.h)}%`;
  img.style.left = `${String((-crop.x * 100) / crop.w)}%`;
  img.style.top = `${String((-crop.y * 100) / crop.h)}%`;
}

/** The filename a human can recognize inside any of the reference shapes. */
function displayNameOf(path: string): string {
  if (path.startsWith('attachment:')) {
    const name = path.split(':')[2];
    if (name) return name;
  }
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

function svgIcon(paths: readonly string[], viewBox: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  }
  return svg;
}

/** A picture-in-a-frame glyph for the placeholder and missing cards. */
function imageIcon(): SVGSVGElement {
  return svgIcon(
    [
      'M2 3.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z',
      'M1 12l4.2-4.2a1 1 0 0 1 1.4 0L11 12.2l2.3-2.3a1 1 0 0 1 1.4 0L17 12.2',
      'M6.5 7.25a.75.75 0 1 0 0-1.5a.75.75 0 0 0 0 1.5Z',
    ],
    '0 0 18 18',
  );
}

const ALIGN_GLYPHS: Record<string, readonly string[]> = {
  left: ['M1 3.5h12', 'M1 7h8', 'M1 10.5h12'],
  center: ['M1 3.5h12', 'M3 7h8', 'M1 10.5h12'],
  right: ['M1 3.5h12', 'M5 7h8', 'M1 10.5h12'],
};

export function imageView(args: RealizedBlockViewArgs<Record<string, unknown>>): RealizedBlockView {
  const { view, services } = args;

  const dom = document.createElement('figure');
  dom.className = ROOT;

  const media = document.createElement('div');
  media.className = `${ROOT}-media`;
  media.setAttribute('contenteditable', 'false');
  dom.appendChild(media);

  const caption = document.createElement('div');
  caption.className = `${ROOT}-caption`;
  // The hint rides a data attribute so the CSS can draw it only while the line is empty;
  // read-only notes get no hint, an empty caption there is simply absent.
  if (view.editable) caption.dataset.placeholder = translate('ImageCaptionPlaceholder');
  dom.appendChild(caption);

  // What the media area shows right now. `path` and `crop` are the doc's say, and the
  // two together decide the media DOM's shape; the rest is runtime.
  let shownPath = pathOf(args.node);
  let shownCrop = cropOf(args.node);
  /** The elements a width write and a resize drag address, while an image is up. */
  let frameEl: HTMLElement | null = null;
  let imgEl: HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  let uploading = false;
  let uploadFailed = false;
  let loadFailed = false;
  let destroyed = false;
  /** Guards a resolved fetch against a path that changed while it was in flight. */
  let loadToken = 0;

  /** The node as it is now, at the live position, not the one captured at build. */
  function liveNode(): { pos: number; node: PMNode } | null {
    const pos = args.getPos();
    if (pos === undefined) return null;
    const node = view.state.doc.nodeAt(pos);
    return node && node.type === args.node.type ? { pos, node } : null;
  }

  function commitAttrs(patch: Record<string, unknown>): void {
    const live = liveNode();
    if (!live) return;
    view.dispatch(
      asOwnUndoStep(view.state.tr.setNodeMarkup(live.pos, undefined, { ...live.node.attrs, ...patch })),
    );
  }

  function openPicker(): void {
    if (!view.editable || uploading) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_TYPES;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) upload(file);
    };
    input.click();
  }

  function upload(file: File): void {
    uploading = true;
    uploadFailed = false;
    renderMedia();
    services.uploadAsset(file).then(
      (assetId) => {
        uploading = false;
        if (destroyed) return;
        // The commit re-renders through update(); a dead position drops the upload,
        // and the sweep collects the file once nothing can redo it into a document.
        commitAttrs({ path: assetId });
        renderMedia();
      },
      () => {
        uploading = false;
        if (destroyed) return;
        uploadFailed = true;
        renderMedia();
      },
    );
  }

  function card(kind: 'placeholder' | 'missing', label: string, detail?: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `${ROOT}-card ${ROOT}-card-${kind}`;
    el.setAttribute('role', 'button');
    el.appendChild(imageIcon());
    const text = document.createElement('span');
    text.className = `${ROOT}-card-label`;
    text.textContent = label;
    el.appendChild(text);
    if (detail) {
      const hint = document.createElement('span');
      hint.className = `${ROOT}-card-detail`;
      hint.textContent = detail;
      el.appendChild(hint);
    }
    el.addEventListener('click', openPicker);
    return el;
  }

  function buildChrome(frame: HTMLElement): void {
    if (!view.editable) return;

    const aligns = document.createElement('div');
    aligns.className = `${ROOT}-aligns`;
    const current = alignOf(currentNode);
    for (const align of ['left', 'center', 'right'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = `${ROOT}-align`;
      button.title = translate(`ImageAlign${align[0].toUpperCase()}${align.slice(1)}Tooltip`);
      if (align === current) button.setAttribute('data-active', 'true');
      button.appendChild(svgIcon(ALIGN_GLYPHS[align], '0 0 14 14'));
      // preventDefault on mousedown keeps the editor's selection where it was.
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => {
        if (alignOf(currentNode) !== align) commitAttrs({ align });
      });
      aligns.appendChild(button);
    }
    frame.appendChild(aligns);

    const pill = document.createElement('div');
    pill.className = `${ROOT}-resize`;
    pill.addEventListener('pointerdown', startResize);
    frame.appendChild(pill);
  }

  /**
   * What a width is written to, which is not always the image.
   *
   * Under a crop the img is an oversized inner layer whose size is dictated by the
   * window, so writing a width to it would move the crop rather than resize the
   * picture. The frame is the box the reader sees, and it is the one that carries
   * the stored width.
   */
  function widthTarget(node: PMNode): HTMLElement | null {
    if (imgEl === null) return null;
    return cropOf(node) !== null ? frameEl : imgEl;
  }

  function startResize(event: PointerEvent): void {
    const target = widthTarget(currentNode);
    if (!target || !view.editable) return;
    event.preventDefault();

    const startWidth = target.getBoundingClientRect().width;
    const startX = event.clientX;
    const maxWidth = Math.min(MAX_WIDTH_CAP, dom.getBoundingClientRect().width || MAX_WIDTH_CAP);
    let lastWidth = startWidth;

    const widthAt = (clientX: number): number =>
      Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + (clientX - startX))));

    const onMove = (move: PointerEvent) => {
      lastWidth = widthAt(move.clientX);
      // Preview only: the model is left alone until release, so nothing re-renders
      // and the drag stays smooth.
      target.style.width = `${lastWidth}px`;
    };
    const stopTracking = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      media.classList.remove('is-resizing');
    };
    // A cancelled pointer commits nothing; the preview goes back to the stored width.
    const onCancel = () => {
      stopTracking();
      applyDimensions(currentNode);
    };
    const onUp = (up: PointerEvent) => {
      stopTracking();
      const finalWidth = widthAt(up.clientX);
      if (Math.abs(finalWidth - startWidth) < 1) return; // a click that never moved
      // One committed step from the pre-drag width to the released one.
      commitAttrs({ width: finalWidth });
    };

    media.classList.add('is-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function applyDimensions(node: PMNode): void {
    const img = imgEl;
    if (!img) return;
    const width = widthOf(node);
    const stored = width > 0 ? `${Math.max(MIN_WIDTH, Math.min(MAX_WIDTH_CAP, width))}px` : null;
    const crop = cropOf(node);

    if (crop !== null && frameEl !== null) {
      frameEl.style.aspectRatio = String(crop.aspect);
      // A cropped image that was never resized takes the column, the same width the
      // PDF export gives it, since a ratio alone cannot produce a height.
      frameEl.style.width = stored ?? '100%';
      applyCropLayout(img, crop);
    } else if (stored !== null) {
      img.style.width = stored;
    } else {
      img.style.removeProperty('width');
    }

    img.alt = lineText(node);
  }

  function renderMedia(): void {
    media.replaceChildren();
    frameEl = null;
    imgEl = null;
    const path = pathOf(currentNode);

    if (uploading) {
      const el = card('placeholder', translate('ImageImporting'));
      el.classList.add('is-busy');
      media.appendChild(el);
      return;
    }
    if (path.length === 0) {
      media.appendChild(
        card('placeholder', translate(uploadFailed ? 'ImageImportFailed' : 'ImagePlaceholder')),
      );
      return;
    }
    if (loadFailed) {
      media.appendChild(
        card(
          'missing',
          translate(view.editable ? 'ImageMissingRelink' : 'ImageMissing'),
          displayNameOf(path),
        ),
      );
      return;
    }
    if (objectUrl === null) {
      // Bytes still in flight; hold the estimated box so the note does not jump when
      // they arrive.
      const skeleton = document.createElement('div');
      skeleton.className = `${ROOT}-loading`;
      media.appendChild(skeleton);
      return;
    }

    // The chrome anchors to the image's own edges, so both ride a frame that hugs it
    // rather than the full-width media row.
    const frame = document.createElement('div');
    frame.className = `${ROOT}-frame`;
    // The clipping box only exists under a crop; without one the frame is the same
    // shrink-to-fit wrapper it has always been and the image draws exactly as before.
    if (cropOf(currentNode) !== null) frame.classList.add('is-cropped');
    const img = document.createElement('img');
    img.src = objectUrl;
    img.draggable = false;
    frame.appendChild(img);
    media.appendChild(frame);
    frameEl = frame;
    imgEl = img;
    applyDimensions(currentNode);
    buildChrome(frame);
  }

  function loadBytes(path: string): void {
    const token = ++loadToken;
    objectUrl = null;
    loadFailed = false;
    if (path.length === 0) {
      renderMedia();
      return;
    }
    renderMedia();
    services.loadAssetUrl(path).then(
      (url) => {
        if (destroyed || token !== loadToken) return;
        objectUrl = url;
        renderMedia();
      },
      () => {
        if (destroyed || token !== loadToken) return;
        loadFailed = true;
        renderMedia();
      },
    );
  }

  // `currentNode` tracks the latest node update() saw, so chrome handlers built once keep
  // reading live attrs instead of the mount-time snapshot.
  let currentNode = args.node;

  function sync(node: PMNode): void {
    currentNode = node;
    dom.setAttribute('data-image', pathOf(node));
    dom.setAttribute('data-align', alignOf(node));
  }

  sync(args.node);
  loadBytes(shownPath);

  return {
    dom,
    contentDOM: caption,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      sync(node);
      const path = pathOf(node);
      const crop = cropOf(node);
      if (path !== shownPath) {
        shownPath = path;
        shownCrop = crop;
        uploadFailed = false;
        loadBytes(path);
      } else if (!sameCrop(crop, shownCrop)) {
        // The crop decides the media's shape, so it is rebuilt. The bytes are
        // already in hand, so nothing is refetched and the rebuild is local.
        shownCrop = crop;
        renderMedia();
      } else {
        applyDimensions(node);
        const active = media.querySelectorAll(`.${ROOT}-align`);
        const align = alignOf(node);
        active.forEach((button, index) => {
          const name = (['left', 'center', 'right'] as const)[index];
          if (name === align) button.setAttribute('data-active', 'true');
          else button.removeAttribute('data-active');
        });
      }
      return true;
    },
    ignoreMutation(mutation) {
      // The caret must keep working in the caption, and edits there must reach the editor.
      if (mutation.type === 'selection') return false;
      if (caption.contains(mutation.target)) return false;
      // Everything else in the figure, the media, its chrome, this view's own attribute
      // writes, is view-owned; without this the resize preview tears the view down mid-drag.
      return true;
    },
    destroy() {
      destroyed = true;
      // Object URLs belong to the session cache, which revokes them together on close.
    },
  };
}

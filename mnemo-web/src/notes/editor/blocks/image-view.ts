/**
 * The image block's renderer: an empty block is a card that opens the file picker, a filled
 * one shows its bytes with a resize pill and the React chrome, and the caption line stays
 * editable ProseMirror content below the media.
 *
 * ## The media is view-owned, the caption is not
 *
 * Everything above the caption, the placeholder card, the `<img>`, the resize pill, the chrome
 * mount, is DOM this view draws and mutates outside transactions (a resize drag previews by
 * writing the img's width style). `ignoreMutation` claims all of it; only the caption, the node's
 * mandatory line handed to ProseMirror as `contentDOM`, is editor content. This is the same split
 * the checklist view draws around its checkbox.
 *
 * ## The caption is always there, and not always showing
 *
 * The line is mandatory in the schema, so an empty caption is clipped rather than removed: zero
 * height, no ink, still measurable and still somewhere the caret can be arrowed into. What
 * reveals it is text, the menu asking for it, or the caret arriving, and the last of those comes
 * from a decoration because a selection change alone never reaches a NodeView.
 *
 * ## A press on the picture is a press on the block
 *
 * Clicking the image selects the block the way the gutter grip does, and holding and moving
 * raises the gutter's own drag through the bridge. The press is not stopped: the right-click
 * menu snapshots the selection at the React root, and it has to see the selection this made. It
 * is also handed the block it landed on, because the coordinate under an opaque picture is not
 * one the editor can resolve a position from.
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
 * Choosing a file, releasing a resize drag, and picking an alignment each commit a single
 * `setNodeMarkup` wrapped as its own undo step, the desktop's Begin/Commit bracket.
 */

import { createElement } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { RealizedBlockView, RealizedBlockViewArgs } from '../registry/types';
import type { ImageCrop } from '../../../components/ui/image-editor/geometry';
import { readCrop } from '../../model/image-crop';
import { getBlockSelection, setBlockSelection } from '../../selection/block-selection-plugin';
import { applyGrip, gripIntent } from '../../selection/grip-selection';
import { asOwnUndoStep } from '../history';
import { pressBlockDrag } from '../chrome/block-drag-bridge';
import { recordImagePress } from '../chrome/image-press';
import { mountPortalNodeView, type PortalNodeView } from '../view/portal-registry';
import { ImageChrome } from './ImageChrome';
import { registerCaptionReveal } from './image-caption-reveal';
import {
  clampImageWidth,
  imageAlignOf,
  imagePathOf,
  imageWidthOf,
  MAX_IMAGE_WIDTH,
  MIN_IMAGE_WIDTH,
} from './image-attrs';
import { lineText } from './shared';
import { useI18nStore } from '../../../i18n/store';
import { createTranslate } from '../../../i18n/translate';

const ROOT = 'notes-image';

const ACCEPTED_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';

/** Reads the active bundle at call time, so it follows a language change. */
function translate(key: string): string {
  return createTranslate(useI18nStore.getState().bundle)('NotesEditor', key);
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
  let shownPath = imagePathOf(args.node);
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
  /** The React pill, mounted once and moved onto whichever frame is live. */
  let chrome: PortalNodeView | null = null;
  /**
   * Whether the menu has asked for the caption line. Presentation, not content, so it is
   * deliberately not stored: a reloaded note starts with its empty captions out of the way.
   */
  let captionOpen = false;
  /** Whether the caret was last seen in this block, so leaving it can put an empty line away. */
  let captionHadCaret = false;
  /** The sid the caption switch is currently lent out under, and how to take it back. */
  let captionSid = '';
  let releaseCaption: (() => void) | null = null;

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

  /** Whether the editor's selection sits inside this block, which is inside its caption line. */
  function caretInside(pos: number, node: PMNode): boolean {
    const selection = view.state.selection;
    return selection.from > pos && selection.to < pos + node.nodeSize;
  }

  /**
   * Read off the live node rather than the last one `update()` saw: the menu asks at a moment of
   * its own choosing, and an edit reaches the document before it reaches this view.
   */
  function captionVisible(): boolean {
    return captionOpen || lineText(liveNode()?.node ?? currentNode).length > 0;
  }

  /**
   * Puts the caption line on or off the page.
   *
   * Text always wins: a caption with something in it is content, and presentation state may not
   * hide content. An empty line the caret has left goes away again, so turning it on and clicking
   * elsewhere is not a way to leave an empty row behind.
   */
  function syncCaption(pos: number, node: PMNode): void {
    const caret = caretInside(pos, node);
    const hasText = lineText(node).length > 0;
    if (captionOpen && captionHadCaret && !caret && !hasText) captionOpen = false;
    captionHadCaret = caret;
    dom.setAttribute('data-caption', captionOpen || hasText ? 'shown' : 'hidden');
  }

  function focusCaption(): void {
    const live = liveNode();
    if (!live) return;
    // Nearest forward text position: the caption's line starts one position further in, and
    // resolving the block's own position would not be a place a caret can be.
    const selection = TextSelection.near(view.state.doc.resolve(live.pos + 1), 1);
    view.dispatch(view.state.tr.setSelection(selection));
    view.focus();
  }

  /** Empties the caption line, as one undo step, so turning the row off is a thing that happens. */
  function clearCaption(): void {
    const live = liveNode();
    if (!live) return;
    const from = live.pos + 2;
    const to = live.pos + live.node.nodeSize - 2;
    if (to <= from) return;
    view.dispatch(asOwnUndoStep(view.state.tr.delete(from, to)));
  }

  function toggleCaption(): void {
    if (captionVisible()) {
      // The row reports what is on screen, so turning it off has to take the text with it, the
      // way the code block's caption does. One undo step puts it back.
      captionOpen = false;
      clearCaption();
    } else {
      captionOpen = true;
      // Turning a caption on and then having to find it is the failure here. A frame later, so
      // the menu that asked has finished closing and handing focus back.
      requestAnimationFrame(focusCaption);
    }
    const live = liveNode();
    if (live) syncCaption(live.pos, live.node);
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

  /**
   * The pill on the picture, as React.
   *
   * Anchored menus are the reason this is a component rather than more imperative DOM beside the
   * rest of the view: a flyout that has to flip near the window edge is not something to hand
   * roll. Absent wherever the editor is mounted without the portal layer or without a registry,
   * which is a test harness and a preview, and costs those surfaces the chrome and not the block.
   */
  function renderChrome(node: PMNode): void {
    const registry = services.registry;
    if (!view.editable || !services.portals || !registry || frameEl === null) return;
    const element = createElement(ImageChrome, {
      view,
      registry,
      services,
      node,
      getPos: args.getPos,
      onAlign: (align: string) => {
        if (imageAlignOf(currentNode) !== align) commitAttrs({ align });
      },
    });
    if (chrome) chrome.update(element);
    else chrome = mountPortalNodeView(services.portals, element, { className: `${ROOT}-chrome` });
    // The frame is rebuilt whenever the window or the reference changes, so the mount is moved
    // back onto the live one rather than recreated; React keeps rendering into the same container.
    if (chrome.dom.parentNode !== frameEl) frameEl.appendChild(chrome.dom);
  }

  function buildChrome(frame: HTMLElement): void {
    if (!view.editable) return;
    const pill = document.createElement('div');
    pill.className = `${ROOT}-resize`;
    pill.addEventListener('pointerdown', startResize);
    frame.appendChild(pill);
    renderChrome(currentNode);
  }

  /**
   * A press on the picture selects the block, and may go on to drag it.
   *
   * Deliberately not stopped: the right-click menu decides what to offer from a pointerdown
   * snapshot taken at the React root, and it has to see the selection this just made. The press
   * is not consumed either, the shared drag arms at five pixels of travel, so a release short of
   * that is simply the click that already selected.
   */
  function onMediaPointerDown(event: PointerEvent): void {
    if (!view.editable) return;
    const live = liveNode();
    if (!live) return;

    // Whatever the button: the menu's snapshot reads and clears this, so the press that opens
    // one names the block it was on rather than leaving it to a coordinate the media swallows.
    recordImagePress({ pos: live.pos, sid: String(live.node.attrs.sid ?? '') });

    const registry = services.registry;
    if (registry) {
      const current = getBlockSelection(view.state);
      const next = applyGrip(view.state.doc, registry, current, live.pos, live.node, gripIntent(event));
      if (next !== current) setBlockSelection(view, next);
    }
    view.focus();

    // Right-click selects and then leaves the menu to it; nothing drags off a secondary button.
    if (event.button !== 0) return;
    pressBlockDrag(view, event, live.pos);
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
    const maxWidth = Math.min(MAX_IMAGE_WIDTH, dom.getBoundingClientRect().width || MAX_IMAGE_WIDTH);
    let lastWidth = startWidth;

    const widthAt = (clientX: number): number =>
      Math.round(Math.min(maxWidth, Math.max(MIN_IMAGE_WIDTH, startWidth + (clientX - startX))));

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
    const width = imageWidthOf(node);
    const stored = width > 0 ? `${clampImageWidth(width)}px` : null;
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
    drawMedia();
    // A placeholder, a missing card and a load in flight have nothing to hang a pill on, and a
    // mount left registered would go on rendering into a container no longer in the document.
    if (frameEl === null) {
      chrome?.destroy();
      chrome = null;
    }
  }

  function drawMedia(): void {
    const path = imagePathOf(currentNode);

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
    if (view.editable) {
      img.addEventListener('pointerdown', onMediaPointerDown);
      // ProseMirror places a caret from mousedown and the browser starts a native image drag from
      // it. Neither is wanted on a picture that answers the press itself, and the focus this
      // cancels is taken back explicitly by the pointerdown above.
      img.addEventListener('mousedown', (event) => {
        event.preventDefault();
      });
    }
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

  /**
   * The menu on the right-click path is built outside this view, so the caption switch is lent out
   * under the block's sid for as long as this view is up.
   *
   * Re-keyed rather than registered once: a block inserted by an edit is given its sid by the
   * identity pass, so the first node this view sees may not carry one yet.
   */
  function syncCaptionReveal(node: PMNode): void {
    const sid = String(node.attrs.sid ?? '');
    if (sid === captionSid) return;
    releaseCaption?.();
    captionSid = sid;
    releaseCaption = registerCaptionReveal(view, sid, {
      visible: captionVisible,
      toggle: toggleCaption,
    });
  }

  function sync(node: PMNode): void {
    currentNode = node;
    dom.setAttribute('data-image', imagePathOf(node));
    dom.setAttribute('data-align', imageAlignOf(node));
    syncCaptionReveal(node);
    const pos = args.getPos();
    if (pos !== undefined) syncCaption(pos, node);
  }

  sync(args.node);
  loadBytes(shownPath);

  return {
    dom,
    contentDOM: caption,
    update(node: PMNode): boolean {
      if (node.type !== args.node.type) return false;
      sync(node);
      const path = imagePathOf(node);
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
        renderChrome(node);
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
      releaseCaption?.();
      chrome?.destroy();
      chrome = null;
      // Object URLs belong to the session cache, which revokes them together on close.
    },
  };
}

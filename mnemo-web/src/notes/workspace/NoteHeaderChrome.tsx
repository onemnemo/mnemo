import { Popover } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { fetchAssetBlobUrl, useAssetObjectUrl } from '@/api/asset-blob';
import { EmojiPickerPopover } from '@/components/emoji/EmojiPickerPopover';
import { AppIcon } from '@/components/icon/AppIcon';
import { fitCropToContainer, isWholeCrop, type ImageCrop, type Size } from '@/components/ui/image-editor/geometry';
import { editImage } from '@/components/ui/image-editor/store';
import { useT } from '@/i18n/useT';
import { useMeasuredWidth } from '@/lib/useMeasuredWidth';
import { toast } from '@/stores/toast';

import { NOTE_COVERS, coverCss, hasCover } from './covers';
import {
  customCoverRequestPath,
  isCustomCover,
  parseCoverCrop,
  serializeCoverCrop,
  uploadCover,
} from './cover-upload';

/** The banner's fixed height in pixels; only its width follows the pane. */
export const COVER_BANNER_HEIGHT = 140;

/**
 * The band aspect assumed when the banner cannot be measured, such as opening the editor
 * before any cover has ever been set. Matches the design prototype's own cover ratio.
 */
const COVER_BAND_ASPECT_FALLBACK = 30 / 7;

/** A patch to the two fields a cover choice ever touches together. */
export interface CoverChange {
  cover: string | null;
  coverCrop: string | null;
}

/**
 * The page cover: a full-bleed banner over the document, or nothing. It carries
 * no controls of its own; changing and removing a cover live in the affordance
 * row under it, beside the icon control, so there is one place to look for the
 * header's controls whether or not a cover is set.
 *
 * The bytes load before either branch is chosen, because switching a note between
 * a preset and an uploaded cover would otherwise change how many hooks this runs.
 * A custom cover with a stored crop draws through `fitCropToContainer`, measuring
 * its own width so the frame can widen or narrow (the pane resizing, the sidebar
 * opening) without the crop sliding the subject out of view; one still uncropped,
 * unmeasured, or carrying a crop this build cannot parse falls back to plain cover
 * fit.
 *
 * A parsed crop with the natural size not in yet is a layout that has not been
 * computed, not a decision that it is uncropped: painting it plain would show the
 * whole picture for a frame and then snap to the crop the moment the size answers.
 * That image stays invisible until both answers are in, rather than choosing
 * a class ahead of the layout that decides which one is right.
 */
export function CoverBanner({
  token,
  crop,
  onBandWidth,
}: {
  token: string | null;
  crop: string | null;
  /** The banner's own measured width in pixels, for a caller framing a new crop against the same band. */
  onBandWidth?: (width: number) => void;
}) {
  const url = useAssetObjectUrl(customCoverRequestPath(token));
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const [natural, setNatural] = useState<Size | null>(null);

  useEffect(() => {
    onBandWidth?.(width);
  }, [width, onBandWidth]);

  // A new source invalidates whatever size the last one reported; the fallback framing
  // covers the gap until the new image's own load event answers.
  useEffect(() => {
    setNatural(null);
  }, [url]);

  const css = coverCss(token);
  if (css) return <div ref={ref} className="h-[140px] w-full overflow-hidden" style={{ background: css }} />;
  if (!isCustomCover(token)) return null;

  const parsed = parseCoverCrop(crop);
  const layout =
    parsed && natural && width > 0
      ? fitCropToContainer(parsed, { width, height: COVER_BANNER_HEIGHT }, natural)
      : null;
  const cropped = layout !== null && layout.width > 0 && layout.height > 0;
  // A stored crop with no layout yet is a snap waiting to happen (the natural size or the
  // band's own width has not answered), not a picture that is genuinely uncropped.
  const layoutPending = parsed !== null && layout === null;

  return (
    <div ref={ref} className="relative h-[140px] w-full overflow-hidden bg-canvas-sunken">
      {url === null ? null : (
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(event) =>
            setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          }
          className={
            (cropped ? 'absolute max-w-none select-none' : 'h-full w-full object-cover object-center') +
            (layoutPending ? ' opacity-0' : '')
          }
          style={
            cropped ? { width: layout.width, height: layout.height, left: layout.left, top: layout.top } : undefined
          }
        />
      )}
    </div>
  );
}

/** The 64px page icon. Presentation only; it is changed from the affordance row. */
export function NoteIcon({ value }: { value: string | null }) {
  if (!value) return null;
  return (
    <span aria-hidden className="inline-block select-none text-[64px] leading-none">
      {value}
    </span>
  );
}

const CHROME_BUTTON =
  'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-ink-3 hover:bg-frame-hover hover:text-ink';

/**
 * The header affordances, between the page icon and the title: the icon and the
 * cover are both set, changed and cleared from here, in one row that reads the
 * same whether or not either is present. Revealed on pane hover, so a note being
 * read carries no permanent chrome.
 */
export function AddHeaderChrome({
  cover,
  coverCrop,
  hasIcon,
  onCover,
  onIcon,
  measureBandAspect,
}: {
  cover: string | null;
  coverCrop: string | null;
  hasIcon: boolean;
  onCover: (next: CoverChange) => void;
  onIcon: (next: string | null) => void;
  /** The banner's live width over its fixed height, read fresh each time the editor opens. */
  measureBandAspect: () => number;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);
  const coverSet = hasCover(cover);

  return (
    <div className="mt-3 flex h-7 items-center gap-1 opacity-0 transition-opacity duration-150 hover:opacity-100 has-[button:focus-visible]:opacity-100 group-hover/pane:opacity-100">
      <EmojiPickerPopover value={null} label={nt('AddIcon')} onChange={onIcon}>
        <button type="button" className={CHROME_BUTTON}>
          <AppIcon name="notes/emoji" size={14} />
          {hasIcon ? nt('ChangeIcon') : nt('AddIcon')}
        </button>
      </EmojiPickerPopover>
      <CoverPicker token={cover} coverCrop={coverCrop} measureBandAspect={measureBandAspect} onChange={onCover}>
        <button type="button" className={CHROME_BUTTON}>
          <AppIcon name="common/image" size={14} />
          {coverSet ? nt('ChangeCover') : nt('AddCover')}
        </button>
      </CoverPicker>
    </div>
  );
}

/** The crop to store for a confirmed edit, null instead of a no-op crop over the whole source. */
function storedCrop(crop: ImageCrop): string | null {
  return isWholeCrop(crop) ? null : serializeCoverCrop(crop);
}

/**
 * A popover of cover swatches, an upload for an image of the user's own, a reposition
 * for one already set, and a clear option once one is set. Open state is optionally
 * controlled, so the note's actions menu can raise the same picker the inline
 * affordance uses rather than growing a second one of its own.
 *
 * Upload and reposition both hand off to the shared image editor dialog rather than a
 * native file input: the same crop frame both add a cover and adjust one already set,
 * so the two flows cannot drift the way two separate pickers eventually would. The
 * popover closes before the dialog opens (the ticket below still guards a stale result
 * against whatever the popover was reopened to choose in the meantime), so the two
 * floating layers are never on screen together.
 */
export function CoverPicker({
  token,
  coverCrop,
  measureBandAspect,
  onChange,
  children,
  open: openProp,
  onOpenChange,
}: {
  token: string | null;
  coverCrop: string | null;
  /** The banner's live width over its fixed height, read fresh each time the editor opens. */
  measureBandAspect: () => number;
  onChange: (next: CoverChange) => void;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // A rejection belongs to the session that showed it, but the picker itself closes
  // before the editor dialog even opens, so a failure that lands in the background
  // arrives while this is already closed and would otherwise show as nothing at all.
  // The latch is only the secondary record, kept for whoever reopens the popover;
  // `fail` below fires the toast that is the actual user-visible signal. Only a
  // closing counts as the session ending, so the latch clears on the way out rather
  // than on the way back in; keyed on open rather than on the toggle, because the
  // note's actions menu drives that prop from the outside.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) setProblem(null);
    wasOpen.current = open;
  }, [open]);

  // Every deliberate choice and every editor session takes the next ticket, so a result
  // that lands after the user moved on can tell it is no longer the current one. A guard
  // rather than a disabled picker: a slow upload should not freeze the swatches behind it.
  const ticket = useRef(0);
  const claim = () => {
    ticket.current += 1;
    setUploading(false);
    return ticket.current;
  };

  const pick = (next: CoverChange) => {
    claim();
    onChange(next);
    setOpen(false);
  };

  /** The frame aspect to open the editor with: the live band, guarded against an unmeasurable one. */
  const currentAspect = () => {
    const measured = measureBandAspect();
    return Number.isFinite(measured) && measured > 0 ? measured : COVER_BAND_ASPECT_FALLBACK;
  };

  /**
   * A cover upload or metadata write that failed after the popover already closed. The toast
   * fires immediately, because without one the action reads as a click that did nothing; the
   * latch is kept only so reopening the popover still explains why.
   */
  const fail = () => {
    setProblem('CoverUploadFailed');
    toast.warning(nt('CoverUploadFailed'));
  };

  async function openUpload() {
    setOpen(false);
    const mine = claim();
    setProblem(null);

    const result = await editImage({
      title: nt('CoverEditorTitle'),
      confirm: nt('CoverEditorSetConfirm'),
      aspect: currentAspect(),
    });
    if (mine !== ticket.current || !result?.file) return;

    setUploading(true);
    try {
      const uploaded = await uploadCover(result.file);
      if (mine !== ticket.current) return;
      pick({ cover: uploaded, coverCrop: storedCrop(result.crop) });
    } catch {
      if (mine !== ticket.current) return;
      setUploading(false);
      fail();
    }
  }

  async function openReposition() {
    const path = customCoverRequestPath(token);
    if (!path) return;
    setOpen(false);
    const mine = claim();
    setProblem(null);

    // The dialog has nothing to show until these bytes arrive, so the fetch is its own busy
    // leg: without it, closing the popover and the dialog opening leave a gap with no signal
    // in between, which reads as a click that did nothing.
    setUploading(true);
    let src: string;
    try {
      src = await fetchAssetBlobUrl(path);
    } catch {
      if (mine === ticket.current) {
        setUploading(false);
        fail();
      }
      return;
    }
    if (mine !== ticket.current) {
      URL.revokeObjectURL(src);
      return;
    }
    setUploading(false);

    try {
      const result = await editImage({
        src,
        crop: parseCoverCrop(coverCrop),
        aspect: currentAspect(),
        title: nt('CoverEditorTitle'),
        confirm: nt('CoverEditorSaveConfirm'),
      });
      if (mine !== ticket.current || !result) return;

      if (result.file) {
        setUploading(true);
        const uploaded = await uploadCover(result.file);
        if (mine !== ticket.current) return;
        pick({ cover: uploaded, coverCrop: storedCrop(result.crop) });
      } else {
        pick({ cover: token, coverCrop: storedCrop(result.crop) });
      }
    } catch {
      if (mine !== ticket.current) return;
      setUploading(false);
      fail();
    } finally {
      URL.revokeObjectURL(src);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="animate-pop-in z-[145] w-[232px] rounded-xl bg-canvas p-2.5 shadow-pop focus:outline-none"
        >
          <div className="grid grid-cols-3 gap-1.5">
            {NOTE_COVERS.map((cover) => (
              <button
                key={cover.token}
                type="button"
                aria-label={cover.token}
                onClick={() => pick({ cover: cover.token, coverCrop: null })}
                style={{ background: cover.css }}
                className={
                  'h-12 rounded-lg transition-transform hover:scale-[1.03]' +
                  (cover.token === token ? ' ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--canvas)]' : '')
                }
              />
            ))}
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={() => void openUpload()}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[12px] text-text-tertiary hover:bg-frame-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-45"
          >
            <AppIcon
              name={uploading ? 'loader-circle' : 'common/image'}
              size={13}
              className={uploading ? 'animate-spin' : undefined}
            />
            {nt('UploadCover')}
          </button>
          {isCustomCover(token) ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => void openReposition()}
              className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[12px] text-text-tertiary hover:bg-frame-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-45"
            >
              <AppIcon name="maximize" size={13} />
              {nt('RepositionCover')}
            </button>
          ) : null}
          {problem === null ? null : <p className="mt-1.5 text-[12px] text-danger">{nt(problem)}</p>}
          {token ? (
            <button
              type="button"
              onClick={() => pick({ cover: null, coverCrop: null })}
              className="mt-2 w-full rounded-md py-1 text-[12px] text-text-tertiary hover:bg-frame-hover hover:text-text-primary"
            >
              {nt('RemoveCover')}
            </button>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

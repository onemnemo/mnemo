import { Popover } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAssetObjectUrl } from '@/api/asset-blob';
import { EmojiPickerPopover } from '@/components/emoji/EmojiPickerPopover';
import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';

import { NOTE_COVERS, coverCss, hasCover } from './covers';
import { coverUploadProblem, customCoverRequestPath, isCustomCover, uploadCover } from './cover-upload';

/**
 * The page cover: a full-bleed banner over the document, or nothing. It carries
 * no controls of its own; changing and removing a cover live in the affordance
 * row under it, beside the icon control, so there is one place to look for the
 * header's controls whether or not a cover is set.
 *
 * The bytes load before either branch is chosen, because switching a note between
 * a preset and an uploaded cover would otherwise change how many hooks this runs.
 */
export function CoverBanner({ token }: { token: string | null }) {
  const url = useAssetObjectUrl(customCoverRequestPath(token));

  const css = coverCss(token);
  if (css) return <div className="h-[140px] w-full overflow-hidden" style={{ background: css }} />;
  if (!isCustomCover(token)) return null;

  return (
    <div className="h-[140px] w-full overflow-hidden bg-canvas-sunken">
      {url === null ? null : (
        <img src={url} alt="" draggable={false} className="h-full w-full object-cover object-center" />
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
  hasIcon,
  onCover,
  onIcon,
}: {
  cover: string | null;
  hasIcon: boolean;
  onCover: (next: string | null) => void;
  onIcon: (next: string | null) => void;
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
      <CoverPicker token={cover} onChange={onCover}>
        <button type="button" className={CHROME_BUTTON}>
          <AppIcon name="common/image" size={14} />
          {coverSet ? nt('ChangeCover') : nt('AddCover')}
        </button>
      </CoverPicker>
    </div>
  );
}

/**
 * A popover of cover swatches, an upload for an image of the user's own, and a
 * clear option once one is set. Open state is optionally controlled, so the note's
 * actions menu can raise the same picker the inline affordance uses rather than
 * growing a second one of its own.
 */
export function CoverPicker({
  token,
  onChange,
  children,
  open: openProp,
  onOpenChange,
}: {
  token: string | null;
  onChange: (next: string | null) => void;
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

  const fileInput = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // A rejection belongs to the session that showed it. Only Popover.Content unmounts on
  // close, so without this the message outlives the popover and greets the next opening
  // with no file having been picked. Keyed on open rather than on the toggle, because the
  // note's actions menu drives that prop from the outside.
  useEffect(() => {
    setProblem(null);
  }, [open]);

  // Every deliberate choice and every upload takes the next ticket, so a result that lands
  // after the user moved on can tell it is no longer the current one. A guard rather than a
  // disabled picker: a slow upload should not freeze the swatches behind it.
  const ticket = useRef(0);
  const claim = () => {
    ticket.current += 1;
    setUploading(false);
    return ticket.current;
  };

  const pick = (next: string | null) => {
    claim();
    onChange(next);
    setOpen(false);
  };

  async function accept(file: File | undefined) {
    if (!file) return;

    const rejection = coverUploadProblem(file);
    if (rejection !== null) {
      setProblem(rejection);
      return;
    }

    const mine = claim();
    setProblem(null);
    setUploading(true);
    try {
      const uploaded = await uploadCover(file);
      if (mine !== ticket.current) return;
      pick(uploaded);
    } catch {
      if (mine !== ticket.current) return;
      setUploading(false);
      setProblem('CoverUploadFailed');
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
                onClick={() => pick(cover.token)}
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
            onClick={() => fileInput.current?.click()}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md py-1 text-[12px] text-text-tertiary hover:bg-frame-hover hover:text-text-primary disabled:pointer-events-none disabled:opacity-45"
          >
            <AppIcon
              name={uploading ? 'loader-circle' : 'common/image'}
              size={13}
              className={uploading ? 'animate-spin' : undefined}
            />
            {nt('UploadCover')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
            hidden
            onChange={(e) => {
              void accept(e.target.files?.[0]);
              // Cleared so picking the same file twice in a row still fires a change.
              e.target.value = '';
            }}
          />
          {problem === null ? null : <p className="mt-1.5 text-[12px] text-danger">{nt(problem)}</p>}
          {token ? (
            <button
              type="button"
              onClick={() => pick(null)}
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

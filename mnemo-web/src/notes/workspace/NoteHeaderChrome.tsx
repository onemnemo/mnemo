import { Popover } from 'radix-ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { EmojiPicker } from '@/components/emoji/EmojiPicker';
import { EmojiPickerButton } from '@/components/emoji/EmojiPickerButton';
import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';

import { NOTE_COVERS, coverCss } from './covers';

/**
 * The page cover: a full-bleed banner over the document, or nothing. Its own
 * controls only surface on hover, so a note with a cover still reads as a
 * reading surface rather than a dashboard.
 */
export function CoverBanner({
  token,
  onChange,
}: {
  token: string | null;
  onChange: (next: string | null) => void;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);
  const css = coverCss(token);
  if (!css) return null;

  return (
    <div className="group/cover relative h-[140px] w-full overflow-hidden" style={{ background: css }}>
      <div className="absolute right-3 top-3 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/cover:opacity-100">
        <CoverPicker token={token} onChange={onChange}>
          <button
            type="button"
            className="rounded-md bg-canvas/70 px-2 py-1 text-[12px] font-medium text-text-primary shadow-canvas backdrop-blur-sm hover:bg-canvas/90"
          >
            {nt('ChangeCover')}
          </button>
        </CoverPicker>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-md bg-canvas/70 px-2 py-1 text-[12px] font-medium text-text-primary shadow-canvas backdrop-blur-sm hover:bg-canvas/90"
        >
          {nt('RemoveCover')}
        </button>
      </div>
    </div>
  );
}

/** The 64px page icon, shown only when one is set; clicking it changes or clears it. */
export function NoteIcon({ value, onChange }: { value: string | null; onChange: (next: string | null) => void }) {
  const t = useT();
  if (!value) return null;
  return (
    <EmojiPickerButton
      value={value}
      onChange={onChange}
      fallback="common/file-text"
      label={t('Notes', 'ChangeIcon')}
      size={64}
      glyphSize={56}
    />
  );
}

const CHROME_BUTTON =
  'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] text-ink-3 hover:bg-frame-hover hover:text-ink';

/**
 * The header affordances, between the page icon and the title: set or change the
 * icon, and add a cover while there is none. They share the pickers the set state
 * uses, so adding and changing are the one control, and they stay reachable here
 * rather than only from a menu. Revealed on pane hover, so a note being read
 * carries no permanent chrome.
 */
export function AddHeaderChrome({
  hasCover,
  hasIcon,
  onCover,
  onIcon,
}: {
  hasCover: boolean;
  hasIcon: boolean;
  onCover: (next: string | null) => void;
  onIcon: (next: string | null) => void;
}) {
  const t = useT();
  const nt = (key: string) => t('Notes', key);

  return (
    <div className="mt-3 flex h-7 items-center gap-1 opacity-0 transition-opacity duration-150 hover:opacity-100 has-[button:focus-visible]:opacity-100 group-hover/pane:opacity-100">
      <IconPicker value={null} onChange={onIcon}>
        <button type="button" className={CHROME_BUTTON}>
          <AppIcon name="notes/emoji" size={14} />
          {hasIcon ? nt('ChangeIcon') : nt('AddIcon')}
        </button>
      </IconPicker>
      {!hasCover ? (
        <CoverPicker token={null} onChange={onCover}>
          <button type="button" className={CHROME_BUTTON}>
            <AppIcon name="common/image" size={14} />
            {nt('AddCover')}
          </button>
        </CoverPicker>
      ) : null}
    </div>
  );
}

/**
 * A popover of cover swatches, plus a clear option once one is set. Open state is
 * optionally controlled, so the note's actions menu can raise the same picker the
 * inline affordance uses rather than growing a second one of its own.
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
  const pick = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

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

/** A popover wrapping the shared emoji picker around an arbitrary trigger. */
export function IconPicker({
  value,
  onChange,
  children,
  open: openProp,
  onOpenChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const commit = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={t('Notes', 'AddIcon')}
          className="animate-pop-in z-[145] rounded-xl bg-canvas shadow-pop focus:outline-none"
        >
          <EmojiPicker value={value} onSelect={(char) => commit(char)} onClear={() => commit(null)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

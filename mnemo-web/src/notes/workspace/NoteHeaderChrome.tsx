import { Popover } from 'radix-ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { EmojiPicker } from '@/components/emoji/EmojiPicker';
import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';

import { NOTE_COVERS, coverCss } from './covers';

/**
 * The page cover: a full-bleed banner over the document, or nothing. It carries
 * no controls of its own; changing and removing a cover live in the affordance
 * row under it, beside the icon control, so there is one place to look for the
 * header's controls whether or not a cover is set.
 */
export function CoverBanner({ token }: { token: string | null }) {
  const css = coverCss(token);
  if (!css) return null;
  return <div className="h-[140px] w-full overflow-hidden" style={{ background: css }} />;
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
  const hasCover = coverCss(cover) !== null;

  return (
    <div className="mt-3 flex h-7 items-center gap-1 opacity-0 transition-opacity duration-150 hover:opacity-100 has-[button:focus-visible]:opacity-100 group-hover/pane:opacity-100">
      <IconPicker value={null} onChange={onIcon}>
        <button type="button" className={CHROME_BUTTON}>
          <AppIcon name="notes/emoji" size={14} />
          {hasIcon ? nt('ChangeIcon') : nt('AddIcon')}
        </button>
      </IconPicker>
      <CoverPicker token={cover} onChange={onCover}>
        <button type="button" className={CHROME_BUTTON}>
          <AppIcon name="common/image" size={14} />
          {hasCover ? nt('ChangeCover') : nt('AddCover')}
        </button>
      </CoverPicker>
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

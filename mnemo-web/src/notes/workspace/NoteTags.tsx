import { useState } from 'react';

import { AppIcon } from '@/components/icon/AppIcon';
import { useT } from '@/i18n/useT';

/**
 * Page tags as chips under the title. Tags are plain labels; the chip colour is
 * derived from the label so the same tag reads the same everywhere without a
 * colour ever being stored or picked. The add affordance only shows on hover, so
 * a note with no tags carries no permanent chrome.
 */
export function NoteTags({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const t = useT();
  const nt = (key: string, params?: Record<string, string | number>) => t('Notes', key, params);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const label = draft.trim();
    setDraft('');
    setAdding(false);
    if (!label) return;
    // Case-insensitive de-dupe, keeping the label already on the note.
    if (tags.some((tag) => tag.toLowerCase() === label.toLowerCase())) return;
    onChange([...tags, label]);
  };

  const remove = (label: string) => onChange(tags.filter((tag) => tag !== label));

  return (
    <div className="group/tags mt-3 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => {
        const hue = hueOf(tag);
        return (
          <span
            key={tag}
            className="group/tag inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[12px] font-medium"
            style={{ background: `oklch(0.62 0.14 ${hue} / 0.16)`, color: `oklch(0.55 0.15 ${hue})` }}
          >
            {tag}
            <button
              type="button"
              aria-label={nt('RemoveTagFormat', { 0: tag })}
              onClick={() => remove(tag)}
              className="flex size-3.5 items-center justify-center rounded-full opacity-0 transition-opacity hover:!opacity-100 group-hover/tag:opacity-70"
            >
              <AppIcon name="common/plus" size={9} className="rotate-45" />
            </button>
          </span>
        );
      })}

      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder={nt('AddTag')}
          aria-label={nt('AddTag')}
          className="h-6 w-28 rounded-full bg-canvas-sunken px-2.5 text-[12px] text-text-primary outline-none placeholder:text-text-faded"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] text-text-tertiary opacity-0 transition-opacity hover:bg-frame-hover hover:text-text-primary focus-visible:opacity-100 group-hover/tags:opacity-100"
        >
          <AppIcon name="tag" size={11} />
          {nt('AddTag')}
        </button>
      )}
    </div>
  );
}

/** A stable hue from the label, so a tag keeps its colour across notes and reloads. */
function hueOf(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 360;
  }
  return hash;
}

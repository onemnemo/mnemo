import { AppIcon } from '@/components/icon/AppIcon';
import { cn } from '@/lib/utils';

/**
 * The favourite star, shown on row hover and filled for a favourite. It stays hidden at
 * rest because the Favourites section already lists them.
 */
export function FavouriteStar({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <span
      role="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cn(
        'hidden size-5 shrink-0 place-items-center rounded hover:bg-frame-active group-hover:grid group-focus-within:grid',
        on ? 'text-ink-2' : 'text-ink-icon',
      )}
    >
      <AppIcon name={on ? 'common/star-filled' : 'common/star'} size={13} preserveColors={false} />
    </span>
  );
}

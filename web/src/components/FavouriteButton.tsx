import { useRef } from 'react';
import { HeartIcon } from './Icons';

/**
 * A star-for-yourself heart. `onToggle` owns the optimistic update and its revert; this just holds off a second
 * tap until the first settles, so a quick double tap cannot race two requests against each other.
 */
export function FavouriteButton({ title, on, onToggle, className = '' }: {
  title: string;
  on: boolean;
  onToggle: () => Promise<void>;
  className?: string;
}) {
  const pending = useRef(false);
  const tap = async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      await onToggle();
    } finally {
      pending.current = false;
    }
  };
  return (
    <button type="button" className={`fav-btn${on ? ' on' : ''} ${className}`.trim()} aria-label={`Favourite ${title}`} aria-pressed={on} onClick={() => void tap()}>
      <HeartIcon filled={on} />
    </button>
  );
}

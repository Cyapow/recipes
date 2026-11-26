import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type MoreItem = { to: string; label: string; icon: ReactNode };

/**
 * The places that do not fit on the top bar. A phone 390pt wide leaves a page 350px of room, and the library's
 * title alone wants about 150 of it, so only the first few round buttons fit: everything else lives here, named in
 * words rather than left to an icon nobody can read. Same bottom sheet as the filters, down to the grab handle.
 */
export function MoreSheet({ open, items, onClose }: {
  open: boolean;
  items: MoreItem[];
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="bottom-sheet-backdrop" data-testid="more-backdrop" onClick={onClose} />
      <div className="bottom-sheet more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-sheet-title">
        <div className="bottom-sheet-grab" aria-hidden="true" />
        <h2 id="more-sheet-title" className="bottom-sheet-title" tabIndex={-1} ref={heading}>More</h2>
        <nav className="more-rows">
          {items.map((i) => (
            // Closed on the way out as well as on the way back: returning to the library must not find it still up.
            <Link key={i.to} className="more-row" to={i.to} onClick={onClose}>
              <span className="more-row-icon" aria-hidden="true">{i.icon}</span>
              {i.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}

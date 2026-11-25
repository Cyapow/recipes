import { useEffect, useState } from 'react';
import { getMe } from '../api';

/** Who is signed in, for knowing which stars are yours. Null until known, and stays null if it cannot be fetched. */
export function useMyEmail(): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getMe().then((me) => live && setEmail(me.email)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return email;
}

/** `favouritedBy` with your address added or removed, keeping the server's sorted order. */
export function withStar(favouritedBy: string[], email: string, on: boolean): string[] {
  const others = favouritedBy.filter((e) => e !== email);
  return (on ? [...others, email] : others).sort();
}

import { createContext, useContext, type ReactNode } from 'react';

export type Me = { email: string; name: string };

const MeContext = createContext<Me | null>(null);

/** Provided by the sign-in gate, which has already asked who this is. Null until it knows. */
export function MeProvider({ me, children }: { me: Me | null; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export const useMe = (): Me | null => useContext(MeContext);

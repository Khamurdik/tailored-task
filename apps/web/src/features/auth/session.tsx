import type { SessionUser } from '@dataroom/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { setSessionExpiredHandler } from '@/shared/api/client';
import * as tokenStore from '@/shared/auth/token-store';
import { clearSession } from '@/shared/query/query-client';

import * as authApi from './auth.api';

export interface Session {
  user: SessionUser | null;
  /** True until the first `/me` settles. Routes must render nothing while it is. */
  isLoading: boolean;
  signIn: (user: SessionUser) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Session bootstrap.
 *
 * The rule that shapes this component: **render nothing until `/me` settles.**
 * A stored token means "probably signed in", and optimistically rendering the
 * login screen while finding out produces a flash of it on every reload for
 * every authenticated user — which reads as broken rather than as fast.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);

  // Not react-query: this is bootstrap, it runs exactly once, and its pending
  // state gates the whole tree. A query's `isLoading` would also be true on
  // every later refetch, which must not blank the app.
  const [isLoading, setIsLoading] = useState(() => tokenStore.get() !== null);

  useEffect(() => {
    if (tokenStore.get() === null) return;

    let cancelled = false;
    void authApi
      .me()
      .then((loaded) => {
        if (!cancelled) setUser(loaded);
      })
      .catch(() => {
        // A dead token reads as logged out. The client has already cleared the
        // store by this point; there is nothing to tell the user, because they
        // are about to see the login screen they would have seen anyway.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A sign-out in another tab signs this one out too.
   *
   * Only removals, never rotations — see `token-store.subscribeSignOut`. The
   * cache is cleared as well, because leaving it populated means the app keeps
   * rendering the previous session's tree from memory.
   */
  useEffect(
    () =>
      tokenStore.subscribeSignOut(() => {
        setUser(null);
        clearSession(queryClient);
      }),
    [queryClient],
  );

  /** A refresh that fails mid-session lands here rather than in a hard navigation. */
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      clearSession(queryClient);
    });
  }, [queryClient]);

  const signIn = useCallback((next: SessionUser) => {
    setUser(next);
    setIsLoading(false);
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = tokenStore.get()?.refreshToken;

    try {
      // Server first. If this is skipped the refresh family stays alive and
      // anyone holding a stolen token keeps minting access tokens for a week.
      if (refreshToken !== undefined) await authApi.logout(refreshToken);
    } catch {
      // Still clear locally. A user who pressed "sign out" must end up signed
      // out of this browser whatever the network did — leaving them apparently
      // signed in is the worse failure of the two.
    } finally {
      tokenStore.clear();
      setUser(null);
      clearSession(queryClient);
    }
  }, [queryClient]);

  const value = useMemo<Session>(
    () => ({ user, isLoading, signIn, signOut }),
    [user, isLoading, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { Spinner } from '@/shared/ui';

import { useSession } from './session';

/**
 * Gates owner routes.
 *
 * **It must never wrap `/s/:code`.** An anonymous share visitor is a legitimate
 * caller, and putting this in front of the share route is the single most
 * common way the public flow gets broken — it fails silently for the person who
 * built it, because they are always signed in.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useSession();
  const location = useLocation();

  // Nothing, not a login redirect. Redirecting while the answer is unknown is
  // what produces the flash of the login screen on every reload.
  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner label="Restoring your session" />
      </div>
    );
  }

  if (user === null) {
    // The full requested path, so a deep link survives signing in. `replace`
    // keeps the login screen out of history, so Back does not return to it.
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return children;
}

/**
 * An admin-only route is **hidden**, not rendered-and-rejected.
 *
 * Showing a non-admin a page that then refuses them tells them the page exists,
 * which is the same enumeration leak the API avoids by answering 404 rather
 * than 403. Consistency matters here: the API already refuses to confirm that
 * `/jobs` exists, and a client that links to it undoes that.
 */
export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useSession();

  if (isLoading) return null;
  if (user === null) return <Navigate to="/login" replace />;
  if (!user.isAdmin) return <Navigate to="/" replace />;

  return children;
}

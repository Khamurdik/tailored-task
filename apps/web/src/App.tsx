import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { LoginPage, ProtectedRoute, SessionProvider, useSession } from '@/features/auth';
import { createQueryClient } from '@/shared/query/query-client';
import { Button } from '@/shared/ui';

const queryClient = createQueryClient();

/**
 * The route table.
 *
 * The one structural rule here: **`/s/:code` sits outside `<ProtectedRoute>`.**
 * An anonymous share visitor is a legitimate caller, and wrapping that route is
 * the most common way the public flow breaks — silently, because whoever built
 * it is always signed in.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Public. No session required, and none assumed. */}
            <Route path="/s/:code" element={<SharePlaceholder />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <RoomsPlaceholder />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Stands in until `explorer` exists. Kept deliberately plain: a placeholder
 * that looks finished is one nobody replaces.
 */
function RoomsPlaceholder() {
  const { user, signOut } = useSession();

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Data rooms</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user?.email}</p>
        </div>
        <Button variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">
        The explorer is not built yet — see apps/web/src/features/explorer/TODO.md.
      </p>
    </main>
  );
}

function SharePlaceholder() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-xl font-semibold">Shared with you</h1>
      <p className="text-sm text-muted-foreground">
        The read-only view is not built yet — see features/public-view/TODO.md.
      </p>
    </main>
  );
}

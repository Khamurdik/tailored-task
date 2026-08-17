import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { LoginPage, ProtectedRoute, SessionProvider } from '@/features/auth';
import { FolderPage, RoomsPage } from '@/features/explorer';
import { PublicViewPage } from '@/features/public-view';
import { UploadPanel, useUploadRunner } from '@/features/uploads';
import { createQueryClient } from '@/shared/query/query-client';

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
            <Route path="/s/:code" element={<PublicViewPage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <RoomsPage />
                </ProtectedRoute>
              }
            />

            {/*
              The folder id is in the URL, which is what makes a folder
              linkable, reloadable and reachable with the back button. Holding
              it in state instead breaks all three and only the first gets
              noticed.
            */}
            <Route
              path="/nodes/:id"
              element={
                <ProtectedRoute>
                  <FolderPage />
                </ProtectedRoute>
              }
            />

            {/*
              An open preview is a **route**, not component state, so it is
              linkable and the back button closes it. The spec wrote this as
              `/rooms/:id/f/:fileId`; the tree is addressed by node id here
              rather than by room, so it is `/nodes/:id/f/:fileId` — same shape,
              consistent with the route above it.
            */}
            <Route
              path="/nodes/:id/f/:fileId"
              element={
                <ProtectedRoute>
                  <FolderPage />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          {/*
            **Outside `<Routes>`, deliberately.** The runner and the panel must
            outlive the page a transfer was started from: mounted inside a route,
            navigating into a folder unmounts them and every upload dies, which
            is the bug that makes people re-drop files and end up with
            duplicates. `WEB-UPLOADS-001` is exactly this.
          */}
          <Uploads />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/** The queue driver and its panel, as one mount point. */
function Uploads() {
  useUploadRunner();
  return <UploadPanel />;
}


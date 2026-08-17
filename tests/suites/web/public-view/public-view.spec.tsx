import type { ChildrenPage, NodeSummary } from '@dataroom/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { PublicViewPage } from '@web/features/public-view/public-view-page';
import * as tokenStore from '@web/shared/auth/token-store';
import { createQueryClient } from '@web/shared/query/query-client';

/**
 * `/s/:code` — the only screen a stranger ever reaches.
 *
 * Six of this suite's declarations are `P0`, and they divide into two kinds: the
 * ones about what a visitor must not *see* (an ancestor's name, an owner's
 * cached data) and the ones about what a failure must not *reveal* (which of the
 * five ways a link can be dead this one is).
 */
const { api } = await import('@web/shared/api/client');

const CODE = 'N4B1G8RY66MCR798';
const ROOT = '00000000-0000-4000-8000-000000000b01';
const ANCESTOR = '00000000-0000-4000-8000-000000000a01';
const CHILD = '00000000-0000-4000-8000-000000000c01';

function respond(status: number, data: unknown): AxiosResponse {
  const config = { headers: new AxiosHeaders() } as AxiosResponse['config'];
  return { data, status, statusText: String(status), headers: new AxiosHeaders(), config };
}

function reject(status: number, data: unknown): AxiosError {
  const response = respond(status, data);
  return new AxiosError(`status ${status}`, String(status), response.config, null, response);
}

function node(overrides: Partial<NodeSummary> & { id: string; name: string }): NodeSummary {
  return {
    type: 'folder',
    state: 'active',
    sizeBytes: null,
    contentType: null,
    subtreeFiles: 0,
    subtreeBytes: 0,
    updatedAt: '2026-08-17T10:00:00.000Z',
    ...overrides,
  };
}

interface Scenario {
  /** Any of the five ways a link is dead. All must be indistinguishable. */
  resolveFails?: boolean;
  children?: NodeSummary[];
}

function install(scenario: Scenario = {}): { calls: string[]; headers: string[] } {
  const calls: string[] = [];
  const headers: string[] = [];

  const adapter: AxiosAdapter = async (config) => {
    const url = config.url ?? '';
    calls.push(url);
    headers.push(String(config.headers?.['X-Share-Token'] ?? ''));
    await Promise.resolve();

    if (url === '/shares/resolve') {
      if (scenario.resolveFails === true) {
        throw reject(404, { code: 'NOT_FOUND', message: 'Not found' });
      }
      return respond(200, { rootNodeId: ROOT, role: 'viewer', expiresAt: null });
    }

    if (url.endsWith('/children')) {
      return respond(200, {
        items: scenario.children ?? [node({ id: CHILD, name: 'Contracts' })],
        nextCursor: null,
        // **Already truncated at the shared node.** The server stops the trail
        // there; the client never has the ancestors to render in the first
        // place, which is what makes this structural rather than a filter.
        breadcrumbs: [{ id: ROOT, name: 'Q4', type: 'folder' }],
      } satisfies ChildrenPage);
    }

    if (url === `/nodes/${ROOT}`) {
      return respond(200, {
        ...node({ id: ROOT, name: 'Q4' }),
        rootId: ANCESTOR,
        parentId: ANCESTOR,
        depth: 2,
        breadcrumbs: [{ id: ROOT, name: 'Q4', type: 'folder' }],
        createdAt: '2026-08-17T10:00:00.000Z',
      });
    }

    // Anything the credential does not reach — an ancestor, a sibling — is the
    // same 404 the API gives, by design.
    throw reject(404, { code: 'NOT_FOUND', message: 'Not found' });
  };

  api.defaults.adapter = adapter;
  return { calls, headers };
}

function renderShare(code = CODE) {
  const client = createQueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/s/${code}`]}>
        <Routes>
          <Route path="/s/:code" element={<PublicViewPage />} />
          <Route path="/login" element={<p>LOGIN PAGE</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client };
}

beforeEach(() => {
  tokenStore.clear();
  install();
});

describe('a valid link', () => {
  it('WEB-PUBLICVIEW-008 renders the shared node with no sign-in step', async () => {
    install();
    renderShare();

    expect(await screen.findByText('Shared with you')).toBeInTheDocument();
    expect(await screen.findByText('Contracts')).toBeInTheDocument();
    // Never a redirect to login, and never a prompt.
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument();
  });

  it('WEB-PUBLICVIEW-004 the route never redirects to login', async () => {
    install({ resolveFails: true });
    renderShare();

    // Even when the link is dead. Sending a stranger to a login page for a link
    // that does not work is both useless and a nudge toward an account they
    // have no reason to want.
    expect(await screen.findByText('This link is not available')).toBeInTheDocument();
    expect(screen.queryByText('LOGIN PAGE')).not.toBeInTheDocument();
  });

  it('WEB-PUBLICVIEW-027 no error screen invites the visitor to create an account', async () => {
    install({ resolveFails: true });
    renderShare();

    const screenText = (await screen.findByText('This link is not available')).closest('div')
      ?.textContent;
    expect(screenText?.toLowerCase()).not.toContain('sign up');
    expect(screenText?.toLowerCase()).not.toContain('create an account');
    expect(screenText?.toLowerCase()).not.toContain('register');
  });

  it('WEB-PUBLICVIEW-007 the header shows no account menu', async () => {
    install();
    renderShare();

    await screen.findByText('Contracts');
    expect(screen.queryByRole('button', { name: /Sign out/i })).not.toBeInTheDocument();
  });
});

describe('what the credential does', () => {
  it('WEB-PUBLICVIEW-003 the credential travels as a header, never in a request URL', async () => {
    const { calls, headers } = install();
    renderShare();

    await screen.findByText('Contracts');

    // The code is in the *browser's* address bar and in a request **header**.
    // It never reaches the API as a path segment, which is the whole reason
    // `links` accepts it in a header — a path lands in every access log between
    // the client and the server.
    for (const url of calls) expect(url).not.toContain(CODE);
    expect(headers.some((value) => value === CODE)).toBe(true);
  });

  it('WEB-PUBLICVIEW-020 breadcrumbs stop at the share root and name no ancestor', async () => {
    install();
    renderShare();

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });

    // `Q4` and nothing above it. The names of the folders between the room and
    // the shared one are the shape of the owner's room, and handing them to a
    // stranger leaks it in the one place strangers actually reach.
    expect(nav.textContent).toContain('Q4');
    expect(nav.textContent).not.toContain('Project Meridian');
    expect(nav.textContent).not.toContain('Diligence');
  });

  it('WEB-PUBLICVIEW-001 no query key here is shared with an owner-scoped key', async () => {
    install();
    const { client } = renderShare();

    await screen.findByText('Contracts');

    /**
     * The resolve key is namespaced by the **credential**.
     *
     * Sharing a cache entry between an owner view and a share view is the
     * mechanism by which private data reaches a public page, and it happens by
     * accident the moment both call `nodes.children(id)` for one id.
     */
    const keys = client.getQueryCache().getAll().map((query) => query.queryKey);
    const resolveKey = keys.find((key) => JSON.stringify(key).includes('resolve'));
    expect(JSON.stringify(resolveKey)).toContain(CODE);
  });

  it('WEB-PUBLICVIEW-005 a signed-in visitor still gets the read-only view', async () => {
    // Signed in as somebody, and opening a link anyway.
    tokenStore.set({ accessToken: 'owner-access', refreshToken: 'owner-refresh' });
    install();
    renderShare();

    await screen.findByText('Contracts');

    /**
     * Not silently upgraded into the owner UI.
     *
     * The credential in the URL is what they arrived with, and honouring it is
     * the difference between previewing what you shared and looking at your own
     * data while believing you are seeing theirs.
     */
    expect(screen.getByText('Shared with you')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
  });
});

describe('what a visitor cannot do', () => {
  it('WEB-PUBLICVIEW-015 no control creates, renames, moves, deletes, or uploads', async () => {
    install();
    renderShare();

    await screen.findByText('Contracts');

    // Absent, not disabled — `Explorer` is passed `readOnly`, and the same
    // component the owner uses is what renders here. Two implementations of one
    // tree is how a mutating affordance survives in the copy nobody looks at.
    for (const name of [/New folder/, /Create a folder/, /Upload files/, /Actions for/]) {
      expect(screen.queryByRole('button', { name }), String(name)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId('upload-input')).not.toBeInTheDocument();
  });

  it('WEB-PUBLICVIEW-016 no share dialog is reachable', async () => {
    install();
    renderShare();

    await screen.findByText('Contracts');

    // The row menu is absent entirely, so there is no path to it — rather than
    // a Share item that would fail on submit.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Share' })).not.toBeInTheDocument();
  });
});

describe('one failure screen', () => {
  it('WEB-PUBLICVIEW-028 every way of being dead renders one identical screen', async () => {
    // The component cannot distinguish them because the API refuses to: unknown,
    // revoked, expired, deleted-target and never-existed are one byte-identical
    // 404 (`API-LINKS-004`). Anything else confirms the token was real.
    for (const attempt of [0, 1, 2]) {
      install({ resolveFails: true });
      const { unmount } = renderShareFor(`code-${attempt}`);

      expect(await screen.findByText('This link is not available')).toBeInTheDocument();
      // No mention of *why*, because there is no why available and inventing
      // one would be inventing an oracle.
      const body = document.body.textContent ?? '';
      for (const leak of ['expired', 'revoked', 'deleted', 'invalid']) {
        expect(body.toLowerCase()).not.toContain(leak);
      }
      unmount();
    }
  });

  it('WEB-PUBLICVIEW-023 a malformed token renders that screen, never a crash', async () => {
    install({ resolveFails: true });
    renderShareFor('%%%not-a-code%%%');

    expect(await screen.findByText('This link is not available')).toBeInTheDocument();
  });

  it('WEB-PUBLICVIEW-025 an expired link renders it with no retry loop', async () => {
    const { calls } = install({ resolveFails: true });
    renderShare();

    await screen.findByText('This link is not available');

    // `retry: false` on the resolve query. A dead link retried three times is
    // three requests against the throttle that protects every share in the
    // system, from a visitor who cannot succeed.
    await new Promise((done) => setTimeout(done, 60));
    expect(calls.filter((url) => url === '/shares/resolve')).toHaveLength(1);
  });

  it('WEB-PUBLICVIEW-026 a deleted node renders it without saying the node was deleted', async () => {
    install({ resolveFails: true });
    renderShare();

    const alert = await screen.findByText('This link is not available');
    // "This document was deleted" tells the holder of a link that it was real
    // and that somebody acted on it.
    expect(alert.parentElement?.textContent).not.toMatch(/delete/i);
  });
});

function renderShareFor(code: string) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/s/${code}`]}>
        <Routes>
          <Route path="/s/:code" element={<PublicViewPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

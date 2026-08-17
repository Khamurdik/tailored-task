import type { ShareSummary } from '@dataroom/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareDialog, shareUrl } from '@web/features/sharing/share-dialog';
import { createQueryClient } from '@web/shared/query/query-client';

/**
 * The share dialog.
 *
 * Nearly every declaration here is `security`, and they are all the same shape:
 * an interaction that could give away *more* than the owner intended. Opening
 * the dialog, closing it, reopening it, and revoking are each tested for what
 * they must **not** do.
 */
const { api } = await import('@web/shared/api/client');

const NODE = '00000000-0000-4000-8000-000000000001';
const ANCESTOR = '00000000-0000-4000-8000-0000000000a0';
const TOKEN = 'Tok3nTok3nTok3nTok3nTok3nTok3nTok3nTok3nTok0';
const CODE = 'N4B1G8RY66MCR798';

function respond(status: number, data: unknown): AxiosResponse {
  const config = { headers: new AxiosHeaders() } as AxiosResponse['config'];
  return { data, status, statusText: String(status), headers: new AxiosHeaders(), config };
}

function reject(status: number, data: unknown): AxiosError {
  const response = respond(status, data);
  return new AxiosError(`status ${status}`, String(status), response.config, null, response);
}

function grant(overrides: Partial<ShareSummary> = {}): ShareSummary {
  return {
    id: '00000000-0000-4000-8000-0000000000e1',
    nodeId: NODE,
    kind: 'public_link',
    role: 'viewer',
    principalEmail: null,
    hasShortCode: false,
    expiresAt: null,
    revokedAt: null,
    createdAt: '2026-08-17T10:00:00.000Z',
    inheritedFrom: null,
    ...overrides,
  };
}

interface Scenario {
  grants?: ShareSummary[];
  createFails?: boolean;
  revokeFails?: boolean;
}

function install(scenario: Scenario = {}): { calls: string[]; bodies: unknown[] } {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  let minted = 0;

  const adapter: AxiosAdapter = async (config) => {
    const url = config.url ?? '';
    const method = (config.method ?? 'get').toUpperCase();
    calls.push(`${method} ${url}`);
    await Promise.resolve();

    if (method === 'GET' && url.endsWith('/shares')) {
      return respond(200, { items: scenario.grants ?? [], nextCursor: null });
    }

    if (method === 'POST' && url.endsWith('/shares')) {
      bodies.push(JSON.parse(String(config.data)));
      if (scenario.createFails === true) {
        throw reject(409, { code: 'CONFLICT', message: 'Already shared' });
      }
      minted += 1;
      return respond(201, {
        // A **valid** uuid: `CreatedShareSchema` says `z.uuid()` and the client
        // parses every response against it, so a short id makes the whole thing
        // fail to parse and every assertion lands on the error state instead.
        share: grant({ id: `00000000-0000-4000-8000-${String(minted).padStart(12, '0')}`, hasShortCode: true }),
        token: `${TOKEN.slice(0, -1)}${minted}`,
        shortCode: CODE,
      });
    }

    if (method === 'DELETE') {
      if (scenario.revokeFails === true) {
        throw reject(404, { code: 'NOT_FOUND', message: 'Not found' });
      }
      return respond(204, undefined);
    }

    return respond(200, {});
  };

  api.defaults.adapter = adapter;
  return { calls, bodies };
}

function renderDialog(open = true) {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ShareDialog nodeId={NODE} nodeName="Diligence" open={open} onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  install();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('creating a public link', () => {
  it('WEB-SHARING-001 opening the dialog creates no grant', async () => {
    const { calls } = install();
    renderDialog();

    await screen.findByRole('button', { name: 'Create a link' });

    // A dialog that mints on open leaves a live grant behind every time someone
    // opens it to look — including the times they close it again immediately.
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('WEB-SHARING-007 closing without generating leaves no grant behind', async () => {
    const { calls } = install();
    const { rerender } = renderDialog(true);

    await screen.findByRole('button', { name: 'Create a link' });

    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <ShareDialog nodeId={NODE} nodeName="Diligence" open={false} onOpenChange={() => undefined} />
      </QueryClientProvider>,
    );

    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('WEB-SHARING-008 generating shows the link once with a clear warning', async () => {
    install();
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Create a link' }));

    // The warning is a statement of fact, not urgency-flavoured copy: only the
    // SHA-256 is stored, so no endpoint can return this again.
    expect(await screen.findByText(/shown once and cannot be retrieved again/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Share link')).toHaveValue(shareUrl(CODE));
  });

  it('WEB-SHARING-009 reopening the dialog does not show the plaintext again', async () => {
    install({ grants: [grant({ hasShortCode: true })] });
    const { rerender } = renderDialog(true);

    await userEvent.click(await screen.findByRole('button', { name: 'Create a link' }));
    expect(await screen.findByLabelText('Share link')).toBeInTheDocument();

    // Closed, then reopened. The token lived in component state and the dialog
    // unmounts its body — there is nowhere for it to have survived.
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <ShareDialog nodeId={NODE} nodeName="Diligence" open={false} onOpenChange={() => undefined} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={createQueryClient()}>
        <ShareDialog nodeId={NODE} nodeName="Diligence" open onOpenChange={() => undefined} />
      </QueryClientProvider>,
    );

    await screen.findByRole('button', { name: 'Create a link' });
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
  });

  it('WEB-SHARING-010 copying puts the full URL on the clipboard, not the bare token', async () => {
    install();
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Create a link' }));
    await userEvent.click(await screen.findByRole('button', { name: /Copy/ }));

    // A bare token is not something a recipient can do anything with.
    const written = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0];
    expect(written).toBe(shareUrl(CODE));
    expect(written).toContain('/s/');
  });

  it('WEB-SHARING-005 copy confirms it copied', async () => {
    install();
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Create a link' }));
    await userEvent.click(await screen.findByRole('button', { name: /Copy/ }));

    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
  });

  it('WEB-SHARING-011 generating twice creates two distinct grants and says so', async () => {
    const { calls } = install();
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Create a link' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Create another link' }));

    await waitFor(() => {
      expect(calls.filter((call) => call.startsWith('POST'))).toHaveLength(2);
    });
    // Said plainly, because "create another" reads like "replace" otherwise —
    // and a link the owner believes is dead but is not is the worst outcome here.
    expect(screen.getByText(/does not replace this one/i)).toBeInTheDocument();
  });

  it('WEB-SHARING-013 the token never reaches the URL bar', async () => {
    install();
    const before = window.location.href;
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Create a link' }));
    await screen.findByLabelText('Share link');

    // It is rendered into an input and put on the clipboard. It is never
    // navigated to, so it cannot enter history or a `Referer` header.
    expect(window.location.href).toBe(before);
  });
});

describe('inviting a person', () => {
  it('WEB-SHARING-017 a malformed email is rejected before the request', async () => {
    const { calls } = install();
    renderDialog();

    await userEvent.type(await screen.findByPlaceholderText(/colleague@/), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText(/does not look like an email/i)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('WEB-SHARING-020 email whitespace is normalised before sending', async () => {
    const { bodies } = install();
    renderDialog();

    const input = await screen.findByPlaceholderText(/colleague@/);
    await userEvent.click(input);
    await userEvent.paste('  Bea@Example.com  ');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // Trimmed and NFC-normalised, matching the server. **Case is left alone** —
    // the column is `citext`, and folding it here too would be a second rule
    // that can disagree with the first.
    expect((bodies[0] as { email: string }).email).toBe('Bea@Example.com');
  });

  it('WEB-SHARING-018 inviting the same address twice is refused with an explanation', async () => {
    const { calls } = install({
      grants: [grant({ kind: 'user', principalEmail: 'bea@example.com', id: '00000000-0000-4000-8000-0000000000e2' })],
    });
    renderDialog();

    await screen.findByText('bea@example.com');
    await userEvent.type(screen.getByPlaceholderText(/colleague@/), 'BEA@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));

    // Refused here rather than sent and 409'd: the server would be right to
    // reject it and the user would have no idea why.
    expect(await screen.findByText(/already has access/i)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('WEB-SHARING-015 an address with no account shows a pending state, not an error', async () => {
    install({
      grants: [
        grant({
          kind: 'user',
          principalEmail: 'nobody@example.com',
          id: '00000000-0000-4000-8000-0000000000e3',
        }),
      ],
    });
    renderDialog();

    // Not an error: the grant is stored and inert until that person logs in.
    expect(await screen.findByText(/Pending/)).toBeInTheDocument();
    expect(screen.getByText(/applies once that account signs in/i)).toBeInTheDocument();
  });
});

describe('seeing and removing access', () => {
  it('WEB-SHARING-021 the list separates direct grants from inherited ones', async () => {
    install({
      grants: [
        grant({ id: '00000000-0000-4000-8000-0000000000e1' }),
        grant({
          id: '00000000-0000-4000-8000-0000000000e2',
          nodeId: ANCESTOR,
          inheritedFrom: { id: ANCESTOR, name: 'Project Meridian' },
        }),
      ],
    });
    renderDialog();

    expect(await screen.findByText('Shared directly')).toBeInTheDocument();
    expect(screen.getByText('Inherited from a parent folder')).toBeInTheDocument();
  });

  it('WEB-SHARING-003 an inherited grant names its source and offers no revoke', async () => {
    install({
      grants: [
        grant({
          id: '00000000-0000-4000-8000-0000000000e2',
          nodeId: ANCESTOR,
          inheritedFrom: { id: ANCESTOR, name: 'Project Meridian' },
        }),
      ],
    });
    renderDialog();

    const group = (await screen.findByText('Inherited from a parent folder')).parentElement;
    expect(group).not.toBeNull();

    /**
     * No revoke button, and the ancestor named instead.
     *
     * A revoke here would fail — the grant lives on the ancestor — and a control
     * that cannot work is worse than none. Telling the owner *where to go* is
     * the useful thing.
     */
    expect(within(group as HTMLElement).queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(within(group as HTMLElement).getByText(/Revoke on “Project Meridian”/)).toBeInTheDocument();
  });

  it('WEB-SHARING-004 a direct grant offers revoke, and confirms first', async () => {
    const { calls } = install({ grants: [grant()] });
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

    // Names what is being cut off rather than asking "are you sure?".
    expect(await screen.findByText(/stops working immediately for everyone/i)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });

  it('WEB-SHARING-023 confirming the revoke sends it', async () => {
    const { calls } = install({ grants: [grant()] });
    renderDialog();

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const dialog = await screen.findByRole('dialog', { name: /Revoke access/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(calls.some((call) => call.startsWith('DELETE'))).toBe(true));
  });

  it('WEB-SHARING-027 a node with no grants says so plainly', async () => {
    install({ grants: [] });
    renderDialog();

    // Rather than an empty table with headers over nothing.
    expect(await screen.findByText(/Nobody else has access/i)).toBeInTheDocument();
    expect(screen.queryByText('Shared directly')).not.toBeInTheDocument();
  });

  it('WEB-SHARING-026 an expired grant is shown as expired rather than omitted', async () => {
    install({
      grants: [grant({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() })],
    });
    renderDialog();

    // Silently omitting it would leave an owner believing access was never
    // granted, rather than that it lapsed.
    expect(await screen.findByText(/^Expired/)).toBeInTheDocument();
  });
});

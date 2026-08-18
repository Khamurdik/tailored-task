import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';

import { FileViewer, isFrameable } from '@web/features/viewer/file-viewer';
import { isExpiring } from '@web/features/viewer/use-content-url';
import { createQueryClient } from '@web/shared/query/query-client';

/**
 * The viewer, rendered for real.
 *
 * The security declaration in this file is `WEB-VIEWER-018`: a non-PDF must
 * never reach an `<iframe>`. It is asserted by querying for the frame's absence
 * rather than by checking a flag, because the property is about the DOM — a
 * component that computed `frameable` correctly and rendered the frame anyway
 * would pass any test of the flag.
 */
const { api } = await import('@web/shared/api/client');

const FILE = '00000000-0000-4000-8000-0000000000f1';

function respond(status: number, data: unknown): AxiosResponse {
  const config = { headers: new AxiosHeaders() } as AxiosResponse['config'];
  return { data, status, statusText: String(status), headers: new AxiosHeaders(), config };
}

function reject(status: number, data: unknown): AxiosError {
  const response = respond(status, data);
  return new AxiosError(`status ${status}`, String(status), response.config, null, response);
}

interface Scenario {
  fail?: boolean;
  ttlMs?: number;
}

function install(scenario: Scenario = {}): { calls: string[] } {
  const calls: string[] = [];
  let issued = 0;

  const adapter: AxiosAdapter = async (config) => {
    const url = config.url ?? '';
    calls.push(url);
    await Promise.resolve();

    if (scenario.fail === true) {
      throw reject(404, { code: 'NOT_FOUND', message: 'Not found' });
    }

    issued += 1;
    return respond(200, {
      // A different URL each time, so "was a fresh one requested?" is
      // observable rather than inferred from a call count alone.
      url: `https://storage.example/signed/${issued}`,
      expiresAt: new Date(Date.now() + (scenario.ttlMs ?? 60_000)).toISOString(),
    });
  };

  api.defaults.adapter = adapter;
  return { calls };
}

function file(overrides: Partial<{ name: string; contentType: string | null; sizeBytes: number | null }> = {}) {
  return {
    id: FILE,
    name: 'report.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
    ...overrides,
  };
}

function renderViewer(
  target: ReturnType<typeof file> | null = file(),
  options: { open?: boolean; readOnly?: boolean } = {},
) {
  const client = createQueryClient();
  const closes: number[] = [];

  const result = render(
    <QueryClientProvider client={client}>
      <FileViewer
        file={target}
        open={options.open ?? true}
        readOnly={options.readOnly ?? false}
        onClose={() => closes.push(1)}
      />
    </QueryClientProvider>,
  );

  return { closes, client, ...result };
}

beforeEach(() => {
  install();
});

describe('opening and rendering', () => {
  it('WEB-VIEWER-006 opening a PDF renders it in a frame', async () => {
    install();
    renderViewer();

    const frame = await screen.findByTitle('report.pdf');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', expect.stringContaining('storage.example'));
  });

  it('WEB-VIEWER-007 the viewer shows the file name and size', async () => {
    install();
    renderViewer(file({ sizeBytes: 2048 }));

    expect(await screen.findByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('WEB-VIEWER-011 a failed load renders an error with a retry, not a blank frame', async () => {
    const { calls } = install({ fail: true });
    renderViewer();

    // A viewer that fails silently reads as a broken file rather than a failed
    // request, and there is nothing for the person to do about it.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTitle('report.pdf')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
  });

  it('WEB-VIEWER-005 the loading state renders before the URL arrives', async () => {
    install();
    renderViewer();

    // `document`, not the render container: Radix portals dialog content to
    // `document.body`, so a container-scoped query finds nothing and the
    // assertion would pass or fail for the wrong reason.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    await screen.findByTitle('report.pdf');
  });
});

describe('what may be framed', () => {
  it('WEB-VIEWER-018 a non-PDF renders the unsupported state and never an iframe', async () => {
    install();
    renderViewer(file({ name: 'evil.html', contentType: 'text/html' }));

    /**
     * The one that matters.
     *
     * Uploads are served from the storage origin, where the web app's CSP does
     * not reach — and that CSP is the mitigation the entire `localStorage`
     * token decision rests on. Under `UPLOAD_FILE_POLICY=all-files` an uploaded
     * `.html` is a real possibility, so framing anything the component has not
     * positively identified as a PDF is how stored XSS reaches a session token.
     */
    expect(await screen.findByText('No preview for this file type')).toBeInTheDocument();
    expect(screen.queryByTitle('evil.html')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('WEB-VIEWER-010 an unsupported type still offers a download', async () => {
    install();
    renderViewer(file({ name: 'notes.txt', contentType: 'text/plain' }));

    const download = await screen.findByRole('link', { name: /Download/ });
    expect(download).toHaveAttribute('download', 'notes.txt');
  });

  it('WEB-VIEWER-019 the frameable check matches the media type, not the whole header', () => {
    // `application/pdf; charset=binary` is still a PDF, and a naive equality
    // check would send it down the unsupported path.
    expect(isFrameable('application/pdf')).toBe(true);
    expect(isFrameable('application/pdf; charset=binary')).toBe(true);
    expect(isFrameable('APPLICATION/PDF')).toBe(true);

    // A blocklist would be wrong the day a new type is added, so this is a
    // positive match on one type.
    for (const type of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'application/pdf-something',
      'text/plain',
      null,
    ]) {
      expect(isFrameable(type), String(type)).toBe(false);
    }
  });
});

describe('the signed URL', () => {
  it('WEB-VIEWER-001 the URL is fetched on open', async () => {
    const { calls } = install();
    renderViewer(file(), { open: false });

    // Nothing is requested for a closed viewer: every issued URL is another
    // unrevocable sixty-second credential.
    expect(calls).toHaveLength(0);
  });

  it('WEB-VIEWER-013 the signed URL never appears in a query key', async () => {
    install();
    const { client } = renderViewer();

    await screen.findByTitle('report.pdf');

    const keys = JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey));
    // A query key is the one structure react-query will happily serialise into
    // a devtools panel, and this URL is a bearer credential.
    expect(keys).not.toContain('storage.example');
    expect(keys).toContain(FILE);
  });

  it('WEB-VIEWER-014 reopening the same file requests a fresh URL', async () => {
    const { calls } = install();
    const { unmount } = renderViewer();
    await screen.findByTitle('report.pdf');
    expect(calls).toHaveLength(1);

    unmount();
    renderViewer();
    await screen.findByTitle('report.pdf');

    /**
     * `gcTime: 0` is the half that is easy to miss. Without it the entry
     * survives unmount, so closing a viewer and reopening it five minutes later
     * renders a long-dead URL out of the cache — which presents as "sometimes
     * the preview is blank".
     */
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it('WEB-VIEWER-002 an expiring URL is treated as needing a refetch', () => {
    const now = Date.now();

    // Comfortably alive.
    expect(isExpiring(new Date(now + 60_000).toISOString(), now)).toBe(false);
    // Inside the margin: a URL that dies while the request is in flight is
    // indistinguishable from one that was never valid.
    expect(isExpiring(new Date(now + 1_000).toISOString(), now)).toBe(true);
    expect(isExpiring(new Date(now - 1).toISOString(), now)).toBe(true);
    // Absent or unparseable is treated as expired rather than as fresh.
    expect(isExpiring(undefined, now)).toBe(true);
    expect(isExpiring('not a date', now)).toBe(true);
  });

  it('WEB-VIEWER-012 a viewer left open past expiry refetches on the next interaction', async () => {
    // A URL that is already inside the expiry margin when it arrives.
    const { calls } = install({ ttlMs: 1_000 });
    renderViewer();

    await screen.findByTitle('report.pdf');
    expect(calls).toHaveLength(1);

    // Dispatched on `window` rather than clicked through `userEvent`: an open
    // Radix dialog sets `pointer-events: none` on the body, so a synthetic
    // click is refused. The listener is on `window` anyway — the point is the
    // interaction, not a timer. A `setInterval` refreshing a signed URL keeps a
    // credential alive for as long as the tab is open, which is the opposite of
    // what a sixty-second TTL is for.
    fireEvent.pointerDown(window);

    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
  });

  it('WEB-VIEWER-015 download reuses the URL already fetched', async () => {
    const { calls } = install();
    renderViewer();

    const frame = await screen.findByTitle('report.pdf');
    const download = screen.getByRole('link', { name: /Download/ });

    // The same URL the frame is showing, not a second one — every extra issued
    // URL is another credential with its own life.
    expect(download).toHaveAttribute('href', frame.getAttribute('src'));
    expect(calls).toHaveLength(1);
  });

  it('WEB-VIEWER-016 the download keeps the display name', async () => {
    install();
    renderViewer(file({ name: 'Звіт за квартал.pdf' }));

    const download = await screen.findByRole('link', { name: /Download/ });
    // The name the tree knows, not the storage key — the key is ids only, by
    // design, so without this the file downloads as a uuid.
    expect(download).toHaveAttribute('download', 'Звіт за квартал.pdf');
  });
});

describe('closing and context', () => {
  it('WEB-VIEWER-017 the viewer offers no mutating affordance in a share view', async () => {
    install();
    renderViewer(file(), { readOnly: true });

    await screen.findByTitle('report.pdf');

    // Absent, not disabled — the same rule the explorer's `readOnly` follows.
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rename/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    // And the reading half still works.
    expect(screen.getByRole('link', { name: /Download/ })).toBeInTheDocument();
  });

  it('WEB-VIEWER-004 the same component renders for a share visitor', async () => {
    // No token is passed: the request interceptor attaches whichever credential
    // the session holds, and the server's guard decides. A viewer that took a
    // token would be a second place deciding what a request carries.
    const { calls } = install();
    renderViewer(file(), { readOnly: true });

    await screen.findByTitle('report.pdf');
    expect(calls).toEqual([`/nodes/${FILE}/content-url`]);
  });

  it('WEB-VIEWER-009 Escape closes the viewer', async () => {
    install();
    const { closes } = renderViewer();

    await screen.findByTitle('report.pdf');
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(closes).toHaveLength(1));
  });
});

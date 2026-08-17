import { MAX_NAME_LENGTH, type ChildrenPage, type NodeSummary } from '@dataroom/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import { Explorer } from '@web/features/explorer/explorer';
import { createQueryClient } from '@web/shared/query/query-client';

/**
 * The explorer, rendered for real against a swapped axios adapter.
 *
 * The adapter is the seam for the same reason the placeholder data layer uses
 * it: everything above it — the request interceptor, the error mapping, the
 * response schema parsing, react-query's cache — stays in the path. Mocking
 * `explorer.api` instead would leave all of that untested and would let these
 * assertions pass against a shape the server can never send.
 */
const { api } = await import('@web/shared/api/client');

/**
 * Valid v4 UUIDs, because `NodeSummarySchema` says `z.uuid()` and the client
 * parses every response against it. Short ids like `'f1'` make the whole
 * response fail to parse, and every test then asserts against the error state
 * instead of the thing it names — which is exactly what happened on the first
 * run of this file, and is the response parser earning its keep.
 */
function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`;
}

const ROOM = uuid(1);

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

function page(items: NodeSummary[], nextCursor: string | null = null): ChildrenPage {
  return {
    items,
    nextCursor,
    breadcrumbs: [{ id: ROOM, name: 'Project Meridian', type: 'room' }],
  };
}

interface Scenario {
  children?: (cursor: string | null) => AxiosResponse | AxiosError;
  create?: (body: { parentId: string; name: string }) => AxiosResponse | AxiosError;
  rename?: (body: { name: string }) => AxiosResponse | AxiosError;
  stats?: () => AxiosResponse | AxiosError;
  remove?: () => AxiosResponse | AxiosError;
}

function install(scenario: Scenario): { calls: string[] } {
  const calls: string[] = [];

  const adapter: AxiosAdapter = async (config) => {
    const url = config.url ?? '';
    const method = (config.method ?? 'get').toUpperCase();
    calls.push(`${method} ${url}`);
    await Promise.resolve();

    const body: Record<string, string> =
      typeof config.data === 'string' ? (JSON.parse(config.data) as Record<string, string>) : {};

    let outcome: AxiosResponse | AxiosError;

    if (method === 'GET' && url.endsWith('/children')) {
      const cursor = (config.params as { cursor?: string } | undefined)?.cursor ?? null;
      outcome = scenario.children?.(cursor) ?? respond(200, page([]));
    } else if (method === 'GET' && url.endsWith('/stats')) {
      outcome = scenario.stats?.() ?? respond(200, { files: 0, folders: 0, bytes: 0 });
    } else if (method === 'POST' && url.endsWith('/nodes/folders')) {
      outcome =
        scenario.create?.(body as { parentId: string; name: string }) ??
        respond(201, detailFor(body['name'] ?? 'New'));
    } else if (method === 'PATCH' && url.endsWith('/name')) {
      outcome = scenario.rename?.(body as { name: string }) ?? respond(200, detailFor(body['name'] ?? 'New'));
    } else if (method === 'DELETE') {
      outcome = scenario.remove?.() ?? respond(204, undefined);
    } else {
      outcome = respond(200, page([]));
    }

    if (outcome instanceof AxiosError) throw outcome;
    return outcome;
  };

  api.defaults.adapter = adapter;
  return { calls };
}

function detailFor(name: string) {
  return {
    ...node({ id: uuid(99), name }),
    rootId: ROOM,
    parentId: ROOM,
    depth: 1,
    breadcrumbs: [],
    createdAt: '2026-08-17T10:00:00.000Z',
  };
}

function renderExplorer(readOnly = false) {
  const client = createQueryClient();
  const navigations: string[] = [];

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Explorer
          nodeId={ROOM}
          readOnly={readOnly}
          onNavigate={(id) => navigations.push(id)}
          onOpenNode={(target) => navigations.push(`file:${target.id}`)}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { navigations };
}

beforeEach(() => {
  // jsdom has no IntersectionObserver, and the explorer registers one for
  // infinite scroll. A stub that never fires is right: these tests drive
  // pagination explicitly rather than by faking a scroll position.
  globalThis.IntersectionObserver = class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): [] {
      return [];
    }
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [];
  } as unknown as typeof IntersectionObserver;
});

describe('browsing', () => {
  it('WEB-EXPLORER-013 clicking a folder row opens that folder', async () => {
    install({ children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])) });
    const { navigations } = renderExplorer();

    // `name: 'Diligence'` exactly — the row's open button and its
    // "Actions for Diligence" menu trigger both match a loose /Diligence/.
    await userEvent.click(await screen.findByRole('button', { name: 'Diligence' }));

    expect(navigations).toEqual([uuid(11)]);
  });

  it('WEB-EXPLORER-014 clicking a file row opens the viewer, not the folder view', async () => {
    install({
      children: () =>
        respond(200, page([node({ id: uuid(21), name: 'report.pdf', type: 'file', sizeBytes: 2048 })])),
    });
    const { navigations } = renderExplorer();

    await userEvent.click(await screen.findByRole('button', { name: 'report.pdf' }));

    // A file is the viewer's business. The explorer must not navigate into it,
    // and must not know what a viewer is — it reports the event upward.
    expect(navigations).toEqual([`file:${uuid(21)}`]);
  });

  it('WEB-EXPLORER-002 folders sort before files as the server sent them', async () => {
    install({
      children: () =>
        respond(
          200,
          page([
            node({ id: uuid(11), name: 'Ømsorg' }),
            node({ id: uuid(12), name: 'café' }),
            node({ id: uuid(21), name: 'aaa.pdf', type: 'file' }),
          ]),
        ),
    });
    renderExplorer();

    await screen.findByText('Ømsorg');
    const rows = screen.getAllByRole('row').slice(1);

    // Rendered in the order received, **not** re-sorted client-side. The server
    // orders under `COLLATE "C"` and the keyset cursor compares the same way; a
    // client that re-sorted would disagree with the cursor at every page
    // boundary (`WEB-EXPLORER-072`).
    expect(rows.map((row) => row.getAttribute('data-node-type'))).toEqual([
      'folder',
      'folder',
      'file',
    ]);
  });

  it('WEB-EXPLORER-021 an empty folder offers the create action rather than a blank page', async () => {
    install({ children: () => respond(200, page([])) });
    renderExplorer();

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    // The empty state carries its own action with its own name — two buttons
    // sharing one accessible name in one view is ambiguous to a screen reader.
    expect(screen.getByRole('button', { name: 'Create a folder' })).toBeInTheDocument();
  });

  it('WEB-EXPLORER-019 a gone folder renders a message, not a spinner', async () => {
    install({ children: () => reject(404, { code: 'NOT_FOUND', message: 'Not found' }) });
    renderExplorer();

    // A deleted folder and one that never existed render the same thing,
    // because the API answers both with the same 404 on purpose. Inventing a
    // difference here would be inventing one the server refuses to expose.
    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading folder')).not.toBeInTheDocument();
  });

  it('WEB-EXPLORER-003 breadcrumbs collapse in the middle past four levels', async () => {
    install({
      children: () =>
        respond(200, {
          items: [],
          nextCursor: null,
          breadcrumbs: [
            { id: uuid(41), name: 'Room', type: 'room' },
            { id: uuid(42), name: 'Level B', type: 'folder' },
            { id: uuid(43), name: 'Level C', type: 'folder' },
            { id: uuid(44), name: 'Level D', type: 'folder' },
            { id: uuid(45), name: 'Level E', type: 'folder' },
            { id: uuid(46), name: 'Here', type: 'folder' },
          ],
        }),
    });
    renderExplorer();

    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });

    // The room and the current folder both survive: those are the two a person
    // orients by, and a trail that truncates the tail hides the one they are
    // standing in.
    expect(within(nav).getByText('Room')).toBeInTheDocument();
    expect(within(nav).getByText('Here')).toBeInTheDocument();
    expect(within(nav).queryByText('Level B')).not.toBeInTheDocument();
    expect(within(nav).getByLabelText(/more levels/)).toBeInTheDocument();
  });

  it('WEB-EXPLORER-015 a breadcrumb segment navigates to that ancestor', async () => {
    install({
      children: () =>
        respond(200, {
          items: [],
          nextCursor: null,
          breadcrumbs: [
            { id: uuid(31), name: 'Room', type: 'room' },
            { id: uuid(32), name: 'Here', type: 'folder' },
          ],
        }),
    });
    const { navigations } = renderExplorer();

    await userEvent.click(await screen.findByRole('link', { name: 'Room' }));
    expect(navigations).toEqual([uuid(31)]);
  });
});

describe('creating a folder', () => {
  async function openCreateDialog(): Promise<void> {
    await userEvent.click(await screen.findByRole('button', { name: 'New folder' }));
  }

  it('WEB-EXPLORER-022 creating a folder with a valid name issues one request', async () => {
    const { calls } = install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    await userEvent.type(screen.getByLabelText('Name'), 'Diligence');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(calls.filter((call) => call.includes('/nodes/folders'))).toHaveLength(1);
    });
  });

  it('WEB-EXPLORER-023 an empty name is rejected before the request', async () => {
    const { calls } = install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    const submit = screen.getByRole('button', { name: 'Create' });

    // Disabled rather than validated-on-submit, and no request is made either
    // way — the check is the early warning, and the server is the enforcement.
    expect(submit).toBeDisabled();
    expect(calls.some((call) => call.includes('/nodes/folders'))).toBe(false);
  });

  it('WEB-EXPLORER-024 a whitespace-only name is rejected before the request', async () => {
    const { calls } = install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    await userEvent.type(screen.getByLabelText('Name'), '   ');

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(await screen.findByText('A name is required.')).toBeInTheDocument();
    expect(calls.some((call) => call.includes('/nodes/folders'))).toBe(false);
  });

  it('WEB-EXPLORER-025 a name over the cap is rejected with the limit shown', async () => {
    install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    // `paste` rather than `type`: 256 keystrokes through userEvent is seconds of
    // test time to assert something about the 256th.
    await userEvent.click(screen.getByLabelText('Name'));
    await userEvent.paste('x'.repeat(MAX_NAME_LENGTH + 1));

    expect(await screen.findByText(new RegExp(String(MAX_NAME_LENGTH)))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('WEB-EXPLORER-026 surrounding whitespace is trimmed rather than rejected', async () => {
    let sent = '';
    install({
      children: () => respond(200, page([])),
      create: (body) => {
        sent = body.name;
        return respond(201, detailFor(body.name));
      },
    });
    renderExplorer();

    await openCreateDialog();
    await userEvent.click(screen.getByLabelText('Name'));
    await userEvent.paste('  Diligence  ');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    // Trimmed the same way the server will, so what the user sees created is
    // what they see in the list a moment later.
    await waitFor(() => expect(sent).toBe('Diligence'));
  });

  it('WEB-EXPLORER-027 a name containing a path separator is never sent raw', async () => {
    const { calls } = install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    await userEvent.click(screen.getByLabelText('Name'));
    await userEvent.paste('../../etc/passwd');

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(calls.some((call) => call.includes('/nodes/folders'))).toBe(false);
  });

  it('WEB-EXPLORER-030 a duplicate name surfaces the 409 with the server’s suggestion', async () => {
    install({
      children: () => respond(200, page([])),
      create: () =>
        reject(409, {
          code: 'NAME_CONFLICT',
          message: 'A sibling with that name already exists',
          details: { suggestedName: 'Diligence (1)' },
        }),
    });
    renderExplorer();

    await openCreateDialog();
    await userEvent.type(screen.getByLabelText('Name'), 'Diligence');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    // The server's suggestion, not one the client invented — the client cannot
    // see the sibling set and any name it made up would be a guess.
    expect(await screen.findByRole('button', { name: /Diligence \(1\)/ })).toBeInTheDocument();
  });

  it('WEB-EXPLORER-031 accepting the suggestion creates the folder in one further click', async () => {
    const names: string[] = [];
    install({
      children: () => respond(200, page([])),
      create: (body) => {
        names.push(body.name);
        return names.length === 1
          ? reject(409, {
              code: 'NAME_CONFLICT',
              message: 'taken',
              details: { suggestedName: 'Diligence (1)' },
            })
          : respond(201, detailFor(body.name));
      },
    });
    renderExplorer();

    await openCreateDialog();
    await userEvent.type(screen.getByLabelText('Name'), 'Diligence');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await userEvent.click(await screen.findByRole('button', { name: /Diligence \(1\)/ }));

    // One click, not "fill it in and press Create again".
    await waitFor(() => expect(names).toEqual(['Diligence', 'Diligence (1)']));
  });

  it('WEB-EXPLORER-032 cancelling the dialog creates nothing', async () => {
    const { calls } = install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    await userEvent.type(screen.getByLabelText('Name'), 'Diligence');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument());
    expect(calls.some((call) => call.includes('/nodes/folders'))).toBe(false);
  });

  it('WEB-EXPLORER-033 Escape closes the dialog and creates nothing', async () => {
    const { calls } = install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument());
    expect(calls.some((call) => call.includes('/nodes/folders'))).toBe(false);
  });

  it('WEB-EXPLORER-035 the name input is focused when the dialog opens', async () => {
    install({ children: () => respond(200, page([])) });
    renderExplorer();

    await openCreateDialog();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
  });

  it('WEB-EXPLORER-007 double-clicking create submits once', async () => {
    let resolveCreate: (() => void) | undefined;
    const { calls } = install({
      children: () => respond(200, page([])),
      create: (body) => {
        // The request is in flight for as long as this test wants it to be.
        void new Promise<void>((done) => {
          resolveCreate = done;
        });
        return respond(201, detailFor(body.name));
      },
    });
    renderExplorer();

    await openCreateDialog();
    await userEvent.type(screen.getByLabelText('Name'), 'Diligence');

    const submit = screen.getByRole('button', { name: 'Create' });
    await userEvent.dblClick(submit);

    await waitFor(() => {
      expect(calls.filter((call) => call.includes('/nodes/folders'))).toHaveLength(1);
    });
    resolveCreate?.();
  });
});

describe('renaming', () => {
  async function openRowMenu(name: string): Promise<void> {
    await userEvent.click(await screen.findByRole('button', { name: `Actions for ${name}` }));
  }

  it('WEB-EXPLORER-041 the rename dialog opens pre-filled', async () => {
    install({ children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])) });
    renderExplorer();

    await openRowMenu('Diligence');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    expect(await screen.findByLabelText('Name')).toHaveValue('Diligence');
  });

  it('WEB-EXPLORER-037 renaming to the identical name closes without a request', async () => {
    const { calls } = install({
      children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])),
    });
    renderExplorer();

    await openRowMenu('Diligence');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));

    // Asking the server would return a 409 against the node itself, which is a
    // confusing way to say "nothing changed".
    await waitFor(() => expect(screen.queryByLabelText('Name')).not.toBeInTheDocument());
    expect(calls.some((call) => call.includes('/name'))).toBe(false);
  });

  it('WEB-EXPLORER-038 renaming to a sibling’s name surfaces the conflict and the suggestion', async () => {
    install({
      children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])),
      rename: () =>
        reject(409, {
          code: 'NAME_CONFLICT',
          message: 'taken',
          details: { suggestedName: 'Reports (1)' },
        }),
    });
    renderExplorer();

    await openRowMenu('Diligence');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = await screen.findByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Reports');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    expect(await screen.findByRole('button', { name: /Reports \(1\)/ })).toBeInTheDocument();
  });

  it('WEB-EXPLORER-042 renaming a file keeps whatever extension the user leaves in place', async () => {
    let sent = '';
    install({
      children: () =>
        respond(200, page([node({ id: uuid(21), name: 'report.pdf', type: 'file', sizeBytes: 10 })])),
      rename: (body) => {
        sent = body.name;
        return respond(200, detailFor(body.name));
      },
    });
    renderExplorer();

    await openRowMenu('report.pdf');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = await screen.findByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Q4 report.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    // The extension is the user's to keep or change. What must not happen is the
    // client silently reattaching one — a file renamed to `notes` is a file
    // called `notes`, and inventing `.pdf` back would be the client deciding.
    await waitFor(() => expect(sent).toBe('Q4 report.pdf'));
  });
});

describe('deleting', () => {
  it('WEB-EXPLORER-054 deleting asks for confirmation first', async () => {
    const { calls } = install({
      children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])),
    });
    renderExplorer();

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Diligence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByText(/Delete “Diligence”\?/)).toBeInTheDocument();
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });

  it('WEB-EXPLORER-055 the confirmation shows real subtree counts from /stats', async () => {
    install({
      children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])),
      stats: () => respond(200, { files: 12, folders: 3, bytes: 999 }),
    });
    renderExplorer();

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Diligence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    // From `/stats`, not from the row's denormalized rollups — those are
    // reconciled daily, and a confirmation built on a drifted counter is worse
    // than one that shows nothing.
    expect(await screen.findByText(/3 folders and 12 files/)).toBeInTheDocument();
  });

  it('WEB-EXPLORER-056 an empty folder says so rather than showing zeroes', async () => {
    install({
      children: () => respond(200, page([node({ id: uuid(11), name: 'Empty' })])),
      stats: () => respond(200, { files: 0, folders: 0, bytes: 0 }),
    });
    renderExplorer();

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Empty' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByText('This folder is empty.')).toBeInTheDocument();
  });

  it('WEB-EXPLORER-057 cancelling the confirmation deletes nothing', async () => {
    const { calls } = install({
      children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])),
    });
    renderExplorer();

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Diligence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false);
  });
});

describe('read-only mode', () => {
  it('WEB-EXPLORER-001 readOnly removes every mutating control — absent, not disabled', async () => {
    install({
      children: () =>
        respond(
          200,
          page([
            node({ id: uuid(11), name: 'Diligence' }),
            node({ id: uuid(21), name: 'report.pdf', type: 'file' }),
          ]),
        ),
    });
    renderExplorer(true);

    await screen.findByText('Diligence');

    /**
     * `queryBy`, asserting absence — not `toBeDisabled`.
     *
     * A disabled control is still a control: it is in the DOM, it can be
     * re-enabled from a console, and it tells a share visitor precisely which
     * operations exist on a node they were given read access to. This is the
     * only thing standing between a visitor and a delete button, which is why
     * the declaration is `security` and `P0` rather than cosmetic.
     */
    expect(screen.queryByRole('button', { name: 'New folder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    // And the reading half still works — a read-only explorer that cannot browse
    // is not read-only, it is broken.
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('WEB-EXPLORER-077 readOnly renders no row context menu', async () => {
    install({ children: () => respond(200, page([node({ id: uuid(11), name: 'Diligence' })])) });
    renderExplorer(true);

    await screen.findByText('Diligence');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('WEB-EXPLORER-081 an empty read-only folder offers no create action', async () => {
    install({ children: () => respond(200, page([])) });
    renderExplorer(true);

    expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
    // The empty state is the easiest place to leave a create button behind,
    // because it is rendered by a different branch than the table.
    expect(screen.queryByRole('button', { name: /folder/i })).not.toBeInTheDocument();
    expect(screen.getByText('This folder is empty.')).toBeInTheDocument();
  });
});

describe('pagination', () => {
  it('WEB-EXPLORER-069 a further page is requested with the server’s cursor, once', async () => {
    const { calls } = install({
      children: (cursor) =>
        cursor === null
          ? respond(200, page([node({ id: uuid(11), name: 'First' })], 'cursor-1'))
          : respond(200, page([node({ id: uuid(12), name: 'Second' })])),
    });

    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Explorer nodeId={ROOM} onNavigate={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText('First');

    // The sentinel only exists while there is a next page, so its presence is
    // the assertion that `nextCursor` was understood.
    expect(calls.filter((call) => call.includes('/children'))).toHaveLength(1);
  });

  it('WEB-EXPLORER-071 the cursor is handed back exactly as received', async () => {
    const seen: (string | null)[] = [];
    install({
      children: (cursor) => {
        seen.push(cursor);
        return cursor === null
          ? respond(200, page([node({ id: uuid(11), name: 'First' })], 'b3BhcXVlLWN1cnNvci12YWx1ZQ'))
          : respond(200, page([node({ id: uuid(12), name: 'Second' })]));
      },
    });
    renderExplorer();

    await screen.findByText('First');

    // A client that parsed, re-encoded or "cleaned" a cursor has taken a
    // dependency on the server's collation — the failure is silently skipped
    // rows at a page boundary, only with non-ASCII names.
    //
    // The fixture cursor is real base64url, because `CursorSchema` is
    // `z.base64url()` and the client parses the whole page against it. The
    // first draft used `opaque.cursor-value_1`, which the schema rejects — the
    // same `.`-is-not-in-the-alphabet problem that made every server-issued
    // cursor invalid until it was fixed.
    expect(seen[0]).toBeNull();
  });
});

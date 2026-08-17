import { MAX_FILE_SIZE } from '@dataroom/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';

import { UploadDropzone } from '@web/features/uploads/upload-dropzone';
import { UploadPanel } from '@web/features/uploads/upload-panel';
import { resetUploadRunner, useUploadRunner } from '@web/features/uploads/use-uploads';
import { rejectionFor, useUploadQueue } from '@web/features/uploads/upload-queue';
import { createQueryClient } from '@web/shared/query/query-client';

/**
 * The upload queue, driven through the real components.
 *
 * Both axios instances are stubbed: the API client for `/uploads/init` and
 * `/complete`, and the **transfer** client for the presigned PUT. Stubbing only
 * the first is how the raw-`XMLHttpRequest` version of this feature passed its
 * tests and still failed in every environment anyone could actually run — the
 * bytes never went through a seam the test could see.
 */
const { api } = await import('@web/shared/api/client');
const uploadsApi = await import('@web/features/uploads/uploads.api');

const PARENT = '00000000-0000-4000-8000-000000000001';
const NODE = '00000000-0000-4000-8000-0000000000a1';

function respond(status: number, data: unknown): AxiosResponse {
  const config = { headers: new AxiosHeaders() } as AxiosResponse['config'];
  return { data, status, statusText: String(status), headers: new AxiosHeaders(), config };
}

function detail(name: string) {
  return {
    id: NODE,
    type: 'file' as const,
    name,
    state: 'active' as const,
    sizeBytes: 4,
    contentType: 'application/pdf',
    subtreeFiles: null,
    subtreeBytes: null,
    updatedAt: '2026-08-17T10:00:00.000Z',
    rootId: PARENT,
    parentId: PARENT,
    depth: 1,
    breadcrumbs: [],
    createdAt: '2026-08-17T10:00:00.000Z',
  };
}

interface Scenario {
  finalName?: string;
  /** Resolves the PUT when called. Left unset, the transfer completes at once. */
  holdTransfer?: boolean;
  failTransfer?: boolean;
}

let releaseTransfer: (() => void) | undefined;
let progressOf: ((percent: number) => void) | undefined;

function install(scenario: Scenario = {}): { calls: string[] } {
  const calls: string[] = [];

  const apiAdapter: AxiosAdapter = async (config) => {
    const url = config.url ?? '';
    calls.push(`${(config.method ?? 'get').toUpperCase()} ${url}`);
    await Promise.resolve();

    if (url.endsWith('/uploads/init')) {
      const body = JSON.parse(String(config.data)) as { name: string };
      return respond(201, {
        nodeId: NODE,
        uploadUrl: `mock://uploads/${NODE}`,
        finalName: scenario.finalName ?? body.name,
      });
    }
    if (url.endsWith('/complete')) return respond(201, detail(scenario.finalName ?? 'a.pdf'));
    if (url.endsWith('/abort')) return respond(204, undefined);
    return respond(200, {});
  };

  // The byte transfer, on its own client — the one the mock adapter answers in
  // `VITE_API_MODE=mock` and a real bucket answers in production.
  const transferAdapter: AxiosAdapter = async (config) => {
    calls.push(`PUT ${config.url ?? ''}`);

    const onProgress = config.onUploadProgress;
    progressOf = (percent) => onProgress?.({ loaded: percent, total: 100, bytes: 0, lengthComputable: true });

    if (scenario.failTransfer === true) throw new Error('The connection dropped mid-transfer');

    if (scenario.holdTransfer === true) {
      await new Promise<void>((resolve, reject) => {
        releaseTransfer = resolve;
        // `signal` is typed as `GenericAbortSignal`, whose `addEventListener` is
        // optional — an axios signal need not be a DOM `AbortSignal`.
        config.signal?.addEventListener?.('abort', () => {
          const cancel = new Error('canceled') as Error & { __CANCEL__?: boolean };
          // What `axios.isCancel` looks for.
          cancel.__CANCEL__ = true;
          reject(cancel);
        });
      });
    }

    return respond(200, '');
  };

  api.defaults.adapter = apiAdapter;
  // The transfer client is exported for exactly this: the bytes travel on their
  // own credential-free instance, and a test that only stubbed `api` would not
  // see them at all.
  uploadsApi.transfer.defaults.adapter = transferAdapter;

  return { calls };
}

function Harness({ parentId = PARENT }: { parentId?: string }) {
  useUploadRunner();
  return (
    <>
      <UploadDropzone parentId={parentId}>
        <p>folder contents</p>
      </UploadDropzone>
      <UploadPanel />
    </>
  );
}

function renderUploads() {
  const client = createQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

function pdf(name: string, bytes = 4): File {
  return new File([new Uint8Array(bytes).fill(37)], name, { type: 'application/pdf' });
}

beforeEach(() => {
  useUploadQueue.getState().reset();
  resetUploadRunner();
  releaseTransfer = undefined;
  progressOf = undefined;
});

describe('starting an upload', () => {
  it('WEB-UPLOADS-012 choosing files through the picker queues them', async () => {
    install();
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));

    // The visible button is not a fallback for drag-and-drop — for a touch
    // device or a screen reader it is the only path.
    await waitFor(() => {
      expect(useUploadQueue.getState().items).toHaveLength(1);
    });
  });

  it('WEB-UPLOADS-013 dropping twenty files queues twenty items', async () => {
    install();
    renderUploads();

    const files = Array.from({ length: 20 }, (_, index) => pdf(`file-${index}.pdf`));
    await userEvent.upload(screen.getByTestId('upload-input'), files);

    await waitFor(() => expect(useUploadQueue.getState().items).toHaveLength(20));
  });

  it('WEB-UPLOADS-017 files land in the folder currently being viewed', async () => {
    install();
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));

    await waitFor(() => {
      expect(useUploadQueue.getState().items[0]?.parentId).toBe(PARENT);
    });
  });
});

describe('validation', () => {
  it('WEB-UPLOADS-020 a file over the limit is rejected before any request', () => {
    // Asserted on the pure function rather than by constructing a 50 MB File in
    // jsdom, which allocates it for real.
    const huge = { size: MAX_FILE_SIZE + 1, name: 'huge.pdf' } as File;
    expect(rejectionFor(huge)).not.toBeNull();
  });

  it('WEB-UPLOADS-021 the rejection names the file and the limit', async () => {
    install();
    renderUploads();

    const huge = new File([new Uint8Array(10)], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: MAX_FILE_SIZE + 1 });
    await userEvent.upload(screen.getByTestId('upload-input'), huge);

    // "Some files were rejected" is not something a person can act on.
    expect(await screen.findByText('huge.pdf')).toBeInTheDocument();
    expect(screen.getByText(/50 MB limit/)).toBeInTheDocument();
    expect(useUploadQueue.getState().items).toHaveLength(0);
  });

  it('WEB-UPLOADS-022 a zero-byte file is rejected with its own message', () => {
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
    // Its own message, because a zero-byte file is usually a failed export or a
    // directory dragged in — and "too large" would be nonsense.
    expect(rejectionFor(empty)).toBe('This file is empty.');
  });

  it('WEB-UPLOADS-024 a mixed drop uploads the valid files and reports only the rejected', async () => {
    install();
    renderUploads();

    const huge = new File([new Uint8Array(10)], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(huge, 'size', { value: MAX_FILE_SIZE + 1 });

    await userEvent.upload(screen.getByTestId('upload-input'), [pdf('good.pdf'), huge]);

    // Refusing the whole batch would make one bad file in twenty everybody's
    // problem.
    await waitFor(() => expect(useUploadQueue.getState().items).toHaveLength(1));
    expect(useUploadQueue.getState().items[0]?.file.name).toBe('good.pdf');
    expect(await screen.findByText('huge.pdf')).toBeInTheDocument();
  });

  it('WEB-UPLOADS-025 an all-rejected drop leaves the queue untouched', async () => {
    install();
    renderUploads();

    const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByTestId('upload-input'), empty);

    expect(await screen.findByText('empty.pdf')).toBeInTheDocument();
    expect(useUploadQueue.getState().items).toHaveLength(0);
  });
});

describe('the queue', () => {
  it('WEB-UPLOADS-010 queue state lives in zustand, not in the query cache', async () => {
    install();
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));
    await waitFor(() => expect(useUploadQueue.getState().items).toHaveLength(1));

    /**
     * Nothing about the transfer is in the query cache. Progress is client
     * state — it has no server to be stale against, it changes many times a
     * second, and putting it in the cache is what makes uploads die on
     * navigation.
     */
    const cached = JSON.stringify(client.getQueryCache().getAll().map((query) => query.queryKey));
    expect(cached).not.toContain('upload');
  });

  it('WEB-UPLOADS-002 concurrency is capped at three however many are dropped', async () => {
    install({ holdTransfer: true });
    renderUploads();

    const files = Array.from({ length: 8 }, (_, index) => pdf(`file-${index}.pdf`));
    await userEvent.upload(screen.getByTestId('upload-input'), files);

    await waitFor(() => {
      const active = useUploadQueue
        .getState()
        .items.filter((item) => item.status === 'uploading').length;
      expect(active).toBe(3);
    });

    // An unbounded queue on a large drop opens every connection at once and
    // renders a wall of 0% bars, which looks broken and finishes later.
    expect(useUploadQueue.getState().items.filter((item) => item.status === 'queued')).toHaveLength(5);
  });

  it('WEB-UPLOADS-009 the panel is dismissible and reappears on a new upload', async () => {
    install({ holdTransfer: true });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('first.pdf'));
    await screen.findByRole('complementary', { name: 'Uploads' });

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss uploads panel' }));
    expect(screen.queryByRole('complementary', { name: 'Uploads' })).not.toBeInTheDocument();

    // Dismissed, not cancelled — the transfer is still running behind it.
    expect(useUploadQueue.getState().items[0]?.status).toBe('uploading');

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('second.pdf'));
    expect(await screen.findByRole('complementary', { name: 'Uploads' })).toBeInTheDocument();
  });
});

describe('progress and completion', () => {
  it('WEB-UPLOADS-003 an item walks queued → uploading → completing → done', async () => {
    const seen: string[] = [];
    const unsubscribe = useUploadQueue.subscribe((state) => {
      const status = state.items[0]?.status;
      if (status !== undefined && seen.at(-1) !== status) seen.push(status);
    });

    install({ holdTransfer: true });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));
    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('uploading'));

    act(() => releaseTransfer?.());

    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('done'));
    unsubscribe();

    // `completing` is its own state because a full bar that has not finished
    // reads as stuck — `/complete` verifies the object and takes time.
    expect(seen).toContain('uploading');
    expect(seen).toContain('completing');
    expect(seen).toContain('done');
  });

  it('WEB-UPLOADS-027 progress comes from real transfer events', async () => {
    install({ holdTransfer: true });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));
    await waitFor(() => expect(progressOf).toBeDefined());

    act(() => progressOf?.(42));

    // The number moved because the transport said so, not because a timer
    // advanced it.
    await waitFor(() => expect(useUploadQueue.getState().items[0]?.progress).toBe(42));
    expect(await screen.findByText('42%')).toBeInTheDocument();
  });

  it('WEB-UPLOADS-008 a resolved name that differs is surfaced', async () => {
    install({ finalName: 'report (2).pdf' });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));

    // Silently renaming someone's file and never saying so is how they later
    // cannot find it.
    expect(await screen.findByText('uploaded as report (2).pdf')).toBeInTheDocument();
  });

  it('WEB-UPLOADS-007 each completion invalidates the tree, not one batch at the end', async () => {
    const { calls } = install();
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));

    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('done'));
    expect(calls).toContain('POST /uploads/init');
    expect(calls).toContain(`PUT mock://uploads/${NODE}`);
    expect(calls).toContain(`POST /uploads/${NODE}/complete`);
  });
});

describe('cancelling and retrying', () => {
  it('WEB-UPLOADS-004 cancelling aborts the transfer and calls /abort', async () => {
    const { calls } = install({ holdTransfer: true });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));
    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('uploading'));

    await userEvent.click(screen.getByRole('button', { name: 'Cancel report.pdf' }));

    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('cancelled'));
    // The pending row goes too. Leaving it holds the name against the unique
    // index until the reaper catches up an hour later.
    await waitFor(() => expect(calls).toContain(`POST /uploads/${NODE}/abort`));
  });

  it('WEB-UPLOADS-005 a failed file can be retried without re-dropping it', async () => {
    install({ failTransfer: true });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));
    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('error'));

    // Re-dropping is what people do when there is no retry, and it is how a
    // folder ends up with `report.pdf` and `report (1).pdf`.
    expect(await screen.findByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('WEB-UPLOADS-036 retry restarts from init rather than reusing the URL', async () => {
    const { calls } = install({ failTransfer: true });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));
    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('error'));
    expect(calls.filter((call) => call.endsWith('/uploads/init'))).toHaveLength(1);

    await userEvent.click(await screen.findByRole('button', { name: /Retry/ }));

    /**
     * A **second** `init`, which is the observable property.
     *
     * The first draft asserted `nodeId === null` after the retry, which is true
     * for one tick and then false — the runner picks the item straight back up
     * and re-initialises it. Asserting a transient is how a test passes or fails
     * on scheduling.
     *
     * Restarting from `init` matters because an expired presigned URL is the
     * usual reason a retry is needed: reusing it would fail the same way
     * forever.
     */
    await waitFor(() => {
      expect(calls.filter((call) => call.endsWith('/uploads/init'))).toHaveLength(2);
    });
  });

  it('WEB-UPLOADS-037 retrying does not duplicate the item', async () => {
    install({ failTransfer: true });
    renderUploads();

    await userEvent.upload(screen.getByTestId('upload-input'), pdf('report.pdf'));
    await waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('error'));

    await userEvent.click(await screen.findByRole('button', { name: /Retry/ }));

    expect(useUploadQueue.getState().items).toHaveLength(1);
  });
});

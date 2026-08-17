import type { ErrorCode } from '@dataroom/shared';

import type { AppError } from './app-error';

export interface Recovery {
  /** One sentence, addressed to the person, never naming an internal concept. */
  message: string;
  /** What the UI should offer. `null` means there is nothing useful to do. */
  action: 'retry' | 'sign-in' | 'reload' | 'rename' | 'go-back' | 'choose-smaller-file' | null;
}

/**
 * Every code maps to a message and a recovery action.
 *
 * The map is exhaustive by construction — `Record<ErrorCode, Recovery>` means
 * adding a code to the shared union fails this file to compile until someone
 * decides what a user should be told. That is the point: an unhandled code
 * otherwise reaches a user as the code itself, and `NAME_CONFLICT` on a screen
 * is not a message, it is a leak of the wire format.
 */
const MESSAGES: Record<ErrorCode, Recovery> = {
  NAME_CONFLICT: {
    message: 'Something here already has that name.',
    action: 'rename',
  },
  GONE: {
    message: 'This link is no longer available.',
    action: null,
  },
  CYCLIC_MOVE: {
    message: 'A folder cannot be moved inside itself.',
    action: 'go-back',
  },
  DEPTH_LIMIT: {
    message: 'This folder is nested too deeply to add more.',
    action: 'go-back',
  },
  FILE_TOO_LARGE: {
    message: 'That file is larger than the 50 MB limit.',
    action: 'choose-smaller-file',
  },
  UNSUPPORTED_FILE_TYPE: {
    message: 'Only PDF files can be uploaded here.',
    action: 'choose-smaller-file',
  },
  NOT_FOUND: {
    message: 'That item is not available.',
    action: 'go-back',
  },
  UNAUTHENTICATED: {
    message: 'Please sign in again to continue.',
    action: 'sign-in',
  },
  RATE_LIMITED: {
    message: 'Too many attempts. Wait a moment and try again.',
    action: 'retry',
  },
  CONFLICT: {
    message: 'That action conflicts with something already in progress.',
    action: 'retry',
  },
  VALIDATION_FAILED: {
    message: 'Some of the details are not valid.',
    action: null,
  },
  INTERNAL: {
    message: 'Something went wrong on our side.',
    action: 'retry',
  },
};

const NETWORK: Recovery = {
  message: 'You appear to be offline. Check your connection.',
  action: 'retry',
};

const TIMEOUT: Recovery = {
  message: 'That took longer than expected.',
  action: 'retry',
};

/**
 * A network failure and a server error read very differently to a person —
 * one is "check your wifi", the other is "it's not you". Collapsing them into
 * "something went wrong" makes both unactionable.
 */
export function describeError(error: AppError): Recovery {
  if (error.kind === 'network') return NETWORK;
  if (error.kind === 'timeout') return TIMEOUT;

  // An unrecognised code — a server ahead of this client — falls back to a
  // generic sentence rather than rendering the code. Users should never see
  // `SOMETHING_UNEXPECTED` on a screen.
  return MESSAGES[error.code] ?? MESSAGES.INTERNAL;
}

/** The map itself, for the test that asserts every code is covered. */
export const errorMessages: Readonly<Record<ErrorCode, Recovery>> = MESSAGES;

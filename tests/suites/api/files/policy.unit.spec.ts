import { describe, expect, it } from 'vitest';

import { loadConfig } from '@api/common';
import { contentDisposition, dispositionType } from '@api/storage';

/**
 * The upload policy, and the rule it is deliberately not allowed to reach.
 */
const BASE = {
  DATABASE_URL: 'postgresql://localhost:5432/x',
  JWT_ACCESS_SECRET: 'a-secret-long-enough-for-the-schema',
  JWT_REFRESH_SECRET: 'another-secret-long-enough-here',
  AWS_REGION: 'eu-central-1',
  S3_BUCKET: 'bucket',
} satisfies NodeJS.ProcessEnv;

describe('the upload file policy', () => {
  it('API-FILES-019 the policy is read from config and defaults to the restrictive value', () => {
    // Unset is `pdf-only`, so an unconfigured deployment is the safe one.
    expect(loadConfig({ ...BASE }).uploads.policy).toBe('pdf-only');

    for (const policy of ['pdf-only', 'all-files'] as const) {
      expect(loadConfig({ ...BASE, UPLOAD_FILE_POLICY: policy }).uploads.policy).toBe(policy);
    }

    // Neither value is compiled in — an unrecognised one is a boot failure with
    // the variable named, not a silent fallback to whichever is the default.
    expect(() => loadConfig({ ...BASE, UPLOAD_FILE_POLICY: 'anything-goes' })).toThrow(
      /UPLOAD_FILE_POLICY/,
    );
  });

  it('API-FILES-022 no value of the policy can cause non-PDF bytes to be served inline', () => {
    /**
     * The disposition rule sits **outside** the toggle, and takes no argument
     * that could carry one — `dispositionType` cannot even see the config.
     *
     * Three separately-reasonable decisions compose into a bad one otherwise:
     * uploads are served from the S3 origin, `inline` makes the browser render
     * rather than download, and the viewer frames that URL. Under `all-files` an
     * uploaded `.html` would then execute as script on the bucket origin, where
     * the web app's CSP — the mitigation the whole `localStorage` token decision
     * rests on — does not apply.
     */
    expect(dispositionType('application/pdf')).toBe('inline');
    expect(dispositionType('application/pdf; charset=binary')).toBe('inline');

    for (const type of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/plain',
      'application/octet-stream',
      null,
      undefined,
    ]) {
      expect(dispositionType(type), String(type)).toBe('attachment');
    }

    // And the header it produces says so, under either policy — the function is
    // pure and the policy is not one of its inputs.
    expect(contentDisposition('text/html', 'evil.html')).toContain('attachment');
  });
});

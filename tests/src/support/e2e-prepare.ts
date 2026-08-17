import { prepareE2eEnvironment } from './e2e-setup.ts';

/**
 * The step that has to happen before Playwright's `webServer` starts.
 *
 * A separate entry point rather than Playwright's `globalSetup`, because that
 * hook runs *after* the web servers are launched — and the API cannot boot
 * against a database that does not exist yet.
 */
await prepareE2eEnvironment();
console.log('e2e environment ready');

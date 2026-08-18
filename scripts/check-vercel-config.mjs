// Refuses a Vercel build whose `vercel.json` is still holding placeholders.
//
// Both of them fail at *runtime* otherwise, and only one of the two is loud:
//
//   REPLACE-WITH-APP-RUNNER-HOST  → every /api request 502s. Obvious.
//   REPLACE-WITH-BUCKET-HOST      → the CSP blocks the upload PUT and the PDF
//                                   frame. The page renders, the tree loads,
//                                   and only uploading or previewing breaks —
//                                   with a console error nobody is watching.
//
// A deploy that looks green and cannot upload a document is worse than a build
// that refuses to finish, so this refuses to finish.
//
// It doubles as a Root Directory check. Vercel resolves `buildCommand` against
// the project's Root Directory, so if that is set to anything but the
// repository root (`apps/api`, say) this file is not found and the build stops
// immediately — which is the mistake that produced a "successful" build of the
// web app inside an API-rooted project.
import { readFileSync } from 'node:fs';

const CONFIG = 'vercel.json';
const ESCAPE_HATCH = 'ALLOW_PLACEHOLDER_DEPLOY';

const raw = readFileSync(new URL(`../${CONFIG}`, import.meta.url), 'utf8');
const placeholders = [...new Set(raw.match(/REPLACE-WITH-[A-Z-]+/g) ?? [])];

if (placeholders.length === 0) {
  console.log(`${CONFIG}: no placeholders left — ok`);
  process.exit(0);
}

const preview = process.env[ESCAPE_HATCH] === '1';
const lines = [
  '',
  `${CONFIG} still contains ${placeholders.length} placeholder(s):`,
  ...placeholders.map((name) => `  - ${name}`),
  '',
  'Replace them and commit:',
  '  REPLACE-WITH-APP-RUNNER-HOST  the API host, e.g. abc123.eu-central-1.awsapprunner.com',
  '                                (host only — no scheme, no trailing slash)',
  '  REPLACE-WITH-BUCKET-HOST      the S3 bucket origin used by presigned URLs,',
  '                                e.g. dataroom-prod.s3.eu-central-1.amazonaws.com',
  '',
  'Vercel cannot read these from environment variables — vercel.json takes',
  'literals only, so they have to be in the committed file. See DEPLOYMENT.md §5.',
  '',
];

if (preview) {
  console.warn(
    [
      ...lines,
      `${ESCAPE_HATCH}=1 is set, so this build continues.`,
      'The result is a UI-only preview: sign-in, uploads and preview will not work.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

console.error(
  [
    ...lines,
    `To deploy the UI anyway — knowing it cannot talk to an API — set ${ESCAPE_HATCH}=1`,
    'as an environment variable on the Vercel project.',
    '',
  ].join('\n'),
);
process.exit(1);

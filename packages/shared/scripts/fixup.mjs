// The package has no top-level "type" field, so Node treats dist/**/*.js as
// CommonJS by default. The ESM build needs an explicit marker or every import
// from apps/web resolves as CJS and the named exports break.
//
// Writing both markers (rather than only the ESM one) keeps the intent obvious
// and survives someone later adding "type": "module" to package.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

for (const [dir, type] of [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
]) {
  const target = join(dist, dir);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}

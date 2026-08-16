/**
 * `pnpm declared` — what the registry currently holds.
 *
 * Runs under Node's type stripping (`node src/registry/cli.ts`), so everything
 * it reaches has to stay strip-safe: no decorators, no parameter properties,
 * no `enum`, and explicit extensions on every relative import.
 */
import { loadRegistry, live, summarize, undeclared, unimplemented } from './registry.ts';

const registry = loadRegistry();
const summary = summarize(registry);
const verbose = process.argv.includes('--all');

const bySuite = new Map<string, { declared: number; implemented: number; p0: number }>();
for (const declaration of live(registry)) {
  const row = bySuite.get(declaration.suite) ?? { declared: 0, implemented: 0, p0: 0 };
  row.declared += 1;
  if (registry.implementations.has(declaration.id)) row.implemented += 1;
  if (declaration.priority === 'P0') row.p0 += 1;
  bySuite.set(declaration.suite, row);
}

const width = Math.max(...[...bySuite.keys()].map((s) => s.length), 5);
const pad = (s: string) => s.padEnd(width);
const num = (n: number) => String(n).padStart(5);

console.log(`${pad('suite')} ${'impl'.padStart(5)}/${'decl'.padStart(5)} ${'P0'.padStart(5)}`);
console.log('-'.repeat(width + 18));
for (const [suite, row] of [...bySuite].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${pad(suite)} ${num(row.implemented)}/${num(row.declared)} ${num(row.p0)}`);
}
console.log('-'.repeat(width + 18));
console.log(`${pad('total')} ${num(summary.implemented)}/${num(summary.declared)} ${num(summary.p0)}`);
console.log(
  `\n${summary.declared} declared in ${summary.groups} groups across ${summary.suites} suites` +
    ` · ${summary.retired} retired · ${summary.p0Implemented}/${summary.p0} P0 implemented`,
);

const strays = undeclared(registry);
if (registry.problems.length > 0) {
  console.error('\nproblems:');
  for (const problem of registry.problems) {
    console.error(`  ${problem.suite}:${problem.line} — ${problem.message}`);
  }
}
if (strays.length > 0) {
  console.error('\nimplemented but never declared:');
  for (const stray of strays) console.error(`  ${stray.id} — ${stray.files.join(', ')}`);
}

if (verbose) {
  console.log('\nnot yet implemented:');
  for (const declaration of unimplemented(registry)) {
    console.log(`  ${declaration.id} [${declaration.priority}] ${declaration.behaviour}`);
  }
}

if (registry.problems.length > 0 || strays.length > 0) process.exitCode = 1;

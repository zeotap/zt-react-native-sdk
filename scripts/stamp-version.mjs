#!/usr/bin/env node
/**
 * Stamps package.json's version into `src/version.ts`.
 *
 * Same fix as increment 241 applied to the browser SDK, for the same reason: a
 * hardcoded literal in the source reported `0.1.0` forever, so every event in the
 * warehouse claimed a version the code had long left behind. Run by `prepack`, so
 * a publish cannot forget; `--check` mode is what CI runs to fail a PR that edited
 * one and not the other.
 *
 *   node scripts/stamp-version.mjs          # write
 *   node scripts/stamp-version.mjs --check  # verify, exit 1 on drift
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = join(root, 'src/version.ts');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`[stamp-version] package.json version is not semver: ${version}`);
  process.exit(1);
}

const current = readFileSync(target, 'utf-8');
const stamped = current.replace(
  /export const SDK_VERSION = '[^']*';/,
  `export const SDK_VERSION = '${version}';`,
);

if (!/export const SDK_VERSION = '/.test(current)) {
  console.error(`[stamp-version] ${target} has no SDK_VERSION declaration to stamp`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  if (stamped !== current) {
    console.error(
      `[stamp-version] src/version.ts is stale: package.json says ${version}. ` +
        'Run `npm run stamp-version`.',
    );
    process.exit(1);
  }
  console.log(`[stamp-version] OK — src/version.ts matches package.json (${version})`);
  process.exit(0);
}

if (stamped !== current) {
  writeFileSync(target, stamped);
  console.log(`[stamp-version] src/version.ts → ${version}`);
} else {
  console.log(`[stamp-version] already ${version}`);
}

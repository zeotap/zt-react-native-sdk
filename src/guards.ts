/**
 * Validation primitives for the option mappers.
 *
 * These exist so a bad option is rejected HERE, in JavaScript, with a message
 * naming the option — rather than crossing the bridge and failing inside a
 * native type cast. The legacy RN package force-cast at that boundary (`as!`),
 * so `{flushAt: "10"}` crashed the app on iOS with a Swift runtime trap and
 * silently mis-configured on Android. Every guard below returns the value or
 * throws `ZeotapConfigError`; none coerces.
 *
 * The wording pattern `[SDK] options.<path> must be …` is the browser SDK's, so
 * the same mistake reads identically on web and on mobile.
 */
import { ZeotapConfigError } from './errors';

const fail = (path: string, must: string, got: unknown): never => {
  throw new ZeotapConfigError(`[SDK] options.${path} must be ${must} (got ${describe(got)})`);
};

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return JSON.stringify(value);
  return typeof value;
}

export function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    return fail(path, 'a non-empty string', value);
  }
  return value;
}

export function optionalString(value: unknown, path: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') return fail(path, 'a string', value);
  return value;
}

export function optionalBoolean(value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') return fail(path, 'a boolean', value);
  return value;
}

/**
 * A positive integer. `Number.isSafeInteger` rather than `Number.isInteger`
 * because these values become a Kotlin `Int`/`Long` and a Swift `Int`, and a
 * value past 2^53 has already lost precision in JS before we could reject it.
 */
export function positiveInt(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return fail(path, 'a positive integer', value);
  }
  return value;
}

/** Like `positiveInt` but 0 is meaningful (e.g. "no cap"). */
export function nonNegativeInt(value: unknown, path: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'a non-negative integer', value);
  }
  return value;
}

export function oneOf<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return fail(path, `one of ${allowed.map(a => `"${a}"`).join(' | ')}`, value);
  }
  return value as T;
}

/**
 * TCF purpose ids: a flat list, ALL of which must be consented — the option's shape
 * on the web, Android and iOS SDKs alike (`number[]` / `List<Int>` / `[Int]`). An empty
 * list means "use the SDK's default", which on every SDK is the GROUP rule
 * `[[1,3,4],[1,5,6]]` (either group suffices) for tracking — a default nobody can
 * express as an option, which is why groups are rejected here rather than forwarded:
 * Android cannot take them at all, and iOS used to flatten them into "all of
 * 1,3,4,5,6", a stricter rule than the integrator asked for, applied silently.
 */
export function purposeIds(value: unknown, path: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return fail(path, 'an array of purpose ids', value);
  if (value.length === 0) return [];

  const isId = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
  if (value.every(isId)) return value as number[];
  if (value.some(Array.isArray)) {
    return fail(
      path,
      'a flat array of purpose ids, all required (purpose groups are not an option on any Zeotap SDK; leave it unset for the default [[1,3,4],[1,5,6]] rule)',
      value,
    );
  }
  return fail(path, 'an array of purpose ids', value);
}

/**
 * A plain object. Rejects arrays and null, which `typeof === 'object'` accepts
 * and which the native side would decode into something unusable.
 */
export function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'an object', value);
  }
  return value as Record<string, unknown>;
}

/**
 * `apiHost` — required on mobile, and validated here because the failure is
 * otherwise invisible: an unreachable host looks exactly like a working SDK
 * whose events never arrive.
 */
export function apiHost(value: unknown): string {
  const host = requiredString(value, 'apiHost');
  if (!/^https?:\/\/[^\s/]+/i.test(host)) {
    throw new ZeotapConfigError(
      `[SDK] options.apiHost must be an absolute http(s) URL (got ${JSON.stringify(host)}). ` +
        'Unlike the browser SDK there is no same-origin default on a device.',
    );
  }
  return host.endsWith('/') ? host.slice(0, -1) : host;
}

/**
 * Identity values must be strings.
 *
 * Not a coercion: `{loyaltyId: 12345}` stringified to `"12345"` would be hashed
 * and shipped, matching nothing downstream, and nobody would see an error. The
 * key is named so the fix is obvious.
 */
export function identityValues(input: unknown): Record<string, string> {
  const record = plainObject(input, 'identities');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue; // absent = not set, as on the web
    if (typeof value !== 'string') {
      throw new ZeotapConfigError(
        `[SDK] identities.${key} must be a string (got ${describe(value)}). Values are ` +
          'hashed as given; a number would be hashed as its digits and match nothing.',
      );
    }
    out[key] = value;
  }
  return out;
}

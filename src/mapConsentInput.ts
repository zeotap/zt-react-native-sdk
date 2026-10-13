/**
 * `setConsent` input mapping, with the browser SDK's mutual-exclusion rule
 * enforced in JavaScript.
 *
 * The web SDK's `ConsentInput` is a union — a TC string, a US Privacy string, or
 * pre-resolved categories — and passing two forms at once is meaningless: the
 * resolver would have to pick one silently, and which one it picked would decide
 * whether events flow. So this rejects it rather than choosing. Passing none is
 * equally rejected: `setConsent({})` reads as "grant nothing" but the web SDK
 * treats an absent `analytics` as a GRANT (`analytics !== false`), so an empty bag
 * would resolve to full consent — the opposite of what the caller almost
 * certainly meant.
 *
 * The native side re-validates (a bridge is not a trust boundary), but the error
 * a JS caller sees comes from here, where it can name the keys.
 */
import { ZeotapConfigError } from './errors';
import { plainObject } from './guards';
import type { ConsentInput } from './types';

const CATEGORY_KEYS = ['analytics', 'marketing', 'advertising', 'functional'] as const;

/** The bag the native bridges decode; exactly one form is populated. */
export type NativeConsentInput =
  | { tcfString: string }
  | { usPrivacy: string }
  | { analytics?: boolean; marketing?: boolean; advertising?: boolean; functional?: boolean };

export function mapConsentInput(input: unknown): NativeConsentInput {
  const bag = plainObject(input, 'consent input');

  const hasTcf = bag.tcfString !== undefined;
  const hasUsp = bag.usPrivacy !== undefined;
  const categories = CATEGORY_KEYS.filter(key => bag[key] !== undefined);
  const forms = [hasTcf, hasUsp, categories.length > 0].filter(Boolean).length;

  if (forms > 1) {
    throw new ZeotapConfigError(
      '[SDK] setConsent accepts exactly one form: {tcfString}, {usPrivacy} or the ' +
        `categories {analytics, marketing, advertising, functional} — got ${describeForms(
          hasTcf,
          hasUsp,
          categories,
        )}. Which one wins would silently decide whether events flow.`,
    );
  }
  if (forms === 0) {
    throw new ZeotapConfigError(
      '[SDK] setConsent needs one of {tcfString}, {usPrivacy} or at least one of ' +
        '{analytics, marketing, advertising, functional}. An empty object would resolve ' +
        'to GRANTED, since an absent category is a grant — pass {analytics: false} to deny.',
    );
  }

  const unknownKeys = Object.keys(bag).filter(
    key => key !== 'tcfString' && key !== 'usPrivacy' && !(CATEGORY_KEYS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ZeotapConfigError(
      `[SDK] setConsent got unknown key(s) ${unknownKeys.join(', ')}. Consent input is a ` +
        'closed shape; an unrecognised key is more likely a typo than an extension.',
    );
  }

  if (hasTcf) {
    if (typeof bag.tcfString !== 'string' || bag.tcfString === '') {
      throw new ZeotapConfigError('[SDK] setConsent tcfString must be a non-empty string');
    }
    return { tcfString: bag.tcfString };
  }

  if (hasUsp) {
    if (typeof bag.usPrivacy !== 'string' || bag.usPrivacy === '') {
      throw new ZeotapConfigError('[SDK] setConsent usPrivacy must be a non-empty string');
    }
    return { usPrivacy: bag.usPrivacy };
  }

  const out: Record<string, boolean> = {};
  for (const key of categories) {
    const value = bag[key];
    if (typeof value !== 'boolean') {
      throw new ZeotapConfigError(
        `[SDK] setConsent ${key} must be a boolean (got ${typeof value}). Omit the key ` +
          'for "not decided" — the SDK treats an absent category as a grant.',
      );
    }
    out[key] = value;
  }
  return out as NativeConsentInput;
}

function describeForms(hasTcf: boolean, hasUsp: boolean, categories: readonly string[]): string {
  const found: string[] = [];
  if (hasTcf) found.push('tcfString');
  if (hasUsp) found.push('usPrivacy');
  if (categories.length > 0) found.push(`categories (${categories.join(', ')})`);
  return found.join(' + ');
}

export type { ConsentInput };

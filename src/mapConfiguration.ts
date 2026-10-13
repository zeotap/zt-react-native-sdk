/**
 * The options mapper — the one place a host's `ZeotapOptions` becomes the bag the
 * native bridges receive.
 *
 * Modelled on the Adobe Launch extension's `mapLoadOptions` (`sdk/adobe-extension/
 * src/lib/mapLoadOptions.js`), which is the pattern that has already proven itself
 * for a thin wrapper over this SDK, hardened in three ways:
 *
 *  1. **Defaults are stated here, once**, and they are the browser SDK's
 *     (`sdk/js/src/client.ts` LoadOptions/ConsentOptions defaults). A wrapper that
 *     forwarded `undefined` and let each platform default independently is how two
 *     SDKs drift apart while every test passes.
 *  2. **Unknown keys are stripped, not forwarded** — and they emit a debug event,
 *     so a typo (`flushInternal`) is visible instead of silently inert. Browser-only
 *     options get a dedicated message saying they do not exist on mobile, since
 *     that is the mistake a web-SDK user actually makes.
 *  3. **`integration` is ours and cannot be overridden.** Every event carries
 *     `context.library.integration = {name: 'react-native-sdk', version}`, which is
 *     how a payload in the warehouse is attributable to this bridge rather than to
 *     the platform SDK underneath. The GTM template stamps its own the same way.
 */
import { INTEGRATION_NAME, SDK_VERSION } from './version';
import {
  apiHost as validateApiHost,
  nonNegativeInt,
  oneOf,
  optionalBoolean,
  optionalString,
  plainObject,
  positiveInt,
  purposeIds,
} from './guards';
import type { ZeotapOptions } from './types';

/** Options the browser SDK has and mobile deliberately does not. */
const BROWSER_ONLY = [
  'autoPage',
  'storage',
  'cookieDomain',
  'cookieExpiryDays',
  'cookieSecure',
  'cookieSameSite',
  'firstPartyCookies',
  'credentials',
] as const;

const KNOWN_OPTIONS = [
  'apiHost',
  'namespace',
  'flushAt',
  'flushInterval',
  'debug',
  'nativeAppId',
  'consent',
  'maxQueueSize',
  'trackApplicationLifecycleEvents',
  'flushOnBackground',
  'collectAdvertisingId',
] as const;

const KNOWN_CONSENT_OPTIONS = [
  'require',
  'default',
  'cmpTimeoutMs',
  'maxBufferedEvents',
  'cmp',
  'purposesForTracking',
  'purposesForIdentifying',
  'purposesForCookieSync',
  'checkVendorConsent',
  'persist',
  'expiryDays',
] as const;

/** The bag the native side receives. Deliberately flat and JSON-only. */
export interface NativeConfiguration {
  apiHost: string;
  namespace: string;
  flushAt: number;
  flushInterval: number;
  debug: boolean;
  nativeAppId: string;
  maxQueueSize: number;
  trackApplicationLifecycleEvents: boolean;
  flushOnBackground: boolean;
  collectAdvertisingId: boolean;
  integration: { name: string; version: string };
  consent: {
    require: boolean;
    default: 'granted' | 'denied';
    cmpTimeoutMs: number;
    maxBufferedEvents: number;
    cmp: 'auto' | 'none';
    purposesForTracking?: number[];
    purposesForIdentifying?: number[];
    purposesForCookieSync?: number[];
    checkVendorConsent: boolean;
    persist: boolean;
    expiryDays: number;
  };
}

export interface MapConfigurationResult {
  configuration: NativeConfiguration;
  /** Human-readable notes for the `debug` event stream (stripped keys, etc.). */
  warnings: string[];
}

function unknownKeyWarnings(
  input: Record<string, unknown>,
  known: readonly string[],
  path: string,
): string[] {
  const warnings: string[] = [];
  for (const key of Object.keys(input)) {
    if (known.includes(key)) continue;
    if ((BROWSER_ONLY as readonly string[]).includes(key)) {
      warnings.push(
        `[SDK] ${path}${key} is a browser-SDK option and does not exist on mobile — ignored. ` +
          (key === 'autoPage'
            ? 'There is no page() on mobile; screen() is the primitive.'
            : 'Mobile has no cookie jar and no same-origin fetch.'),
      );
      continue;
    }
    warnings.push(`[SDK] unknown option ${path}${key} — ignored`);
  }
  return warnings;
}

/**
 * Validate and normalise. Throws `ZeotapConfigError` on the first bad value,
 * naming it; returns the native bag plus any warnings worth emitting.
 */
export function mapConfiguration(input: unknown): MapConfigurationResult {
  const options = plainObject(input ?? {}, '');
  const warnings = unknownKeyWarnings(options, KNOWN_OPTIONS, '');

  const consentInput =
    options.consent === undefined ? {} : plainObject(options.consent, 'consent');
  warnings.push(...unknownKeyWarnings(consentInput, KNOWN_CONSENT_OPTIONS, 'consent.'));

  const require = optionalBoolean(consentInput.require, 'consent.require', false);

  const consent: NativeConfiguration['consent'] = {
    require,
    default: oneOf(consentInput.default, 'consent.default', ['granted', 'denied'] as const, 'granted'),
    cmpTimeoutMs: positiveInt(consentInput.cmpTimeoutMs, 'consent.cmpTimeoutMs', 10_000),
    maxBufferedEvents: positiveInt(consentInput.maxBufferedEvents, 'consent.maxBufferedEvents', 10),
    // The web default: 'auto' when consent is required (there is presumably a CMP
    // to wait for), 'none' otherwise. Stated here so both platforms agree even
    // though each has its own default in its own Configuration.
    cmp: oneOf(consentInput.cmp, 'consent.cmp', ['auto', 'none'] as const, require ? 'auto' : 'none'),
    checkVendorConsent: optionalBoolean(
      consentInput.checkVendorConsent,
      'consent.checkVendorConsent',
      false,
    ),
    persist: optionalBoolean(consentInput.persist, 'consent.persist', true),
    expiryDays: positiveInt(consentInput.expiryDays, 'consent.expiryDays', 365),
  };

  // Purpose lists are omitted when absent rather than sent as `[]`, so the native
  // side applies its own documented defaults ([[1,3,4],[1,5,6]] for tracking,
  // [1,9] for identifying) instead of receiving an empty list that could be read
  // as "no purposes required".
  const tracking = purposeIds(consentInput.purposesForTracking, 'consent.purposesForTracking');
  const identifying = purposeIds(consentInput.purposesForIdentifying, 'consent.purposesForIdentifying');
  const cookieSync = purposeIds(consentInput.purposesForCookieSync, 'consent.purposesForCookieSync');
  if (tracking && tracking.length > 0) consent.purposesForTracking = tracking;
  if (identifying && identifying.length > 0) consent.purposesForIdentifying = identifying;
  if (cookieSync && cookieSync.length > 0) consent.purposesForCookieSync = cookieSync;

  const configuration: NativeConfiguration = {
    apiHost: validateApiHost(options.apiHost),
    namespace: optionalString(options.namespace, 'namespace', 'zeotap'),
    flushAt: positiveInt(options.flushAt, 'flushAt', 10),
    flushInterval: positiveInt(options.flushInterval, 'flushInterval', 5000),
    debug: optionalBoolean(options.debug, 'debug', false),
    nativeAppId: optionalString(options.nativeAppId, 'nativeAppId', ''),
    maxQueueSize: positiveInt(options.maxQueueSize, 'maxQueueSize', 500),
    trackApplicationLifecycleEvents: optionalBoolean(
      options.trackApplicationLifecycleEvents,
      'trackApplicationLifecycleEvents',
      false,
    ),
    flushOnBackground: optionalBoolean(options.flushOnBackground, 'flushOnBackground', true),
    collectAdvertisingId: optionalBoolean(
      options.collectAdvertisingId,
      'collectAdvertisingId',
      false,
    ),
    // Not host-overridable, deliberately: this is the bridge's identity in the
    // warehouse. `integration` is not in KNOWN_OPTIONS, so passing one is
    // reported as an unknown option and dropped.
    integration: { name: INTEGRATION_NAME, version: SDK_VERSION },
    consent,
  };

  // Referenced so the compiler keeps the guard imported even if a future edit
  // drops its last call site; nonNegativeInt is part of the guard vocabulary.
  void nonNegativeInt;

  return { configuration, warnings };
}

/** Just the options object, for callers that do not want the warnings. */
export function toNativeConfiguration(input: unknown): NativeConfiguration {
  return mapConfiguration(input).configuration;
}

export type { ZeotapOptions };

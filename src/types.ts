/**
 * The public types.
 *
 * Option NAMES and UNITS are the browser SDK's, deliberately — `flushInterval` is
 * milliseconds here exactly as it is in `sdk/js`, and `cmpTimeoutMs` keeps its
 * suffix. That is what lets a React Native app pass ONE options object that both
 * native SDKs accept unchanged, and it is why a customer migrating from the web
 * SDK does not have to relearn anything. Two deliberate differences from the web,
 * both forced by the platform:
 *
 *  - `apiHost` is REQUIRED. On the web an empty host means "same origin"; on a
 *    device there is no origin, so an absent host is a silent no-send.
 *  - there is no `page()` and no `autoPage`. `screen()` is the mobile primitive;
 *    the browser SDK's page vectors are tagged js-only in `sdk/conformance`.
 *
 * Anything browser-only is absent rather than accepted-and-ignored: cookie
 * options, `credentials`, `firstPartyCookies`, `storage`. Passing one is a
 * validation error naming it, not a no-op — see `mapConfiguration`.
 */

/** Consent categories, as the web SDK's `ConsentInput` parsed form. */
export interface ParsedConsent {
  analytics?: boolean;
  marketing?: boolean;
  advertising?: boolean;
  functional?: boolean;
}

/**
 * Exactly one form per call, like the web SDK: an IAB TC string, a US Privacy
 * string, or pre-resolved categories. Two forms at once, or none, is rejected.
 */
export type ConsentInput = { tcfString: string } | { usPrivacy: string } | ParsedConsent;

export type ConsentDefault = 'granted' | 'denied';
export type CmpMode = 'auto' | 'none';

export interface ConsentOptions {
  /** Gate events until a decision exists. Default false. */
  require?: boolean;
  /** What an unanswered CMP resolves to. Default `'granted'`. */
  default?: ConsentDefault;
  /** How long to wait for a CMP. Default 10000. */
  cmpTimeoutMs?: number;
  /** FIFO pre-consent buffer cap; the NEWEST event is dropped on overflow. Default 10. */
  maxBufferedEvents?: number;
  /** Default `'auto'` when `require` is true, else `'none'`. */
  cmp?: CmpMode;
  /** TCF purpose ids, ALL required. Unset: the SDK's rule, `[1,3,4]` or `[1,5,6]`. */
  purposesForTracking?: number[];
  /** TCF purpose ids, ALL required. Unset: `[1,9]`. */
  purposesForIdentifying?: number[];
  /** TCF purpose ids, ALL required. Unset: the same rule as tracking. */
  purposesForCookieSync?: number[];
  /** Require the Zeotap vendor bit (GVL 1469/301) for tracking too. Default false. */
  checkVendorConsent?: boolean;
  /** Persist the resolved decision across launches. Default true. */
  persist?: boolean;
  /** Persisted-decision lifetime. Default 365. */
  expiryDays?: number;
}

export interface ZeotapOptions {
  /** REQUIRED. `https://…` (or `http://` for a local ingest during development). */
  apiHost: string;
  /** Storage-key prefix, shared with a WebView's SDK when they match. Default `'zeotap'`. */
  namespace?: string;
  /** Flush when this many events are queued. Default 10. */
  flushAt?: number;
  /** Milliseconds between timed flushes. Default 5000. */
  flushInterval?: number;
  /** Verbose native logging. Default false. */
  debug?: boolean;
  /** `X-Native-App-ID` on every batch. Default `''`. */
  nativeAppId?: string;
  consent?: ConsentOptions;
  /** Durable queue cap; the OLDEST event is dropped on overflow. Default 500. */
  maxQueueSize?: number;
  /** Emit `Application Installed/Updated/Opened/Backgrounded`. Default false. */
  trackApplicationLifecycleEvents?: boolean;
  /** Flush when the app goes to background. Default true. */
  flushOnBackground?: boolean;
  /** Collect the advertising id (host owns the ATT prompt). Default false. */
  collectAdvertisingId?: boolean;
}

export interface ConsentSignals {
  track: boolean;
  identify: boolean;
  cookieSync: boolean;
}

/** `getConsentState()`. Keys are absent while unresolved, as on the web. */
export interface ConsentState {
  resolved: boolean;
  signals?: ConsentSignals;
  /** `'default' | 'storage' | 'cmp' | 'manual'` — the precedence rank order. */
  source?: string;
  gdprApplies?: boolean;
}

export interface ZeotapIdentity {
  anonymousId: string;
  userId: string | null;
}

/** Input keys the SDK hashes; `fpuid` and custom keys pass through raw. */
export interface UserIdentities {
  [key: string]: string;
}

export interface SetUserIdentitiesOptions {
  /** The values are ALREADY hashed and keyed as `email_sha256_lowercase` etc. */
  hashed?: boolean;
}

/** Events `addListener` accepts. */
export type ZeotapEvent = 'error' | 'debug';

export interface ZeotapEventPayload {
  /** `'error'`: the SDK's message. `'debug'`: a diagnostic line. */
  message: string;
  /** Present on `'error'` when the native side had a code. */
  code?: string;
}

export interface ZeotapSubscription {
  remove(): void;
}

/**
 * `@zeotap/react-native-sdk` — the public API.
 *
 * A THIN bridge: every method validates its arguments, then forwards to the
 * native Android/iOS SDK, which owns all the business logic (payload shape,
 * consent gating, PII hashing, the durable queue, retries). Nothing about the
 * contract is reimplemented here, which is the whole design — the alternative, a
 * pure-JS port reusing `sdk/js`, cannot survive process death, cannot share an
 * identity with a WebView, and would need a second hashing implementation.
 *
 * Three behaviours worth knowing:
 *
 *  - **Empty-argument calls resolve without sending**, exactly as the browser SDK
 *    returns silently: `track('')`, `group('')` and `alias('')` are no-ops. They
 *    do not reject, because a missing product name in a UI is not an error the
 *    caller can act on, and the web SDK set that precedent.
 *  - **A gated drop REJECTS** with the SDK's own message
 *    (`[SDK] Dropped track: no track consent`). On the web that arrives as a
 *    callback error; a Promise is the RN idiom for the same thing, so
 *    `await track(...)` in a `try/catch` sees consent decisions.
 *  - **Pre-configure calls REJECT** with `[SDK] Not initialized. Call configure()
 *    before <method>().` — the web SDK's wording, with `configure` in place of
 *    `load`.
 */
import NativeZeotap from './NativeZeotap';
import { addListener as addEventListener, emitLocal } from './events';
import {
  ZeotapConfigError,
  ZeotapConsentError,
  ZeotapError,
  ZeotapLinkingError,
  ZeotapPlatformError,
  ZeotapSdkError,
  ZeotapUnsupportedError,
  fromNativeError,
} from './errors';
import { mapConfiguration } from './mapConfiguration';
import { mapConsentInput } from './mapConsentInput';
import { identityValues } from './guards';
import { assertPlatform, isNewArchitecture } from './platform';
import { INTEGRATION_NAME, SDK_VERSION } from './version';
import type {
  ConsentInput,
  ConsentState,
  SetUserIdentitiesOptions,
  UserIdentities,
  ZeotapEvent,
  ZeotapEventPayload,
  ZeotapIdentity,
  ZeotapOptions,
  ZeotapSubscription,
} from './types';

/** Properties/traits accepted on the wire: JSON-representable values only. */
export type EventProperties = Record<string, unknown>;

let configured = false;

/**
 * Every native call goes through here so a missing native module, a rejected
 * promise and a pre-configure call all produce one error vocabulary rather than
 * three. Without it a caller would have to handle RN's raw rejection shape.
 */
async function call<T>(method: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const mapped = fromNativeError(error);
    // A TurboModule that was never linked throws on property access rather than
    // rejecting, and the raw message ("null is not an object") points nowhere.
    if (/not a function|undefined is not an object|null is not an object/i.test(mapped.message)) {
      throw new ZeotapLinkingError(`while calling ${method}()`);
    }
    throw mapped;
  }
}

function requireConfigured(method: string): void {
  if (!configured) {
    throw new ZeotapSdkError(
      'E_NOT_CONFIGURED',
      `[SDK] Not initialized. Call configure() before ${method}().`,
    );
  }
}

const Zeotap = {
  /**
   * Idempotent, like `load()` on the native SDKs: a second call resolves without
   * reconfiguring. Rejects on an invalid option, naming it.
   */
  async configure(writeKey: string, options?: ZeotapOptions): Promise<void> {
    if (typeof writeKey !== 'string' || writeKey.trim() === '') {
      throw new ZeotapConfigError('[SDK] writeKey is required');
    }
    const { configuration, warnings } = mapConfiguration(options);
    for (const warning of warnings) emitLocal('debug', warning);

    await call('configure', () => NativeZeotap.configure(writeKey, configuration));
    configured = true;
  },

  async track(event: string, properties?: EventProperties): Promise<void> {
    requireConfigured('track');
    if (typeof event !== 'string' || event === '') return; // web parity: silent no-op
    await call('track', () => NativeZeotap.track(event, properties ?? null));
  },

  async screen(name?: string, category?: string, properties?: EventProperties): Promise<void> {
    requireConfigured('screen');
    await call('screen', () =>
      NativeZeotap.screen(name ?? null, category ?? null, properties ?? null),
    );
  },

  async identify(userId?: string, traits?: EventProperties): Promise<void> {
    requireConfigured('identify');
    await call('identify', () => NativeZeotap.identify(userId ?? null, traits ?? null));
  },

  async group(groupId: string, traits?: EventProperties): Promise<void> {
    requireConfigured('group');
    if (typeof groupId !== 'string' || groupId === '') return;
    await call('group', () => NativeZeotap.group(groupId, traits ?? null));
  },

  /** `previousId` defaults to the current anonymousId on the native side. */
  async alias(newId: string, previousId?: string): Promise<void> {
    requireConfigured('alias');
    if (typeof newId !== 'string' || newId === '') return;
    await call('alias', () => NativeZeotap.alias(newId, previousId ?? null));
  },

  /** Exactly one of `{tcfString}`, `{usPrivacy}` or the four categories. */
  async setConsent(input: ConsentInput): Promise<void> {
    requireConfigured('setConsent');
    const mapped = mapConsentInput(input);
    await call('setConsent', () => NativeZeotap.setConsent(mapped));
  },

  /** Does NOT reject before `configure` — the web SDK's `getConsentState()` is
   *  callable pre-init and answers `{resolved: false}`. */
  async getConsentState(): Promise<ConsentState> {
    if (!configured) return { resolved: false };
    const state = await call('getConsentState', () => NativeZeotap.getConsentState());
    return state as ConsentState;
  },

  async setUserIdentities(
    identities: UserIdentities,
    options?: SetUserIdentitiesOptions,
  ): Promise<void> {
    requireConfigured('setUserIdentities');
    const values = identityValues(identities);
    const hashed = options?.hashed === true;
    if (Object.keys(values).length === 0) return; // nothing to set; web parity
    await call('setUserIdentities', () => NativeZeotap.setUserIdentities(values, hashed));
  },

  /** Omit `keys` to remove every identity. Never consent-gated. */
  async unsetUserIdentities(keys?: string[]): Promise<void> {
    requireConfigured('unsetUserIdentities');
    if (keys !== undefined && (!Array.isArray(keys) || keys.some(k => typeof k !== 'string'))) {
      throw new ZeotapConfigError('[SDK] unsetUserIdentities keys must be an array of strings');
    }
    await call('unsetUserIdentities', () => NativeZeotap.unsetUserIdentities(keys ?? null));
  },

  /** `{anonymousId, userId}` in one bridge call. */
  async getIdentity(): Promise<ZeotapIdentity> {
    requireConfigured('getIdentity');
    const identity = await call('getIdentity', () => NativeZeotap.getIdentity());
    return identity as ZeotapIdentity;
  },

  async reset(): Promise<void> {
    requireConfigured('reset');
    await call('reset', () => NativeZeotap.reset());
  },

  /** Resolves once the queued batch has been attempted, not when it succeeded. */
  async flush(): Promise<void> {
    requireConfigured('flush');
    await call('flush', () => NativeZeotap.flush());
  },

  /** `'error'` and `'debug'` — see ./events for what arrives on each. */
  addListener(
    event: ZeotapEvent,
    handler: (payload: ZeotapEventPayload) => void,
  ): ZeotapSubscription {
    return addEventListener(event, handler);
  },

  android: {
    /**
     * Supply the GAID yourself, instead of letting the SDK resolve it.
     *
     * For an app that already has it (its own lookup, or a mediation SDK) or that
     * deliberately ships without `play-services-ads-identifier`. A host-supplied
     * value always wins over the SDK's own lookup, and the lookup is then not
     * even attempted — it is a blocking IPC call.
     *
     * Requires `collectAdvertisingId: true`. That flag is the host's single
     * switch for whether an advertising id may be collected at all, so one call
     * does not override it; the native side logs a warning when it is false
     * rather than failing silently. Same rule as iOS.
     *
     * `limitAdTracking: true` withholds the id and reports
     * `adTrackingEnabled: false`, which is the point of reporting it at all.
     * Pass `null` to withdraw a previously supplied id.
     */
    async setAdvertisingId(advertisingId: string | null, limitAdTracking: boolean): Promise<void> {
      assertPlatform('android', 'Zeotap.android.setAdvertisingId');
      requireConfigured('setAdvertisingId');
      await call('setAdvertisingIdAndroid', () =>
        NativeZeotap.setAdvertisingIdAndroid(advertisingId, limitAdTracking === true),
      );
    },
  },

  ios: {
    /**
     * Supported: the SDK holds a `ManualAdvertisingIdProvider` and re-reads it
     * per payload, so this takes effect for subsequent events.
     *
     * The host owns the ATT prompt — the SDK never calls
     * `requestTrackingAuthorization`. `trackingAuthorized` is the DECISION, not
     * the ATT enum, mirroring the native
     * `ZTConfiguration.setAdvertisingId(_:trackingAuthorized:)`. Pass
     * `(null, false)` to withdraw a previously supplied id.
     */
    async setAdvertisingId(idfa: string | null, trackingAuthorized: boolean): Promise<void> {
      assertPlatform('ios', 'Zeotap.ios.setAdvertisingId');
      requireConfigured('setAdvertisingId');
      await call('setAdvertisingIdIOS', () =>
        NativeZeotap.setAdvertisingIdIOS(idfa, trackingAuthorized === true),
      );
    },
  },

  /** Build metadata, handy in a bug report. */
  get info(): { version: string; integration: string; newArchitecture: boolean } {
    return {
      version: SDK_VERSION,
      integration: INTEGRATION_NAME,
      newArchitecture: isNewArchitecture(),
    };
  },

  /** Test seam: forget that `configure` ran. Not part of the supported API. */
  __resetForTesting(): void {
    configured = false;
  },
};

export default Zeotap;

export {
  ZeotapError,
  ZeotapConfigError,
  ZeotapConsentError,
  ZeotapLinkingError,
  ZeotapPlatformError,
  ZeotapSdkError,
  ZeotapUnsupportedError,
  mapConfiguration,
  mapConsentInput,
  SDK_VERSION,
  INTEGRATION_NAME,
};

export type {
  ConsentInput,
  ConsentState,
  SetUserIdentitiesOptions,
  UserIdentities,
  ZeotapEvent,
  ZeotapEventPayload,
  ZeotapIdentity,
  ZeotapOptions,
  ZeotapSubscription,
};

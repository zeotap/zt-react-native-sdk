/**
 * The TurboModule spec — and therefore THE contract between JavaScript and both
 * native bridges. RN codegen reads this file (see `codegenConfig` in
 * package.json) and generates the abstract `NativeZeotapSpec` the Kotlin and
 * Objective-C modules extend, so a method added here is a compile error on both
 * platforms until it is implemented. That is the point: the legacy RN package
 * (`rn-package-maattrraan`) had 28 native methods for 19 operations, a typo
 * frozen into the wire protocol (`initalizeBySettingOptions`), and
 * platform-asymmetric methods that were silent no-ops on the other side. None of
 * that is expressible here.
 *
 * Three rules this file follows deliberately:
 *
 * 1. **Everything is a Promise.** The native SDKs deliver their callbacks on a
 *    platform-specific thread (Android on its own SDK dispatcher, iOS on
 *    `callbackQueue`); a Promise is the one shape that hides that difference,
 *    and it means a gated drop surfaces as a rejection carrying the SDK's own
 *    message rather than vanishing.
 * 2. **`Object` bags, never typed structs.** Codegen's struct support differs
 *    across the arch matrix and RN versions this package supports (0.73+, both
 *    architectures). A bag validated in JS by `mapConfiguration`/`mapConsentInput`
 *    before it crosses is both portable and stricter than codegen would be —
 *    and the validation error names the offending option, which a codegen type
 *    error never does.
 * 3. **A method exists here only if a native SDK can honour it.** The
 *    advertising-id setters stay platform-specific because the arguments are
 *    irreducibly different — Android has a limit-ad-tracking flag, iOS an ATT
 *    decision — so each native side implements its own and REJECTS the foreign
 *    one with `E_PLATFORM`. Declaring only one would make the other platform a
 *    silent no-op, which is the legacy behaviour this replaces; the JS layer
 *    rejects first, so the native rejection is a backstop.
 *
 *    (Until the Android SDK gained `setAdvertisingId`, this file declared only
 *    the iOS method and the JS Android one rejected as unsupported. Both are
 *    real now.)
 *
 * There is deliberately NO `__runConformance` here, though increment 245 shipped
 * one that only ever rejected. Running `sdk/conformance` vectors through the
 * native engine from this module is not possible without widening each SDK's
 * PUBLIC API: the pieces a vector exercises — `Hasher`, `Keys`, the consent
 * state machine, the transport — are `internal` on Android and non-public on
 * iOS, and there is no seam to capture what the SDK produced. Exporting them for
 * a debug feature would permanently enlarge the supported surface (`apiCheck`
 * would then guard it) to prove something already proven three other ways: each
 * engine runs every vector in its own unit suite, the two codecs' tests cover
 * what this bridge can actually get wrong (marshalling), and
 * `e2e/tests/mobile/react-native.spec.ts` asserts real hashed payloads that
 * crossed this bridge on a device. See docs/increments/250-*.md.
 */
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** Idempotent, like the native `load`/`configure`. Rejects on a bad option. */
  configure(writeKey: string, options: Object): Promise<void>;

  track(event: string, properties: Object | null): Promise<void>;
  screen(name: string | null, category: string | null, properties: Object | null): Promise<void>;
  identify(userId: string | null, traits: Object | null): Promise<void>;
  group(groupId: string, traits: Object | null): Promise<void>;
  alias(newId: string, previousId: string | null): Promise<void>;

  /** One of `{tcfString}`, `{usPrivacy}`, `{analytics?,marketing?,advertising?,functional?}`. */
  setConsent(input: Object): Promise<void>;
  /** `{resolved, signals?: {track,identify,cookieSync}, source?, gdprApplies?}`. */
  getConsentState(): Promise<Object>;

  setUserIdentities(identities: Object, hashed: boolean): Promise<void>;
  /** `null` or an empty array removes every identity. Never consent-gated. */
  unsetUserIdentities(keys: Array<string> | null): Promise<void>;

  /**
   * `{anonymousId: string, userId: string | null}` in one call.
   *
   * One method rather than two getters because a nullable Promise return is the
   * least portable corner of codegen across the versions this package supports,
   * and because a caller wanting one almost always wants both.
   */
  getIdentity(): Promise<Object>;

  reset(): Promise<void>;
  flush(): Promise<void>;

  /**
   * Android only — rejects `E_PLATFORM` on iOS. `limitAdTracking` is the user's
   * opt-out: when true the id is NOT sent and `adTrackingEnabled: false` is.
   * Requires `collectAdvertisingId: true`, which is the host's single switch for
   * whether an advertising id may be collected at all; the native side logs a
   * warning when it is false rather than failing, matching iOS.
   * Pass `null` to withdraw a previously supplied id.
   */
  setAdvertisingIdAndroid(advertisingId: string | null, limitAdTracking: boolean): Promise<void>;

  /**
   * iOS only — rejects `E_PLATFORM` on Android. `trackingAuthorized` mirrors the
   * native `ZTConfiguration.setAdvertisingId(_:trackingAuthorized:)` signature
   * exactly: the SDK wants the decision, not the ATT enum, and the host owns the
   * prompt. Pass `null` + `false` to withdraw a previously supplied id.
   */
  setAdvertisingIdIOS(idfa: string | null, trackingAuthorized: boolean): Promise<void>;

  /** NativeEventEmitter plumbing — required in the spec by the new architecture. */
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/**
 * `getEnforcing` on purpose: the legacy package used `?? {}` and a Proxy, so a
 * missing native module surfaced as "undefined is not a function" at the first
 * call site instead of at load, and pointed at the SDK rather than at the app's
 * autolinking. `getEnforcing` throws immediately with the module name; the
 * wrapper in `./errors` turns that into a `ZeotapLinkingError` naming the
 * pod-install / rebuild step.
 */
export default TurboModuleRegistry.getEnforcing<Spec>('Zeotap');

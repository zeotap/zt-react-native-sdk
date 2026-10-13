/**
 * The error surface. Every rejection a caller can see comes from here, and each
 * one names what to do about it.
 *
 * The native bridges reject with a stable CODE as the first argument
 * (`E_NOT_CONFIGURED`, `E_CONFIG`, `E_CONSENT`, `E_PLATFORM`, `E_ARGUMENT`,
 * `E_SDK`), which `fromNativeError` maps onto these classes while preserving the
 * SDK's own message verbatim. Preserving it matters: a consent drop carries the
 * browser SDK's exact wording (`[SDK] Dropped track: no track consent`), and that
 * string is contractual — the web SDK's tests, the conformance vectors and both
 * native suites all assert it, so a bridge that reworded it would break parity in
 * the one place a customer actually reads.
 */

/** Base class, so `catch (e) { if (e instanceof ZeotapError) … }` covers all of them. */
export class ZeotapError extends Error {
  /** The native rejection code, or a JS-side equivalent. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    // Restores the prototype chain when the package is consumed as compiled
    // ES5/commonjs, where subclassing a built-in otherwise loses `instanceof`.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * The native module is not present. Almost always a build step that did not run,
 * so the message says which one rather than "undefined is not a function" — the
 * legacy package's failure mode, which pointed at the SDK instead of at
 * autolinking.
 */
export class ZeotapLinkingError extends ZeotapError {
  constructor(detail?: string) {
    super(
      'E_LINKING',
      "[SDK] The native module 'Zeotap' is not available. Rebuild the app after " +
        'installing the package: `pod install` in ios/ then rebuild for iOS, or a ' +
        'clean Gradle build for Android. Expo Go cannot load it at all — it needs a ' +
        'development build.' +
        (detail ? ` (${detail})` : ''),
    );
  }
}

/** An option or argument this layer rejected before it crossed the bridge. */
export class ZeotapConfigError extends ZeotapError {
  constructor(message: string) {
    super('E_CONFIG', message);
  }
}

/** The SDK dropped the event because the resolved consent denies it. */
export class ZeotapConsentError extends ZeotapError {
  constructor(message: string) {
    super('E_CONSENT', message);
  }
}

/**
 * A platform-specific method called on the wrong platform.
 *
 * A rejection, never a silent no-op: the legacy package made
 * `setAdvertisingId` a no-op on the platform that did not implement it, so an
 * app could ship believing it had set an advertising id that was never sent.
 */
export class ZeotapPlatformError extends ZeotapError {
  constructor(method: string, supported: 'android' | 'ios', actual: string) {
    super(
      'E_PLATFORM',
      `[SDK] ${method}() is ${supported}-only and was called on ${actual}. Guard the ` +
        `call with Platform.OS, or use Zeotap.${supported}.setAdvertisingId only inside ` +
        `a ${supported} branch.`,
    );
  }
}

/**
 * The call is meaningful but the platform SDK underneath has no way to honour it.
 *
 * Distinct from `ZeotapPlatformError` (wrong platform for a method that exists
 * elsewhere): this is "your platform's SDK does not offer this at all", and the
 * message must name what to do instead — otherwise it reads as a bug in the
 * bridge.
 */
export class ZeotapUnsupportedError extends ZeotapError {
  constructor(message: string) {
    super('E_UNSUPPORTED', message);
  }
}

/** The SDK reported something else; `message` is its own. */
export class ZeotapSdkError extends ZeotapError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

const CODE_KEY = 'code';

/**
 * Turn a rejection from the native side into the right class.
 *
 * RN delivers a rejected native promise as an `Error` whose `code` is the string
 * the native side passed. Anything without a recognised code is still wrapped
 * rather than re-thrown raw, so a caller never has to handle two error shapes.
 */
export function fromNativeError(error: unknown): ZeotapError {
  if (error instanceof ZeotapError) return error;

  const record = (error ?? {}) as Record<string, unknown>;
  const code = typeof record[CODE_KEY] === 'string' ? (record[CODE_KEY] as string) : 'E_SDK';
  const message =
    typeof record.message === 'string' && record.message.length > 0
      ? record.message
      : `[SDK] Native call failed (${code})`;

  switch (code) {
    case 'E_CONSENT':
      return new ZeotapConsentError(message);
    case 'E_CONFIG':
    case 'E_ARGUMENT':
      return new ZeotapConfigError(message);
    case 'E_LINKING':
      return new ZeotapLinkingError(message);
    default:
      // E_NOT_CONFIGURED, E_PLATFORM and E_SDK keep their own code: they are
      // distinguishable by code and there is nothing to add to the message.
      return new ZeotapSdkError(code, message);
  }
}

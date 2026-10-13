/**
 * One fake TurboModule for the whole suite.
 *
 * The tests exercise the JS layer's real code paths — validation, error mapping,
 * the integration stamp, the empty-argument short circuits — against a recorded
 * native module, which is the only part a unit test can own. What the native side
 * DOES with the bag is covered by each platform's own suite plus the
 * `sdk/conformance` runners; what crosses the bridge is covered here.
 */

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export interface FakeNative {
  calls: RecordedCall[];
  /** Queue a rejection for the next call to `method`. */
  failNext(method: string, error: unknown): void;
  /** Queue a resolved value for the next call to `method`. */
  resolveNext(method: string, value: unknown): void;
  reset(): void;
}

const calls: RecordedCall[] = [];
const failures = new Map<string, unknown>();
const values = new Map<string, unknown>();

function record(method: string, ...args: unknown[]): Promise<unknown> {
  calls.push({ method, args });
  if (failures.has(method)) {
    const error = failures.get(method);
    failures.delete(method);
    return Promise.reject(error);
  }
  if (values.has(method)) {
    const value = values.get(method);
    values.delete(method);
    return Promise.resolve(value);
  }
  return Promise.resolve(undefined);
}

export const fakeNative: FakeNative = {
  calls,
  failNext(method, error) {
    failures.set(method, error);
  },
  resolveNext(method, value) {
    values.set(method, value);
  },
  reset() {
    calls.length = 0;
    failures.clear();
    values.clear();
  },
};

/** The object `jest.mock('../NativeZeotap')` returns. */
export const nativeModuleMock = {
  configure: (...a: unknown[]) => record('configure', ...a),
  track: (...a: unknown[]) => record('track', ...a),
  screen: (...a: unknown[]) => record('screen', ...a),
  identify: (...a: unknown[]) => record('identify', ...a),
  group: (...a: unknown[]) => record('group', ...a),
  alias: (...a: unknown[]) => record('alias', ...a),
  setConsent: (...a: unknown[]) => record('setConsent', ...a),
  getConsentState: (...a: unknown[]) => record('getConsentState', ...a),
  setUserIdentities: (...a: unknown[]) => record('setUserIdentities', ...a),
  unsetUserIdentities: (...a: unknown[]) => record('unsetUserIdentities', ...a),
  getIdentity: (...a: unknown[]) => record('getIdentity', ...a),
  reset: (...a: unknown[]) => record('reset', ...a),
  flush: (...a: unknown[]) => record('flush', ...a),
  setAdvertisingIdAndroid: (...a: unknown[]) => record('setAdvertisingIdAndroid', ...a),
  setAdvertisingIdIOS: (...a: unknown[]) => record('setAdvertisingIdIOS', ...a),
  addListener: () => undefined,
  removeListeners: () => undefined,
};

/** A rejection shaped like RN's: an Error carrying the native `code`. */
export function nativeRejection(code: string, message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

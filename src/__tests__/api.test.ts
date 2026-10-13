/**
 * The public API's behaviour at the bridge boundary: what forwards, what
 * short-circuits, what rejects, and how a native rejection is re-shaped.
 *
 * `NativeZeotap` is mocked because the native module is the thing under test on
 * the OTHER side of the boundary (each platform's own suite plus the conformance
 * runners cover it). What this file owns is the promise that a call which reaches
 * the bridge carries exactly the arguments the contract says.
 */
import { fakeNative, nativeRejection } from './mocks';
import Zeotap, {
  ZeotapConfigError,
  ZeotapConsentError,
  ZeotapPlatformError,
} from '../index';

// `jest.mock` factories are hoisted above the imports, so they may not close over
// an imported binding — hence the inline `require`, which jest explicitly allows.
jest.mock('../NativeZeotap', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  default: require('./mocks').nativeModuleMock,
}));
jest.mock('react-native', () => ({
  // Pinned to android so the platform-rejection test has a definite "other"
  // platform; the iOS direction is the same code path with OS swapped.
  Platform: { OS: 'android' },
  NativeEventEmitter: class {
    addListener() {
      return { remove() {} };
    }
  },
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  TurboModuleRegistry: { getEnforcing: () => require('./mocks').nativeModuleMock },
}));

const HOST = { apiHost: 'https://ingest.example' };
const lastCall = (method: string) => [...fakeNative.calls].reverse().find(c => c.method === method);

beforeEach(async () => {
  fakeNative.reset();
  Zeotap.__resetForTesting();
});

describe('configure', () => {
  it('forwards the write key and the mapped configuration', async () => {
    await Zeotap.configure('wk_test', HOST);
    const call = lastCall('configure');
    expect(call?.args[0]).toBe('wk_test');
    expect(call?.args[1]).toMatchObject({
      apiHost: 'https://ingest.example',
      flushAt: 10,
      integration: { name: 'react-native-sdk' },
    });
  });

  it('rejects a blank write key before touching the bridge', async () => {
    await expect(Zeotap.configure('', HOST)).rejects.toThrow('[SDK] writeKey is required');
    expect(fakeNative.calls).toHaveLength(0);
  });

  it('rejects a bad option before touching the bridge', async () => {
    await expect(Zeotap.configure('wk', { apiHost: 'nope' })).rejects.toThrow(ZeotapConfigError);
    expect(fakeNative.calls).toHaveLength(0);
  });

  it('is idempotent — a second call resolves', async () => {
    await Zeotap.configure('wk_test', HOST);
    await expect(Zeotap.configure('wk_test', HOST)).resolves.toBeUndefined();
  });
});

describe('pre-configure calls', () => {
  it.each([
    ['track', () => Zeotap.track('Ev')],
    ['screen', () => Zeotap.screen('Home')],
    ['identify', () => Zeotap.identify('u1')],
    ['group', () => Zeotap.group('g1')],
    ['alias', () => Zeotap.alias('n1')],
    ['setConsent', () => Zeotap.setConsent({ analytics: true })],
    ['setUserIdentities', () => Zeotap.setUserIdentities({ email: 'a@b.com' })],
    ['unsetUserIdentities', () => Zeotap.unsetUserIdentities()],
    ['getIdentity', () => Zeotap.getIdentity()],
    ['reset', () => Zeotap.reset()],
    ['flush', () => Zeotap.flush()],
  ])('%s rejects with the web SDK’s wording', async (method, run) => {
    await expect(run()).rejects.toThrow(
      `[SDK] Not initialized. Call configure() before ${method}().`,
    );
    expect(fakeNative.calls).toHaveLength(0);
  });

  it('getConsentState is callable pre-configure and answers unresolved', async () => {
    // Web parity: `getConsentState()` never throws before load().
    await expect(Zeotap.getConsentState()).resolves.toEqual({ resolved: false });
    expect(fakeNative.calls).toHaveLength(0);
  });
});

describe('event methods', () => {
  beforeEach(async () => {
    await Zeotap.configure('wk_test', HOST);
    fakeNative.reset();
  });

  it('forwards track with null properties when omitted', async () => {
    await Zeotap.track('Sample Track');
    expect(lastCall('track')?.args).toEqual(['Sample Track', null]);
  });

  it('forwards track properties verbatim', async () => {
    await Zeotap.track('Sample Track', { count: 1, source: 'sample-app' });
    expect(lastCall('track')?.args[1]).toEqual({ count: 1, source: 'sample-app' });
  });

  it.each([
    ['track', () => Zeotap.track('')],
    ['group', () => Zeotap.group('')],
    ['alias', () => Zeotap.alias('')],
  ])('%s with an empty name resolves WITHOUT sending, like the web SDK', async (_m, run) => {
    await expect(run()).resolves.toBeUndefined();
    expect(fakeNative.calls).toHaveLength(0);
  });

  it('forwards screen with nulls for the optional arguments', async () => {
    await Zeotap.screen();
    expect(lastCall('screen')?.args).toEqual([null, null, null]);
    await Zeotap.screen('Home', 'Sample', { tab: 'main' });
    expect(lastCall('screen')?.args).toEqual(['Home', 'Sample', { tab: 'main' }]);
  });

  it('forwards identify with a null userId when omitted', async () => {
    await Zeotap.identify(undefined, { plan: 'sample' });
    expect(lastCall('identify')?.args).toEqual([null, { plan: 'sample' }]);
  });

  it('forwards alias with a null previousId so the native side supplies the anonymousId', async () => {
    await Zeotap.alias('new-1');
    expect(lastCall('alias')?.args).toEqual(['new-1', null]);
  });
});

describe('identities', () => {
  beforeEach(async () => {
    await Zeotap.configure('wk_test', HOST);
    fakeNative.reset();
  });

  it('forwards values and the hashed flag', async () => {
    await Zeotap.setUserIdentities({ email: 'a@b.com' });
    expect(lastCall('setUserIdentities')?.args).toEqual([{ email: 'a@b.com' }, false]);
    await Zeotap.setUserIdentities({ email_sha256_lowercase: 'h' }, { hashed: true });
    expect(lastCall('setUserIdentities')?.args).toEqual([{ email_sha256_lowercase: 'h' }, true]);
  });

  it('does not cross the bridge when nothing survives validation', async () => {
    await Zeotap.setUserIdentities({ email: null } as never);
    expect(fakeNative.calls).toHaveLength(0);
  });

  it('rejects a non-string value by key', async () => {
    await expect(Zeotap.setUserIdentities({ loyaltyId: 1 } as never)).rejects.toThrow(
      /identities\.loyaltyId must be a string/,
    );
  });

  it('unsetUserIdentities() forwards null for "remove everything"', async () => {
    await Zeotap.unsetUserIdentities();
    expect(lastCall('unsetUserIdentities')?.args).toEqual([null]);
    await Zeotap.unsetUserIdentities(['email']);
    expect(lastCall('unsetUserIdentities')?.args).toEqual([['email']]);
  });

  it('rejects a malformed keys array', async () => {
    await expect(Zeotap.unsetUserIdentities([1] as never)).rejects.toThrow(
      /keys must be an array of strings/,
    );
  });

  it('getIdentity resolves the native bag', async () => {
    fakeNative.resolveNext('getIdentity', { anonymousId: 'anon-1', userId: null });
    await expect(Zeotap.getIdentity()).resolves.toEqual({ anonymousId: 'anon-1', userId: null });
  });
});

describe('native rejections', () => {
  beforeEach(async () => {
    await Zeotap.configure('wk_test', HOST);
    fakeNative.reset();
  });

  it('maps E_CONSENT to ZeotapConsentError, preserving the SDK’s own message', async () => {
    // The wording is contractual: the web SDK's tests, the conformance vectors
    // and both native suites all assert this exact string.
    const message = '[SDK] Dropped track: no track consent';
    fakeNative.failNext('track', nativeRejection('E_CONSENT', message));
    await expect(Zeotap.track('Ev')).rejects.toThrow(ZeotapConsentError);
    await expect(
      (async () => {
        fakeNative.failNext('track', nativeRejection('E_CONSENT', message));
        await Zeotap.track('Ev');
      })(),
    ).rejects.toThrow(message);
  });

  it('maps E_ARGUMENT and E_CONFIG to ZeotapConfigError', async () => {
    fakeNative.failNext('setConsent', nativeRejection('E_ARGUMENT', 'bad bag'));
    await expect(Zeotap.setConsent({ analytics: true })).rejects.toThrow(ZeotapConfigError);
  });

  it('keeps an unknown code rather than swallowing it', async () => {
    fakeNative.failNext('flush', nativeRejection('E_SDK', 'ingest unreachable'));
    await expect(Zeotap.flush()).rejects.toMatchObject({
      code: 'E_SDK',
      message: 'ingest unreachable',
    });
  });

  it('turns a missing native module into a linking error naming the fix', async () => {
    fakeNative.failNext('flush', new TypeError('null is not an object'));
    await expect(Zeotap.flush()).rejects.toThrow(/Rebuild the app after installing the package/);
  });
});

describe('platform-specific methods', () => {
  beforeEach(async () => {
    await Zeotap.configure('wk_test', HOST);
    fakeNative.reset();
  });

  it('forwards the Android advertising id, coercing the flag to a boolean', async () => {
    await Zeotap.android.setAdvertisingId('gaid-1', false);
    expect(lastCall('setAdvertisingIdAndroid')?.args).toEqual(['gaid-1', false]);
    // `null` withdraws a previously supplied id — distinct from never setting one.
    await Zeotap.android.setAdvertisingId(null, true);
    expect(lastCall('setAdvertisingIdAndroid')?.args).toEqual([null, true]);
  });

  it('REJECTS the iOS method on Android instead of silently doing nothing', async () => {
    await expect(Zeotap.ios.setAdvertisingId('idfa', true)).rejects.toThrow(ZeotapPlatformError);
    await expect(Zeotap.ios.setAdvertisingId('idfa', true)).rejects.toThrow(
      /ios-only and was called on android/,
    );
    expect(fakeNative.calls).toHaveLength(0);
  });
});

describe('info', () => {
  it('reports the package version and integration name', () => {
    expect(Zeotap.info.integration).toBe('react-native-sdk');
    expect(Zeotap.info.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

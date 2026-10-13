/**
 * The options mapper is where a host's mistake becomes a named error instead of a
 * native crash, and where the two platforms are made to agree on every default.
 * Both properties are asserted here rather than trusted.
 */
import { mapConfiguration } from '../mapConfiguration';
import { ZeotapConfigError } from '../errors';
import { INTEGRATION_NAME, SDK_VERSION } from '../version';

const minimal = { apiHost: 'https://ingest.example' };

describe('mapConfiguration defaults', () => {
  it('applies the browser SDK’s defaults verbatim', () => {
    const { configuration } = mapConfiguration(minimal);
    expect(configuration).toMatchObject({
      apiHost: 'https://ingest.example',
      namespace: 'zeotap',
      flushAt: 10,
      // Milliseconds, like the web SDK — the unit is part of the contract.
      flushInterval: 5000,
      debug: false,
      nativeAppId: '',
      maxQueueSize: 500,
      trackApplicationLifecycleEvents: false,
      flushOnBackground: true,
      collectAdvertisingId: false,
    });
    expect(configuration.consent).toMatchObject({
      require: false,
      default: 'granted',
      cmpTimeoutMs: 10_000,
      maxBufferedEvents: 10,
      cmp: 'none',
      checkVendorConsent: false,
      persist: true,
      expiryDays: 365,
    });
  });

  it('defaults cmp to auto when consent is required, none otherwise', () => {
    expect(mapConfiguration({ ...minimal, consent: { require: true } }).configuration.consent.cmp).toBe(
      'auto',
    );
    expect(mapConfiguration(minimal).configuration.consent.cmp).toBe('none');
    // An explicit value always wins over the derived one.
    expect(
      mapConfiguration({ ...minimal, consent: { require: true, cmp: 'none' } }).configuration.consent
        .cmp,
    ).toBe('none');
  });

  it('omits purpose lists when absent or empty so the native defaults apply', () => {
    const { configuration } = mapConfiguration({ ...minimal, consent: { purposesForTracking: [] } });
    expect('purposesForTracking' in configuration.consent).toBe(false);
    expect('purposesForIdentifying' in configuration.consent).toBe(false);
  });

  it('forwards both purpose shapes: a flat list and a list of groups', () => {
    const flat = mapConfiguration({
      ...minimal,
      consent: { purposesForIdentifying: [1, 9] },
    }).configuration.consent;
    expect(flat.purposesForIdentifying).toEqual([1, 9]);
    // Groups are the SDKs' DEFAULT rule, not an option any SDK accepts: iOS used to
    // flatten them into "all of 1,3,4,5,6" and Android could not compile them.
    expect(() =>
      mapConfiguration({ ...minimal, consent: { purposesForTracking: [[1, 3, 4], [1, 5, 6]] } }),
    ).toThrow(/purpose groups are not an option/);
  });
});

describe('mapConfiguration stamps the integration', () => {
  it('always sets react-native-sdk with this package’s version', () => {
    const { configuration } = mapConfiguration(minimal);
    expect(configuration.integration).toEqual({
      name: INTEGRATION_NAME,
      version: SDK_VERSION,
    });
    expect(configuration.integration.name).toBe('react-native-sdk');
  });

  it('cannot be overridden by the host', () => {
    // This is how a payload in the warehouse stays attributable to the bridge.
    const { configuration, warnings } = mapConfiguration({
      ...minimal,
      integration: { name: 'not-us', version: '9.9.9' },
    } as never);
    expect(configuration.integration.name).toBe('react-native-sdk');
    expect(warnings.join('\n')).toContain('unknown option integration');
  });
});

describe('mapConfiguration validation', () => {
  it('requires apiHost — there is no same-origin default on a device', () => {
    expect(() => mapConfiguration({})).toThrow(ZeotapConfigError);
    expect(() => mapConfiguration({})).toThrow(/options\.apiHost must be a non-empty string/);
  });

  it('rejects a non-absolute apiHost', () => {
    expect(() => mapConfiguration({ apiHost: '/cdp' })).toThrow(
      /apiHost must be an absolute http\(s\) URL/,
    );
  });

  it('strips a trailing slash so the native side builds one canonical URL', () => {
    expect(mapConfiguration({ apiHost: 'https://x.example/' }).configuration.apiHost).toBe(
      'https://x.example',
    );
  });

  it.each([
    ['flushAt', { flushAt: 0 }, /options\.flushAt must be a positive integer/],
    ['flushAt as a string', { flushAt: '10' }, /options\.flushAt must be a positive integer/],
    ['flushInterval', { flushInterval: -1 }, /options\.flushInterval must be a positive integer/],
    ['maxQueueSize', { maxQueueSize: 1.5 }, /options\.maxQueueSize must be a positive integer/],
    ['debug', { debug: 'yes' }, /options\.debug must be a boolean/],
    ['namespace', { namespace: 7 }, /options\.namespace must be a string/],
  ])('rejects a bad %s by name', (_label, extra, pattern) => {
    expect(() => mapConfiguration({ ...minimal, ...(extra as object) })).toThrow(pattern);
  });

  it.each([
    ['consent.default', { default: 'maybe' }, /consent\.default must be one of "granted" \| "denied"/],
    ['consent.cmp', { cmp: 'sometimes' }, /consent\.cmp must be one of "auto" \| "none"/],
    ['consent.require', { require: 1 }, /consent\.require must be a boolean/],
    ['consent.expiryDays', { expiryDays: 0 }, /consent\.expiryDays must be a positive integer/],
    [
      'consent.purposesForTracking',
      { purposesForTracking: ['1'] },
      /consent\.purposesForTracking must be an array of purpose ids/,
    ],
  ])('rejects a bad %s by name', (_label, consent, pattern) => {
    expect(() => mapConfiguration({ ...minimal, consent })).toThrow(pattern);
  });

  it('rejects a non-object options bag', () => {
    expect(() => mapConfiguration('nope' as never)).toThrow(/must be an object/);
    expect(() => mapConfiguration([] as never)).toThrow(/must be an object/);
  });

  it('accepts an entirely absent options bag except for the required host', () => {
    // apiHost is the only required option, so `undefined` must fail on it and
    // nothing else — a mapper that threw on a missing `consent` would force
    // every caller to pass a bag it does not care about.
    expect(() => mapConfiguration(undefined)).toThrow(/apiHost/);
  });
});

describe('mapConfiguration warnings', () => {
  it('names a browser-only option instead of silently ignoring it', () => {
    const { warnings } = mapConfiguration({ ...minimal, autoPage: true, cookieDomain: '.x.com' } as never);
    expect(warnings.join('\n')).toContain('autoPage is a browser-SDK option');
    expect(warnings.join('\n')).toContain('There is no page() on mobile');
    expect(warnings.join('\n')).toContain('cookieDomain is a browser-SDK option');
  });

  it('names an unknown option — a typo is inert, not fatal', () => {
    const { warnings, configuration } = mapConfiguration({ ...minimal, flushInternal: 1 } as never);
    expect(warnings.join('\n')).toContain('unknown option flushInternal');
    // The typo did not silently change the real option.
    expect(configuration.flushInterval).toBe(5000);
  });

  it('names an unknown consent option under its own path', () => {
    const { warnings } = mapConfiguration({ ...minimal, consent: { requre: true } } as never);
    expect(warnings.join('\n')).toContain('unknown option consent.requre');
  });

  it('warns about nothing when the bag is clean', () => {
    expect(mapConfiguration({ ...minimal, flushAt: 20, consent: { require: true } }).warnings).toEqual(
      [],
    );
  });
});

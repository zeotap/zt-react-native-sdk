/**
 * The RN layer read against the REAL `sdk/conformance` vectors.
 *
 * This bridge cannot run the vectors through the native engine — the pieces they
 * exercise (`Hasher`, `Keys`, the consent state machine, the transport) are
 * `internal` on Android and non-public on iOS, and exporting them for a debug
 * feature would permanently widen each SDK's supported surface. That is why
 * `__runConformance` was removed rather than implemented; see
 * docs/increments/250-*.md.
 *
 * What this bridge CAN be held to is narrower and still worth pinning: every
 * consent input shape the browser SDK accepts must survive `mapConsentInput`,
 * and every namespace the storage-keys family names must be one this layer
 * passes through untouched. If the web SDK grows a new consent form, these tests
 * fail here — which is the whole point of generating vectors from it.
 *
 * The vectors are read from disk, not copied: a stale copy would assert against
 * yesterday's contract and pass.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { mapConsentInput } from '../mapConsentInput';
import { mapConfiguration } from '../mapConfiguration';
import { ZeotapConfigError } from '../errors';

// In the monorepo the vectors sit beside this package. The standalone public
// repository (scripts/sdk-export/export-react-native.sh) carries a copy at
// conformance/vectors and says so through jest.globals.ZEOTAP_CONFORMANCE_DIR
// in package.json — a setting rather than a "whichever exists" probe, so a tree
// missing its vectors fails in load() instead of quietly reading another copy.
declare const ZEOTAP_CONFORMANCE_DIR: string | undefined;
const PACKAGE_ROOT = join(__dirname, '../..');
const VECTORS = join(
  PACKAGE_ROOT,
  typeof ZEOTAP_CONFORMANCE_DIR === 'string' ? ZEOTAP_CONFORMANCE_DIR : '../conformance/vectors',
);

interface VectorCase {
  id: string;
  description?: string;
  input: unknown;
  expected: unknown;
  platforms?: string[];
}

function load(family: string): VectorCase[] {
  const file = join(VECTORS, `${family}.vectors.json`);
  const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { cases: VectorCase[] };
  expect(parsed.cases.length).toBeGreaterThan(0);
  return parsed.cases;
}

/**
 * Where this layer deliberately disagrees with the browser SDK, under one rule:
 * **an empty consent input is rejected rather than silently granting.**
 *
 * The browser SDK resolves all three of these to `track: true, identify: true`,
 * because an absent category is a grant — so `{}`, `{tcfString: ""}` and
 * `{usPrivacy: ""}` each mean full consent to it. From an app, every one of them
 * far more likely means "the CMP returned nothing" or "the user consented to
 * nothing", and silently granting on that reading is an invisible privacy
 * failure rather than a recoverable bug. `mapConsentInput` rejects them with a
 * message naming what to pass instead (`{analytics: false}` to deny).
 *
 * Recorded in `sdk/conformance/README.md` too, so it is a decision on the record
 * rather than a discrepancy someone finds later.
 */
const DELIBERATE_DEVIATIONS = new Set(['parsed/empty', 'tcf/empty', 'usp/empty']);

/**
 * Cases in this family whose `input` is NOT a `ConsentInput` at all.
 *
 * The family pins `resolveSignals`, and the generator also uses it to pin
 * `uniformSignals(granted)` — its own note says so: *"input is a ConsentInput
 * ({tcfString} | {usPrivacy} | parsed booleans) except the two `uniform` cases"*.
 * Feeding `{uniform: true}` to `mapConsentInput` would be asserting that the
 * bridge accepts a shape no caller can send.
 */
const NOT_CONSENT_INPUTS = new Set(['uniform/granted', 'uniform/denied']);

describe('consent-signals vectors', () => {
  const cases = load('consent-signals');

  it('covers every input form the browser SDK accepts', () => {
    // A guard on the guard: if the family shrank to nothing meaningful the
    // per-case assertions below would vacuously pass.
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases.map(c => [c.id, c] as const))(
    'mapConsentInput accepts %s',
    (id, testCase) => {
      const input = testCase.input as Record<string, unknown>;

      if (NOT_CONSENT_INPUTS.has(id)) {
        // Asserted as an exclusion rather than filtered away, so this fails
        // loudly if the generator ever turns `uniform` into a real input form.
        expect(Object.keys(input)).toEqual(['uniform']);
        return;
      }

      if (DELIBERATE_DEVIATIONS.has(id)) {
        // Pinned as a deviation, not skipped: if someone "fixes" the mapper to
        // match the web SDK, this fails and they read the reason above.
        expect(() => mapConsentInput(input)).toThrow(ZeotapConfigError);
        return;
      }

      const mapped = mapConsentInput(input) as Record<string, unknown>;
      // The mapper forwards the form verbatim — it validates, it does not
      // transform. Anything else would mean the native side resolves a
      // different input than the browser SDK did.
      expect(mapped).toEqual(input);
    },
  );
});

describe('consent-resolution vectors', () => {
  /**
   * This family scripts `offer`/`setConsent` calls against the consent manager,
   * which lives in the native SDK. The only part this layer owns is the INPUT of
   * each `setConsent` step, so that is what is asserted.
   */
  const inputs = load('consent-resolution')
    .flatMap(c => {
      const steps = (c.input as { steps?: Array<Record<string, unknown>> }).steps ?? [];
      return steps
        .filter(step => step.op === 'setConsent' && step.input)
        .map(step => [c.id, step.input as Record<string, unknown>] as const);
    });

  it('has consent inputs to check', () => {
    expect(inputs.length).toBeGreaterThan(0);
  });

  it.each(inputs)('mapConsentInput accepts the input in %s', (_id, input) => {
    expect(() => mapConsentInput(input)).not.toThrow();
  });
});

describe('storage-keys vectors', () => {
  const cases = load('storage-keys');

  it.each(cases.map(c => [c.id, c] as const))(
    'the namespace in %s survives mapConfiguration untouched',
    (_id, testCase) => {
      const namespace = (testCase.input as { namespace: string }).namespace;
      const { configuration } = mapConfiguration({
        apiHost: 'https://ingest.example',
        namespace,
      });
      // The bridge must not normalise, lower-case or prefix the namespace: the
      // native SDK derives every storage key from it, and a WebView sharing the
      // same namespace has to land on the same keys.
      expect(configuration.namespace).toBe(namespace);
    },
  );

  it('defaults to the namespace the vectors treat as canonical', () => {
    const canonical = cases.map(c => (c.input as { namespace: string }).namespace);
    expect(canonical).toContain('zeotap');
    expect(mapConfiguration({ apiHost: 'https://ingest.example' }).configuration.namespace).toBe(
      'zeotap',
    );
  });
});

describe('payload vectors', () => {
  /**
   * The payload family is built by the native SDK, so almost none of it is this
   * layer's business. The exception is the integration stamp: the vectors carry
   * `$LIBRARY_NAME`/`$LIBRARY_VERSION` placeholders that each platform
   * substitutes, and this bridge adds `context.library.integration` on top —
   * the one field it contributes to every payload.
   */
  it('pins the integration mechanism this bridge rides on', () => {
    // Each case's `expected.payloads[]` carries `context.library` with
    // `$LIBRARY_NAME`/`$LIBRARY_VERSION` placeholders each platform substitutes
    // for its own identity. A subset ALSO carries `integration` — the web SDK's
    // `integration` LoadOption, generated with the GTM template's stamp.
    //
    // That subset is what matters here: it is the same field, set the same way,
    // that this bridge fills with `react-native-sdk`. If the shape ever changed
    // (a rename, a nesting change), the RN e2e assertion on
    // `context.library.integration` would start failing in CI on a device; this
    // fails in a unit test instead.
    const libraries = load('payload')
      .flatMap(
        c =>
          (c.expected as { payloads?: Array<{ context?: { library?: Record<string, unknown> } }> })
            .payloads ?? [],
      )
      .map(p => p.context?.library)
      .filter((l): l is Record<string, unknown> => l !== undefined);
    expect(libraries.length).toBeGreaterThan(0);

    // Every case substitutes the platform's own identity through the same
    // placeholder, so this bridge's `@zeotap/android-sdk` / `@zeotap/ios-sdk`
    // values land where the vectors say they should.
    for (const library of libraries) {
      expect(library.name).toBe('$LIBRARY_NAME');
      expect(library.version).toBe('$LIBRARY_VERSION');
    }

    const stamped = libraries.filter(l => l.integration !== undefined);
    expect(stamped.length).toBeGreaterThan(0);
    for (const library of stamped) {
      const integration = library.integration as Record<string, unknown>;
      // `{name, version}` and nothing else — the shape mapConfiguration builds.
      expect(Object.keys(integration).sort()).toEqual(['name', 'version']);
      expect(typeof integration.name).toBe('string');
      expect(typeof integration.version).toBe('string');
    }
  });

  it('the bridge stamps the integration the e2e suite asserts', () => {
    const { configuration } = mapConfiguration({ apiHost: 'https://ingest.example' });
    expect(configuration.integration.name).toBe('react-native-sdk');
  });
});

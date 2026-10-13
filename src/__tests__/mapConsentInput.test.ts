/**
 * `setConsent` is the one input where being permissive is dangerous: two forms at
 * once would let the resolver silently pick which one decides whether events
 * flow, and an empty bag would resolve to GRANTED (the web SDK treats an absent
 * category as a grant). Both are rejected, and both rejections are asserted.
 */
import { mapConsentInput } from '../mapConsentInput';
import { identityValues } from '../guards';
import { ZeotapConfigError } from '../errors';

describe('mapConsentInput', () => {
  it('accepts a TC string', () => {
    expect(mapConsentInput({ tcfString: 'CQAbc' })).toEqual({ tcfString: 'CQAbc' });
  });

  it('accepts a US Privacy string', () => {
    expect(mapConsentInput({ usPrivacy: '1YNN' })).toEqual({ usPrivacy: '1YNN' });
  });

  it('accepts a partial category set — an omitted category is "not decided"', () => {
    expect(mapConsentInput({ analytics: true })).toEqual({ analytics: true });
    expect(mapConsentInput({ analytics: false, marketing: true })).toEqual({
      analytics: false,
      marketing: true,
    });
  });

  it('rejects two forms at once, naming both', () => {
    expect(() => mapConsentInput({ tcfString: 'CQ', analytics: true })).toThrow(ZeotapConfigError);
    expect(() => mapConsentInput({ tcfString: 'CQ', analytics: true })).toThrow(
      /exactly one form.*got tcfString \+ categories \(analytics\)/s,
    );
    expect(() => mapConsentInput({ tcfString: 'CQ', usPrivacy: '1YNN' })).toThrow(
      /got tcfString \+ usPrivacy/,
    );
  });

  it('rejects an empty bag, explaining that it would have GRANTED', () => {
    expect(() => mapConsentInput({})).toThrow(/would resolve to GRANTED/);
  });

  it('rejects an unknown key rather than dropping it', () => {
    expect(() => mapConsentInput({ analytics: true, personalisation: true })).toThrow(
      /unknown key\(s\) personalisation/,
    );
  });

  it('rejects a non-boolean category, pointing at "omit the key" instead', () => {
    expect(() => mapConsentInput({ analytics: 'true' })).toThrow(
      /setConsent analytics must be a boolean/,
    );
  });

  it('rejects an empty string for either string form', () => {
    expect(() => mapConsentInput({ tcfString: '' })).toThrow(/tcfString must be a non-empty string/);
    expect(() => mapConsentInput({ usPrivacy: '' })).toThrow(/usPrivacy must be a non-empty string/);
  });

  it('rejects a non-object', () => {
    expect(() => mapConsentInput(null)).toThrow(/must be an object/);
    expect(() => mapConsentInput(['analytics'])).toThrow(/must be an object/);
  });
});

describe('identityValues', () => {
  it('passes strings through', () => {
    expect(identityValues({ email: 'a@b.com', fpuid: 'fp-1' })).toEqual({
      email: 'a@b.com',
      fpuid: 'fp-1',
    });
  });

  it('drops null and undefined — absent means "not set", as on the web', () => {
    expect(identityValues({ email: 'a@b.com', cellno: null, loginid: undefined })).toEqual({
      email: 'a@b.com',
    });
  });

  it('rejects a non-string value by key, explaining the downstream consequence', () => {
    // A number stringified to "12345" would be hashed and shipped, matching
    // nothing — and nobody would see an error.
    expect(() => identityValues({ loyaltyId: 12345 })).toThrow(
      /identities\.loyaltyId must be a string/,
    );
    expect(() => identityValues({ loyaltyId: 12345 })).toThrow(/match nothing/);
  });

  it('rejects a nested object value', () => {
    expect(() => identityValues({ email: { sha256: 'x' } })).toThrow(/identities\.email must be a string/);
  });
});

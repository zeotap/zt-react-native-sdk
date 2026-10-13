# `@zeotap/react-native-sdk`

The SignalSmith React Native SDK — a **thin bridge** over the native
[Android](https://github.com/zeotap/zeotap-pulse-android) and [iOS](https://github.com/zeotap/zeotap-pulse-ios) SDKs.

All the business logic lives in those: the payload shape, consent gating, the IAB
TCF integration, on-device PII hashing, the durable offline queue and the retry
policy. This package validates its arguments, maps errors, stamps the
`react-native-sdk` integration and forwards. That is deliberate — see
[Why a bridge](#why-a-bridge-and-not-a-javascript-port).

## Install

```bash
npm install @zeotap/react-native-sdk
cd ios && pod install          # iOS
```

Autolinking finds the native module; no manifest or `AppDelegate` edits.
**Expo** users need a [development build](https://docs.expo.dev/develop/development-builds/introduction/)
(Expo Go ships a fixed set of native modules and cannot load this one) and should
add the config plugin:

```json
{ "expo": { "plugins": [["@zeotap/react-native-sdk", {
  "iosUserTrackingUsageDescription": "We use your data to personalise ads."
}]] } }
```

Requirements: React Native ≥ 0.73 (both the old and new architecture), iOS 14+,
Android minSdk 23.

## Usage

```ts
import Zeotap from '@zeotap/react-native-sdk';

await Zeotap.configure('YOUR_WRITE_KEY', {
  apiHost: 'https://ingest.example.com',   // required — see below
  flushAt: 10,
  flushInterval: 5000,                     // milliseconds, as in the browser SDK
  consent: { require: true, default: 'denied' },
});

await Zeotap.track('Order Completed', { revenue: 149.0, currency: 'USD' });
await Zeotap.screen('Checkout', 'Shop', { step: 3 });
await Zeotap.identify('user-42', { plan: 'pro' });
await Zeotap.setUserIdentities({ email: 'a@b.com', cellno: '91 9999999999' });
await Zeotap.setConsent({ analytics: true, marketing: false });
```

Every method returns a Promise. Three behaviours are worth knowing up front:

- **A gated drop rejects.** When consent denies an event the promise rejects with
  the SDK's own message (`[SDK] Dropped track: no track consent`) as a
  `ZeotapConsentError`, so `try/catch` around `await track(...)` sees consent
  decisions. On the web the same information arrives as a callback error.
- **Empty names resolve without sending.** `track('')`, `group('')` and
  `alias('')` are silent no-ops, exactly as in the browser SDK: a missing product
  name in a UI is not an error the caller can act on.
- **`apiHost` is required.** On the web an empty host means "same origin"; a
  device has no origin, so an absent host would be a silent no-send.

### Options

Names **and units** are the browser SDK's, so one options object serves both
platforms and a web-SDK user relearns nothing. Full list and defaults:
[`src/types.ts`](src/types.ts). Options that exist on the web but not here
(`autoPage`, the cookie options, `credentials`, `storage`) are reported as
warnings on the `debug` stream rather than silently ignored — mobile has no
cookie jar, and `screen()` is the mobile primitive, so there is no `page()`.

### Errors

| class | when |
|---|---|
| `ZeotapConfigError` | an option or argument this layer rejected, named in the message |
| `ZeotapConsentError` | the SDK dropped the event because consent denies it |
| `ZeotapLinkingError` | the native module is not present — names the build step to re-run |
| `ZeotapPlatformError` | a platform-specific method called on the other platform |
| `ZeotapUnsupportedError` | the platform SDK has no way to honour the call |
| `ZeotapSdkError` | anything else, with the native code on `.code` |

### Diagnostics

```ts
Zeotap.addListener('error', ({ message }) => console.warn(message));
Zeotap.addListener('debug', ({ message }) => console.log(message));
```

A Promise covers the call that failed; this stream carries what no call owns — a
batch rejected by ingest, a delivery exhausted after four attempts, a pre-consent
buffer overflow that dropped an event nobody was awaiting.

### Advertising id

```ts
// Android — `limitAdTracking` is the user's opt-out
await Zeotap.android.setAdvertisingId(gaid, limitAdTracking);

// iOS — the host owns the ATT prompt; the SDK never calls requestTrackingAuthorization
await Zeotap.ios.setAdvertisingId(idfa, trackingAuthorized);
```

Two methods rather than one because the arguments differ irreducibly: Android has
a limit-ad-tracking flag, iOS an ATT decision. Calling the wrong one **rejects**
with a `ZeotapPlatformError` — it does not quietly do nothing, which is what the
legacy package did, letting an app ship believing it had set an id that was never
sent.

Both require `collectAdvertisingId: true`, which is your single switch for
whether an advertising id may be collected at all; one call does not override it,
and the native side logs a warning when it is false. A host-supplied value always
wins over the SDK's own lookup, and on Android the (blocking, IPC) Play Services
lookup is then not attempted at all. Pass `null` to withdraw an id.

If you would rather not supply one, Android can resolve the GAID itself: set
`collectAdvertisingId: true` and add `play-services-ads-identifier` to your app.

## Why a bridge, and not a JavaScript port

Reusing the browser SDK in JavaScript was the alternative and was rejected. A JS port
cannot survive process death (the durable SQLite queue is what makes delivery
at-least-once across an app kill), cannot share an `anonymousId` with a WebView
in a hybrid app, would need a second hashing implementation for React Native's
missing SubtleCrypto, and would collect no device context. Every one of those is
load-bearing for a mobile CDP.

The cost is that this package is only as good as its boundary, which is why the
boundary is where the tests are.

## Architecture

```
src/NativeZeotap.ts      the codegen spec — THE contract; adding a method here
                         is a compile error on both platforms until implemented
src/index.ts             the public API: guards, short circuits, error mapping
src/mapConfiguration.ts  options → the native bag, with the web SDK's defaults
src/mapConsentInput.ts   the mutual-exclusion rule for setConsent
android/                 ZeotapModuleImpl (all the logic) + newarch/oldarch shims
ios/                     Zeotap.mm (mechanical) + ZeotapImpl.swift (the logic)
```

`NATIVE_VERSIONS.json` pins the native SDK versions this bridge is built against.
`android/build.gradle` and `ZeotapReactNative.podspec` both read it, so a version
bump cannot reach one platform and not the other.

## Contributing

This repository is published from Zeotap's internal SDK monorepo on every release,
so pull requests can't be merged here directly. To report a bug or request a
feature, open an issue. Fixes are made upstream and arrive with the next release.

## License

[MIT](LICENSE) © Zeotap GmbH

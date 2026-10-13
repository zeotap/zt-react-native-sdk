#import <React/RCTEventEmitter.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <RNZeotapSpec/RNZeotapSpec.h>
#endif

/**
 * The React Native module. Subclasses RCTEventEmitter because the bridge also
 * carries the SDK's out-of-band reports (a batch rejected by ingest, a delivery
 * exhausted after four attempts, a pre-consent buffer overflow) to the JS
 * `error` / `debug` streams — things no single Promise owns.
 *
 * Under the new architecture it ALSO conforms to the codegen-generated
 * `NativeZeotapSpec` protocol, so a method added to `src/NativeZeotap.ts` is a
 * compile error here until it is implemented. That is the property the legacy
 * package lacked, where the JS spec and the native modules drifted apart.
 *
 * Everything in the .mm is mechanical argument unwrapping; the decisions live in
 * ZeotapImpl.swift.
 */
#ifdef RCT_NEW_ARCH_ENABLED
@interface Zeotap : RCTEventEmitter <NativeZeotapSpec>
#else
@interface Zeotap : RCTEventEmitter <RCTBridgeModule>
#endif
@end

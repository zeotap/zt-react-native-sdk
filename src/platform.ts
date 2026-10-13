/**
 * Platform gating for the two methods that are not symmetric.
 *
 * Advertising ids differ irreducibly: Android has a GAID plus a
 * limit-ad-tracking flag, iOS has an IDFA plus an ATT authorisation status. There
 * is no honest common signature, so the API keeps both — and calling the wrong
 * one REJECTS. The legacy RN package made the foreign call a silent no-op, which
 * let an app ship believing it had set an advertising id that was never sent.
 */
import { Platform } from 'react-native';
import { ZeotapPlatformError } from './errors';

export function assertPlatform(supported: 'android' | 'ios', method: string): void {
  if (Platform.OS !== supported) {
    throw new ZeotapPlatformError(method, supported, Platform.OS);
  }
}

/** `true` on the new architecture. Reported in debug output, never branched on. */
export function isNewArchitecture(): boolean {
  // The reliable probe is the presence of the TurboModule proxy; the legacy
  // package checked `global.nativeFabricUIManager`, which is FABRIC (the
  // renderer), not TurboModules — so it reported false for a new-arch app that
  // had not enabled Fabric.
  const globals = global as unknown as Record<string, unknown>;
  return globals.__turboModuleProxy != null || globals.RN$Bridgeless === true;
}

/**
 * The `error` / `debug` event stream.
 *
 * Why an emitter at all: a Promise covers the call that failed, but the native
 * SDKs also report things no single call owns — a batch rejected by ingest, a
 * delivery exhausted after four attempts, a pre-consent buffer overflow that
 * dropped an event nobody was awaiting. On Android and iOS that is `SdkListener`;
 * here it is this stream, so a host can log or alert on it.
 *
 * `debug` also carries the option warnings `mapConfiguration` produced (unknown
 * or browser-only keys), which is the only way a typo'd option becomes visible
 * without failing the call.
 */
import { NativeEventEmitter, type EmitterSubscription } from 'react-native';
import NativeZeotap from './NativeZeotap';
import type { ZeotapEvent, ZeotapEventPayload, ZeotapSubscription } from './types';

/** The native event name; both bridges emit exactly this one. */
const NATIVE_EVENT = 'ZeotapEvent';

interface NativeEnvelope {
  type: ZeotapEvent;
  message: string;
  code?: string;
}

let emitter: NativeEventEmitter | null = null;
const listeners = new Map<ZeotapEvent, Set<(payload: ZeotapEventPayload) => void>>();
/** Emitted before the native module was ever touched (option warnings). */
const localQueue: Array<{ type: ZeotapEvent; payload: ZeotapEventPayload }> = [];

function ensureEmitter(): NativeEventEmitter | null {
  if (emitter) return emitter;
  try {
    // The module is passed explicitly: on the new architecture
    // `new NativeEventEmitter()` with no argument warns on iOS, and the
    // TurboModule instance is what owns addListener/removeListeners.
    emitter = new NativeEventEmitter(NativeZeotap as never);
    emitter.addListener(NATIVE_EVENT, (envelope: NativeEnvelope) => {
      dispatch(envelope.type, { message: envelope.message, code: envelope.code });
    });
    return emitter;
  } catch {
    // A missing native module must not make `addListener` throw: a host that
    // subscribes at import time would then crash before its own error handling
    // exists. Local emissions still work, so option warnings are not lost.
    return null;
  }
}

function dispatch(type: ZeotapEvent, payload: ZeotapEventPayload): void {
  const set = listeners.get(type);
  if (!set || set.size === 0) return;
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch {
      // A throwing listener must not break the others, nor bubble into the
      // native emitter's callback where it would be unhandled.
    }
  }
}

export function addListener(
  event: ZeotapEvent,
  handler: (payload: ZeotapEventPayload) => void,
): ZeotapSubscription {
  ensureEmitter();
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);

  // Deliver anything emitted before this subscription existed — the option
  // warnings from a `configure` that ran first, which are exactly what a host
  // subscribing to `debug` wants to see.
  for (const queued of localQueue.filter(q => q.type === event)) handler(queued.payload);

  return {
    remove() {
      set?.delete(handler);
    },
  };
}

/** Emit from JS (option warnings, linking failures). */
export function emitLocal(type: ZeotapEvent, message: string, code?: string): void {
  const payload: ZeotapEventPayload = code === undefined ? { message } : { message, code };
  const set = listeners.get(type);
  if (!set || set.size === 0) {
    // Bounded: this only ever holds warnings from the calls made before a host
    // subscribed, and an unbounded buffer in a long-lived app is a leak.
    if (localQueue.length < 50) localQueue.push({ type, payload });
    return;
  }
  dispatch(type, payload);
}

/** Test seam: drop every subscription and the queue. */
export function resetListenersForTesting(): void {
  listeners.clear();
  localQueue.length = 0;
  emitter = null;
}

export type { EmitterSubscription };

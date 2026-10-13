package com.zeotap.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * New-architecture (TurboModule) shim.
 *
 * Extends the class RN codegen generates from `src/NativeZeotap.ts`, so adding a
 * method to that spec is a COMPILE ERROR here until it is implemented — which is
 * the property the legacy package lacked, where the JS spec and the native
 * modules drifted until a method existed on one platform only.
 *
 * Contains no logic: every method hands straight to [ZeotapModuleImpl], which the
 * old-architecture shim shares. Keeping the two shims mechanical is what stops
 * them diverging, and it is why the unit tests drive the impl directly.
 */
@ReactModule(name = ZeotapModuleImpl.NAME)
class ZeotapModule(reactContext: ReactApplicationContext) : NativeZeotapSpec(reactContext) {

    private val impl = ZeotapModuleImpl(reactContext)

    override fun getName(): String = ZeotapModuleImpl.NAME

    override fun configure(writeKey: String?, options: ReadableMap?, promise: Promise) =
        impl.configure(writeKey, options, promise)

    override fun track(event: String?, properties: ReadableMap?, promise: Promise) =
        impl.track(event, properties, promise)

    override fun screen(
        name: String?,
        category: String?,
        properties: ReadableMap?,
        promise: Promise,
    ) = impl.screen(name, category, properties, promise)

    override fun identify(userId: String?, traits: ReadableMap?, promise: Promise) =
        impl.identify(userId, traits, promise)

    override fun group(groupId: String?, traits: ReadableMap?, promise: Promise) =
        impl.group(groupId, traits, promise)

    override fun alias(newId: String?, previousId: String?, promise: Promise) =
        impl.alias(newId, previousId, promise)

    override fun setConsent(input: ReadableMap?, promise: Promise) = impl.setConsent(input, promise)

    override fun getConsentState(promise: Promise) = impl.getConsentState(promise)

    override fun setUserIdentities(identities: ReadableMap?, hashed: Boolean, promise: Promise) =
        impl.setUserIdentities(identities, hashed, promise)

    override fun unsetUserIdentities(keys: ReadableArray?, promise: Promise) =
        impl.unsetUserIdentities(keys, promise)

    override fun getIdentity(promise: Promise) = impl.getIdentity(promise)

    override fun reset(promise: Promise) = impl.reset(promise)

    override fun flush(promise: Promise) = impl.flush(promise)

    override fun setAdvertisingIdAndroid(
        advertisingId: String?,
        limitAdTracking: Boolean,
        promise: Promise,
    ) = impl.setAdvertisingIdAndroid(advertisingId, limitAdTracking, promise)

    override fun setAdvertisingIdIOS(idfa: String?, trackingAuthorized: Boolean, promise: Promise) =
        impl.setAdvertisingIdIOS(promise)

    // The emitter's own plumbing. The codegen spec declares them because the new
    // architecture routes NativeEventEmitter through the module itself; the
    // counting is RN's business, not ours.
    override fun addListener(eventName: String?) = Unit

    override fun removeListeners(count: Double) = Unit
}

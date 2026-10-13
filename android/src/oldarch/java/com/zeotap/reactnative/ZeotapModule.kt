package com.zeotap.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * Old-architecture (bridge) shim — the same surface as the `newarch` variant,
 * declared by hand because there is no generated spec to extend.
 *
 * The package still supports this: RN's new architecture is the default only from
 * 0.76 and the peer range starts at 0.73, so a real app on the old architecture
 * must work. `android/build.gradle` swaps which of the two source sets is
 * compiled, so exactly one `ZeotapModule` exists in any build.
 *
 * Method signatures must match the generated spec's argument ORDER exactly (the
 * JS side calls one name either way). Both shims delegating to the same
 * [ZeotapModuleImpl] is what keeps them honest.
 */
@ReactModule(name = ZeotapModuleImpl.NAME)
class ZeotapModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val impl = ZeotapModuleImpl(reactContext)

    override fun getName(): String = ZeotapModuleImpl.NAME

    @ReactMethod
    fun configure(writeKey: String?, options: ReadableMap?, promise: Promise) =
        impl.configure(writeKey, options, promise)

    @ReactMethod
    fun track(event: String?, properties: ReadableMap?, promise: Promise) =
        impl.track(event, properties, promise)

    @ReactMethod
    fun screen(name: String?, category: String?, properties: ReadableMap?, promise: Promise) =
        impl.screen(name, category, properties, promise)

    @ReactMethod
    fun identify(userId: String?, traits: ReadableMap?, promise: Promise) =
        impl.identify(userId, traits, promise)

    @ReactMethod
    fun group(groupId: String?, traits: ReadableMap?, promise: Promise) =
        impl.group(groupId, traits, promise)

    @ReactMethod
    fun alias(newId: String?, previousId: String?, promise: Promise) =
        impl.alias(newId, previousId, promise)

    @ReactMethod
    fun setConsent(input: ReadableMap?, promise: Promise) = impl.setConsent(input, promise)

    @ReactMethod
    fun getConsentState(promise: Promise) = impl.getConsentState(promise)

    @ReactMethod
    fun setUserIdentities(identities: ReadableMap?, hashed: Boolean, promise: Promise) =
        impl.setUserIdentities(identities, hashed, promise)

    @ReactMethod
    fun unsetUserIdentities(keys: ReadableArray?, promise: Promise) =
        impl.unsetUserIdentities(keys, promise)

    @ReactMethod
    fun getIdentity(promise: Promise) = impl.getIdentity(promise)

    @ReactMethod
    fun reset(promise: Promise) = impl.reset(promise)

    @ReactMethod
    fun flush(promise: Promise) = impl.flush(promise)

    @ReactMethod
    fun setAdvertisingIdAndroid(advertisingId: String?, limitAdTracking: Boolean, promise: Promise) =
        impl.setAdvertisingIdAndroid(advertisingId, limitAdTracking, promise)

    @ReactMethod
    fun setAdvertisingIdIOS(idfa: String?, trackingAuthorized: Boolean, promise: Promise) =
        impl.setAdvertisingIdIOS(promise)

    // Required by NativeEventEmitter on the old architecture too: without them RN
    // logs "does not implement addListener" every time a host subscribes.
    @ReactMethod
    fun addListener(eventName: String?) = Unit

    @ReactMethod
    fun removeListeners(count: Double) = Unit
}

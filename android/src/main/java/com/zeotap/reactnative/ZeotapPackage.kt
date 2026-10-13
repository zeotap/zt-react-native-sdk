package com.zeotap.reactnative

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Autolinking entry point.
 *
 * `TurboReactPackage` rather than the newer `BaseReactPackage`: the peer range
 * starts at React Native 0.73, where `BaseReactPackage` does not exist yet.
 * `TurboReactPackage` is present in every version in that range (deprecated but
 * functional in 0.76+), so this is the one base class that compiles across the
 * whole matrix. Revisit when the peer floor moves past 0.74.
 *
 * The lazy `getModule` shape (rather than `createNativeModules` returning an
 * instantiated list) is what lets the new architecture construct the module on
 * first use instead of at startup — the reason TurboReactPackage exists.
 */
class ZeotapPackage : TurboReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == ZeotapModuleImpl.NAME) ZeotapModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            ZeotapModuleImpl.NAME to ReactModuleInfo(
                ZeotapModuleImpl.NAME,
                ZeotapModuleImpl.NAME,
                false, // canOverrideExistingModule
                false, // needsEagerInit — the SDK is configured explicitly by the host
                false, // isCxxModule
                // The ONE flag that must track the build: reporting turbo=true in an
                // old-architecture app makes RN look for a JSI binding that was never
                // generated, and the module resolves as undefined at runtime.
                BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            ),
        )
    }
}

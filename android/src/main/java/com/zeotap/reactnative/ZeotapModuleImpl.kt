package com.zeotap.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.zeotap.sdk.Analytics
import com.zeotap.sdk.BatchResult
import com.zeotap.sdk.CmpMode
import com.zeotap.sdk.Configuration
import com.zeotap.sdk.ConsentDefault
import com.zeotap.sdk.ConsentInput
import com.zeotap.sdk.ConsentOptions
import com.zeotap.sdk.DropReason
import com.zeotap.sdk.NotInitializedException
import com.zeotap.sdk.SdkListener
import com.zeotap.sdk.Zeotap

/**
 * The whole Android bridge. Both architecture shims ([ZeotapModule] in `newarch`
 * and `oldarch`) delegate here and contain no logic of their own, so there is one
 * implementation to read, test and fix — the legacy package duplicated its logic
 * across the two shims and they drifted.
 *
 * Rejection codes are a closed set the JS layer maps onto error classes
 * (`src/errors.ts`):
 *
 * | code               | meaning                                              |
 * |--------------------|------------------------------------------------------|
 * | `E_NOT_CONFIGURED` | a method called before `configure`                   |
 * | `E_CONFIG`         | an invalid option reached the native side            |
 * | `E_CONSENT`        | the SDK dropped the event; consent denies it         |
 * | `E_PLATFORM`       | an iOS-only method called here                       |
 * | `E_ARGUMENT`       | a malformed argument bag                             |
 * | `E_SDK`            | anything else the SDK reported                       |
 *
 * The SDK's own message is passed through UNCHANGED on every rejection. That is
 * deliberate: `[SDK] Dropped track: no track consent` is asserted by the web
 * SDK's tests, the `sdk/conformance` vectors and both native suites, so a bridge
 * that reworded it would break parity in the one place a customer reads.
 */
class ZeotapModuleImpl(private val reactContext: ReactApplicationContext) {

    companion object {
        const val NAME = "Zeotap"

        private const val E_NOT_CONFIGURED = "E_NOT_CONFIGURED"
        private const val E_CONFIG = "E_CONFIG"
        private const val E_CONSENT = "E_CONSENT"
        private const val E_PLATFORM = "E_PLATFORM"
        private const val E_ARGUMENT = "E_ARGUMENT"
        private const val E_SDK = "E_SDK"

        /** The single event name the JS emitter listens on. */
        private const val JS_EVENT = "ZeotapEvent"
    }

    @Volatile
    private var analytics: Analytics? = null

    /**
     * Forwards the SDK's out-of-band reports to the JS `error` / `debug` streams.
     *
     * A Promise covers the call that failed, but nothing owns a batch rejected by
     * ingest, a delivery exhausted after four attempts, or a pre-consent buffer
     * overflow that dropped an event no one was awaiting. On Android that is
     * `SdkListener`; without this the host would never learn about any of it.
     */
    private val listener = object : SdkListener {
        override fun onBatchResult(result: BatchResult) {
            if (!result.success) {
                emit("error", "[SDK] Batch partially rejected: ${result.errors}", "E_SDK")
            } else {
                emit("debug", "[SDK] Batch delivered: ${result.received}/${result.sent}")
            }
        }

        override fun onDeliveryFailure(status: Int?, attempts: Int, error: Throwable?) {
            // Four attempts are already spent by the time this fires; the rows were
            // released back to the durable queue for a later flush, so this is a
            // warning about latency, not about lost data.
            emit(
                "error",
                "[SDK] Delivery failed after $attempts attempt(s)" +
                    (status?.let { " (HTTP $it)" } ?: "") +
                    (error?.message?.let { ": $it" } ?: ""),
                E_SDK,
            )
        }

        override fun onEventDropped(type: String, reason: DropReason, message: String) {
            // A consent drop is reported on `error` like any other drop: the host
            // asked for the event and did not get it, whatever the reason.
            emit("error", message, if (reason == DropReason.CONSENT_DENIED) E_CONSENT else E_SDK)
        }

        override fun onError(error: Throwable) {
            emit("error", error.message ?: error.toString(), E_SDK)
        }
    }

    private fun emit(type: String, message: String, code: String? = null) {
        if (!reactContext.hasActiveReactInstance()) return
        val payload = com.facebook.react.bridge.Arguments.createMap().apply {
            putString("type", type)
            putString("message", message)
            if (code != null) putString("code", code)
        }
        try {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(JS_EVENT, payload)
        } catch (_: Throwable) {
            // A teardown race (the instance went away between the check and the
            // emit) must not surface as an SDK error; the event is diagnostic.
        }
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    fun configure(writeKey: String?, options: ReadableMap?, promise: Promise) {
        if (writeKey.isNullOrBlank()) {
            promise.reject(E_CONFIG, "[SDK] writeKey is required")
            return
        }
        if (options == null) {
            promise.reject(E_CONFIG, "[SDK] configure requires an options object")
            return
        }
        // Idempotent, matching `Zeotap.load`: a second configure resolves without
        // rebuilding, so a re-rendered root component cannot reconfigure the SDK.
        if (analytics != null) {
            promise.resolve(null)
            return
        }
        try {
            val configuration = buildConfiguration(options)
            val instance = Zeotap.load(reactContext.applicationContext, writeKey, configuration)
            instance.addListener(listener)
            analytics = instance
            promise.resolve(null)
        } catch (e: IllegalArgumentException) {
            // ArgumentException is an IllegalArgumentException, and inside the
            // options bag both mean the same thing to a caller: the
            // CONFIGURATION was wrong. E_ARGUMENT is reserved for the per-call
            // bags (identities, consent input), where the distinction is useful.
            promise.reject(E_CONFIG, "[SDK] ${e.message}")
        } catch (e: Throwable) {
            promise.reject(E_SDK, e.message ?: "[SDK] configure failed")
        }
    }

    private fun buildConfiguration(options: ReadableMap): Configuration {
        val codec = ReadableMapCodec
        val builder = Configuration.Builder(codec.requireString(options, "apiHost"))
            .namespace(codec.stringOrNull(options, "namespace") ?: "zeotap")
            .flushAt(codec.intOr(options, "flushAt", 10))
            // JS says `flushInterval` (milliseconds, the browser SDK's name and
            // unit); Android's builder says `flushIntervalMs`. The rename lives
            // here so one options object serves both platforms.
            .flushIntervalMs(codec.longOr(options, "flushInterval", 5_000L))
            .debug(codec.boolOr(options, "debug", false))
            .nativeAppId(codec.stringOrNull(options, "nativeAppId") ?: "")
            .maxQueueSize(codec.intOr(options, "maxQueueSize", 500))
            .trackApplicationLifecycleEvents(
                codec.boolOr(options, "trackApplicationLifecycleEvents", false)
            )
            .flushOnBackground(codec.boolOr(options, "flushOnBackground", true))
            .collectAdvertisingId(codec.boolOr(options, "collectAdvertisingId", false))

        options.getMap("integration")?.let { integration ->
            builder.integration(
                codec.requireString(integration, "name"),
                codec.requireString(integration, "version"),
            )
        }
        options.getMap("consent")?.let { builder.consent(buildConsentOptions(it)) }
        return builder.build()
    }

    private fun buildConsentOptions(consent: ReadableMap): ConsentOptions {
        val codec = ReadableMapCodec
        val builder = ConsentOptions.Builder()
            .require(codec.boolOr(consent, "require", false))
            .default(
                if (codec.stringOrNull(consent, "default") == "denied") {
                    ConsentDefault.DENIED
                } else {
                    ConsentDefault.GRANTED
                }
            )
            .cmpTimeoutMs(codec.longOr(consent, "cmpTimeoutMs", 10_000L))
            .maxBufferedEvents(codec.intOr(consent, "maxBufferedEvents", 10))
            .checkVendorConsent(codec.boolOr(consent, "checkVendorConsent", false))
            .persist(codec.boolOr(consent, "persist", true))
            .expiryDays(codec.intOr(consent, "expiryDays", 365))

        when (codec.stringOrNull(consent, "cmp")) {
            "auto" -> builder.cmp(CmpMode.AUTO)
            "none" -> builder.cmp(CmpMode.NONE)
            null -> Unit // let the SDK derive it from `require`
            else -> throw ArgumentException("consent.cmp must be \"auto\" or \"none\"")
        }
        // Absent lists are left alone so the SDK applies its documented defaults
        // ([[1,3,4],[1,5,6]] for tracking, [1,9] for identifying) — sending `[]`
        // could be read as "no purposes required".
        codec.purposeIds(consent, "purposesForTracking")?.let { builder.purposesForTracking(it) }
        codec.purposeIds(consent, "purposesForIdentifying")?.let { builder.purposesForIdentifying(it) }
        codec.purposeIds(consent, "purposesForCookieSync")?.let { builder.purposesForCookieSync(it) }
        return builder.build()
    }

    // ── events ──────────────────────────────────────────────────────────────

    fun track(event: String?, properties: ReadableMap?, promise: Promise) =
        withSdk("track", promise) { sdk ->
            if (event.isNullOrEmpty()) {
                promise.resolve(null) // web parity: an empty name is a silent no-op
            } else {
                sdk.track(event, ReadableMapCodec.toMap(properties)) { error ->
                    settle(promise, error)
                }
            }
        }

    fun screen(name: String?, category: String?, properties: ReadableMap?, promise: Promise) =
        withSdk("screen", promise) { sdk ->
            // Named, not positional: Analytics.screen is (name, category). The positional
            // call copied the INTERNAL client.screen(category, name) order (the browser
            // SDK's page(category, name)), so every RN screen() on Android swapped the two —
            // found by the first device journey ("Expected: Home, Received: Sample").
            sdk.screen(
                name = name,
                category = category,
                properties = ReadableMapCodec.toMap(properties),
            ) { error ->
                settle(promise, error)
            }
        }

    fun identify(userId: String?, traits: ReadableMap?, promise: Promise) =
        withSdk("identify", promise) { sdk ->
            sdk.identify(userId, ReadableMapCodec.toMap(traits)) { error -> settle(promise, error) }
        }

    fun group(groupId: String?, traits: ReadableMap?, promise: Promise) =
        withSdk("group", promise) { sdk ->
            if (groupId.isNullOrEmpty()) {
                promise.resolve(null)
            } else {
                sdk.group(groupId, ReadableMapCodec.toMap(traits)) { error -> settle(promise, error) }
            }
        }

    fun alias(newId: String?, previousId: String?, promise: Promise) =
        withSdk("alias", promise) { sdk ->
            if (newId.isNullOrEmpty()) {
                promise.resolve(null)
            } else {
                sdk.alias(newId, previousId) { error -> settle(promise, error) }
            }
        }

    // ── consent ─────────────────────────────────────────────────────────────

    fun setConsent(input: ReadableMap?, promise: Promise) =
        withSdk("setConsent", promise) { sdk ->
            try {
                sdk.setConsent(toConsentInput(input))
                promise.resolve(null)
            } catch (e: ArgumentException) {
                promise.reject(E_ARGUMENT, "[SDK] ${e.message}")
            }
        }

    /**
     * Exactly one form, like the web SDK. Two at once would leave the resolver
     * silently choosing which one decides whether events flow; none would resolve
     * to GRANTED, since an absent category is a grant.
     */
    private fun toConsentInput(input: ReadableMap?): ConsentInput {
        if (input == null) throw ArgumentException("setConsent requires an input object")
        val codec = ReadableMapCodec
        val tcf = codec.stringOrNull(input, "tcfString")
        val usp = codec.stringOrNull(input, "usPrivacy")
        val categories = listOf("analytics", "marketing", "advertising", "functional")
            .filter { input.hasKey(it) && !input.isNull(it) }

        val forms = listOf(tcf != null, usp != null, categories.isNotEmpty()).count { it }
        if (forms > 1) {
            throw ArgumentException(
                "setConsent accepts exactly one of {tcfString}, {usPrivacy} or the categories"
            )
        }
        if (forms == 0) {
            throw ArgumentException(
                "setConsent needs one of {tcfString}, {usPrivacy} or at least one category"
            )
        }
        return when {
            tcf != null -> ConsentInput.Tcf(tcf)
            usp != null -> ConsentInput.UsPrivacy(usp)
            else -> ConsentInput.Parsed(
                codec.boolOrNull(input, "analytics"),
                codec.boolOrNull(input, "marketing"),
                codec.boolOrNull(input, "advertising"),
                codec.boolOrNull(input, "functional"),
            )
        }
    }

    /**
     * `{resolved, signals?: {track, identify, cookieSync}, source?, gdprApplies?}`
     * — byte-identical in shape to iOS's `ZTAnalytics.getConsentState()`. The two
     * platforms disagreeing here is exactly the silent divergence this package
     * exists to prevent, so both are written against the same documented shape.
     */
    fun getConsentState(promise: Promise) {
        val sdk = analytics
        if (sdk == null) {
            // Web parity: `getConsentState()` is callable before init.
            promise.resolve(ReadableMapCodec.toWritableMap(mapOf("resolved" to false)))
            return
        }
        try {
            val state = sdk.getConsentState()
            val out = LinkedHashMap<String, Any?>()
            out["resolved"] = state.resolved
            state.signals?.let {
                out["signals"] = linkedMapOf(
                    "track" to it.track,
                    "identify" to it.identify,
                    "cookieSync" to it.cookieSync,
                )
            }
            state.source?.let { out["source"] = it.name.lowercase() }
            state.gdprApplies?.let { out["gdprApplies"] = it }
            promise.resolve(ReadableMapCodec.toWritableMap(out))
        } catch (e: Throwable) {
            promise.reject(E_SDK, e.message ?: "[SDK] getConsentState failed")
        }
    }

    // ── identities ──────────────────────────────────────────────────────────

    fun setUserIdentities(identities: ReadableMap?, hashed: Boolean, promise: Promise) =
        withSdk("setUserIdentities", promise) { sdk ->
            try {
                sdk.setUserIdentities(ReadableMapCodec.identities(identities), hashed) { error ->
                    settle(promise, error)
                }
            } catch (e: ArgumentException) {
                promise.reject(E_ARGUMENT, "[SDK] ${e.message}")
            }
        }

    fun unsetUserIdentities(keys: ReadableArray?, promise: Promise) =
        withSdk("unsetUserIdentities", promise) { sdk ->
            try {
                // Never consent-gated, and `null` means "remove everything".
                sdk.unsetUserIdentities(ReadableMapCodec.stringListOrNull(keys))
                promise.resolve(null)
            } catch (e: ArgumentException) {
                promise.reject(E_ARGUMENT, "[SDK] ${e.message}")
            }
        }

    fun getIdentity(promise: Promise) = withSdk("getIdentity", promise) { sdk ->
        promise.resolve(
            ReadableMapCodec.toWritableMap(
                mapOf("anonymousId" to sdk.anonymousId, "userId" to sdk.userId)
            )
        )
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    fun reset(promise: Promise) = withSdk("reset", promise) { sdk ->
        sdk.reset()
        promise.resolve(null)
    }

    fun flush(promise: Promise) = withSdk("flush", promise) { sdk ->
        // Resolves when the flush has been REQUESTED: the SDK's flush() is
        // fire-and-forget and delivery outcome arrives on the listener, so
        // resolving on completion would mean waiting out four retries.
        sdk.flush()
        promise.resolve(null)
    }

    /**
     * The host's own GAID. Wins over the SDK's reflective Play Services lookup,
     * which is then not attempted at all (it is a blocking IPC call).
     *
     * Requires `collectAdvertisingId: true`; the SDK logs a warning when it is
     * false rather than failing, because that flag is the host's single switch
     * for whether an advertising id may be collected and one call must not
     * override it.
     */
    fun setAdvertisingIdAndroid(advertisingId: String?, limitAdTracking: Boolean, promise: Promise) =
        withSdk("setAdvertisingId", promise) { sdk ->
            sdk.setAdvertisingId(advertisingId, limitAdTracking)
            promise.resolve(null)
        }

    /**
     * iOS-only. Rejected rather than ignored so a cross-platform caller learns
     * where the asymmetry is — the JS layer rejects first, this is the backstop.
     * The arguments differ irreducibly (a limit-ad-tracking flag versus an ATT
     * decision), which is why there are two methods rather than one.
     */
    fun setAdvertisingIdIOS(promise: Promise) {
        promise.reject(
            E_PLATFORM,
            "[SDK] setAdvertisingIdIOS is iOS-only. On Android use " +
                "Zeotap.android.setAdvertisingId(id, limitAdTracking)."
        )
    }

    // ── plumbing ────────────────────────────────────────────────────────────

    /** Resolve, or reject with the code the SDK's error maps to. */
    private fun settle(promise: Promise, error: Throwable?) {
        if (error == null) {
            promise.resolve(null)
            return
        }
        promise.reject(codeFor(error), error.message ?: "[SDK] call failed")
    }

    /**
     * The `Callback` carries a `Throwable`, not a reason enum, so the consent
     * drops are recognised by the SDK's own message prefixes — which are frozen
     * by the conformance vectors and therefore safe to match on. Anything
     * unrecognised stays `E_SDK` rather than being guessed at.
     */
    private fun codeFor(error: Throwable): String {
        val message = error.message ?: return E_SDK
        return when {
            error is NotInitializedException -> E_NOT_CONFIGURED
            message.startsWith("[SDK] Dropped ") -> E_CONSENT
            message.startsWith("[SDK] Identities dropped") -> E_CONSENT
            message.startsWith("[SDK] Event dropped") -> E_CONSENT
            else -> E_SDK
        }
    }

    private inline fun withSdk(method: String, promise: Promise, body: (Analytics) -> Unit) {
        val sdk = analytics
        if (sdk == null) {
            promise.reject(
                E_NOT_CONFIGURED,
                "[SDK] Not initialized. Call configure() before $method()."
            )
            return
        }
        try {
            body(sdk)
        } catch (e: ArgumentException) {
            promise.reject(E_ARGUMENT, "[SDK] ${e.message}")
        } catch (e: Throwable) {
            promise.reject(codeFor(e), e.message ?: "[SDK] $method failed")
        }
    }

    /** Test seam: drop the configured instance. */
    internal fun shutdownForTesting() {
        analytics?.removeListener(listener)
        analytics?.shutdown()
        analytics = null
    }
}

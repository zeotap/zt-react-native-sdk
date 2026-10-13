package com.zeotap.reactnative

import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The bridge's contract with JavaScript: which calls reach the SDK, which are
 * refused, and with what code. Every rejection code here is one the JS layer maps
 * onto an error class in `src/errors.ts`, so a change to either side without the
 * other fails a test.
 *
 * Drives [ZeotapModuleImpl] directly rather than one of the architecture shims,
 * because the shims are mechanical delegation and the impl is the thing both
 * architectures share.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ZeotapModuleImplTest {

    private lateinit var impl: ZeotapModuleImpl

    private fun options(vararg overrides: Pair<String, Any?>): JavaOnlyMap {
        val map = JavaOnlyMap.of(
            "apiHost", "https://ingest.example",
            "flushAt", 10.0,
            "flushInterval", 5000.0,
        )
        for ((key, value) in overrides) {
            when (value) {
                null -> map.putNull(key)
                is String -> map.putString(key, value)
                is Boolean -> map.putBoolean(key, value)
                is Double -> map.putDouble(key, value)
                is JavaOnlyMap -> map.putMap(key, value)
                else -> throw IllegalArgumentException("unsupported override $key")
            }
        }
        return map
    }

    private fun configure(): RecordingPromise {
        val promise = RecordingPromise()
        impl.configure("wk_test", options(), promise)
        return promise
    }

    @Before
    fun setUp() {
        val context = ReactApplicationContext(ApplicationProvider.getApplicationContext())
        impl = ZeotapModuleImpl(context)
    }

    @After
    fun tearDown() {
        impl.shutdownForTesting()
    }

    // ── configure ───────────────────────────────────────────────────────────

    @Test
    fun `configure resolves and is idempotent`() {
        assertTrue(configure().resolved)
        // A re-rendered root component must not be able to reconfigure the SDK.
        assertTrue(configure().resolved)
    }

    @Test
    fun `a blank write key is refused as a configuration error`() {
        val promise = RecordingPromise()
        impl.configure("  ", options(), promise)
        assertEquals("E_CONFIG", promise.rejectedCode)
        assertEquals("[SDK] writeKey is required", promise.rejectedMessage)
    }

    @Test
    fun `a missing apiHost is refused rather than defaulted`() {
        // There is no same-origin default on a device: an absent host would mean
        // a working-looking SDK whose events never arrive.
        val promise = RecordingPromise()
        impl.configure("wk_test", JavaOnlyMap.of("flushAt", 10.0), promise)
        assertEquals("E_CONFIG", promise.rejectedCode)
        assertTrue(promise.rejectedMessage!!.contains("apiHost is required"))
    }

    @Test
    fun `a wrongly typed option is refused by name`() {
        val promise = RecordingPromise()
        impl.configure("wk_test", options("flushAt" to "ten"), promise)
        assertEquals("E_CONFIG", promise.rejectedCode)
        assertTrue(promise.rejectedMessage!!.contains("flushAt must be a number"))
    }

    @Test
    fun `a null options bag is refused`() {
        val promise = RecordingPromise()
        impl.configure("wk_test", null, promise)
        assertEquals("E_CONFIG", promise.rejectedCode)
    }

    // ── not configured ──────────────────────────────────────────────────────

    @Test
    fun `every gated method rejects before configure, and none of them throws`() {
        val cases = mapOf<String, (RecordingPromise) -> Unit>(
            "track" to { p -> impl.track("Ev", null, p) },
            "screen" to { p -> impl.screen("Home", null, null, p) },
            "identify" to { p -> impl.identify("u1", null, p) },
            "group" to { p -> impl.group("g1", null, p) },
            "alias" to { p -> impl.alias("n1", null, p) },
            "setConsent" to { p -> impl.setConsent(JavaOnlyMap.of("analytics", true), p) },
            "setUserIdentities" to { p ->
                impl.setUserIdentities(JavaOnlyMap.of("email", "a@b.com"), false, p)
            },
            "unsetUserIdentities" to { p -> impl.unsetUserIdentities(null, p) },
            "getIdentity" to { p -> impl.getIdentity(p) },
            "reset" to { p -> impl.reset(p) },
            "flush" to { p -> impl.flush(p) },
        )
        for ((method, run) in cases) {
            val promise = RecordingPromise()
            run(promise)
            assertEquals("$method should reject", "E_NOT_CONFIGURED", promise.rejectedCode)
            assertEquals(
                "[SDK] Not initialized. Call configure() before $method().",
                promise.rejectedMessage,
            )
        }
    }

    @Test
    fun `getConsentState answers unresolved before configure instead of rejecting`() {
        // Web parity: `getConsentState()` is the one method callable pre-init.
        val promise = RecordingPromise()
        impl.getConsentState(promise)
        assertTrue(promise.resolved)
        assertEquals(false, promise.map().getBoolean("resolved"))
    }

    // ── events ──────────────────────────────────────────────────────────────

    @Test
    fun `an empty event name resolves without sending, like the web SDK`() {
        configure()
        val track = RecordingPromise()
        impl.track("", null, track)
        assertTrue(track.resolved)

        val group = RecordingPromise()
        impl.group("", null, group)
        assertTrue(group.resolved)

        val alias = RecordingPromise()
        impl.alias("", null, alias)
        assertTrue(alias.resolved)
    }

    @Test
    fun `track settles through the SDK callback`() {
        configure()
        val promise = RecordingPromise()
        impl.track("Sample Track", JavaOnlyMap.of("count", 1.0), promise)
        // Consent is not required by default, so the event enqueues and the SDK
        // invokes the callback with no error.
        assertTrue("track should have settled", promise.settled)
        assertNull(promise.rejectedCode)
    }

    // ── consent ─────────────────────────────────────────────────────────────

    @Test
    fun `setConsent accepts each of the three forms`() {
        configure()
        for (input in listOf(
            JavaOnlyMap.of("tcfString", "CQAbc"),
            JavaOnlyMap.of("usPrivacy", "1YNN"),
            JavaOnlyMap.of("analytics", true),
        )) {
            val promise = RecordingPromise()
            impl.setConsent(input, promise)
            assertTrue("form $input should be accepted", promise.resolved)
        }
    }

    @Test
    fun `setConsent refuses two forms at once`() {
        // Whichever one won would silently decide whether events flow.
        configure()
        val promise = RecordingPromise()
        impl.setConsent(JavaOnlyMap.of("tcfString", "CQAbc", "analytics", true), promise)
        assertEquals("E_ARGUMENT", promise.rejectedCode)
        assertTrue(promise.rejectedMessage!!.contains("exactly one"))
    }

    @Test
    fun `setConsent refuses an empty bag`() {
        // An empty bag would resolve to GRANTED, since an absent category grants.
        configure()
        val promise = RecordingPromise()
        impl.setConsent(JavaOnlyMap.of(), promise)
        assertEquals("E_ARGUMENT", promise.rejectedCode)
    }

    @Test
    fun `getConsentState resolves the documented shape after a manual decision`() {
        configure()
        impl.setConsent(JavaOnlyMap.of("analytics", true), RecordingPromise())
        val promise = RecordingPromise()
        impl.getConsentState(promise)
        val state = promise.map()
        assertEquals(true, state.getBoolean("resolved"))
        assertEquals("manual", state.getString("source"))
        val signals = state.getMap("signals")!!
        // The exact key set iOS's ZTAnalytics.getConsentState() returns.
        assertEquals(true, signals.getBoolean("track"))
        assertEquals(true, signals.getBoolean("identify"))
        assertEquals(false, signals.getBoolean("cookieSync"))
    }

    // ── identities ──────────────────────────────────────────────────────────

    @Test
    fun `a non-string identity value is refused by key`() {
        configure()
        val promise = RecordingPromise()
        impl.setUserIdentities(JavaOnlyMap.of("loyaltyId", 12345.0), false, promise)
        assertEquals("E_ARGUMENT", promise.rejectedCode)
        assertTrue(promise.rejectedMessage!!.contains("identities.loyaltyId"))
    }

    @Test
    fun `unsetUserIdentities with no keys resolves and is never gated`() {
        configure()
        val all = RecordingPromise()
        impl.unsetUserIdentities(null, all)
        assertTrue(all.resolved)

        val some = RecordingPromise()
        impl.unsetUserIdentities(JavaOnlyArray.of("email"), some)
        assertTrue(some.resolved)
    }

    @Test
    fun `unsetUserIdentities refuses a non-string key by index`() {
        configure()
        val promise = RecordingPromise()
        impl.unsetUserIdentities(JavaOnlyArray.of(1.0), promise)
        assertEquals("E_ARGUMENT", promise.rejectedCode)
    }

    @Test
    fun `getIdentity resolves the anonymousId and a null userId`() {
        configure()
        val promise = RecordingPromise()
        impl.getIdentity(promise)
        val identity = promise.map()
        assertTrue(identity.getString("anonymousId")!!.isNotEmpty())
        assertTrue(identity.isNull("userId"))
    }

    // ── asymmetries ─────────────────────────────────────────────────────────

    @Test
    fun `the iOS advertising-id method rejects here, naming the Android alternative`() {
        val promise = RecordingPromise()
        impl.setAdvertisingIdIOS(promise)
        assertEquals("E_PLATFORM", promise.rejectedCode)
        // A silent no-op is how the legacy package let an app ship believing it
        // had set an advertising id that was never sent.
        assertTrue(promise.rejectedMessage!!.contains("collectAdvertisingId: true"))
    }
}

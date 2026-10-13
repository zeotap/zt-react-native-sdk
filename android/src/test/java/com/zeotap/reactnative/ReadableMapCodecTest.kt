package com.zeotap.reactnative

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * The JS↔native boundary. Two properties matter more than the rest:
 * a whole number must not reach ingest as `1.0`, and nothing here may throw an
 * unhandled exception whatever JavaScript sends.
 */
@RunWith(RobolectricTestRunner::class)
class ReadableMapCodecTest {

    @Test
    fun `decodes every ReadableType`() {
        val map = JavaOnlyMap.of(
            "s", "text",
            "b", true,
            "n", 3.5,
            "nul", null,
            "m", JavaOnlyMap.of("inner", "value"),
            "a", JavaOnlyArray.of(1.0, "two", false),
        )
        val decoded = ReadableMapCodec.toMap(map)
        assertEquals("text", decoded["s"])
        assertEquals(true, decoded["b"])
        assertEquals(3.5, decoded["n"])
        assertNull(decoded["nul"])
        assertEquals(mapOf("inner" to "value"), decoded["m"])
        assertEquals(listOf<Any?>(1, "two", false), decoded["a"])
    }

    @Test
    fun `a whole number narrows to an integer so the wire matches the browser SDK`() {
        // `{count: 1}` must serialise as 1, not 1.0: the browser SDK's payload has
        // the integer, an event contract may declare an integer field, and the
        // difference is visible in the warehouse.
        val decoded = ReadableMapCodec.toMap(JavaOnlyMap.of("count", 1.0))
        assertEquals(1, decoded["count"])
        assertTrue(decoded["count"] is Int)
    }

    @Test
    fun `a fractional number stays a double`() {
        val decoded = ReadableMapCodec.toMap(JavaOnlyMap.of("revenue", 149.99))
        assertEquals(149.99, decoded["revenue"])
        assertTrue(decoded["revenue"] is Double)
    }

    @Test
    fun `a whole number beyond Int range narrows to Long, not to a truncated Int`() {
        val decoded = ReadableMapCodec.toMap(JavaOnlyMap.of("ts", 1.7684724301e12))
        assertEquals(1768472430100L, decoded["ts"])
    }

    @Test
    fun `nested structures recurse`() {
        val map = JavaOnlyMap.of(
            "outer",
            JavaOnlyMap.of("list", JavaOnlyArray.of(JavaOnlyMap.of("deep", 1.0))),
        )
        val decoded = ReadableMapCodec.toMap(map)
        @Suppress("UNCHECKED_CAST")
        val outer = decoded["outer"] as Map<String, Any?>
        @Suppress("UNCHECKED_CAST")
        val list = outer["list"] as List<Any?>
        assertEquals(mapOf("deep" to 1), list[0])
    }

    @Test
    fun `a null map decodes to an empty map rather than throwing`() {
        assertEquals(emptyMap<String, Any?>(), ReadableMapCodec.toMap(null))
        assertEquals(emptyList<Any?>(), ReadableMapCodec.toList(null))
    }

    @Test
    fun `typed reads reject a wrong type by key instead of coercing`() {
        val map = JavaOnlyMap.of("flushAt", "10", "debug", 1.0)
        try {
            ReadableMapCodec.intOr(map, "flushAt", 10)
            fail("expected a rejection")
        } catch (e: ArgumentException) {
            assertTrue(e.message!!.contains("flushAt must be a number"))
        }
        try {
            ReadableMapCodec.boolOr(map, "debug", false)
            fail("expected a rejection")
        } catch (e: ArgumentException) {
            assertTrue(e.message!!.contains("debug must be a boolean"))
        }
    }

    @Test
    fun `typed reads fall back when the key is absent or null`() {
        val map = JavaOnlyMap.of("present", null)
        assertEquals(7, ReadableMapCodec.intOr(map, "missing", 7))
        assertEquals(7, ReadableMapCodec.intOr(map, "present", 7))
        assertEquals(true, ReadableMapCodec.boolOr(map, "missing", true))
        assertNull(ReadableMapCodec.stringOrNull(map, "present"))
    }

    @Test
    fun `identity values must be strings and are named when they are not`() {
        try {
            ReadableMapCodec.identities(JavaOnlyMap.of("loyaltyId", 12345.0))
            fail("expected a rejection")
        } catch (e: ArgumentException) {
            assertTrue(e.message!!.contains("identities.loyaltyId must be a string"))
            // The message has to say WHY, or the caller "fixes" it by stringifying.
            assertTrue(e.message!!.contains("match nothing"))
        }
    }

    @Test
    fun `a null identity value is skipped, not sent as an empty string`() {
        val decoded = ReadableMapCodec.identities(JavaOnlyMap.of("email", "a@b.com", "cellno", null))
        assertEquals(mapOf("email" to "a@b.com"), decoded)
    }

    @Test
    fun `purpose ids accept a flat list and a list of groups`() {
        val flat = ReadableMapCodec.purposeIds(
            JavaOnlyMap.of("purposesForIdentifying", JavaOnlyArray.of(1.0, 9.0)),
            "purposesForIdentifying",
        )
        assertEquals(listOf(1, 9), flat)

        val grouped = ReadableMapCodec.purposeIds(
            JavaOnlyMap.of(
                "purposesForTracking",
                JavaOnlyArray.of(JavaOnlyArray.of(1.0, 3.0, 4.0), JavaOnlyArray.of(1.0, 5.0, 6.0)),
            ),
            "purposesForTracking",
        )
        assertEquals(listOf(listOf(1, 3, 4), listOf(1, 5, 6)), grouped)
    }

    @Test
    fun `an empty purpose list is treated as absent so the SDK defaults apply`() {
        // Sending `[]` could be read as "no purposes required", which would grant
        // consent that the CMP never gave.
        assertNull(
            ReadableMapCodec.purposeIds(
                JavaOnlyMap.of("purposesForTracking", JavaOnlyArray.of()),
                "purposesForTracking",
            ),
        )
    }

    @Test
    fun `string lists reject a non-string element by index`() {
        try {
            ReadableMapCodec.stringListOrNull(JavaOnlyArray.of("email", 1.0))
            fail("expected a rejection")
        } catch (e: ArgumentException) {
            assertTrue(e.message!!.contains("keys[1] must be a string"))
        }
    }
}

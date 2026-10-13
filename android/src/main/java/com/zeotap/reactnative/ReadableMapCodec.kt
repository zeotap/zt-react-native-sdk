package com.zeotap.reactnative

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

/**
 * The JS↔native boundary, and the one place in this bridge that must never throw
 * an unhandled exception.
 *
 * The legacy React Native package force-cast here (`as!` on iOS, unchecked casts
 * on Android) and crashed the host app on a null or a nested value. Every read
 * below either produces a value or throws [ArgumentException], which the module
 * turns into an `E_ARGUMENT` rejection naming the key — a rejected promise the
 * app can handle, not a crash.
 */
internal class ArgumentException(message: String) : IllegalArgumentException(message)

internal object ReadableMapCodec {

    /**
     * Recursive `ReadableMap` → `Map<String, Any?>`.
     *
     * Nulls are KEPT rather than dropped: `{trait: null}` is a meaningful payload
     * value (JSON null) and the SDK forwards it to ingest, where a contract may
     * legitimately declare a nullable field. Identities are the exception and
     * handled separately by [identities].
     */
    fun toMap(map: ReadableMap?): Map<String, Any?> {
        if (map == null) return emptyMap()
        // LinkedHashMap: ingest passes `context`/`properties` through as JSON and
        // the browser SDK's payload has a stable key order. Iteration order here
        // is what the SDK's JSON writer emits, so a HashMap would make the wire
        // bytes vary run to run for no reason.
        val out = LinkedHashMap<String, Any?>()
        val iterator = map.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            out[key] = value(map, key)
        }
        return out
    }

    fun toList(array: ReadableArray?): List<Any?> {
        if (array == null) return emptyList()
        val out = ArrayList<Any?>(array.size())
        for (index in 0 until array.size()) {
            out.add(
                when (array.getType(index)) {
                    ReadableType.Null -> null
                    ReadableType.Boolean -> array.getBoolean(index)
                    ReadableType.Number -> number(array.getDouble(index))
                    ReadableType.String -> array.getString(index)
                    ReadableType.Map -> toMap(array.getMap(index))
                    ReadableType.Array -> toList(array.getArray(index))
                }
            )
        }
        return out
    }

    private fun value(map: ReadableMap, key: String): Any? = when (map.getType(key)) {
        ReadableType.Null -> null
        ReadableType.Boolean -> map.getBoolean(key)
        ReadableType.Number -> number(map.getDouble(key))
        ReadableType.String -> map.getString(key)
        ReadableType.Map -> toMap(map.getMap(key))
        ReadableType.Array -> toList(map.getArray(key))
    }

    /**
     * JavaScript has ONE number type, so RN hands every number across as a
     * Double — and `{count: 1}` would reach ingest as `1.0`.
     *
     * The browser SDK's payload has `1`, and that difference is visible in the
     * warehouse and in a contract that declares an integer field, so a whole
     * value is narrowed back to an integral type here. Int when it fits (the
     * common case, and what a JSON writer renders shortest), Long otherwise;
     * anything fractional or non-finite stays a Double for the SDK's own
     * JS-compatible number formatting to handle.
     */
    private fun number(value: Double): Any =
        if (value.isFinite() && value == Math.floor(value) && !value.isInfinite()) {
            if (value >= Int.MIN_VALUE.toDouble() && value <= Int.MAX_VALUE.toDouble()) {
                value.toInt()
            } else {
                value.toLong()
            }
        } else {
            value
        }

    // ── typed reads ─────────────────────────────────────────────────────────
    // Each REJECTS a wrong type instead of coercing. A coerced option is worse
    // than a rejected one: `{flushAt: "10"}` silently becoming 0 or 10 is a
    // behaviour change nobody asked for and nobody can see.

    fun stringOrNull(map: ReadableMap, key: String): String? {
        if (!map.hasKey(key) || map.isNull(key)) return null
        if (map.getType(key) != ReadableType.String) {
            throw ArgumentException("$key must be a string, got ${map.getType(key)}")
        }
        return map.getString(key)
    }

    fun requireString(map: ReadableMap, key: String): String =
        stringOrNull(map, key) ?: throw ArgumentException("$key is required")

    fun boolOr(map: ReadableMap, key: String, fallback: Boolean): Boolean {
        if (!map.hasKey(key) || map.isNull(key)) return fallback
        if (map.getType(key) != ReadableType.Boolean) {
            throw ArgumentException("$key must be a boolean, got ${map.getType(key)}")
        }
        return map.getBoolean(key)
    }

    fun boolOrNull(map: ReadableMap, key: String): Boolean? {
        if (!map.hasKey(key) || map.isNull(key)) return null
        if (map.getType(key) != ReadableType.Boolean) {
            throw ArgumentException("$key must be a boolean, got ${map.getType(key)}")
        }
        return map.getBoolean(key)
    }

    fun longOr(map: ReadableMap, key: String, fallback: Long): Long {
        if (!map.hasKey(key) || map.isNull(key)) return fallback
        if (map.getType(key) != ReadableType.Number) {
            throw ArgumentException("$key must be a number, got ${map.getType(key)}")
        }
        val raw = map.getDouble(key)
        if (!raw.isFinite() || raw != Math.floor(raw)) {
            throw ArgumentException("$key must be a whole number, got $raw")
        }
        return raw.toLong()
    }

    fun intOr(map: ReadableMap, key: String, fallback: Int): Int = longOr(map, key, fallback.toLong()).toInt()

    /**
     * Purpose ids, accepting both web shapes: a flat list (`[1,3,4]`, all
     * required) and a list of groups (`[[1,3,4],[1,5,6]]`, any group sufficient).
     * Returned as the flattened `List<Int>` the SDK's builder takes, with the
     * a flat list of ids, all required.
     */
    fun purposeIds(map: ReadableMap, key: String): List<Int>? {
        if (!map.hasKey(key) || map.isNull(key)) return null
        if (map.getType(key) != ReadableType.Array) {
            throw ArgumentException("$key must be an array")
        }
        val decoded = toList(map.getArray(key))
        if (decoded.isEmpty()) return null
        // Flat ids, ALL required: ConsentOptions.Builder takes List<Int>, as the web and
        // iOS SDKs take number[] / [Int]. The JS layer already rejects purpose groups.
        return decoded.map { element ->
            when (element) {
                is Int -> element
                is Long -> element.toInt()
                is Double -> if (element % 1.0 == 0.0) element.toInt()
                    else throw ArgumentException("$key must contain integers")
                is List<*> -> throw ArgumentException(
                    "$key must be a flat array of purpose ids (purpose groups are not an option)",
                )
                else -> throw ArgumentException("$key must contain integers")
            }
        }
    }

    fun stringListOrNull(array: ReadableArray?): List<String>? {
        if (array == null) return null
        val out = ArrayList<String>(array.size())
        for (index in 0 until array.size()) {
            if (array.getType(index) != ReadableType.String) {
                throw ArgumentException("keys[$index] must be a string")
            }
            out.add(array.getString(index) ?: throw ArgumentException("keys[$index] must be a string"))
        }
        return out
    }

    /**
     * Identity values must be strings.
     *
     * NOT stringified: `{loyaltyId: 12345}` coerced to `"12345"` would be hashed
     * and shipped, matching nothing downstream, with no error anywhere. The JS
     * layer rejects this first; this is the backstop for a caller reaching the
     * native module directly.
     */
    fun identities(map: ReadableMap?): Map<String, String?> {
        if (map == null) return emptyMap()
        val out = LinkedHashMap<String, String?>()
        val iterator = map.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            if (map.isNull(key)) continue // absent = not set, as on the web
            if (map.getType(key) != ReadableType.String) {
                throw ArgumentException(
                    "identities.$key must be a string, got ${map.getType(key)}; a number would " +
                        "be hashed as its digits and match nothing"
                )
            }
            out[key] = map.getString(key)
        }
        return out
    }

    /** `Map<String, Any?>` → `WritableMap`, for the values we resolve back to JS. */
    @Suppress("UNCHECKED_CAST") // nested maps come from our own SDK, keyed by String
    fun toWritableMap(source: Map<String, Any?>): WritableMap {
        val out = Arguments.createMap()
        for ((key, value) in source) {
            when (value) {
                null -> out.putNull(key)
                is Boolean -> out.putBoolean(key, value)
                is Int -> out.putInt(key, value)
                is Long -> out.putDouble(key, value.toDouble())
                is Double -> out.putDouble(key, value)
                is String -> out.putString(key, value)
                is Map<*, *> -> out.putMap(key, toWritableMap(value as Map<String, Any?>))
                else -> out.putString(key, value.toString())
            }
        }
        return out
    }
}

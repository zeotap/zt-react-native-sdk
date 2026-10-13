package com.zeotap.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap

/**
 * A `Promise` that records instead of crossing the bridge.
 *
 * The interface carries a long tail of deprecated `reject` overloads that RN
 * keeps for source compatibility; only [resolve] and `reject(code, message)` are
 * used by this module, so the rest funnel into the same recording to make an
 * accidental use of a deprecated form visible rather than silent.
 */
internal class RecordingPromise : Promise {
    var resolved = false
        private set
    var value: Any? = null
        private set
    var rejectedCode: String? = null
        private set
    var rejectedMessage: String? = null
        private set

    val settled: Boolean get() = resolved || rejectedCode != null

    override fun resolve(value: Any?) {
        resolved = true
        this.value = value
    }

    /** The resolved value as a map, for the two methods that answer objects. */
    fun map(): WritableMap = value as WritableMap

    override fun reject(code: String?, message: String?) {
        rejectedCode = code
        rejectedMessage = message
    }

    override fun reject(code: String?, throwable: Throwable?) = reject(code, throwable?.message)

    override fun reject(code: String?, message: String?, throwable: Throwable?) =
        reject(code, message)

    override fun reject(throwable: Throwable?) = reject("E_UNSPECIFIED", throwable?.message)

    override fun reject(throwable: Throwable?, userInfo: WritableMap?) = reject(throwable)

    override fun reject(code: String?, userInfo: WritableMap) = reject(code, code)

    override fun reject(code: String?, throwable: Throwable?, userInfo: WritableMap?) =
        reject(code, throwable?.message)

    override fun reject(code: String?, message: String?, userInfo: WritableMap) =
        reject(code, message)

    override fun reject(
        code: String?,
        message: String?,
        throwable: Throwable?,
        userInfo: WritableMap?,
    ) = reject(code, message)

    @Deprecated("Prefer reject(code, message)", ReplaceWith("reject(code, message)"))
    override fun reject(message: String?) = reject("E_UNSPECIFIED", message)
}

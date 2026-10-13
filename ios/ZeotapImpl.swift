import Foundation
import ZeotapSDK
// SwiftPM ships the @objc wrappers as their own product, ZeotapSDKObjC. CocoaPods compiles
// every subspec (Core, ObjC, …) into the ONE ZeotapSDK module, so there is no separate module
// to import there — and an unconditional import failed the first CocoaPods build of this bridge.
#if canImport(ZeotapSDKObjC)
import ZeotapSDKObjC
#endif

/// The whole iOS bridge. `Zeotap.mm` is mechanical argument unwrapping; every
/// decision lives here, in Swift, where the SDK's own types are visible.
///
/// It talks to `ZTAnalytics` / `ZTConfiguration` (`sdk/ios/Sources/ZeotapSDKObjC`)
/// rather than the Swift API directly — that target exists precisely so a bridge
/// has a stable, `@objc`-visible surface, and using it means the RN module never
/// depends on Swift-only generics or enums.
///
/// Rejection codes are a closed set the JS layer maps onto error classes
/// (`src/errors.ts`):
///
/// | code               | meaning                                       |
/// |--------------------|-----------------------------------------------|
/// | `E_NOT_CONFIGURED` | a method called before `configure`            |
/// | `E_CONFIG`         | an invalid option reached the native side     |
/// | `E_CONSENT`        | the SDK dropped the event; consent denies it  |
/// | `E_PLATFORM`       | an Android-only method called here            |
/// | `E_ARGUMENT`       | a malformed argument bag                      |
/// | `E_SDK`            | anything else the SDK reported                |
///
/// Every rejection carries the SDK's own message UNCHANGED: `[SDK] Dropped
/// track: no track consent` is asserted by the web SDK's tests, the
/// `sdk/conformance` vectors and both native suites, so rewording it here would
/// break parity in the one place a customer reads.
@objc(ZeotapImpl)
public final class ZeotapImpl: NSObject {

    public typealias Resolve = (Any?) -> Void
    public typealias Reject = (String, String) -> Void

    private enum Code {
        static let notConfigured = "E_NOT_CONFIGURED"
        static let config = "E_CONFIG"
        static let consent = "E_CONSENT"
        static let platform = "E_PLATFORM"
        static let argument = "E_ARGUMENT"
        static let sdk = "E_SDK"
    }

    /// Retained only so a `configure` call's options stay inspectable for debug
    /// logging. Nothing depends on its lifetime any more: `setAdvertisingId` goes
    /// through `ZTAnalytics`, which owns the provider the SDK re-reads per payload.
    private var configuration: ZTConfiguration?
    private var analytics: ZTAnalytics?
    /// Strong: ZTAnalytics holds a listener weakly. Its closure captures `self` weakly,
    /// so the bridge and its forwarder do not keep each other alive.
    private lazy var eventForwarder: ZeotapEventForwarder = ZeotapEventForwarder { [weak self] type, message, code in
        var payload: [String: Any] = ["type": type, "message": message]
        if let code { payload["code"] = code }
        self?.emitEvent?(payload as NSDictionary)
    }

    /// Emits `{type, message, code?}` to JS. Set by the `.mm` layer, which owns
    /// the `RCTEventEmitter` plumbing.
    @objc public var emitEvent: ((NSDictionary) -> Void)?

    // MARK: - configure

    @objc public func configure(
        writeKey: String?,
        options: NSDictionary?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        guard let writeKey, !writeKey.trimmingCharacters(in: .whitespaces).isEmpty else {
            reject(Code.config, "[SDK] writeKey is required")
            return
        }
        // Idempotent, matching `Zeotap.configure`: a re-rendered root component
        // must not be able to reconfigure the SDK.
        if analytics != nil {
            resolve(nil)
            return
        }
        let bag = ZeotapJSONCodec.decodeDictionary(options)
        guard !bag.isEmpty else {
            reject(Code.config, "[SDK] configure requires an options object")
            return
        }
        do {
            let configuration = try buildConfiguration(bag)
            let instance = try ZTAnalytics.configure(writeKey: writeKey, configuration: configuration)
            self.configuration = configuration
            self.analytics = instance
            // The SDK's observability stream, as Android's bridge reports it: without this
            // the JS `error` / `debug` events never fired on iOS at all.
            instance.addListener(eventForwarder)
            resolve(nil)
        } catch let error as CodecError {
            // Inside the options bag a malformed value and an invalid option mean
            // the same thing to a caller: the CONFIGURATION was wrong.
            reject(Code.config, "[SDK] \(error.localizedDescription)")
        } catch {
            reject(Code.config, message(for: error))
        }
    }

    private func buildConfiguration(_ bag: [String: Any]) throws -> ZTConfiguration {
        let codec = ZeotapJSONCodec.self
        let configuration = ZTConfiguration(apiHost: try codec.string(bag, "apiHost"))
        if let namespace = try codec.optionalString(bag, "namespace") {
            configuration.namespace = namespace
        }
        configuration.flushAt = try codec.int(bag, "flushAt", default: 10)
        // JS says `flushInterval` in milliseconds — the browser SDK's name and
        // unit — and so does ZTConfiguration. One options object, both platforms.
        configuration.flushInterval = try codec.int(bag, "flushInterval", default: 5000)
        configuration.debug = try codec.bool(bag, "debug", default: false)
        if let nativeAppId = try codec.optionalString(bag, "nativeAppId") {
            configuration.nativeAppId = nativeAppId
        }
        configuration.maxQueueSize = try codec.int(bag, "maxQueueSize", default: 500)
        configuration.trackApplicationLifecycleEvents =
            try codec.bool(bag, "trackApplicationLifecycleEvents", default: false)
        configuration.flushOnBackground = try codec.bool(bag, "flushOnBackground", default: true)
        configuration.collectAdvertisingId = try codec.bool(bag, "collectAdvertisingId", default: false)

        if let integration = bag["integration"] as? [String: Any] {
            configuration.integrationName = try codec.string(integration, "name")
            configuration.integrationVersion = try codec.string(integration, "version")
        }
        if let consent = bag["consent"] as? [String: Any] {
            try applyConsentOptions(consent, to: configuration)
        }
        return configuration
    }

    private func applyConsentOptions(_ bag: [String: Any], to configuration: ZTConfiguration) throws {
        let codec = ZeotapJSONCodec.self
        configuration.consentRequire = try codec.bool(bag, "require", default: false)
        configuration.consentDefault = try codec.optionalString(bag, "default") ?? "granted"
        configuration.consentCmpTimeoutMs = try codec.int(bag, "cmpTimeoutMs", default: 10_000)
        configuration.consentMaxBufferedEvents = try codec.int(bag, "maxBufferedEvents", default: 10)
        // Left nil when absent so the SDK derives it from `require`, exactly as
        // the web SDK does.
        configuration.consentCmp = try codec.optionalString(bag, "cmp")
        configuration.consentCheckVendorConsent = try codec.bool(bag, "checkVendorConsent", default: false)
        configuration.consentPersist = try codec.bool(bag, "persist", default: true)
        configuration.consentExpiryDays = try codec.int(bag, "expiryDays", default: 365)
        if let tracking = try codec.purposeIds(bag, "purposesForTracking") {
            configuration.consentPurposesForTracking = tracking
        }
        if let identifying = try codec.purposeIds(bag, "purposesForIdentifying") {
            configuration.consentPurposesForIdentifying = identifying
        }
        if let cookieSync = try codec.purposeIds(bag, "purposesForCookieSync") {
            configuration.consentPurposesForCookieSync = cookieSync
        }
    }

    // MARK: - events

    @objc public func track(
        event: String?,
        properties: NSDictionary?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("track", reject) { sdk in
            guard let event, !event.isEmpty else {
                resolve(nil) // web parity: an empty name is a silent no-op
                return
            }
            sdk.track(event, properties: ZeotapJSONCodec.decodeDictionary(properties)) { error in
                self.settle(error, resolve, reject)
            }
        }
    }

    @objc public func screen(
        name: String?,
        category: String?,
        properties: NSDictionary?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("screen", reject) { sdk in
            sdk.screen(
                name: name,
                category: category,
                properties: ZeotapJSONCodec.decodeDictionary(properties)
            ) { error in
                self.settle(error, resolve, reject)
            }
        }
    }

    @objc public func identify(
        userId: String?,
        traits: NSDictionary?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("identify", reject) { sdk in
            sdk.identify(userId: userId, traits: ZeotapJSONCodec.decodeDictionary(traits)) { error in
                self.settle(error, resolve, reject)
            }
        }
    }

    @objc public func group(
        groupId: String?,
        traits: NSDictionary?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("group", reject) { sdk in
            guard let groupId, !groupId.isEmpty else {
                resolve(nil)
                return
            }
            sdk.group(groupId, traits: ZeotapJSONCodec.decodeDictionary(traits)) { error in
                self.settle(error, resolve, reject)
            }
        }
    }

    @objc public func alias(
        newId: String?,
        previousId: String?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("alias", reject) { sdk in
            guard let newId, !newId.isEmpty else {
                resolve(nil)
                return
            }
            sdk.alias(newId, previousId: previousId) { error in
                self.settle(error, resolve, reject)
            }
        }
    }

    // MARK: - consent

    @objc public func setConsent(
        input: NSDictionary?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("setConsent", reject) { sdk in
            let bag = ZeotapJSONCodec.decodeDictionary(input)
            let codec = ZeotapJSONCodec.self
            do {
                let tcf = try codec.optionalString(bag, "tcfString")
                let usp = try codec.optionalString(bag, "usPrivacy")
                let categories = ["analytics", "marketing", "advertising", "functional"]
                    .filter { bag[$0] != nil && !(bag[$0] is NSNull) }
                let forms = [tcf != nil, usp != nil, !categories.isEmpty].filter { $0 }.count

                // Exactly one form, like the web SDK. Two at once would leave the
                // resolver silently choosing which decides whether events flow;
                // none would resolve to GRANTED, since an absent category grants.
                if forms > 1 {
                    reject(
                        Code.argument,
                        "[SDK] setConsent accepts exactly one of {tcfString}, {usPrivacy} or the categories"
                    )
                    return
                }
                if forms == 0 {
                    reject(
                        Code.argument,
                        "[SDK] setConsent needs one of {tcfString}, {usPrivacy} or at least one category"
                    )
                    return
                }

                if let tcf {
                    sdk.setConsentTCFString(tcf)
                } else if let usp {
                    sdk.setConsentUSPrivacy(usp)
                } else {
                    sdk.setConsentAnalytics(
                        try codec.optionalBool(bag, "analytics").map(NSNumber.init(value:)),
                        marketing: try codec.optionalBool(bag, "marketing").map(NSNumber.init(value:)),
                        advertising: try codec.optionalBool(bag, "advertising").map(NSNumber.init(value:)),
                        functional: try codec.optionalBool(bag, "functional").map(NSNumber.init(value:))
                    )
                }
                resolve(nil)
            } catch let error as CodecError {
                reject(Code.argument, "[SDK] \(error.localizedDescription)")
            } catch {
                reject(Code.sdk, self.message(for: error))
            }
        }
    }

    /// Passed through from `ZTAnalytics.getConsentState()` unchanged — it already
    /// returns the documented `{resolved, signals?, source?, gdprApplies?}` shape
    /// that the Android bridge is written to reproduce.
    @objc public func getConsentState(resolve: @escaping Resolve, reject: @escaping Reject) {
        guard let sdk = analytics else {
            // Web parity: `getConsentState()` is the one method callable pre-init.
            resolve(["resolved": false])
            return
        }
        resolve(sdk.getConsentState())
    }

    // MARK: - identities

    @objc public func setUserIdentities(
        identities: NSDictionary?,
        hashed: Bool,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("setUserIdentities", reject) { sdk in
            do {
                let values = try ZeotapJSONCodec.identities(identities)
                sdk.setUserIdentities(values, hashed: hashed) { error in
                    self.settle(error, resolve, reject)
                }
            } catch let error as CodecError {
                reject(Code.argument, "[SDK] \(error.localizedDescription)")
            } catch {
                reject(Code.sdk, self.message(for: error))
            }
        }
    }

    @objc public func unsetUserIdentities(
        keys: NSArray?,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        withSdk("unsetUserIdentities", reject) { sdk in
            do {
                // Never consent-gated, and nil means "remove everything".
                sdk.unsetUserIdentities(try ZeotapJSONCodec.stringArray(keys))
                resolve(nil)
            } catch let error as CodecError {
                reject(Code.argument, "[SDK] \(error.localizedDescription)")
            } catch {
                reject(Code.sdk, self.message(for: error))
            }
        }
    }

    @objc public func getIdentity(resolve: @escaping Resolve, reject: @escaping Reject) {
        withSdk("getIdentity", reject) { sdk in
            let userId: Any = sdk.userId.map { $0 as Any } ?? NSNull()
            resolve(["anonymousId": sdk.anonymousId, "userId": userId])
        }
    }

    // MARK: - lifecycle

    @objc public func reset(resolve: @escaping Resolve, reject: @escaping Reject) {
        withSdk("reset", reject) { sdk in
            sdk.reset()
            resolve(nil)
        }
    }

    @objc public func flush(resolve: @escaping Resolve, reject: @escaping Reject) {
        withSdk("flush", reject) { sdk in
            // Resolves when the flush COMPLETES its attempt; the SDK's completion
            // fires on `callbackQueue` after the batch has been tried.
            sdk.flush {
                resolve(nil)
            }
        }
    }

    /// Goes through `ZTAnalytics`, not the configuration object. It used to reach
    /// `ZTConfiguration.setAdvertisingId`, which works only while that same instance
    /// is alive — a lifetime this module happened to satisfy by retaining it, and a
    /// trap for anyone who later stopped. The SDK re-reads the value per payload
    /// either way, so this takes effect for subsequent events.
    @objc public func setAdvertisingId(
        idfa: String?,
        trackingAuthorized: Bool,
        resolve: @escaping Resolve,
        reject: @escaping Reject
    ) {
        guard let analytics else {
            reject(Code.notConfigured, "[SDK] Not initialized. Call configure() before setAdvertisingId().")
            return
        }
        analytics.setAdvertisingId(idfa, trackingAuthorized: trackingAuthorized)
        resolve(nil)
    }

    /// Android-only, rejected rather than ignored so a cross-platform caller
    /// learns where the asymmetry is.
    @objc public func setAdvertisingIdAndroid(resolve: @escaping Resolve, reject: @escaping Reject) {
        reject(
            Code.platform,
            "[SDK] Zeotap.android.setAdvertisingId is Android-only; on iOS use "
                + "Zeotap.ios.setAdvertisingId(idfa, trackingAuthorized)."
        )
    }

    // MARK: - plumbing

    private func withSdk(_ method: String, _ reject: @escaping Reject, _ body: (ZTAnalytics) -> Void) {
        guard let sdk = analytics else {
            reject(Code.notConfigured, "[SDK] Not initialized. Call configure() before \(method)().")
            return
        }
        body(sdk)
    }

    private func settle(_ error: Error?, _ resolve: @escaping Resolve, _ reject: @escaping Reject) {
        guard let error else {
            resolve(nil)
            return
        }
        reject(code(for: error), message(for: error))
    }

    /// The SDK's completion carries an `Error`, not a reason enum, so consent
    /// drops are recognised by the SDK's own message prefixes — frozen by the
    /// conformance vectors and therefore safe to match on. Anything unrecognised
    /// stays `E_SDK` rather than being guessed at.
    private func code(for error: Error) -> String {
        let text = message(for: error)
        if text.hasPrefix("[SDK] Dropped ") { return Code.consent }
        if text.hasPrefix("[SDK] Identities dropped") { return Code.consent }
        if text.hasPrefix("[SDK] Event dropped") { return Code.consent }
        if text.hasPrefix("[SDK] Not initialized") { return Code.notConfigured }
        return Code.sdk
    }

    private func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }

    /// Test seam: forget the configured instance.
    @objc public func shutdownForTesting() {
        analytics?.shutdown()
        analytics = nil
        configuration = nil
    }
}

// MARK: - SDK listener → JS events

/// The same stream, word for word, as the Android bridge's `SdkListener`
/// (ZeotapModuleImpl.kt): a delivered batch on `debug`, everything a caller asked for
/// and did not get on `error`. One JS app must see one event stream on both platforms.
///
/// A separate PRIVATE object rather than `extension ZeotapImpl: ZTSdkListener`: a public
/// conformance is written into the generated ZeotapReactNative-Swift.h, which Zeotap.mm
/// imports without importing ZeotapSDK, and the first build failed on "cannot find
/// protocol declaration for 'ZTSdkListener'". Private types never reach that header.
private final class ZeotapEventForwarder: NSObject, ZTSdkListener {
    private let emit: (String, String, String?) -> Void

    init(emit: @escaping (String, String, String?) -> Void) {
        self.emit = emit
    }

    func onBatchResult(status: Int, success: Bool, received: Int, sent: Int, errors: [String]) {
        if success {
            emit("debug", "[SDK] Batch delivered: \(received)/\(sent)", nil)
        } else {
            emit("error", "[SDK] Batch partially rejected: \(errors)", "E_SDK")
        }
    }

    func onDeliveryFailure(status: NSNumber?, attempts: Int, error: Error?) {
        // Four attempts are spent by now and the rows went back to the durable queue,
        // so this warns about latency, not lost data.
        var message = "[SDK] Delivery failed after \(attempts) attempt(s)"
        if let status { message += " (HTTP \(status))" }
        if let error { message += ": \(error.localizedDescription)" }
        emit("error", message, "E_SDK")
    }

    func onEventDropped(type: String, reason: String, message: String) {
        emit("error", message, reason == "consentDenied" ? "E_CONSENT" : "E_SDK")
    }

    func onError(_ error: Error) {
        emit("error", error.localizedDescription, "E_SDK")
    }
}

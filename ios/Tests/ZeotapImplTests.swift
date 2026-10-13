import XCTest
@testable import ZeotapReactNative

/// The JS↔native boundary and the argument-validation paths that need no
/// configured SDK. Everything the SDK itself does is covered by `sdk/ios`'s own
/// suite plus the `sdk/conformance` runners; what this file owns is that nothing
/// crossing the bridge is silently coerced, and that nothing here can trap.
final class ZeotapJSONCodecTests: XCTestCase {

    func testNSNullSurvivesAsJsonNull() {
        // `{trait: null}` is a meaningful payload value the SDK forwards to
        // ingest, where a contract may declare a nullable field — dropping it
        // would change the event.
        let decoded = ZeotapJSONCodec.decodeDictionary(["trait": NSNull()] as NSDictionary)
        XCTAssertTrue(decoded["trait"] is NSNull)
    }

    func testBooleanStaysBooleanAndOneStaysANumber() {
        // The trap: JS `true` arrives as an NSNumber indistinguishable from 1 by
        // value. Get this wrong and `{flag: true}` reaches ingest as `1`.
        let decoded = ZeotapJSONCodec.decodeDictionary(
            ["flag": NSNumber(value: true), "count": NSNumber(value: 1)] as NSDictionary
        )
        XCTAssertEqual(decoded["flag"] as? Bool, true)
        XCTAssertFalse(decoded["flag"] is Int)
        XCTAssertEqual(decoded["count"] as? Int, 1)
    }

    func testWholeNumberBecomesIntegralAndFractionStaysDouble() {
        // The browser SDK's payload has `1`, not `1.0`.
        let decoded = ZeotapJSONCodec.decodeDictionary(
            ["count": NSNumber(value: 1.0), "revenue": NSNumber(value: 149.99)] as NSDictionary
        )
        XCTAssertEqual(decoded["count"] as? Int, 1)
        XCTAssertEqual(decoded["revenue"] as? Double, 149.99)
    }

    func testNestedStructuresRecurse() {
        let input: NSDictionary = [
            "outer": ["list": [["deep": NSNumber(value: 1)]]]
        ]
        let decoded = ZeotapJSONCodec.decodeDictionary(input)
        let outer = decoded["outer"] as? [String: Any]
        let list = outer?["list"] as? [Any]
        let first = list?.first as? [String: Any]
        XCTAssertEqual(first?["deep"] as? Int, 1)
    }

    func testTypedReadsRejectAWrongTypeByKey() {
        let bag: [String: Any] = ["flushAt": "10", "debug": NSNumber(value: 1)]
        XCTAssertThrowsError(try ZeotapJSONCodec.int(bag, "flushAt", default: 10)) { error in
            XCTAssertTrue("\(error.localizedDescription)".contains("flushAt must be a number"))
        }
        XCTAssertThrowsError(try ZeotapJSONCodec.bool(bag, "debug", default: false)) { error in
            XCTAssertTrue("\(error.localizedDescription)".contains("debug must be a boolean"))
        }
    }

    func testTypedReadsFallBackWhenAbsentOrNull() throws {
        let bag: [String: Any] = ["present": NSNull()]
        XCTAssertEqual(try ZeotapJSONCodec.int(bag, "missing", default: 7), 7)
        XCTAssertEqual(try ZeotapJSONCodec.int(bag, "present", default: 7), 7)
        XCTAssertNil(try ZeotapJSONCodec.optionalString(bag, "present"))
    }

    func testIdentityValueMustBeAStringAndIsNamedWhenItIsNot() {
        // A number stringified to "12345" would be hashed and shipped, matching
        // nothing downstream, with no error anywhere.
        XCTAssertThrowsError(
            try ZeotapJSONCodec.identities(["loyaltyId": NSNumber(value: 12345)] as NSDictionary)
        ) { error in
            let text = error.localizedDescription
            XCTAssertTrue(text.contains("identities.loyaltyId must be a string"))
            XCTAssertTrue(text.contains("match nothing"))
        }
    }

    func testNullIdentityValueIsSkippedNotEmptied() throws {
        let decoded = try ZeotapJSONCodec.identities(
            ["email": "a@b.com", "cellno": NSNull()] as NSDictionary
        )
        XCTAssertEqual(decoded, ["email": "a@b.com"])
    }

    func testPurposeIdsAcceptBothShapesAndTreatEmptyAsAbsent() throws {
        let flat = try ZeotapJSONCodec.purposeIds(
            ["purposesForIdentifying": [NSNumber(value: 1), NSNumber(value: 9)]],
            "purposesForIdentifying"
        )
        XCTAssertEqual(flat?.map(\.intValue), [1, 9])

        let grouped = try ZeotapJSONCodec.purposeIds(
            ["purposesForTracking": [[NSNumber(value: 1), NSNumber(value: 3)], [NSNumber(value: 5)]]],
            "purposesForTracking"
        )
        XCTAssertEqual(grouped?.map(\.intValue), [1, 3, 5])

        // An empty list could be read as "no purposes required", which would
        // grant consent the CMP never gave.
        XCTAssertNil(try ZeotapJSONCodec.purposeIds(["purposesForTracking": []], "purposesForTracking"))
    }

    func testStringArrayRejectsANonStringElementByIndex() {
        XCTAssertThrowsError(try ZeotapJSONCodec.stringArray(["email", NSNumber(value: 1)])) { error in
            XCTAssertTrue(error.localizedDescription.contains("keys[1] must be a string"))
        }
    }
}

/// The impl's refusals. Anything that needs a live SDK belongs to the XCUITest
/// suite in `sdk/ios/SampleApp` and the mobile e2e harness.
final class ZeotapImplGuardTests: XCTestCase {
    private var impl = ZeotapImpl()

    override func setUp() {
        super.setUp()
        impl = ZeotapImpl()
    }

    override func tearDown() {
        impl.shutdownForTesting()
        super.tearDown()
    }

    func testEveryGatedMethodRejectsBeforeConfigure() {
        let cases: [(String, (@escaping ZeotapImpl.Resolve, @escaping ZeotapImpl.Reject) -> Void)] = [
            ("track", { r, j in self.impl.track(event: "Ev", properties: nil, resolve: r, reject: j) }),
            ("identify", { r, j in self.impl.identify(userId: "u", traits: nil, resolve: r, reject: j) }),
            ("group", { r, j in self.impl.group(groupId: "g", traits: nil, resolve: r, reject: j) }),
            ("reset", { r, j in self.impl.reset(resolve: r, reject: j) }),
            ("flush", { r, j in self.impl.flush(resolve: r, reject: j) }),
            ("getIdentity", { r, j in self.impl.getIdentity(resolve: r, reject: j) }),
        ]
        for (name, run) in cases {
            var code: String?
            var message: String?
            run({ _ in }, { c, m in code = c; message = m })
            XCTAssertEqual(code, "E_NOT_CONFIGURED", "\(name) should refuse before configure")
            XCTAssertEqual(message, "[SDK] Not initialized. Call configure() before \(name)().")
        }
    }

    func testGetConsentStateAnswersUnresolvedBeforeConfigure() {
        // Web parity: `getConsentState()` is the one method callable pre-init.
        var value: Any?
        impl.getConsentState(resolve: { value = $0 }, reject: { _, _ in XCTFail("should not reject") })
        XCTAssertEqual((value as? [String: Any])?["resolved"] as? Bool, false)
    }

    func testBlankWriteKeyIsRefused() {
        var code: String?
        impl.configure(
            writeKey: "  ",
            options: ["apiHost": "https://ingest.example"],
            resolve: { _ in XCTFail("should not resolve") },
            reject: { c, _ in code = c }
        )
        XCTAssertEqual(code, "E_CONFIG")
    }

    func testMissingApiHostIsRefusedRatherThanDefaulted() {
        // There is no same-origin default on a device.
        var message: String?
        impl.configure(
            writeKey: "wk_test",
            options: ["flushAt": NSNumber(value: 10)],
            resolve: { _ in XCTFail("should not resolve") },
            reject: { _, m in message = m }
        )
        XCTAssertTrue(message?.contains("apiHost is required") == true)
    }

    func testAndroidAdvertisingIdMethodRejectsHere() {
        var code: String?
        var message: String?
        impl.setAdvertisingIdAndroid(resolve: { _ in }, reject: { c, m in code = c; message = m })
        XCTAssertEqual(code, "E_PLATFORM")
        XCTAssertTrue(message?.contains("Android-only") == true)
    }
}

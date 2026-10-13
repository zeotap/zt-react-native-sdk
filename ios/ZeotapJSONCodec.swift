import Foundation

/// The JS↔native boundary, and the one type in this bridge that must never trap.
///
/// The legacy iOS bridge force-cast here (`as!`) and crashed the host app on an
/// `NSNull` or a nested dictionary. Every read below either produces a value or
/// throws `CodecError`, which `ZeotapImpl` turns into an `E_ARGUMENT` rejection
/// naming the key — a rejected promise the app can handle, not a trap.
enum CodecError: Error, LocalizedError {
    case wrongType(key: String, expected: String, got: String)
    case missing(key: String)
    case identityNotAString(key: String, got: String)

    var errorDescription: String? {
        switch self {
        case let .wrongType(key, expected, got):
            return "\(key) must be \(expected), got \(got)"
        case let .missing(key):
            return "\(key) is required"
        case let .identityNotAString(key, got):
            return "identities.\(key) must be a string, got \(got); a number would be hashed "
                + "as its digits and match nothing"
        }
    }
}

enum ZeotapJSONCodec {

    /// Recursive `NSDictionary` (from JS) → `[String: Any]`.
    ///
    /// `NSNull` becomes a real `NSNull` rather than being dropped: `{trait: null}`
    /// is a meaningful JSON payload value the SDK forwards to ingest, where a
    /// contract may legitimately declare a nullable field. Identities are the
    /// exception and handled by `identities(_:)`.
    static func decode(_ value: Any?) -> Any? {
        guard let value else { return nil }
        switch value {
        case is NSNull:
            return NSNull()
        case let dictionary as [String: Any]:
            var out: [String: Any] = [:]
            for (key, element) in dictionary {
                out[key] = decode(element) ?? NSNull()
            }
            return out
        case let array as [Any]:
            return array.map { decode($0) ?? NSNull() }
        case let number as NSNumber:
            return normalise(number)
        default:
            return value
        }
    }

    static func decodeDictionary(_ value: Any?) -> [String: Any] {
        (decode(value) as? [String: Any]) ?? [:]
    }

    /// The boolean trap, and the reason this function exists.
    ///
    /// JavaScript `true` arrives as an `NSNumber`, and `NSNumber(value: true)` is
    /// indistinguishable from `NSNumber(value: 1)` by value alone — so `{flag:
    /// true}` would reach ingest as `1`. The discriminator is the underlying
    /// Objective-C type: `objCType` is `"c"` for a boolean-backed NSNumber.
    ///
    /// `objCType` rather than `CFGetTypeID(...) == CFBooleanGetTypeID()` for one
    /// reason: `sdk/ios/Sources/ZeotapSDK/Payload/JSONMapper.swift` had to solve
    /// exactly this and settled on the same check, because the CoreFoundation
    /// call is unavailable on the Linux test host the package also builds for.
    /// Two different answers to the same question in one codebase is how a
    /// payload difference between the SDK and its bridge would go unnoticed.
    private static func normalise(_ number: NSNumber) -> Any {
        if isBoolean(number) { return number.boolValue }
        let double = number.doubleValue
        // A whole number must serialise as an integral value: the browser SDK's
        // payload has `1`, not `1.0`, and an event contract may declare an
        // integer field.
        if double.isFinite, double == double.rounded(.towardZero),
           double >= Double(Int.min), double <= Double(Int.max) {
            return number.intValue
        }
        return double
    }

    static func isBoolean(_ number: NSNumber) -> Bool {
        strcmp(number.objCType, "c") == 0
    }

    // ── typed reads ─────────────────────────────────────────────────────────

    static func string(_ bag: [String: Any], _ key: String) throws -> String {
        guard let value = bag[key], !(value is NSNull) else { throw CodecError.missing(key: key) }
        guard let string = value as? String else {
            throw CodecError.wrongType(key: key, expected: "a string", got: describe(value))
        }
        return string
    }

    static func optionalString(_ bag: [String: Any], _ key: String) throws -> String? {
        guard let value = bag[key], !(value is NSNull) else { return nil }
        guard let string = value as? String else {
            throw CodecError.wrongType(key: key, expected: "a string", got: describe(value))
        }
        return string
    }

    static func bool(_ bag: [String: Any], _ key: String, default fallback: Bool) throws -> Bool {
        guard let value = bag[key], !(value is NSNull) else { return fallback }
        guard let number = value as? NSNumber, isBoolean(number) else {
            throw CodecError.wrongType(key: key, expected: "a boolean", got: describe(value))
        }
        return number.boolValue
    }

    static func optionalBool(_ bag: [String: Any], _ key: String) throws -> Bool? {
        guard let value = bag[key], !(value is NSNull) else { return nil }
        guard let number = value as? NSNumber, isBoolean(number) else {
            throw CodecError.wrongType(key: key, expected: "a boolean", got: describe(value))
        }
        return number.boolValue
    }

    static func int(_ bag: [String: Any], _ key: String, default fallback: Int) throws -> Int {
        guard let value = bag[key], !(value is NSNull) else { return fallback }
        guard let number = value as? NSNumber, !isBoolean(number) else {
            throw CodecError.wrongType(key: key, expected: "a number", got: describe(value))
        }
        return number.intValue
    }

    /// Purpose ids in both web shapes: a flat list (all required) or a list of
    /// groups (any group sufficient). `nil` when absent or empty, so the SDK
    /// applies its own documented defaults — an empty list could be read as "no
    /// purposes required", which would grant consent the CMP never gave.
    static func purposeIds(_ bag: [String: Any], _ key: String) throws -> [NSNumber]? {
        guard let value = bag[key], !(value is NSNull) else { return nil }
        guard let array = value as? [Any] else {
            throw CodecError.wrongType(key: key, expected: "an array", got: describe(value))
        }
        if array.isEmpty { return nil }
        var flattened: [NSNumber] = []
        for element in array {
            if let number = element as? NSNumber, !isBoolean(number) {
                flattened.append(number)
            } else if element is [Any] {
                // Groups used to be FLATTENED here — [[1,3,4],[1,5,6]] ("either group")
                // became [1,3,4,1,5,6] ("all of them"), a stricter rule than asked for,
                // applied silently. No SDK takes groups as an option; refuse them.
                throw CodecError.wrongType(
                    key: key, expected: "a flat array of purpose ids (purpose groups are not an option)",
                    got: describe(element)
                )
            } else {
                throw CodecError.wrongType(
                    key: key, expected: "integers", got: describe(element)
                )
            }
        }
        return flattened
    }

    static func stringArray(_ value: Any?) throws -> [String]? {
        guard let value, !(value is NSNull) else { return nil }
        guard let array = value as? [Any] else {
            throw CodecError.wrongType(key: "keys", expected: "an array", got: describe(value))
        }
        var out: [String] = []
        for (index, element) in array.enumerated() {
            guard let string = element as? String else {
                throw CodecError.wrongType(
                    key: "keys[\(index)]", expected: "a string", got: describe(element)
                )
            }
            out.append(string)
        }
        return out
    }

    /// Identity values must be strings — never `String(describing:)`d.
    ///
    /// A number stringified to `"12345"` would be hashed and shipped, matching
    /// nothing downstream, with no error anywhere. The JS layer rejects this
    /// first; this is the backstop for a caller reaching the module directly.
    static func identities(_ value: Any?) throws -> [String: String] {
        let bag = decodeDictionary(value)
        var out: [String: String] = [:]
        for (key, element) in bag {
            if element is NSNull { continue } // absent = not set, as on the web
            guard let string = element as? String else {
                throw CodecError.identityNotAString(key: key, got: describe(element))
            }
            out[key] = string
        }
        return out
    }

    static func describe(_ value: Any?) -> String {
        switch value {
        case .none, is NSNull: return "null"
        case let number as NSNumber: return isBoolean(number) ? "a boolean" : "a number"
        case is String: return "a string"
        case is [Any]: return "an array"
        case is [String: Any]: return "an object"
        default: return String(describing: type(of: value))
        }
    }
}

require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
# The native SDK version is read from ONE file, shared with android/build.gradle,
# so a bump cannot be applied to one platform only. Dev and CI builds substitute
# the local source instead (`pod 'ZeotapSDK', :path => '../../../ios'` in the
# example's Podfile), which is what makes a monorepo change testable before it is
# ever published.
native_versions = JSON.parse(File.read(File.join(__dir__, "NATIVE_VERSIONS.json")))

Pod::Spec.new do |s|
  s.name         = "ZeotapReactNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/zeotap/zeotap-pulse-rn"
  s.license      = { :type => "MIT", :file => "LICENSE" }
  s.authors      = "Zeotap"
  s.platforms    = { :ios => "14.0" } # matches ZeotapSDK's floor
  s.source       = { :git => "https://github.com/zeotap/zeotap-pulse-rn.git", :tag => "v#{s.version}" }

  # Objective-C++ bridge + Swift impl + Swift codec. Tests are excluded here and
  # attached to the test_spec below, so a consuming app never compiles them.
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.exclude_files = "ios/Tests/**/*"

  s.swift_version = "5.9"

  # The SDK doing the actual work. A pessimistic constraint on the pinned version:
  # a patch release of the native SDK is a bug fix the bridge should pick up, but
  # a minor could move the contract this bridge is written against.
  # The ObjC subspec, not the bare pod: ZeotapSDK's default subspec is Core only, and the
  # bridge calls the @objc wrappers (ZTAnalytics / ZTConfiguration) the ObjC subspec adds.
  # Depending on "ZeotapSDK" left them out, so the first CocoaPods build of the bridge failed.
  s.dependency "ZeotapSDK/ObjC", "~> #{native_versions['ios']}"

  # `install_modules_dependencies` wires React-Core, the codegen'd spec pod and
  # the new-architecture flags in one call, and is version-aware — doing it by
  # hand is how a library ends up working on one RN version only.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency "React-Core"
  end

  s.test_spec "Tests" do |test_spec|
    test_spec.source_files = "ios/Tests/**/*.{swift}"
    # `pod lib lint --platforms=ios` runs these; they cover the codec and the
    # argument-validation paths that need no configured SDK.
  end
end

#!/usr/bin/env bash
# Proves the native SDK versions NATIVE_VERSIONS.json pins are PUBLISHED: that
# com.zeotap.sdk:android-sdk:<v> resolves on Maven Central and ZeotapSDK <v> on
# CocoaPods. Exits non-zero, naming the missing one, otherwise.
#
# This is the most likely way to break customers. A bridge published against a
# native version that does not exist installs as a BROKEN PACKAGE FOR EVERY
# CONSUMER: their `pod install` or Gradle resolve fails and the app cannot
# build. npm versions cannot be replaced, so it cannot be fixed in place.
# Matching versions in the source tree (the monorepo's native-versions test)
# says nothing about whether they are out yet; only the registries do.
#
# Read-only HTTPS against the registries' documented URLs. Run by the monorepo
# release train (.github/workflows/sdk-release-rn.yml) before it exports, and by
# the public repository's publish workflow immediately before `npm publish`.
set -euo pipefail
cd "$(dirname "$0")/.."

android_v="$(node -p 'require("./NATIVE_VERSIONS.json").android')"
ios_v="$(node -p 'require("./NATIVE_VERSIONS.json").ios')"
echo "[natives] NATIVE_VERSIONS.json pins android=$android_v ios=$ios_v"

broken() {
  local msg="$1
Publish the natives FIRST (tag sdk-android-v$android_v and sdk-ios-v$ios_v in the
monorepo, wait for them to appear), then release this bridge."
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    while IFS= read -r line; do echo "::error::$line"; done <<<"$msg"
  else
    echo "[natives] FAIL: $msg" >&2
  fi
  exit 1
}

# Maven Central. The POM is the canonical per-version descriptor and the file
# Gradle fetches first, so its presence is exactly what "resolvable" means.
maven_url="https://repo1.maven.org/maven2/com/zeotap/sdk/android-sdk/$android_v/android-sdk-$android_v.pom"
echo "[natives] HEAD $maven_url"
curl -fsSL --retry 3 --retry-delay 10 --max-time 60 -o /dev/null -I "$maven_url" \
  || broken "com.zeotap.sdk:android-sdk:$android_v is NOT on Maven Central ($maven_url)."
echo "[natives]   ✓ com.zeotap.sdk:android-sdk:$android_v"

# CocoaPods. The CDN is what `pod install` reads. Specs are sharded by the first
# three hex characters of the MD5 of the POD NAME (not the version).
#
# `-L` is REQUIRED: cdn.cocoapods.org 301s every spec request to
# cdn.jsdelivr.net. Without it curl takes the 3xx as success, and the check
# passes for versions that do not exist.
pod_name=ZeotapSDK
if command -v md5sum >/dev/null; then md5="$(printf '%s' "$pod_name" | md5sum | cut -c1-3)"
else md5="$(printf '%s' "$pod_name" | md5 -q | cut -c1-3)"; fi
cdn_url="https://cdn.cocoapods.org/Specs/${md5:0:1}/${md5:1:1}/${md5:2:1}/$pod_name/$ios_v/$pod_name.podspec.json"
echo "[natives] HEAD $cdn_url"
if curl -fsSL --retry 3 --retry-delay 10 --max-time 60 -o /dev/null -I "$cdn_url"; then
  echo "[natives]   ✓ pod $pod_name $ios_v (CDN)"
  exit 0
fi

# A freshly pushed version can lag on the CDN by a few minutes while trunk
# already knows it. Trunk's API is the authority, so a CDN miss is only fatal
# if trunk has not heard of the version either.
echo "[natives]   CDN miss — asking trunk directly"
trunk_url="https://trunk.cocoapods.org/api/v1/pods/$pod_name"
versions="$(curl -fsSL --retry 3 --retry-delay 10 --max-time 60 "$trunk_url" || true)"
if printf '%s' "$versions" | node -e '
  const want = process.argv[1];
  let body = "";
  process.stdin.on("data", (c) => (body += c));
  process.stdin.on("end", () => {
    let pod;
    try { pod = JSON.parse(body); } catch { process.exit(1); }
    process.exit((pod.versions || []).some((v) => v.name === want) ? 0 : 1);
  });
' "$ios_v"; then
  echo "[natives]   ✓ pod $pod_name $ios_v (trunk; the CDN is still catching up —"
  echo "[natives]     a consumer may need \`pod repo update\` for a few minutes)"
else
  broken "pod $pod_name $ios_v is on neither the CocoaPods CDN ($cdn_url) nor trunk ($trunk_url)."
fi

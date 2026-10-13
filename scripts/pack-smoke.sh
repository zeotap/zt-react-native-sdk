#!/usr/bin/env bash
# Proves the PUBLISHED artefact is usable — not just the working tree.
#
# The failure this exists to catch: `files` in package.json is a hand-maintained
# allowlist, and a published package missing `android/`, `ios/` or
# `NATIVE_VERSIONS.json` is broken for every consumer while the repository looks
# perfectly fine. `npm pack` is the only way to see what actually ships.
set -euo pipefail

cd "$(dirname "$0")/.."
PACKAGE_ROOT="$PWD"

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v npm  >/dev/null || { echo "npm is required" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[pack-smoke] building the tarball"
npm pack --pack-destination "$WORK" >/dev/null
TARBALL="$(find "$WORK" -name '*.tgz' -maxdepth 1 | head -1)"
[[ -n "$TARBALL" ]] || { echo "npm pack produced no tarball" >&2; exit 1; }
echo "[pack-smoke] $(basename "$TARBALL")"

echo "[pack-smoke] checking the tarball's contents"
CONTENTS="$(tar -tzf "$TARBALL")"
MISSING=()
# Each of these is load-bearing for a consumer: src for Metro, lib for a
# bundler that prefers the built output, android/ios for autolinking, and
# NATIVE_VERSIONS.json for the two native dependency declarations.
for required in \
  "package/src/index.ts" \
  "package/src/NativeZeotap.ts" \
  "package/NATIVE_VERSIONS.json" \
  "package/ZeotapReactNative.podspec" \
  "package/app.plugin.js" \
  "package/android/build.gradle" \
  "package/android/src/main/java/com/zeotap/reactnative/ZeotapModuleImpl.kt" \
  "package/ios/Zeotap.mm" \
  "package/ios/ZeotapImpl.swift" \
; do
  grep -qx "$required" <<<"$CONTENTS" || MISSING+=("$required")
done

# The reverse check: the JS and Kotlin tests must NOT ship. The JS ones import
# jest and would be compiled by a consumer's bundler; the Kotlin ones pull junit
# and robolectric onto a consumer's Gradle classpath.
#
# `ios/Tests` is the deliberate exception and must stay: the podspec declares a
# `test_spec` over it, and `pod lib lint` — a release gate — resolves that spec
# from wherever the pod is installed. A tarball without them turns that gate into
# a warning about missing files.
LEAKED=()
while IFS= read -r entry; do
  LEAKED+=("$entry")
done < <(grep -E "package/(src/__tests__|android/src/test)/" <<<"$CONTENTS" || true)

if (( ${#MISSING[@]} > 0 )); then
  echo "[pack-smoke] FAIL — the tarball is missing:" >&2
  printf '  %s\n' "${MISSING[@]}" >&2
  echo "Fix the \"files\" array in package.json." >&2
  exit 1
fi
if (( ${#LEAKED[@]} > 0 )); then
  echo "[pack-smoke] FAIL — tests leaked into the tarball:" >&2
  printf '  %s\n' "${LEAKED[@]}" >&2
  exit 1
fi
echo "[pack-smoke] contents OK"

echo "[pack-smoke] installing into a throwaway app"
APP="$WORK/consumer"
mkdir -p "$APP"
cd "$APP"
cat > package.json <<'PKG'
{
  "name": "zeotap-pack-smoke",
  "private": true,
  "version": "0.0.0"
}
PKG
# The peers are what a real RN app already has; installed here so the types the
# package's .d.ts references actually resolve.
npm install --silent --no-audit --no-fund \
  react@18.3.1 react-native@0.76.5 typescript@5.9.3 @types/react@18.3.12 >/dev/null
npm install --silent --no-audit --no-fund "$TARBALL" >/dev/null

cat > consumer.ts <<'TS'
// Exercises the public surface a customer actually touches, so a broken export
// map or a missing .d.ts fails here rather than in their app.
import Zeotap, {
  ZeotapConsentError,
  type ZeotapOptions,
  type ConsentState,
} from '@zeotap/react-native-sdk';

const options: ZeotapOptions = { apiHost: 'https://ingest.example', flushAt: 10 };

export async function main(): Promise<ConsentState> {
  await Zeotap.configure('wk_test', options);
  await Zeotap.track('Sample Track', { count: 1 });
  await Zeotap.setUserIdentities({ email: 'a@b.com' });
  try {
    await Zeotap.flush();
  } catch (error) {
    if (error instanceof ZeotapConsentError) throw error;
  }
  return Zeotap.getConsentState();
}
TS
cat > tsconfig.json <<'TSCONFIG'
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "bundler",
    "module": "esnext",
    "target": "esnext",
    "jsx": "react-jsx",
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["consumer.ts"]
}
TSCONFIG

echo "[pack-smoke] typechecking the consumer"
npx tsc --noEmit -p tsconfig.json

echo "[pack-smoke] checking the codegen spec is discoverable"
# An app's codegen reads `codegenConfig` from every installed package; without it
# the TurboModule spec is never generated and the module resolves as undefined
# on the new architecture.
node -e "
const pkg = require('@zeotap/react-native-sdk/package.json');
const config = pkg.codegenConfig;
if (!config || config.name !== 'RNZeotapSpec') {
  throw new Error('codegenConfig missing or renamed: ' + JSON.stringify(config));
}
if (config.jsSrcsDir !== 'src') {
  throw new Error('codegenConfig.jsSrcsDir must point at the shipped spec');
}
console.log('[pack-smoke] codegenConfig OK (' + config.name + ')');
"

echo "[pack-smoke] OK"

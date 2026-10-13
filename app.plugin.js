/**
 * Expo config plugin.
 *
 * Plain JavaScript, and a single file, on purpose: an Expo plugin is `require`d
 * by the prebuild CLI straight from the installed package, so a TypeScript
 * plugin would need its own build output in `files` and a stale `lib/` would
 * break prebuild in a way that is very hard to diagnose. There is little enough
 * here that types buy nothing.
 *
 * What it does NOT do: install the SDK. Autolinking already finds the native
 * module. This only writes the two things Expo owns and a developer cannot
 * otherwise set — the ATT usage description and the minSdk floor.
 *
 * Expo Go cannot load this package at all (it ships a fixed set of native
 * modules), so the plugin says so once, loudly, rather than letting the app fail
 * at the first `configure()` with a linking error.
 *
 *   // app.json
 *   { "expo": { "plugins": [["@zeotap/react-native-sdk", {
 *       "iosUserTrackingUsageDescription": "We use your data to personalise ads."
 *   }]] } }
 */
const { withInfoPlist, withGradleProperties, createRunOncePlugin } = require('@expo/config-plugins');

const pkg = require('./package.json');

/** The SDK's floor, mirroring sdk/android/build.gradle.kts. */
const MIN_SDK_VERSION = 23;

function withZeotap(config, props = {}) {
  const { iosUserTrackingUsageDescription } = props;

  // Only when the host actually intends to collect the IDFA: adding the key
  // unconditionally makes App Review ask about tracking an app does not do.
  if (iosUserTrackingUsageDescription) {
    config = withInfoPlist(config, cfg => {
      cfg.modResults.NSUserTrackingUsageDescription = iosUserTrackingUsageDescription;
      return cfg;
    });
  }

  config = withGradleProperties(config, cfg => {
    const existing = cfg.modResults.find(
      item => item.type === 'property' && item.key === 'android.minSdkVersion',
    );
    // Raise, never lower: an app that already targets a higher floor keeps it.
    if (!existing || Number(existing.value) < MIN_SDK_VERSION) {
      cfg.modResults = cfg.modResults.filter(
        item => !(item.type === 'property' && item.key === 'android.minSdkVersion'),
      );
      cfg.modResults.push({
        type: 'property',
        key: 'android.minSdkVersion',
        value: String(MIN_SDK_VERSION),
      });
    }
    return cfg;
  });

  return config;
}

module.exports = createRunOncePlugin(withZeotap, pkg.name, pkg.version);

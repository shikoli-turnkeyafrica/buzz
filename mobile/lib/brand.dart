// mobile/lib/brand.dart
/// Single source of brand identity for the mobile client.
///
/// Native config (Gradle, AndroidManifest, Info.plist, xcconfig, pubspec) cannot
/// import Dart, so it pins the same literals; `test/brand_config_test.dart`
/// proves they agree. Change a value here and the test tells you every native
/// file that must follow.
///
/// Mirrors `desktop/src/brand.ts`.
library;

const productName = 'Cybercare Commons';
const productShort = 'Commons';
const vendor = 'Cybota';

/// URL scheme for app deep links: `cybercare://message?…`.
const deepLinkScheme = 'cybercare';

/// First-party theme pair. These names travel over the relay in the
/// community-theme preference and MUST match desktop's `THEME_NAMES`.
const themeName = 'cybercare';
const themeDarkName = 'cybercare-dark';

/// Android `applicationId` and iOS `BUNDLE_IDENTIFIER`. Same value as the
/// desktop `APP_IDENTIFIER` so the three clients read as one product.
const androidApplicationId = 'africa.cybota.cybercare.commons';
const iosBundleIdentifier = 'africa.cybota.cybercare.commons';

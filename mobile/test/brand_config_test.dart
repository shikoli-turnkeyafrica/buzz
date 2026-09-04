// mobile/test/brand_config_test.dart
import 'dart:io';

import 'package:buzz/brand.dart' as brand;
import 'package:flutter_test/flutter_test.dart';

String _read(String path) => File(path).readAsStringSync();

void main() {
  test('build.gradle.kts pins the brand applicationId and label', () {
    final gradle = _read('android/app/build.gradle.kts');
    expect(gradle, contains('applicationId = "${brand.androidApplicationId}"'));
    expect(
      gradle,
      contains('resValue("string", "app_name", "${brand.productName}")'),
    );
    expect(
      gradle,
      contains('resValue("string", "app_name", "${brand.productShort} (\$worktreeLabel)")'),
    );
  });

  test('AndroidManifest registers only the brand deep-link scheme', () {
    final manifest = _read('android/app/src/main/AndroidManifest.xml');
    expect(manifest, contains('android:scheme="${brand.deepLinkScheme}"'));
    expect(manifest, isNot(contains('android:scheme="buzz"')));
  });

  test('iOS xcconfigs pin the brand bundle identifier and display name', () {
    for (final file in ['ios/Flutter/Release.xcconfig', 'ios/Flutter/Debug.xcconfig']) {
      final xc = _read(file);
      expect(xc, contains('BUNDLE_IDENTIFIER = ${brand.iosBundleIdentifier}'), reason: file);
      expect(xc, contains('APP_DISPLAY_NAME = ${brand.productName}'), reason: file);
    }
  });

  test('Info.plist pins the brand name and URL scheme', () {
    final plist = _read('ios/Runner/Info.plist');
    expect(plist, contains('<string>${brand.productName}</string>'));
    expect(plist, contains('<string>${brand.deepLinkScheme}</string>'));
    expect(plist, contains('<string>${brand.iosBundleIdentifier}.deeplink</string>'));
    expect(plist, isNot(contains('<string>buzz</string>')));
    expect(plist, isNot(contains('Buzz')));
  });

  test('pubspec description names the product', () {
    final pubspec = _read('pubspec.yaml');
    expect(pubspec, contains('description: ${brand.productName} mobile client'));
    // The Dart package name is an identifier, not brand copy — it stays.
    expect(pubspec, contains('name: buzz\n'));
  });
}

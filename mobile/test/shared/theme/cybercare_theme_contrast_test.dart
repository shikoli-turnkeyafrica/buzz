import 'dart:math' as math;

import 'package:buzz/brand.dart' as brand;
import 'package:buzz/shared/theme/buzz_theme.dart';
import 'package:buzz/shared/theme/theme_catalog.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

double _channel(double c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055).pow(2.4);

double _luminance(Color c) =>
    0.2126 * _channel(c.r) + 0.7152 * _channel(c.g) + 0.0722 * _channel(c.b);

/// WCAG contrast ratio of [fg] composited over [bg] at [fg]'s alpha.
double contrast(Color fg, Color bg) {
  final a = fg.a;
  final blended = Color.from(
    alpha: 1,
    red: fg.r * a + bg.r * (1 - a),
    green: fg.g * a + bg.g * (1 - a),
    blue: fg.b * a + bg.b * (1 - a),
  );
  final l1 = _luminance(blended);
  final l2 = _luminance(bg);
  final hi = l1 > l2 ? l1 : l2;
  final lo = l1 > l2 ? l2 : l1;
  return (hi + 0.05) / (lo + 0.05);
}

extension on double {
  double pow(double e) => math.pow(this, e).toDouble();
}

void main() {
  test('catalog carries the Cybercare pair under the brand names', () {
    expect(findTheme(brand.themeName), isNotNull);
    expect(findTheme(brand.themeDarkName), isNotNull);
    // Pre-rebrand names stored on upgraded phones resolve to the pair.
    expect(findTheme('buzz')?.name, brand.themeName);
    expect(findTheme('buzz-dark')?.name, brand.themeDarkName);
    expect(cybercareThemeName, brand.themeName);
    expect(cybercareDarkThemeName, brand.themeDarkName);
  });

  test('body text meets AA on both grounds', () {
    final light = findTheme(brand.themeName)!;
    final dark = findTheme(brand.themeDarkName)!;
    expect(contrast(light.fg, light.bg), greaterThanOrEqualTo(4.5));
    expect(contrast(light.comment, light.bg), greaterThanOrEqualTo(4.5));
    expect(contrast(dark.fg, dark.bg), greaterThanOrEqualTo(4.5));
    expect(contrast(dark.comment, dark.bg), greaterThanOrEqualTo(4.5));
  });

  test('top-section chrome is legible on the navy in BOTH brightnesses', () {
    // Desktop paints a flat navy sidebar and uses white-alpha chrome text on it
    // in light AND dark mode. Black-on-navy (the old light-mode rule) is 1.5:1.
    for (final brightness in Brightness.values) {
      final gradient = cybercareTopSectionGradient(
        brand.themeName,
        brightness,
      )!;
      for (final stop in gradient.colors) {
        expect(
          contrast(topSectionPrimaryForeground(brightness), stop),
          greaterThanOrEqualTo(4.5),
          reason: '$brightness primary on $stop',
        );
        expect(
          contrast(topSectionSecondaryForeground(brightness), stop),
          greaterThanOrEqualTo(3.0),
          reason: '$brightness secondary on $stop',
        );
      }
    }
  });
}

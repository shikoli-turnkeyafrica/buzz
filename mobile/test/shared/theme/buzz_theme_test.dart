import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/shared/theme/theme.dart';
import 'package:buzz/shared/widgets/frosted_app_bar.dart';

void main() {
  group('Cybercare theme catalog entries', () {
    test('both halves are in the catalog', () {
      expect(findTheme(cybercareThemeName), isNotNull);
      expect(findTheme(cybercareDarkThemeName), isNotNull);
    });

    test('carry the Cybota palette', () {
      final light = findTheme(cybercareThemeName)!;
      expect(light.bg, const Color(0xFFFAFAFA));
      expect(light.fg, const Color(0xFF1A2857));
      expect(light.comment, const Color(0xFF6B6B6B));

      final dark = findTheme(cybercareDarkThemeName)!;
      expect(dark.bg, const Color(0xFF161925));
      expect(dark.fg, const Color(0xFFE9ECEF));
      expect(dark.comment, const Color(0xFF99A2B8));
    });

    test('are a light/dark pair', () {
      expect(findTheme(cybercareThemeName)!.isDark, isFalse);
      expect(findTheme(cybercareDarkThemeName)!.isDark, isTrue);
      expect(themePairFor(cybercareThemeName), cybercareDarkThemeName);
      expect(themePairFor(cybercareDarkThemeName), cybercareThemeName);
    });

    test('appear as a single System-mode option labelled "Cybercare"', () {
      final paired = themeGroups().paired.map((t) => t.name);
      expect(paired, contains(cybercareThemeName));
      expect(paired, isNot(contains(cybercareDarkThemeName)));
      expect(pairedThemeLabel(cybercareThemeName), 'Cybercare');
      expect(
        themeSelectionLabel(cybercareThemeName, ThemeMode.system),
        'Cybercare',
      );
      expect(
        themeSelectionLabel(cybercareDarkThemeName, ThemeMode.system),
        'Cybercare',
      );
    });

    test('forces neutral rendering without changing the stored accent', () {
      const storedAccent = '#ef4444';

      expect(
        effectiveAccentIndex(cybercareThemeName, storedAccent),
        neutralAccentIndex,
      );
      expect(
        effectiveAccentIndex(cybercareDarkThemeName, storedAccent),
        neutralAccentIndex,
      );
      expect(
        effectiveAccentIndex('github-light', storedAccent),
        accentIndexForWireValue(storedAccent),
      );
      expect(storedAccent, '#ef4444');
    });

    test('resolve across brightnesses like any other pair', () {
      final resolved = resolveSchemes(cybercareThemeName, ThemeMode.system);
      expect(resolved.forcedMode, isNull);
      expect(resolved.light.brightness, Brightness.light);
      expect(resolved.dark.brightness, Brightness.dark);
      expect(resolved.lightTheme?.name, cybercareThemeName);
      expect(resolved.darkTheme?.name, cybercareDarkThemeName);

      expect(
        effectiveTheme(cybercareThemeName, ThemeMode.dark)?.name,
        cybercareDarkThemeName,
      );
      expect(
        effectiveTheme(cybercareDarkThemeName, ThemeMode.light)?.name,
        cybercareThemeName,
      );
    });

    test(
      'fallbacks expose the effective Cybercare theme for gradient selection',
      () {
        final coerced = resolveSchemes('nord', ThemeMode.light);
        expect(coerced.lightTheme?.name, cybercareThemeName);
        expect(
          cybercareTopSectionGradient(
            coerced.lightTheme!.name,
            coerced.light.brightness,
          ),
          isNotNull,
        );

        final unknown = resolveSchemes('not-a-theme', ThemeMode.light);
        expect(unknown.lightTheme?.name, cybercareThemeName);
        expect(
          cybercareTopSectionGradient(
            unknown.lightTheme!.name,
            unknown.light.brightness,
          ),
          isNotNull,
        );
      },
    );
  });

  group('cybercareTopSectionGradient', () {
    test('is null for non-Cybercare themes', () {
      expect(
        cybercareTopSectionGradient('github-light', Brightness.light),
        isNull,
      );
      expect(cybercareTopSectionGradient('nord', Brightness.dark), isNull);
    });

    test('paints top to bottom for both halves of the pair', () {
      for (final name in [cybercareThemeName, cybercareDarkThemeName]) {
        final gradient = cybercareTopSectionGradient(name, Brightness.light);
        expect(gradient, isNotNull, reason: '$name should be gradient-backed');
        expect(gradient!.begin, Alignment.topCenter);
        expect(gradient.end, Alignment.bottomCenter);
        expect(gradient.colors, hasLength(2));
      }
    });

    test('brightness selects the stops, not the theme name', () {
      // Both halves enable the gradient, so System mode keeps it on across an
      // OS switch — the applied brightness alone decides which stops are used.
      final light = cybercareTopSectionGradient(
        cybercareThemeName,
        Brightness.light,
      )!;
      final dark = cybercareTopSectionGradient(
        cybercareThemeName,
        Brightness.dark,
      )!;

      expect(light.colors, isNot(dark.colors));
      expect(
        cybercareTopSectionGradient(
          cybercareDarkThemeName,
          Brightness.dark,
        )!.colors,
        dark.colors,
      );
      expect(
        cybercareTopSectionGradient(
          cybercareDarkThemeName,
          Brightness.light,
        )!.colors,
        light.colors,
      );
    });

    test('is flat: top and bottom stops are the same navy', () {
      for (final brightness in Brightness.values) {
        final gradient = cybercareTopSectionGradient(
          cybercareThemeName,
          brightness,
        )!;
        expect(gradient.colors[0], gradient.colors[1]);
      }
    });

    test('is opaque so the color replaces the frosted fill', () {
      for (final brightness in Brightness.values) {
        final gradient = cybercareTopSectionGradient(
          cybercareThemeName,
          brightness,
        )!;
        for (final color in gradient.colors) {
          expect(color.a, 1.0);
        }
      }
    });
  });

  group('theme threading', () {
    BoxDecoration barDecoration(WidgetTester tester) {
      final container = tester
          .widgetList<Container>(
            find.descendant(
              of: find.byType(FrostedAppBar),
              matching: find.byType(Container),
            ),
          )
          .first;
      return container.decoration! as BoxDecoration;
    }

    Widget harness(ThemeData theme) => MaterialApp(
      theme: theme,
      home: Builder(
        builder: (context) => Stack(
          children: [
            FrostedAppBar(
              gradient: context.appColors.topSectionGradient,
              title: const Text('Home'),
            ),
          ],
        ),
      ),
    );

    testWidgets('AppTheme carries the gradient to the top section', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          AppTheme.light(
            topSectionGradient: cybercareTopSectionGradient(
              cybercareThemeName,
              Brightness.light,
            ),
          ),
        ),
      );

      final decoration = barDecoration(tester);
      expect(decoration.gradient, isNotNull);
      // A BoxDecoration cannot paint a color and a gradient at once.
      expect(decoration.color, isNull);
    });

    testWidgets('non-Cybercare themes keep the frosted surface fill', (
      tester,
    ) async {
      await tester.pumpWidget(harness(AppTheme.light()));

      final decoration = barDecoration(tester);
      expect(decoration.gradient, isNull);
      expect(decoration.color, isNotNull);
    });

    testWidgets('Cybercare section labels use 80% white foreground', (
      tester,
    ) async {
      await tester.pumpWidget(
        harness(
          AppTheme.light(
            topSectionGradient: cybercareTopSectionGradient(
              cybercareThemeName,
              Brightness.light,
            ),
          ),
        ),
      );

      final context = tester.element(find.text('Home'));
      expect(
        navigationSectionForeground(context),
        Colors.white.withValues(alpha: 0.8),
      );
    });

    testWidgets('navigation roles inherit non-Cybercare theme tokens', (
      tester,
    ) async {
      const primaryForeground = Color(0xFF123456);
      const secondaryForeground = Color(0xFF789ABC);
      const searchSurface = Color(0xFFDEF012);
      final theme = ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.purple).copyWith(
          onSurface: primaryForeground,
          onSurfaceVariant: secondaryForeground,
          surfaceContainerHighest: searchSurface,
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          home: const Scaffold(body: SizedBox()),
        ),
      );

      final context = tester.element(find.byType(SizedBox));
      expect(navigationPrimaryForeground(context), primaryForeground);
      expect(navigationSecondaryForeground(context), secondaryForeground);
      expect(navigationSectionForeground(context), secondaryForeground);
      expect(navigationSearchSurface(context), searchSurface);
      expect(
        navigationDivider(context, 0.15),
        primaryForeground.withValues(alpha: 0.15),
      );
    });
  });

  group('isCybercareTheme', () {
    test('matches only the Cybercare pair', () {
      expect(isCybercareTheme(cybercareThemeName), isTrue);
      expect(isCybercareTheme(cybercareDarkThemeName), isTrue);
      expect(isCybercareTheme('github-light'), isFalse);
      expect(isCybercareTheme(''), isFalse);
    });
  });
}

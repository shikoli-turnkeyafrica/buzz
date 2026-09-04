import 'package:flutter/material.dart';

import 'package:buzz/brand.dart' as brand;

import 'accent_colors.dart';
import 'app_colors.dart';

/// Name of the first-party Cybercare theme. Its base colors are the Cybota
/// palette (`theme_catalog.dart`); what sets it apart is the flat navy painted
/// across the app's top section, mirroring desktop's sidebar canvas
/// (`--buzz-gradient-light-top/bottom` in `desktop/src/shared/styles/globals/theme.css`).
const cybercareThemeName = brand.themeName;

/// Name of the dark counterpart. Paired with [cybercareThemeName] in
/// `themePairs`, so the two behave as a single "Cybercare" choice under
/// System mode.
const cybercareDarkThemeName = brand.themeDarkName;

/// Whether [themeName] is either half of the Cybercare pair. Both halves
/// enable the top section treatment so System mode keeps it on across an OS
/// light/dark switch.
bool isCybercareTheme(String themeName) =>
    themeName == cybercareThemeName || themeName == cybercareDarkThemeName;

/// Whether the current widget tree is using the first-party Cybercare
/// treatment.
bool isCybercareThemeContext(BuildContext context) =>
    Theme.of(context).extension<AppColors>()?.topSectionGradient != null;

/// Primary foreground for the flat navy top section, pure function of
/// [brightness] so it can be computed without a [BuildContext].
///
/// White in both brightnesses: the navy top section is dark even under the
/// light theme. Alpha values copied from desktop `--buzz-chrome-foreground`.
Color topSectionPrimaryForeground(Brightness brightness) =>
    Colors.white.withValues(alpha: brightness == Brightness.dark ? 0.50 : 0.75);

/// Secondary/placeholder foreground for the flat navy top section.
Color topSectionSecondaryForeground(Brightness brightness) =>
    Colors.white.withValues(alpha: brightness == Brightness.dark ? 0.40 : 0.55);

/// Primary foreground for the mobile top navigation.
///
/// Every theme uses its own [ColorScheme.onSurface]. Cybercare is the
/// exception: its flat navy top section needs a fixed white foreground
/// rather than the accent-derived color scheme foreground.
Color navigationPrimaryForeground(BuildContext context) {
  final scheme = Theme.of(context).colorScheme;
  if (!isCybercareThemeContext(context)) return scheme.onSurface;
  return topSectionPrimaryForeground(scheme.brightness);
}

/// Secondary label and placeholder foreground for the mobile top navigation.
Color navigationSecondaryForeground(BuildContext context) {
  final scheme = Theme.of(context).colorScheme;
  if (!isCybercareThemeContext(context)) return scheme.onSurfaceVariant;
  return topSectionSecondaryForeground(scheme.brightness);
}

/// Channel-section label and icon foreground for the mobile side navigation.
///
/// Section labels need more hierarchy than a placeholder. Cybercare therefore
/// uses a stronger white over its navy, while all other themes preserve their
/// established secondary foreground token.
Color navigationSectionForeground(BuildContext context) {
  final scheme = Theme.of(context).colorScheme;
  if (!isCybercareThemeContext(context)) return scheme.onSurfaceVariant;
  return Colors.white.withValues(alpha: 0.8);
}

/// Search-field surface for the mobile top navigation.
Color navigationSearchSurface(BuildContext context) {
  final scheme = Theme.of(context).colorScheme;
  if (!isCybercareThemeContext(context)) return scheme.surfaceContainerHighest;
  return Colors.white.withValues(
    alpha: scheme.brightness == Brightness.dark ? 0.04 : 0.08,
  );
}

/// A low-contrast navigation divider derived from the active theme foreground.
Color navigationDivider(BuildContext context, double opacity) =>
    navigationPrimaryForeground(context).withValues(alpha: opacity);

/// Cybercare renders with its fixed neutral foreground while preserving the
/// stored wire accent so the user's choice returns on another theme.
int effectiveAccentIndex(String themeName, String storedAccent) {
  if (isCybercareTheme(themeName)) return neutralAccentIndex;
  return accentIndexForWireValue(storedAccent) ?? defaultAccentIndex;
}

/// Gradient stops, matching desktop's `--buzz-gradient-*` custom properties.
/// Flat: top == bottom, so the section paints as a solid navy fill rather
/// than an actual gradient.
const _lightTop = Color(0xFF1A2857);
const _lightBottom = Color(0xFF1A2857);
const _darkTop = Color(0xFF161925);
const _darkBottom = Color(0xFF161925);

/// The Cybercare top-section fill, or null when [themeName] is not a
/// Cybercare theme — in which case the section keeps its default frosted
/// fill.
///
/// The stops are fully opaque: under Cybercare the color replaces the
/// frosted treatment rather than tinting it, matching desktop's solid
/// sidebar canvas.
///
/// [brightness] comes from the applied color scheme rather than the theme
/// name, so System mode picks the right stops as the OS switches.
LinearGradient? cybercareTopSectionGradient(
  String themeName,
  Brightness brightness,
) {
  if (!isCybercareTheme(themeName)) return null;

  final isDark = brightness == Brightness.dark;
  return LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [
      isDark ? _darkTop : _lightTop,
      isDark ? _darkBottom : _lightBottom,
    ],
  );
}

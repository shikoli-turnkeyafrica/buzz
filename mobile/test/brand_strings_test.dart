// mobile/test/brand_strings_test.dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Lines allowed to say "Buzz": code identifiers, storage keys, the Dart
/// package, upstream references. Anything else is user-facing copy that must
/// go through brand.dart.
final _allowed = <RegExp>[
  RegExp(r'package:buzz/'),
  RegExp(r"'buzz_[a-z_]+'"), // storage / prefs keys (legacy underscore form)
  RegExp(r'\bBuzz[A-Z]\w*'), // class names: BuzzLoadingIndicator …
  RegExp(r'\bbuzz[A-Z]\w*'), // identifiers: buzzLink, isBuzzUrl …
  RegExp(r'\bis[A-Z]\w*Buzz\w*'), // isBuzzThemeContext-style helpers
  RegExp(r"'buzz://'"), // Task 4 legacy pairing prefix literal
  // Explicit upstream references, case-insensitive so a sentence-leading
  // "Upstream Buzz ..." / "Pre-rebrand ..." still matches (Ruling P4).
  RegExp(r'upstream Buzz|block/buzz|pre-rebrand', caseSensitive: false),
  RegExp(r'--buzz-|data-buzz-'), // desktop CSS hook names in comments
  // Ruling P4: Task 5's _legacyThemeAliases in theme_catalog.dart normalises
  // legacy stored/relayed theme names ('buzz', 'buzz-dark') to the current
  // theme names at the catalog boundary — these are data values read off the
  // wire / SharedPreferences, not copy.
  RegExp(r"'buzz(-dark)?':\s*'cybercare"),
  // Platform channel / native view-type identifiers must match the
  // Kotlin/Swift channel-name string literals verbatim — never renamed per
  // the "never rename Kotlin/Swift symbols" constraint.
  RegExp(r"'buzz/[\w/]*"),
  // Storage keys, SharedPreferences prefixes, and Nostr addressable-event
  // d-tags persisted to disk or exchanged with the relay/desktop — never
  // renamed, or existing local data and cross-client sync silently break.
  // Requires a '.' or ':' marker so this doesn't also swallow plain
  // dash-only internal identifiers with no persistence/interop stake (see
  // the temp-file-prefix entry below).
  RegExp(r"'buzz[\w.\-]*[.:]"),
  // 'buzz-video-'/'buzz-compose-' are internal temp-capture filename
  // prefixes (video_viewer.dart, camera_capture_cleanup.dart). Unlike
  // message_actions.dart's download/share filename (now 'commons-', since
  // that name reaches the user's gallery and the system share sheet),
  // these never surface a name to the user — they're cleaned up
  // internally. Renaming them is safe, just not required.
  RegExp(r"'buzz-(video|compose)-"),
  // Widget-test ValueKeys where "buzz" isn't the leading token of the
  // literal (e.g. 'composer-buzz-link-chip:$label') — internal test ids.
  RegExp(r"ValueKey\('[\w:$-]*buzz[\w:$-]*'\)"),
  // '#buzz-anim=' is the animated-avatar URL fragment tag shared with the
  // desktop client (see animated_avatar.dart) — a wire-format tag, not copy.
  RegExp(r'buzz-anim='),
  // Blossom media-auth event `content` values (BUD-01 get/upload auth)
  // mirror desktop's identical convention; not user-facing, not brand copy.
  RegExp(r"'(Get|Upload) buzz-media'"),
  // transcript_builder.dart matches a section-header prefix emitted by the
  // backend agent-prompt payload (out of this client's control) — not copy
  // this client renders; the fallback title it produces does go through
  // brand.dart.
  RegExp(r"'buzz event'"),
];

void main() {
  test('no user-facing "Buzz" remains in lib/', () {
    final offenders = <String>[];
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      final lines = entity.readAsLinesSync();
      // Line-scoped: each line is checked independently, so a multi-line
      // string literal is still caught line by line. The only blind spot is
      // a single line that both says "Buzz" and matches an `_allowed` regex
      // — which is why every `_allowed` entry above must be narrow and
      // commented with why it's safe.
      for (var i = 0; i < lines.length; i++) {
        final line = lines[i];
        if (!RegExp(r'\bbuzz\b', caseSensitive: false).hasMatch(line)) continue;
        if (_allowed.any((re) => re.hasMatch(line))) continue;
        offenders.add('${entity.path}:${i + 1}: ${line.trim()}');
      }
    }
    expect(offenders, isEmpty, reason: offenders.join('\n'));
  });
}

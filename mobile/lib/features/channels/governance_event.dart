import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../../shared/relay/relay.dart';

enum GovernanceVerdict { approve, reject }

/// A signed governance act in a governed room (kinds 46200–46204).
///
/// Mirrors `parseGovernancePayload` / `describeGovernanceEvent` in
/// `desktop/src/features/messages/components/GovernanceEventRow.tsx`.
@immutable
class GovernanceEvent {
  final int kind;
  final GovernanceVerdict? verdict;
  final String? position;

  /// Free-text reason the author signed with the ruling.
  final String? note;

  /// What the ruling is about, when it concerns an off-relay record
  /// (e.g. a piece of Cybercare evidence).
  final String? subjectName;
  final String? subjectReference;

  const GovernanceEvent({
    required this.kind,
    this.verdict,
    this.position,
    this.note,
    this.subjectName,
    this.subjectReference,
  });

  static bool isGovernanceKind(int kind) =>
      EventKind.governanceKinds.contains(kind);

  /// Parses a governance event. Returns null for other kinds. Unreadable
  /// content still yields a row (the act was signed; only detail is lost).
  static GovernanceEvent? fromEvent(NostrEvent event) {
    if (!isGovernanceKind(event.kind)) return null;

    Map<dynamic, dynamic> json = const {};
    try {
      final decoded = jsonDecode(event.content);
      if (decoded is Map) json = decoded;
    } catch (_) {}

    final subject = json['subject'];
    return GovernanceEvent(
      kind: event.kind,
      verdict: switch (json['action']) {
        'APPROVE' => GovernanceVerdict.approve,
        'REJECT' => GovernanceVerdict.reject,
        _ => null,
      },
      position: _string(json['position']),
      note: _string(json['note']),
      subjectName: subject is Map ? _string(subject['name']) : null,
      subjectReference: subject is Map ? _string(subject['reference']) : null,
    );
  }

  /// The action line under the author's name, e.g. "APPROVED" or
  /// "staged proposal for review".
  String get actionLabel => switch (kind) {
    EventKind.governanceDigest => 'published governance digest',
    EventKind.governanceStaged => 'staged proposal for review',
    EventKind.governanceAdvice =>
      position != null ? 'advised: $position' : 'provided advice',
    EventKind.governanceRatification => switch (verdict) {
      GovernanceVerdict.approve => 'APPROVED',
      GovernanceVerdict.reject => 'REJECTED',
      null => 'ratified',
    },
    EventKind.governanceDissent => 'dissented',
    _ => 'signed a governance act',
  };
}

String? _string(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

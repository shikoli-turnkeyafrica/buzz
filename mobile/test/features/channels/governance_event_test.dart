import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:buzz/features/channels/governance_event.dart';
import 'package:buzz/features/channels/timeline_message.dart';
import 'package:buzz/shared/relay/relay.dart';

NostrEvent _governance({
  required String id,
  int kind = EventKind.governanceRatification,
  String content = '',
}) => NostrEvent(
  id: id,
  pubkey: 'owner',
  createdAt: 1000,
  kind: kind,
  tags: const [
    ['h', 'ch1'],
  ],
  content: content,
  sig: '',
);

void main() {
  group('GovernanceEvent.fromEvent', () {
    test('reads an evidence ruling as the desktop panel signs it', () {
      final event = GovernanceEvent.fromEvent(
        _governance(
          id: 'r1',
          content: jsonEncode({
            'action': 'APPROVE',
            'position': 'Accepted',
            'note': ' Policy signed by the board ',
            'subject': {
              'type': 'cybercare.evidence',
              'name': 'Access control policy',
              'reference': 'EV-0042',
            },
          }),
        ),
      )!;
      expect(event.verdict, GovernanceVerdict.approve);
      expect(event.actionLabel, 'APPROVED');
      expect(event.note, 'Policy signed by the board');
      expect(event.subjectName, 'Access control policy');
      expect(event.subjectReference, 'EV-0042');
    });

    test('reject and unreadable content still describe the act', () {
      expect(
        GovernanceEvent.fromEvent(
          _governance(id: 'r2', content: '{"action":"REJECT"}'),
        )!.actionLabel,
        'REJECTED',
      );
      final junk = GovernanceEvent.fromEvent(
        _governance(id: 'r3', content: 'not json'),
      )!;
      expect(junk.actionLabel, 'signed off');
      expect(junk.subjectName, isNull);
    });

    test('labels the other governance kinds like desktop', () {
      String label(int kind, [String content = '{}']) =>
          GovernanceEvent.fromEvent(
            _governance(id: 'k$kind', kind: kind, content: content),
          )!.actionLabel;
      expect(label(EventKind.governanceDigest), 'published governance digest');
      expect(label(EventKind.governanceStaged), 'staged proposal for review');
      expect(label(EventKind.governanceAdvice), 'provided advice');
      expect(
        label(EventKind.governanceAdvice, '{"position":"hold"}'),
        'advised: hold',
      );
      expect(label(EventKind.governanceDissent), 'dissented');
    });

    test('ignores other kinds', () {
      expect(
        GovernanceEvent.fromEvent(
          _governance(id: 'm', kind: EventKind.streamMessage),
        ),
        isNull,
      );
    });
  });

  test('formatTimeline keeps governance acts as read-only rows', () {
    final result = formatTimeline([
      _governance(id: 'g1', content: '{"action":"APPROVE"}'),
    ]);
    expect(result, hasLength(1));
    expect(result.single.isSystem, isTrue);
    expect(result.single.governance?.verdict, GovernanceVerdict.approve);
  });

  test('governed kinds are fetched and subscribed', () {
    for (final kind in EventKind.governanceKinds) {
      expect(EventKind.channelTimelineContentKinds, contains(kind));
      expect(EventKind.channelEventKinds, contains(kind));
    }
  });
}

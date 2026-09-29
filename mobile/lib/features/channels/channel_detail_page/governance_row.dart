part of '../channel_detail_page.dart';

/// A signed governance act (kinds 46200–46204) in the timeline: who signed,
/// the verdict, what it was about and the note they signed with. Read-only;
/// long-press offers reactions only.
///
/// Mirrors `GovernanceEventRow` on desktop.
class _GovernanceRow extends HookConsumerWidget {
  final TimelineMessage message;
  final String channelId;
  final String? currentPubkey;
  final bool isMember;
  final bool isArchived;

  const _GovernanceRow({
    required this.message,
    required this.channelId,
    this.currentPubkey,
    this.isMember = false,
    this.isArchived = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final spotlightKey = useMemoized(() => GlobalKey());
    final governance = message.governance;
    if (governance == null) return const SizedBox.shrink();

    final userCache = ref.watch(userCacheProvider);
    String resolveLabel(String? pubkey) {
      if (pubkey == null) return 'Someone';
      final profile =
          userCache[pubkey.toLowerCase()] ??
          ref.read(userCacheProvider.notifier).get(pubkey.toLowerCase());
      return profile?.label ?? shortPubkey(pubkey);
    }

    void openReactionPopover(Rect anchorRect) {
      final spotlightRenderObject = spotlightKey.currentContext
          ?.findRenderObject();
      final spotlightRect =
          spotlightRenderObject is RenderBox && spotlightRenderObject.hasSize
          ? spotlightRenderObject.localToGlobal(Offset.zero) &
                spotlightRenderObject.size
          : anchorRect;
      showMessageActions(
        context: context,
        ref: ref,
        message: message,
        channelId: channelId,
        canManageMessage: false,
        allMessages: null,
        currentPubkey: currentPubkey,
        isMember: isMember,
        isArchived: isArchived,
        anchorRect: spotlightRect,
        popoverSpotlightPadding: EdgeInsets.fromLTRB(
          Grid.xxs,
          Grid.xxs,
          Grid.xxs,
          message.reactions.isEmpty ? Grid.xxs : Grid.quarter,
        ),
      );
    }

    final base = _systemActionTextStyle(context);
    final verdictColor = switch (governance.verdict) {
      GovernanceVerdict.approve => context.appColors.success,
      GovernanceVerdict.reject => context.colors.error,
      null => null,
    };
    final actionSpans = <InlineSpan>[
      TextSpan(
        text: governance.actionLabel,
        style: verdictColor == null
            ? null
            : TextStyle(color: verdictColor, fontWeight: FontWeight.w700),
      ),
      if (governance.subjectName != null) ...[
        TextSpan(
          text: '\n${governance.subjectName}',
          style: TextStyle(color: context.colors.onSurface),
        ),
        if (governance.subjectReference != null)
          TextSpan(text: ' · ${governance.subjectReference}'),
      ],
      if (governance.note != null)
        TextSpan(
          text: '\n“${governance.note}”',
          style: base?.copyWith(fontStyle: FontStyle.italic),
        ),
    ];

    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(Radii.md),
      clipBehavior: Clip.antiAlias,
      child: MessageLongPressInkWell(
        key: ValueKey('governance-row-${message.id}'),
        onLongPress: openReactionPopover,
        borderRadius: BorderRadius.circular(Radii.md),
        highlightColor: context.colors.primary.withValues(alpha: 0.1),
        child: Padding(
          padding: const EdgeInsets.only(top: Grid.xs),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              KeyedSubtree(
                key: spotlightKey,
                child: _MessageStyleSystemMessageContent(
                  displayPubkey: message.pubkey,
                  createdAt: message.createdAt,
                  resolveLabel: resolveLabel,
                  userCache: userCache,
                  actionSpans: actionSpans,
                ),
              ),
              if (message.reactions.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(
                    left: messageAvatarSize + messageAvatarContentGap,
                  ),
                  child: ReactionRow(
                    messageId: message.id,
                    reactions: message.reactions,
                    onToggle: (emoji) => toggleReaction(ref, message, emoji),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

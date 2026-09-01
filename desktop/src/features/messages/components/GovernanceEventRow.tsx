import * as React from "react";

import type { TimelineMessage } from "@/features/messages/types";
import { MessageReactions } from "@/features/messages/ui/MessageReactions";
import { useReactionHandler } from "@/features/messages/ui/useReactionHandler";
import {
  formatOwnerLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  KIND_CYBOTA_DIGEST,
  KIND_CYBOTA_STAGED,
  KIND_CYBOTA_ADVICE,
  KIND_CYBOTA_RATIFICATION,
  KIND_CYBOTA_DISSENT,
} from "@/shared/constants/kinds";
import { MESSAGE_MARKDOWN_CLASS } from "@/shared/ui/mentionChip";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { MessageAgentOwner } from "../ui/MessageAgentOwner";
import {
  MessageAuthorText,
  MessageHeaderRow,
  MessageMetaSeparator,
} from "../ui/MessageHeader";
import { MessageTimestamp } from "../ui/MessageTimestamp";

type GovernanceEventPayload = {
  kind: number;
  actor?: string;
  action?: "APPROVE" | "REJECT";
  position?: string;
  refs?: string[];
  verified: boolean;
};

type ProfileNameProps = {
  pubkey?: string;
  children: React.ReactNode;
  highlight?: boolean;
  underlineOnHover?: boolean;
  isAgent?: boolean;
};

function ProfileName({
  pubkey,
  children,
  highlight,
  underlineOnHover,
  isAgent,
}: ProfileNameProps) {
  if (!pubkey) return <>{children}</>;

  return (
    <UserProfilePopover pubkey={pubkey}>
      <button
        className={cn(
          "inline-flex items-center gap-1 rounded px-0.5 -mx-0.5 transition-colors",
          highlight && "bg-accent/50 hover:bg-accent",
          underlineOnHover && "hover:underline",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
        type="button"
      >
        <span className={cn("font-medium", isAgent && "italic")}>
          {children}
        </span>
      </button>
    </UserProfilePopover>
  );
}

function parseGovernancePayload(message: TimelineMessage): GovernanceEventPayload | null {
  try {
    // TimelineMessage.body contains the content, not .content
    const content = message.body ? JSON.parse(message.body) : {};
    return {
      kind: message.kind ?? 0,
      actor: message.pubkey,
      action: content.action,
      position: content.position,
      refs: content.refs || [],
      verified: true, // Timeline messages are already verified
    };
  } catch {
    return {
      kind: message.kind ?? 0,
      actor: message.pubkey,
      verified: true,
    };
  }
}

function describeGovernanceEvent(
  payload: GovernanceEventPayload,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
): { title: React.ReactNode; action: React.ReactNode; variant: "default" | "advice" | "ratification" | "dissent" } | null {
  const actorLabel = resolveUserLabel({
    pubkey: payload.actor ?? "",
    currentPubkey,
    profiles,
  });
  const actorName = (
    <ProfileName pubkey={payload.actor}>{actorLabel}</ProfileName>
  );

  switch (payload.kind) {
    case KIND_CYBOTA_DIGEST:
      return {
        title: actorName,
        action: "published governance digest",
        variant: "default",
      };

    case KIND_CYBOTA_STAGED:
      return {
        title: actorName,
        action: "staged proposal for review",
        variant: "default",
      };

    case KIND_CYBOTA_ADVICE:
      return {
        title: actorName,
        action: payload.position ? (
          <>advised: {payload.position}</>
        ) : (
          "provided advice"
        ),
        variant: "advice",
      };

    case KIND_CYBOTA_RATIFICATION:
      return {
        title: actorName,
        action: payload.action ? (
          <span className={cn(
            "font-semibold",
            payload.action === "APPROVE" ? "text-green-600 dark:text-green-500" : "text-red-600 dark:text-red-500"
          )}>
            {payload.action === "APPROVE" ? "APPROVED" : "REJECTED"}
          </span>
        ) : (
          "ratified"
        ),
        variant: "ratification",
      };

    case KIND_CYBOTA_DISSENT:
      return {
        title: actorName,
        action: "dissented",
        variant: "dissent",
      };

    default:
      return null;
  }
}

function TimelineLink({ eventId }: { eventId: string }) {
  return (
    <a
      href={`#${eventId}`}
      className="text-xs text-primary hover:underline"
      onClick={(e) => {
        e.preventDefault();
        // Scroll to event in timeline - placeholder for actual navigation
        console.log("Navigate to event:", eventId);
      }}
    >
      ref:{eventId.slice(0, 8)}
    </a>
  );
}

export const GovernanceEventRow = React.memo(function GovernanceEventRow({
  message,
  currentPubkey,
  agentPubkeys,
  profiles,
  ownerProfiles,
  onToggleReaction,
}: {
  message: TimelineMessage;
  currentPubkey?: string;
  agentPubkeys?: ReadonlySet<string>;
  profiles?: UserProfileLookup;
  ownerProfiles?: UserProfileLookup;
  onToggleReaction?: (
    message: TimelineMessage,
    emoji: string,
    remove: boolean,
  ) => Promise<void>;
}) {
  const payload = parseGovernancePayload(message);
  if (!payload) return null;

  const description = describeGovernanceEvent(payload, currentPubkey, profiles);
  if (!description) return null;

  const actorProfile = payload.actor
    ? profiles?.[normalizePubkey(payload.actor)]
    : undefined;
  const isAgent = Boolean(
    actorProfile?.isAgent ||
      message.isAgent ||
      (payload.actor && agentPubkeys?.has(normalizePubkey(payload.actor)))
  );
  const ownerPubkey = actorProfile?.ownerPubkey ?? null;
  const ownerLabel = formatOwnerLabel(ownerPubkey, currentPubkey, ownerProfiles);

  const {
    reactions,
    canToggle: canToggleReactions,
    pending: reactionPending,
    errorMessage: reactionErrorMessage,
    select: handleReactionSelect,
  } = useReactionHandler(message, onToggleReaction);

  const reactionsContent = reactions.length > 0 && (
    <div>
      <MessageReactions
        messageId={message.id}
        reactions={reactions}
        canToggle={canToggleReactions}
        pending={reactionPending}
        className="mt-0.5 pt-0.5"
        onSelect={(emoji) => {
          void handleReactionSelect(emoji);
        }}
      />
      {reactionErrorMessage ? (
        <p className="mt-1.5 text-xs text-destructive">
          {reactionErrorMessage}
        </p>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "group/message relative mx-1 rounded-2xl px-2 py-1 transition-colors hover:bg-muted/50 focus-within:bg-muted/50"
      )}
      data-testid="governance-event-row"
    >
      <div className="flex items-start gap-2.5">
        <UserAvatar
          avatarUrl={message.avatarUrl ?? null}
          displayName={message.author}
          size="md"
        />
        <div
          className={cn(
            MESSAGE_MARKDOWN_CLASS,
            "flex min-w-0 flex-1 flex-col gap-0.5"
          )}
        >
          <MessageHeaderRow>
            <MessageAuthorText as="div" className="text-foreground">
              {description.title}
            </MessageAuthorText>
            {isAgent ? (
              <>
                <MessageAgentOwner
                  ownerLabel={ownerLabel}
                  ownerPubkey={ownerPubkey}
                />
                <span className="inline-flex min-w-0 items-baseline gap-x-1.5">
                  <MessageMetaSeparator />
                  <MessageTimestamp createdAt={message.createdAt} />
                </span>
              </>
            ) : (
              <MessageTimestamp createdAt={message.createdAt} />
            )}
          </MessageHeaderRow>
          <p className="-mt-0.5 text-sm leading-snug text-foreground">
            {description.action}
          </p>
          {!payload.verified && (
            <p className="text-xs text-muted-foreground italic">
              unverified
            </p>
          )}
          {payload.refs && payload.refs.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {payload.refs.map((ref) => (
                <TimelineLink key={ref} eventId={ref} />
              ))}
            </div>
          )}
          {reactionsContent}
        </div>
      </div>
    </div>
  );
});

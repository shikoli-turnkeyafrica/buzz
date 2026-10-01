import * as React from "react";
import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  type CybercareActionOutcome,
  recordCybercareDecision,
} from "../cybercareApi";
import {
  buildProposalDecision,
  type Proposal,
  type ProposalDecision,
} from "../proposal";

function errorText(reason: unknown) {
  const text =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Something went wrong.";
  // The relay's refusal for anyone who is not an approver in this channel.
  return /restricted:/i.test(text)
    ? "Only approvers can sign off in this channel."
    : text;
}

type Outcome =
  | { state: "idle" }
  | { state: "signing" }
  | { state: "recording"; decisionId: string; approve: boolean }
  | {
      state: "done";
      decisionId: string;
      approve: boolean;
      cybercare: CybercareActionOutcome[] | null;
      cybercareError?: string;
    }
  | { state: "failed"; message: string };

/**
 * An agent's proposal in the timeline: what it asks for, and, for anyone
 * but its author, Approve and sign / Reject and sign. The signature is the
 * decision; for remediation actions, Cybercare then records which decision
 * opened (or cancelled) them.
 */
export function ProposalCard({
  proposalId,
  channelId,
  proposal,
  decision,
  deciderLabel,
  isAuthor,
}: {
  proposalId: string;
  channelId: string | null;
  proposal: Proposal;
  decision: ProposalDecision | undefined;
  deciderLabel: string | null;
  isAuthor: boolean;
}) {
  const { activeCommunity } = useCommunities();
  const [choice, setChoice] = React.useState<"approve" | "reject" | null>(null);
  const [note, setNote] = React.useState("");
  const [outcome, setOutcome] = React.useState<Outcome>({ state: "idle" });

  const recordInCybercare = async (decisionId: string, approve: boolean) => {
    const config = activeCommunity?.cybercare;
    if (proposal.actionIds.length === 0 || !config || !activeCommunity) {
      setOutcome({ state: "done", decisionId, approve, cybercare: null });
      return;
    }
    setOutcome({ state: "recording", decisionId, approve });
    try {
      const results = await recordCybercareDecision({
        communityId: activeCommunity.id,
        config,
        orgId: proposal.orgId ?? proposal.subject?.orgId,
        actionIds: proposal.actionIds,
        decisionEventId: decisionId,
        approve,
      });
      setOutcome({ state: "done", decisionId, approve, cybercare: results });
    } catch (reason) {
      setOutcome({
        state: "done",
        decisionId,
        approve,
        cybercare: null,
        cybercareError: errorText(reason),
      });
    }
  };

  const handleSign = async () => {
    if (!choice || !channelId) return;
    const approve = choice === "approve";
    setOutcome({ state: "signing" });
    try {
      const unsigned = buildProposalDecision({
        channelId,
        proposalId,
        proposal,
        approve,
        note,
      });
      await relayClient.preconnect();
      const event = await signRelayEvent(unsigned);
      await relayClient.publishEvent(
        event,
        "Timed out posting the decision to this channel.",
        "Couldn't post the decision to this channel.",
      );
      setChoice(null);
      await recordInCybercare(event.id, approve);
    } catch (reason) {
      setOutcome({ state: "failed", message: errorText(reason) });
    }
  };

  const busy = outcome.state === "signing" || outcome.state === "recording";

  return (
    <div
      className="mt-1 space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3"
      data-testid="proposal-card"
    >
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-foreground">
          {proposal.title}
        </p>
        {proposal.summary ? (
          <p className="text-sm text-muted-foreground">{proposal.summary}</p>
        ) : null}
      </div>
      {proposal.items.length > 0 ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground">
          {proposal.items.map((item) => (
            <li key={`${item.label}-${item.actionId ?? ""}`}>
              {item.label}
              {item.owner || item.due ? (
                <span className="text-muted-foreground">
                  {item.owner ? ` · ${item.owner}` : ""}
                  {item.due ? ` · due ${item.due}` : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {decision ? (
        <p
          className={cn(
            "flex items-center gap-1.5 text-sm font-semibold",
            decision.approve
              ? "text-green-700 dark:text-green-500"
              : "text-red-700 dark:text-red-500",
          )}
          data-testid="proposal-decided"
        >
          {decision.approve ? (
            <Check aria-hidden className="h-4 w-4" />
          ) : (
            <X aria-hidden className="h-4 w-4" />
          )}
          {decision.approve ? "Approved" : "Rejected"}
          {deciderLabel ? ` by ${deciderLabel}` : ""}
        </p>
      ) : isAuthor ? (
        <p className="text-xs text-muted-foreground">
          Waiting for an approver to sign off.
        </p>
      ) : choice ? (
        <div className="space-y-2">
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Note for the record{" "}
            <span className="font-normal">
              (optional, included in your signed decision)
            </span>
            <textarea
              className="min-h-14 w-full rounded-lg border border-input/60 bg-background px-2 py-1.5 text-sm text-foreground"
              disabled={busy}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why you decided this"
              value={note}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              className={
                choice === "approve"
                  ? "bg-[#d6322b] text-white hover:bg-[#b82620]"
                  : undefined
              }
              data-testid="proposal-sign"
              disabled={busy}
              onClick={() => void handleSign()}
              size="sm"
              type="button"
              variant={choice === "reject" ? "destructive" : undefined}
            >
              {busy ? (
                <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
              ) : null}
              {choice === "approve" ? "Approve and sign" : "Reject and sign"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => setChoice(null)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : outcome.state === "idle" || outcome.state === "failed" ? (
        <div className="flex items-center gap-2">
          <Button
            data-testid="proposal-approve"
            disabled={!channelId}
            onClick={() => setChoice("approve")}
            size="sm"
            type="button"
          >
            Approve…
          </Button>
          <Button
            data-testid="proposal-reject"
            disabled={!channelId}
            onClick={() => setChoice("reject")}
            size="sm"
            type="button"
            variant="outline"
          >
            Reject…
          </Button>
        </div>
      ) : null}

      {outcome.state === "failed" ? (
        <p className="text-xs text-destructive" role="alert">
          {outcome.message}
        </p>
      ) : null}
      {outcome.state === "recording" ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
          Recording the decision in Cybercare…
        </p>
      ) : null}
      {outcome.state === "done" ? (
        <CybercareResult
          approve={outcome.approve}
          error={outcome.cybercareError}
          onRetry={() =>
            void recordInCybercare(outcome.decisionId, outcome.approve)
          }
          results={outcome.cybercare}
        />
      ) : null}
    </div>
  );
}

function CybercareResult({
  approve,
  results,
  error,
  onRetry,
}: {
  approve: boolean;
  results: CybercareActionOutcome[] | null;
  error?: string;
  onRetry: () => void;
}) {
  if (!results && !error) return null;
  const failed = results?.filter((r) => !r.ok) ?? [];
  const done = (results?.length ?? 0) - failed.length;
  const verb = approve ? "opened" : "cancelled";
  return (
    <div className="space-y-1 text-xs" data-testid="proposal-cybercare">
      {done > 0 ? (
        <p className="flex items-center gap-1.5 text-green-700 dark:text-green-500">
          <Check aria-hidden className="h-3.5 w-3.5" />
          Cybercare {verb} {done} action{done === 1 ? "" : "s"}.
        </p>
      ) : null}
      {error || failed.length > 0 ? (
        <div className="space-y-1">
          <p className="flex gap-1.5 text-amber-700 dark:text-amber-400">
            <TriangleAlert
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
            />
            {error ??
              `Cybercare didn't record ${failed.length} action${failed.length === 1 ? "" : "s"}: ${failed[0]?.message ?? "no reason given"}`}{" "}
            Your signed decision stands.
          </p>
          <Button onClick={onRetry} size="sm" type="button" variant="outline">
            Try Cybercare again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

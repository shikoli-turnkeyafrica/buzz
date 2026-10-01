import * as React from "react";
import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  type CybercareActionOutcome,
  type CybercareConfig,
  getCybercareActionStates,
  recordCybercareDecision,
} from "../cybercareApi";
import {
  buildProposalDecision,
  type Proposal,
  type ProposalDecision,
  signingProblem,
} from "../proposal";
import { readRoomBinding } from "../roomBinding";

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

type SignedEvent = Awaited<ReturnType<typeof signRelayEvent>>;

type Outcome =
  | { state: "idle" }
  | { state: "signing" }
  // Signed but not confirmed by the relay: a retry re-sends THIS event, never
  // a new signature, so a timeout can't produce two different decisions.
  | { state: "unsent"; event: SignedEvent; approve: boolean; message: string }
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
 * An agent's proposal in the timeline. Anyone but its author gets Approve… /
 * Reject…, but only when what the card shows is exactly what a decision
 * would change in Cybercare (see `signingProblem`). The signature is the
 * decision; Cybercare then records which decision opened or cancelled the
 * actions, scoped to the organisation of this channel's assessment.
 */
export function ProposalCard({
  proposalId,
  channelId,
  proposal,
  decision,
  deciderLabel,
  isAuthor,
  isDecider,
}: {
  proposalId: string;
  channelId: string | null;
  proposal: Proposal;
  decision: ProposalDecision | undefined;
  deciderLabel: string | null;
  isAuthor: boolean;
  /** The signed-in key made the decision shown. */
  isDecider: boolean;
}) {
  const { activeCommunity } = useCommunities();
  const config = activeCommunity?.cybercare;
  const communityId = activeCommunity?.id ?? null;
  const boundOrgId =
    communityId && channelId
      ? (readRoomBinding(communityId, channelId)?.orgId ?? null)
      : null;
  const problem = signingProblem(proposal, boundOrgId);
  const [choice, setChoice] = React.useState<"approve" | "reject" | null>(null);
  const [note, setNote] = React.useState("");
  const [outcome, setOutcome] = React.useState<Outcome>({ state: "idle" });

  const recordInCybercare = async (decisionId: string, approve: boolean) => {
    if (proposal.actionIds.length === 0) {
      setOutcome({ state: "done", decisionId, approve, cybercare: null });
      return;
    }
    if (!config || !communityId || !boundOrgId) {
      setOutcome({
        state: "done",
        decisionId,
        approve,
        cybercare: null,
        cybercareError:
          "Cybercare isn't connected for this channel, so the actions weren't changed there.",
      });
      return;
    }
    setOutcome({ state: "recording", decisionId, approve });
    try {
      const results = await recordCybercareDecision({
        communityId,
        config,
        orgId: boundOrgId,
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

  const publish = async (event: SignedEvent, approve: boolean) => {
    try {
      await relayClient.preconnect();
      await relayClient.publishEvent(
        event,
        "Timed out posting the decision to this channel.",
        "Couldn't post the decision to this channel.",
      );
    } catch (reason) {
      setOutcome({
        state: "unsent",
        event,
        approve,
        message: errorText(reason),
      });
      return;
    }
    setChoice(null);
    await recordInCybercare(event.id, approve);
  };

  const handleSign = async () => {
    if (!choice || !channelId || problem) return;
    const approve = choice === "approve";
    setOutcome({ state: "signing" });
    let event: SignedEvent;
    try {
      event = await signRelayEvent(
        buildProposalDecision({
          channelId,
          proposalId,
          proposal,
          approve,
          note,
        }),
      );
    } catch (reason) {
      setOutcome({ state: "failed", message: errorText(reason) });
      return;
    }
    await publish(event, approve);
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
      {proposal.actionIds.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Signing changes {proposal.actionIds.length} remediation action
          {proposal.actionIds.length === 1 ? "" : "s"} in Cybercare.
        </p>
      ) : null}

      {decision ? (
        <>
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
          {isDecider &&
          outcome.state === "idle" &&
          proposal.actionIds.length > 0 ? (
            <CybercareCheck
              actionIds={proposal.actionIds}
              approve={decision.approve}
              communityId={communityId}
              config={config}
              onRecord={() =>
                void recordInCybercare(decision.eventId, decision.approve)
              }
              orgId={boundOrgId}
            />
          ) : null}
        </>
      ) : isAuthor ? (
        <p className="text-xs text-muted-foreground">
          Waiting for an approver to sign off.
        </p>
      ) : problem ? (
        <p
          className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400"
          data-testid="proposal-problem"
        >
          <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {problem}
        </p>
      ) : outcome.state === "unsent" ? (
        <div className="space-y-1" role="alert">
          <p className="text-xs text-destructive">
            {outcome.message} Your decision is signed but not yet in the
            channel.
          </p>
          <Button
            onClick={() => void publish(outcome.event, outcome.approve)}
            size="sm"
            type="button"
            variant="outline"
          >
            Send it again
          </Button>
        </div>
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
            aria-label={`Approve: ${proposal.title}`}
            data-testid="proposal-approve"
            disabled={!channelId}
            onClick={() => setChoice("approve")}
            size="sm"
            type="button"
          >
            Approve…
          </Button>
          <Button
            aria-label={`Reject: ${proposal.title}`}
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
      <div aria-live="polite" role="status">
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
    </div>
  );
}

/**
 * For the person who decided: whether Cybercare has caught up with the
 * signed decision (it may not have, if the app closed before it answered),
 * with a way to record it again. Read-only until they click.
 */
function CybercareCheck({
  actionIds,
  approve,
  communityId,
  config,
  orgId,
  onRecord,
}: {
  actionIds: string[];
  approve: boolean;
  communityId: string | null;
  config: CybercareConfig | undefined;
  orgId: string | null;
  onRecord: () => void;
}) {
  const [waiting, setWaiting] = React.useState<number | null>(null);
  const idsKey = actionIds.join(",");
  React.useEffect(() => {
    if (!config || !communityId || !orgId) return;
    let cancelled = false;
    getCybercareActionStates({
      communityId,
      config,
      orgId,
      actionIds: idsKey.split(","),
    })
      .then((states) => {
        if (cancelled) return;
        setWaiting(
          states.filter((s) => s.status === "pending_approval").length,
        );
      })
      .catch(() => !cancelled && setWaiting(null));
    return () => {
      cancelled = true;
    };
  }, [communityId, config, orgId, idsKey]);

  if (!config || !orgId) {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-400">
        Cybercare isn't connected for this channel, so these actions can't be
        checked here.
      </p>
    );
  }
  if (!waiting) return null;
  return (
    <div className="space-y-1 text-xs" data-testid="proposal-cybercare-behind">
      <p className="flex gap-1.5 text-amber-700 dark:text-amber-400">
        <TriangleAlert aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {waiting} action{waiting === 1 ? " is" : "s are"} still waiting in
        Cybercare for this decision.
      </p>
      <Button onClick={onRecord} size="sm" type="button" variant="outline">
        {approve ? "Open them in Cybercare" : "Cancel them in Cybercare"}
      </Button>
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

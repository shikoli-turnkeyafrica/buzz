import * as React from "react";
import { Check, Clock, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import {
  type CybercareConfig,
  type CybercareGraphEvidence,
  reviewCybercareGraphEvidence,
} from "../cybercareApi";
import { buildGraphEvidenceDecision, fileStatusLabel } from "../graphEvidence";

type SignedEvent = Awaited<ReturnType<typeof signRelayEvent>>;

type Step =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; detail: string }
  | { state: "failed"; detail: string };

function errorText(reason: unknown) {
  const text =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : "Something went wrong.";
  return /restricted:/i.test(text)
    ? "Only approvers can sign off in this channel."
    : text;
}

function StepLine({
  step,
  label,
  idle,
}: {
  step: Step;
  label: string;
  idle: string;
}) {
  const icon =
    step.state === "done" ? (
      <Check
        aria-hidden
        className="h-4 w-4 text-green-700 dark:text-green-500"
      />
    ) : step.state === "failed" ? (
      <X aria-hidden className="h-4 w-4 text-destructive" />
    ) : step.state === "pending" ? (
      <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" />
    ) : (
      <Clock aria-hidden className="h-4 w-4 text-muted-foreground" />
    );
  const detail =
    step.state === "done" || step.state === "failed" ? step.detail : idle;
  return (
    <div className="flex gap-2 px-3 py-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span
        className={cn("text-xs", step.state === "failed" && "text-destructive")}
      >
        <span className="font-semibold">{label}</span> · {detail}
      </span>
    </div>
  );
}

/**
 * Review one item of the organisation's evidence of record. The decision is
 * signed on this device first but not posted; Cybercare records it citing
 * that signature; only then is it posted to the channel. If Cybercare
 * refuses, the signed decision is discarded and the channel never sees it. A
 * failed post is retried with the same signed event.
 */
export function GraphEvidenceReviewForm({
  channelId,
  communityId,
  config,
  orgId,
  evidence,
  keyLinked,
  onReviewed,
}: {
  channelId: string;
  communityId: string;
  config: CybercareConfig;
  orgId: string;
  evidence: CybercareGraphEvidence;
  keyLinked: boolean | null;
  onReviewed: () => void;
}) {
  const [choice, setChoice] = React.useState<"approve" | "reject" | null>(null);
  const [note, setNote] = React.useState("");
  const [saved, setSaved] = React.useState<Step>({ state: "idle" });
  const [posted, setPosted] = React.useState<Step>({ state: "idle" });
  const [unsent, setUnsent] = React.useState<SignedEvent | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: switching to another item resets the form; the id is the trigger, not an input
  React.useEffect(() => {
    setChoice(null);
    setNote("");
    setSaved({ state: "idle" });
    setPosted({ state: "idle" });
    setUnsent(null);
  }, [evidence.evidenceId]);

  const busy = saved.state === "pending" || posted.state === "pending";
  const started = saved.state !== "idle";

  const post = async (event: SignedEvent) => {
    setPosted({ state: "pending" });
    try {
      await relayClient.preconnect();
      await relayClient.publishEvent(
        event,
        "Timed out posting the decision to this channel.",
        "Couldn't post the decision to this channel.",
      );
      setUnsent(null);
      setPosted({ state: "done", detail: "posted to this channel" });
    } catch (reason) {
      setUnsent(event);
      setPosted({
        state: "failed",
        detail: `${errorText(reason)} Cybercare has the review; send it again to put it in this channel.`,
      });
    }
    onReviewed();
  };

  const handleSign = async () => {
    if (!choice) return;
    const approve = choice === "approve";
    setSaved({ state: "pending" });
    let event: SignedEvent;
    try {
      event = await signRelayEvent(
        buildGraphEvidenceDecision({
          channelId,
          orgId,
          evidence,
          approve,
          note,
        }),
      );
    } catch (reason) {
      setSaved({ state: "failed", detail: errorText(reason) });
      return;
    }
    try {
      const recorded = await reviewCybercareGraphEvidence({
        communityId,
        config,
        orgId,
        evidenceId: evidence.evidenceId,
        approve,
        commonsEventId: event.id,
        rationale: note.trim(),
      });
      setSaved({
        state: "done",
        detail: `${recorded.decision === "rejected" ? "Rejected" : "Approved"} · by ${recorded.approver ?? "you"}`,
      });
    } catch (reason) {
      setSaved({ state: "failed", detail: errorText(reason) });
      setPosted({ state: "failed", detail: "nothing was posted" });
      return;
    }
    await post(event);
  };

  return (
    <div className="space-y-3" data-testid="graph-evidence-review">
      <div className="space-y-1">
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Review · {evidence.evidenceCode}
        </div>
        <p className="text-sm font-medium text-foreground">{evidence.title}</p>
        {evidence.controls.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Supports{" "}
            {evidence.controls
              .map((c) => `${c.controlCode} ${c.name}`)
              .join(", ")}
          </p>
        ) : null}
        <p
          className="text-xs text-muted-foreground"
          data-testid="graph-evidence-file"
        >
          {fileStatusLabel(evidence)}
        </p>
        {evidence.review ? (
          <p className="text-xs text-muted-foreground">
            Last review: {evidence.review.decision}
            {evidence.review.approver ? ` by ${evidence.review.approver}` : ""}.
            A new review is added to the record; this channel keeps both
            decisions.
          </p>
        ) : null}
      </div>

      {!started && !choice ? (
        <div className="flex items-center gap-2">
          <Button
            aria-label={`Approve: ${evidence.title}`}
            data-testid="graph-evidence-approve"
            onClick={() => setChoice("approve")}
            size="sm"
            type="button"
          >
            Approve…
          </Button>
          <Button
            aria-label={`Reject: ${evidence.title}`}
            data-testid="graph-evidence-reject"
            onClick={() => setChoice("reject")}
            size="sm"
            type="button"
            variant="outline"
          >
            Reject…
          </Button>
        </div>
      ) : null}

      {!started && choice ? (
        <div className="space-y-2">
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Note for the record{" "}
            <span className="font-normal">
              (optional, included in your signed decision)
            </span>
            <textarea
              className="min-h-14 w-full rounded-lg border border-input/60 bg-background px-2 py-1.5 text-sm text-foreground"
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Why you decided this"
              value={note}
            />
          </label>
          {keyLinked === false ? (
            <p className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert
                aria-hidden
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              This device isn't registered to your Cybercare account, so the
              decision won't count as yours in Cybercare. Register it in
              Settings, then Cybercare.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              className={
                choice === "approve"
                  ? "bg-[#d6322b] text-white hover:bg-[#b82620]"
                  : undefined
              }
              data-testid="graph-evidence-sign"
              disabled={busy}
              onClick={() => void handleSign()}
              size="sm"
              type="button"
              variant={choice === "reject" ? "destructive" : undefined}
            >
              {choice === "approve" ? "Approve and sign" : "Reject and sign"}
            </Button>
            <Button
              onClick={() => setChoice(null)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Your decision is signed on this device, saved in Cybercare, then
            posted to this channel. If Cybercare refuses (for example, you don't
            have review permission), nothing is posted.
          </p>
        </div>
      ) : null}

      {started ? (
        <div
          aria-live="polite"
          className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70"
          data-testid="graph-evidence-progress"
          role="status"
        >
          <StepLine idle="waiting" label="Saved in Cybercare" step={saved} />
          <StepLine
            idle="waiting for Cybercare"
            label="Decision posted"
            step={posted}
          />
          <StepLine
            idle={
              posted.state === "done"
                ? "included when this channel's history is next locked"
                : "after the decision is posted"
            }
            label="Tamper-proof record"
            step={{ state: "idle" }}
          />
        </div>
      ) : null}
      {unsent ? (
        <Button
          onClick={() => void post(unsent)}
          size="sm"
          type="button"
          variant="outline"
        >
          Send it again
        </Button>
      ) : null}
    </div>
  );
}

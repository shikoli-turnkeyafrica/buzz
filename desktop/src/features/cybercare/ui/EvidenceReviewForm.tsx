import * as React from "react";
import { Check, Clock, LoaderCircle, TriangleAlert, X } from "lucide-react";

import { signRelayEvent } from "@/shared/api/tauri";
import { relayClient } from "@/shared/api/relayClient";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  type CybercareConfig,
  type CybercareEvidenceItem,
  type CybercareNamed,
  verifyCybercareEvidence,
} from "../cybercareApi";
import { buildEvidenceRatification } from "../ratification";
import type { RoomBinding } from "../roomBinding";

type Step =
  | { state: "idle" }
  | { state: "pending" }
  | { state: "done"; detail: string }
  | { state: "failed"; detail: string };

type Progress = { platform: Step; signed: Step };

const IDLE: Progress = {
  platform: { state: "idle" },
  signed: { state: "idle" },
};

function errorText(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "Something went wrong.";
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
 * Review one piece of evidence: the Platform records it under the signed-in
 * person first; only then does the app sign the ruling and post it to the
 * room. A Platform refusal signs nothing. A relay refusal leaves the
 * Platform row standing and says so.
 */
export function EvidenceReviewForm({
  channelId,
  communityId,
  config,
  binding,
  evidence,
  statuses,
  keyLinked,
  onReviewed,
}: {
  channelId: string;
  communityId: string;
  config: CybercareConfig;
  binding: RoomBinding;
  evidence: CybercareEvidenceItem;
  statuses: CybercareNamed[];
  keyLinked: boolean | null;
  onReviewed: () => void;
}) {
  const [statusId, setStatusId] = React.useState("");
  const [note, setNote] = React.useState("");
  const [progress, setProgress] = React.useState<Progress>(IDLE);

  // biome-ignore lint/correctness/useExhaustiveDependencies: switching to another item resets the form; the id is the trigger, not an input
  React.useEffect(() => {
    setStatusId("");
    setNote("");
    setProgress(IDLE);
  }, [evidence.id]);

  const status = statuses.find((s) => s.id === statusId) ?? null;
  const busy =
    progress.platform.state === "pending" ||
    progress.signed.state === "pending";
  const finished = progress.signed.state === "done";

  const handleVerify = async () => {
    if (!status) return;
    setProgress({ platform: { state: "pending" }, signed: { state: "idle" } });
    let reviewId: string;
    try {
      const recorded = await verifyCybercareEvidence({
        communityId,
        config,
        orgId: binding.orgId,
        evidenceId: evidence.id,
        reviewStatusId: status.id,
        riskAssessmentId: binding.assessmentId,
        updateExisting: evidence.review != null,
      });
      reviewId = recorded.reviewId;
      setProgress({
        platform: {
          state: "done",
          detail: `review ${reviewId.slice(0, 8)}… · ${recorded.status?.name ?? status.name} · by ${recorded.reviewedBy ?? "you"}`,
        },
        signed: { state: "pending" },
      });
    } catch (reason) {
      setProgress({
        platform: { state: "failed", detail: errorText(reason) },
        signed: { state: "failed", detail: "nothing signed" },
      });
      return;
    }

    try {
      const unsigned = buildEvidenceRatification({
        channelId,
        binding,
        evidence,
        status,
        reviewId,
        note,
      });
      await relayClient.preconnect();
      const event = await signRelayEvent(unsigned);
      await relayClient.publishEvent(
        event,
        "Timed out posting the ruling to the room.",
        "Couldn't post the ruling to the room.",
      );
      setProgress((current) => ({
        ...current,
        signed: {
          state: "done",
          detail: `46203 ${event.id.slice(0, 8)}… posted to this room`,
        },
      }));
    } catch (reason) {
      setProgress((current) => ({
        ...current,
        signed: {
          state: "failed",
          detail: `${errorText(reason)} Cybercare has the review; the room has no signed ruling for it.`,
        },
      }));
    }
    onReviewed();
  };

  return (
    <div className="space-y-3" data-testid="cybercare-review-form">
      <div className="space-y-1">
        <div className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Review · {evidence.name}
        </div>
        {evidence.description ? (
          <p className="text-xs text-muted-foreground">
            {evidence.description}
          </p>
        ) : null}
        {evidence.review ? (
          <p className="text-xs text-muted-foreground">
            Currently {evidence.review.status?.name ?? "reviewed"}
            {evidence.review.reviewedBy
              ? ` by ${evidence.review.reviewedBy}`
              : ""}
            . A new review replaces it in Cybercare; the room keeps both
            rulings.
          </p>
        ) : null}
      </div>

      {progress.platform.state === "idle" ? (
        <>
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Status
            <select
              className="h-9 w-full rounded-lg border border-input/60 bg-background px-2 text-sm text-foreground"
              data-testid="cybercare-review-status"
              disabled={busy}
              onChange={(event) => setStatusId(event.target.value)}
              value={statusId}
            >
              <option value="">Choose a status</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-xs font-medium text-muted-foreground">
            Note for the record{" "}
            <span className="font-normal">
              (optional, goes into the signed ruling)
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
              This app's key isn't linked to your Cybercare identity, so the
              ruling won't count as yours in Cybercare. Link it in Settings,
              then Cybercare.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              className="bg-[#d6322b] text-white hover:bg-[#b82620]"
              data-testid="cybercare-verify"
              disabled={!status || busy}
              onClick={() => void handleVerify()}
              type="button"
            >
              Verify and sign
            </Button>
            {!status ? (
              <span className="text-xs text-muted-foreground">
                Choose a status first.
              </span>
            ) : null}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Cybercare records the review under your account first. Then this app
            signs the ruling with your key and posts it here. If Cybercare
            refuses (no permission, assessment locked), nothing is signed.
          </p>
        </>
      ) : (
        <div
          aria-live="polite"
          className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70"
          data-testid="cybercare-verify-progress"
        >
          <StepLine idle="waiting" label="Cybercare" step={progress.platform} />
          <StepLine
            idle="waiting for Cybercare"
            label="Signed ruling"
            step={progress.signed}
          />
          <StepLine
            idle={
              finished
                ? "the next seal of this room will include it"
                : "after the ruling is posted"
            }
            label="Checkpoint"
            step={{ state: "idle" }}
          />
        </div>
      )}
    </div>
  );
}

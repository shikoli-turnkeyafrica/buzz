import type { CybercareGraphEvidence } from "./cybercareApi";
import { KIND_CYBOTA_RATIFICATION } from "./ratification";

export type GraphEvidenceDecisionInput = {
  channelId: string;
  orgId: string;
  evidence: Pick<
    CybercareGraphEvidence,
    "evidenceId" | "evidenceCode" | "title" | "hasArtefact"
  >;
  approve: boolean;
  note: string;
};

/**
 * The unsigned 46203 for a review decision on a graph evidence item. The body
 * is what the timeline card reads (`action`, `note`, `subject`); the
 * `cybercare_evidence` tag lets Cybercare and verifiers find the item. The
 * subject records whether Cybercare held the file at the time, so a reader
 * never mistakes a review for an integrity check.
 */
export function buildGraphEvidenceDecision(input: GraphEvidenceDecisionInput) {
  const action = input.approve ? "APPROVE" : "REJECT";
  const note = input.note.trim();
  return {
    kind: KIND_CYBOTA_RATIFICATION,
    content: JSON.stringify({
      action,
      note: note || undefined,
      subject: {
        type: "cybercare.graph_evidence",
        evidenceId: input.evidence.evidenceId,
        name: input.evidence.title,
        reference: input.evidence.evidenceCode,
        fileHeld: input.evidence.hasArtefact,
        orgId: input.orgId,
      },
    }),
    tags: [
      ["h", input.channelId],
      ["entity_id", input.evidence.evidenceId],
      ["action", input.approve ? "approve" : "reject"],
      ["cybercare_evidence", input.evidence.evidenceId],
      ["cybercare_org", input.orgId],
    ],
  };
}

/** Plain words for whether Cybercare holds the evidence file. */
export function fileStatusLabel(
  evidence: Pick<CybercareGraphEvidence, "hasArtefact" | "verificationStatus">,
): string {
  switch (evidence.verificationStatus) {
    case "verified":
      return "File held and verified";
    case "pending_verification":
      return "File held, not yet verified";
    case "tampered":
      return "File held, but it no longer matches its fingerprint";
    default:
      return evidence.hasArtefact
        ? "File held"
        : "Metadata only: Cybercare doesn't hold the file";
  }
}

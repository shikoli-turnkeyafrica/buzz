import type { CybercareEvidenceItem, CybercareNamed } from "./cybercareApi";
import type { RoomBinding } from "./roomBinding";

/** Kind the governed relay reserves for ratifications (officeholders only). */
export const KIND_CYBOTA_RATIFICATION = 46203;

const REFUSING_STATUS = /reject|insufficient|not\s|invalid|fail|decline/i;

/**
 * The governance card shows APPROVED or REJECTED. A review status is a
 * refusal when its name says so; anything else approves the evidence.
 */
export function rulingAction(statusName: string): "APPROVE" | "REJECT" {
  return REFUSING_STATUS.test(statusName) ? "REJECT" : "APPROVE";
}

export type EvidenceRatificationInput = {
  channelId: string;
  binding: RoomBinding;
  evidence: Pick<CybercareEvidenceItem, "id" | "name" | "reference">;
  status: CybercareNamed;
  reviewId: string;
  note: string;
};

/**
 * The unsigned 46203 for a recorded evidence review. The body is what the
 * timeline's governance card reads (`action`, `position`, `note`, `subject`)
 * plus the Cybercare references a verifier needs to find the Platform row.
 * `refs` is left out: the card reads it as room event ids, and this ruling
 * points at a Cybercare record, not at another event. Tags let
 * relays and indexers filter without parsing the body.
 */
export function buildEvidenceRatification(input: EvidenceRatificationInput) {
  const action = rulingAction(input.status.name);
  const note = input.note.trim();
  const content = {
    action,
    position: input.status.name,
    note: note || undefined,
    subject: {
      type: "cybercare.evidence",
      evidenceId: input.evidence.id,
      name: input.evidence.name,
      reference: input.evidence.reference ?? undefined,
      reviewId: input.reviewId,
      reviewStatusId: input.status.id,
      orgId: input.binding.orgId,
      moduleId: input.binding.moduleId,
      riskAssessmentId: input.binding.assessmentId,
    },
  };
  return {
    kind: KIND_CYBOTA_RATIFICATION,
    content: JSON.stringify(content),
    tags: [
      ["h", input.channelId],
      ["entity_id", input.evidence.id],
      ["action", action.toLowerCase()],
      ["cybercare_review", input.reviewId],
      ["cybercare_org", input.binding.orgId],
    ],
  };
}

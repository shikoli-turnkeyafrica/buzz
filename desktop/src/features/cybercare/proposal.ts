import { KIND_CYBOTA_RATIFICATION } from "./ratification";

/** Kind an agent files a proposal with (members may file; nobody signs off). */
export const KIND_CYBOTA_PROPOSAL = 46201;

export type ProposalItem = {
  label: string;
  owner?: string;
  due?: string;
  actionId?: string;
};

export type ProposalSubject = {
  type?: string;
  name?: string;
  reference?: string;
  orgId?: string;
};

export type Proposal = {
  title: string;
  summary?: string;
  items: ProposalItem[];
  subject?: ProposalSubject;
  /** Cybercare actions waiting on this decision (`cybercare_action` tags). */
  actionIds: string[];
  orgId?: string;
  entityId?: string;
};

/** The parts of a timeline message a proposal or decision is read from. */
export type GovernedMessage = {
  id: string;
  kind?: number;
  body: string;
  tags?: string[][];
  pubkey?: string;
  createdAt: number;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tagValues(tags: string[][] | undefined, name: string): string[] {
  return (tags ?? [])
    .filter((tag) => tag[0] === name && typeof tag[1] === "string")
    .map((tag) => tag[1]);
}

/** Reads a 46201 proposal; null when the body is not a proposal. */
export function parseProposal(message: GovernedMessage): Proposal | null {
  if (message.kind !== KIND_CYBOTA_PROPOSAL) return null;
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(message.body);
    if (!parsed || typeof parsed !== "object") return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const title = str(body.title);
  if (!title) return null;
  const items = Array.isArray(body.items)
    ? body.items.flatMap((raw): ProposalItem[] => {
        if (!raw || typeof raw !== "object") return [];
        const item = raw as Record<string, unknown>;
        const label = str(item.label);
        return label
          ? [
              {
                label,
                owner: str(item.owner),
                due: str(item.due),
                actionId: str(item.actionId),
              },
            ]
          : [];
      })
    : [];
  const subjectRaw =
    body.subject && typeof body.subject === "object"
      ? (body.subject as Record<string, unknown>)
      : undefined;
  return {
    title,
    summary: str(body.summary),
    items,
    subject: subjectRaw
      ? {
          type: str(subjectRaw.type),
          name: str(subjectRaw.name),
          reference: str(subjectRaw.reference),
          orgId: str(subjectRaw.orgId),
        }
      : undefined,
    actionIds: tagValues(message.tags, "cybercare_action"),
    orgId: tagValues(message.tags, "cybercare_org")[0],
    entityId: tagValues(message.tags, "entity_id")[0],
  };
}

export type ProposalDecision = {
  eventId: string;
  approve: boolean;
  pubkey?: string;
  note?: string;
  createdAt: number;
};

/** The proposal id a 46203 answers, from its `["e", id, relay, "proposal"]`. */
export function decidedProposalId(message: GovernedMessage): string | null {
  if (message.kind !== KIND_CYBOTA_RATIFICATION) return null;
  const tag = (message.tags ?? []).find(
    (t) => t[0] === "e" && t[3] === "proposal" && typeof t[1] === "string",
  );
  return tag ? tag[1] : null;
}

/**
 * The first decision for each proposal in these messages. A proposal is open
 * until one exists; later decisions are history, not a change of outcome.
 */
export function decisionsByProposal(
  messages: readonly GovernedMessage[],
): Map<string, ProposalDecision> {
  const decisions = new Map<string, ProposalDecision>();
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  for (const message of ordered) {
    const proposalId = decidedProposalId(message);
    if (!proposalId || decisions.has(proposalId)) continue;
    let action: unknown;
    let note: string | undefined;
    try {
      const body = JSON.parse(message.body) as Record<string, unknown>;
      action = body.action;
      note = str(body.note);
    } catch {
      continue;
    }
    if (action !== "APPROVE" && action !== "REJECT") continue;
    decisions.set(proposalId, {
      eventId: message.id,
      approve: action === "APPROVE",
      pubkey: message.pubkey,
      note,
      createdAt: message.createdAt,
    });
  }
  return decisions;
}

export type ProposalDecisionInput = {
  channelId: string;
  proposalId: string;
  proposal: Proposal;
  approve: boolean;
  note: string;
};

/**
 * The unsigned 46203 an approver signs for a proposal. Its body is what the
 * timeline card reads; the `e` tag marked "proposal" is what closes the
 * proposal; the `cybercare_action` tags let Cybercare and verifiers find the
 * actions this decision opened.
 */
export function buildProposalDecision(input: ProposalDecisionInput) {
  const action = input.approve ? "APPROVE" : "REJECT";
  const note = input.note.trim();
  const subject = {
    ...(input.proposal.subject ?? {}),
    name: input.proposal.subject?.name ?? input.proposal.title,
  };
  const tags: string[][] = [
    ["h", input.channelId],
    ["e", input.proposalId, "", "proposal"],
    ["action", input.approve ? "approve" : "reject"],
  ];
  if (input.proposal.entityId)
    tags.push(["entity_id", input.proposal.entityId]);
  if (input.proposal.orgId) tags.push(["cybercare_org", input.proposal.orgId]);
  for (const id of input.proposal.actionIds)
    tags.push(["cybercare_action", id]);
  return {
    kind: KIND_CYBOTA_RATIFICATION,
    content: JSON.stringify({
      action,
      note: note || undefined,
      subject,
      proposal: input.proposalId,
    }),
    tags,
  };
}

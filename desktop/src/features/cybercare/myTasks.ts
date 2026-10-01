import {
  decisionsByProposal,
  type GovernedMessage,
  KIND_CYBOTA_PROPOSAL,
  parseProposal,
  type Proposal,
} from "./proposal";

export type OpenProposalTask = {
  kind: "proposal";
  id: string;
  channelId: string;
  author: string;
  createdAt: number;
  proposal: Proposal;
};

export type EvidenceTask = {
  kind: "evidence";
  channelId: string;
  assessmentName: string;
  awaiting: number;
};

export type MyTask = OpenProposalTask | EvidenceTask;

/** Raw relay events, as the relay client returns them. */
export type TaskEvent = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: string[][];
};

function toMessage(event: TaskEvent): GovernedMessage {
  return {
    id: event.id,
    kind: event.kind,
    body: event.content,
    tags: event.tags,
    pubkey: event.pubkey,
    createdAt: event.created_at,
  };
}

/**
 * Proposals that still wait for a decision, newest first. My own proposals
 * are not my task (someone else signs off), and a proposal leaves the list
 * as soon as any decision in its channel points at it.
 */
export function openProposals(
  events: readonly TaskEvent[],
  myPubkey: string | null,
): OpenProposalTask[] {
  const messages = events.map(toMessage);
  const decided = decisionsByProposal(messages);
  const me = myPubkey?.toLowerCase() ?? null;
  return messages
    .filter(
      (m) =>
        m.kind === KIND_CYBOTA_PROPOSAL &&
        !decided.has(m.id) &&
        (m.pubkey ?? "").toLowerCase() !== me,
    )
    .flatMap((m): OpenProposalTask[] => {
      const proposal = parseProposal(m);
      const channelId = m.tags?.find((t) => t[0] === "h")?.[1];
      return proposal && channelId
        ? [
            {
              kind: "proposal",
              id: m.id,
              channelId,
              author: m.pubkey ?? "",
              createdAt: m.createdAt,
              proposal,
            },
          ]
        : [];
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** How many tasks the sidebar badge shows. */
export function taskCount(tasks: readonly MyTask[]): number {
  return tasks.reduce(
    (sum, task) => sum + (task.kind === "proposal" ? 1 : task.awaiting),
    0,
  );
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildProposalDecision,
  decisionsByProposal,
  parseProposal,
} from "./proposal.ts";

const proposalMessage = {
  id: "p1",
  kind: 46201,
  createdAt: 100,
  pubkey: "agent",
  body: JSON.stringify({
    title: "Remediation plan · VPN Gateway (edge-fw-02)",
    summary: "Three actions close the two criticals.",
    items: [
      {
        label: "Patch FortiOS to 7.4.4",
        owner: "Head of IT Ops",
        due: "2026-10-14",
        actionId: "a1",
      },
      { label: "  " },
      "junk",
    ],
    subject: {
      type: "cybercare.remediation_plan",
      name: "VPN Gateway",
      reference: "VULN-0412",
      orgId: "org",
    },
    requested: "approval",
  }),
  tags: [
    ["h", "ch"],
    ["t", "proposal"],
    ["entity_id", "asset-1"],
    ["cybercare_org", "org"],
    ["cybercare_action", "a1"],
    ["cybercare_action", "a2"],
  ],
};

const decision = (id, proposalId, action, createdAt) => ({
  id,
  kind: 46203,
  createdAt,
  pubkey: "approver",
  body: JSON.stringify({ action, note: "ok" }),
  tags: [
    ["h", "ch"],
    ["e", proposalId, "", "proposal"],
  ],
});

describe("parseProposal", () => {
  it("reads title, items, subject and the actions it waits on", () => {
    const p = parseProposal(proposalMessage);
    assert.equal(p.title, "Remediation plan · VPN Gateway (edge-fw-02)");
    assert.equal(p.items.length, 1);
    assert.equal(p.items[0].actionId, "a1");
    assert.deepEqual(p.actionIds, ["a1", "a2"]);
    assert.equal(p.orgId, "org");
    assert.equal(p.entityId, "asset-1");
    assert.equal(p.subject.reference, "VULN-0412");
  });

  it("is null for other kinds, bad JSON or no title", () => {
    assert.equal(parseProposal({ ...proposalMessage, kind: 9 }), null);
    assert.equal(parseProposal({ ...proposalMessage, body: "nope" }), null);
    assert.equal(parseProposal({ ...proposalMessage, body: "{}" }), null);
  });
});

describe("decisionsByProposal", () => {
  it("keeps the first decision per proposal and ignores unrelated ones", () => {
    const map = decisionsByProposal([
      decision("d2", "p1", "REJECT", 300),
      decision("d1", "p1", "APPROVE", 200),
      { ...decision("x", "p1", "APPROVE", 150), tags: [["e", "p1"]] },
      { ...decision("y", "p1", "MAYBE", 120) },
    ]);
    assert.equal(map.get("p1").eventId, "d1");
    assert.equal(map.get("p1").approve, true);
    assert.equal(map.size, 1);
  });
});

describe("buildProposalDecision", () => {
  const p = parseProposal(proposalMessage);
  const event = buildProposalDecision({
    channelId: "ch",
    proposalId: "p1",
    proposal: p,
    approve: true,
    note: "  Go ahead.  ",
  });
  const body = JSON.parse(event.content);

  it("is a 46203 that closes the proposal", () => {
    assert.equal(event.kind, 46203);
    assert.deepEqual(event.tags[0], ["h", "ch"]);
    assert.deepEqual(event.tags[1], ["e", "p1", "", "proposal"]);
    assert.equal(body.proposal, "p1");
    assert.equal(body.action, "APPROVE");
    assert.equal(body.position, undefined);
    assert.equal(body.note, "Go ahead.");
  });

  it("carries the subject and every action it opens", () => {
    assert.equal(body.subject.name, "VPN Gateway");
    const actions = event.tags
      .filter((t) => t[0] === "cybercare_action")
      .map((t) => t[1]);
    assert.deepEqual(actions, ["a1", "a2"]);
    assert.ok(
      event.tags.some((t) => t[0] === "cybercare_org" && t[1] === "org"),
    );
  });

  it("rejects without a note", () => {
    const r = buildProposalDecision({
      channelId: "ch",
      proposalId: "p1",
      proposal: p,
      approve: false,
      note: "",
    });
    const rb = JSON.parse(r.content);
    assert.equal(rb.action, "REJECT");
    assert.equal(rb.note, undefined);
  });
});

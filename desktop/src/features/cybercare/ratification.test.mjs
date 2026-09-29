import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEvidenceRatification, rulingAction } from "./ratification.ts";
import {
  readRoomBinding,
  roomBindingKey,
  writeRoomBinding,
} from "./roomBinding.ts";

const binding = {
  orgId: "cb000000-0000-0000-0000-000000000001",
  orgLabel: "Cybota Bank",
  moduleId: "11111111-0000-4000-8000-000000000001",
  moduleName: "Riskcare",
  assessmentId: "22222222-0000-4000-8000-000000000001",
  assessmentName: "Q3 2026 Riskcare",
};

describe("rulingAction", () => {
  it("approves unless the status name refuses", () => {
    assert.equal(rulingAction("Verified"), "APPROVE");
    assert.equal(rulingAction("Partially sufficient"), "APPROVE");
    assert.equal(rulingAction("Insufficient"), "REJECT");
    assert.equal(rulingAction("Rejected"), "REJECT");
    assert.equal(rulingAction("Not applicable"), "REJECT");
  });
});

describe("buildEvidenceRatification", () => {
  const event = buildEvidenceRatification({
    channelId: "room-1",
    binding,
    evidence: { id: "ev-1", name: "Vault change ticket", reference: "AC-2" },
    status: { id: "st-1", name: "Verified" },
    reviewId: "rev-1",
    note: "  Ticket matches the answer.  ",
  });

  it("is a 46203 scoped to the room", () => {
    assert.equal(event.kind, 46203);
    assert.deepEqual(event.tags[0], ["h", "room-1"]);
  });

  it("carries what the governance card reads and what a verifier needs", () => {
    const body = JSON.parse(event.content);
    assert.equal(body.action, "APPROVE");
    assert.equal(body.position, "Verified");
    assert.equal(body.refs, undefined);
    assert.equal(body.subject.name, "Vault change ticket");
    assert.equal(body.note, "Ticket matches the answer.");
    assert.equal(body.subject.reviewId, "rev-1");
    assert.equal(body.subject.riskAssessmentId, binding.assessmentId);
    assert.ok(
      event.tags.some(([k, v]) => k === "cybercare_review" && v === "rev-1"),
    );
  });

  it("drops an empty note rather than sign whitespace", () => {
    const quiet = buildEvidenceRatification({
      channelId: "room-1",
      binding,
      evidence: { id: "ev-1", name: "x", reference: null },
      status: { id: "st-2", name: "Insufficient" },
      reviewId: "rev-2",
      note: "   ",
    });
    const body = JSON.parse(quiet.content);
    assert.equal(body.note, undefined);
    assert.equal(body.action, "REJECT");
  });
});

describe("room binding", () => {
  it("round-trips through storage and rejects partial records", () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    };
    assert.equal(readRoomBinding("c", "r", storage), null);
    assert.equal(writeRoomBinding("c", "r", binding, storage), true);
    assert.deepEqual(readRoomBinding("c", "r", storage), binding);
    store.set(roomBindingKey("c", "r"), JSON.stringify({ orgId: "x" }));
    assert.equal(readRoomBinding("c", "r", storage), null);
    store.set(roomBindingKey("c", "r"), "{not json");
    assert.equal(readRoomBinding("c", "r", storage), null);
  });
});

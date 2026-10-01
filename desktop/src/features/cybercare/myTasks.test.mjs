import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { openProposals, taskCount } from "./myTasks.ts";

const proposal = (id, author, createdAt, channel = "ch") => ({
  id,
  kind: 46201,
  pubkey: author,
  created_at: createdAt,
  content: JSON.stringify({ title: `Plan ${id}` }),
  tags: [["h", channel]],
});

const decision = (id, proposalId) => ({
  id,
  kind: 46203,
  pubkey: "approver",
  created_at: 500,
  content: JSON.stringify({ action: "APPROVE" }),
  tags: [
    ["h", "ch"],
    ["e", proposalId, "", "proposal"],
  ],
});

describe("openProposals", () => {
  it("lists undecided proposals by others, newest first", () => {
    const tasks = openProposals(
      [
        proposal("p1", "agent", 100),
        proposal("p2", "agent", 300, "ch2"),
        proposal("p3", "ME", 200),
        proposal("p4", "agent", 250),
        decision("d1", "p4"),
        { ...proposal("bad", "agent", 400), content: "not json" },
        { ...proposal("nochan", "agent", 410), tags: [] },
      ],
      "me",
    );
    assert.deepEqual(
      tasks.map((t) => t.id),
      ["p2", "p1"],
    );
    assert.equal(tasks[0].channelId, "ch2");
    assert.equal(tasks[0].proposal.title, "Plan p2");
  });

  it("ignores a decision posted in another channel", () => {
    const elsewhere = {
      ...decision("dx", "p1"),
      tags: [
        ["h", "ungoverned"],
        ["e", "p1", "", "proposal"],
      ],
    };
    const tasks = openProposals(
      [proposal("p1", "agent", 100), elsewhere],
      "me",
    );
    assert.deepEqual(
      tasks.map((t) => t.id),
      ["p1"],
    );
  });

  it("counts only the channels it is told to", () => {
    const tasks = openProposals(
      [
        proposal("p1", "agent", 100, "bound"),
        proposal("p2", "agent", 200, "other"),
      ],
      "me",
      (id) => id === "bound",
    );
    assert.deepEqual(
      tasks.map((t) => t.id),
      ["p1"],
    );
  });
});

describe("taskCount", () => {
  it("counts proposals once and evidence by items awaiting", () => {
    assert.equal(
      taskCount([
        { kind: "proposal" },
        { kind: "evidence", awaiting: 3 },
        { kind: "evidence", awaiting: 0 },
      ]),
      4,
    );
  });
});

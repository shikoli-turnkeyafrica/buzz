import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGraphEvidenceDecision,
  fileStatusLabel,
} from "./graphEvidence.ts";

const evidence = {
  evidenceId: "e14",
  evidenceCode: "EVID-2025-014",
  title: "CBK on-site cyber inspection report — H2 2025",
  hasArtefact: false,
};

describe("buildGraphEvidenceDecision", () => {
  const event = buildGraphEvidenceDecision({
    channelId: "ch",
    orgId: "org",
    evidence,
    approve: true,
    note: "  Findings closed.  ",
  });
  const body = JSON.parse(event.content);

  it("is a 46203 in the channel that names the evidence", () => {
    assert.equal(event.kind, 46203);
    assert.deepEqual(event.tags[0], ["h", "ch"]);
    assert.ok(
      event.tags.some((t) => t[0] === "cybercare_evidence" && t[1] === "e14"),
    );
    assert.ok(
      event.tags.some((t) => t[0] === "cybercare_org" && t[1] === "org"),
    );
    assert.equal(body.action, "APPROVE");
    assert.equal(body.note, "Findings closed.");
    assert.equal(body.subject.reference, "EVID-2025-014");
  });

  it("records that no file was held, so a review isn't read as integrity", () => {
    assert.equal(body.subject.fileHeld, false);
  });

  it("rejects without a note", () => {
    const r = JSON.parse(
      buildGraphEvidenceDecision({
        channelId: "ch",
        orgId: "org",
        evidence,
        approve: false,
        note: "",
      }).content,
    );
    assert.equal(r.action, "REJECT");
    assert.equal(r.note, undefined);
  });
});

describe("fileStatusLabel", () => {
  it("says plainly whether Cybercare holds the file", () => {
    assert.match(
      fileStatusLabel({
        hasArtefact: false,
        verificationStatus: "metadata_only",
      }),
      /doesn't hold/,
    );
    assert.equal(
      fileStatusLabel({ hasArtefact: true, verificationStatus: "verified" }),
      "File held and verified",
    );
    assert.match(
      fileStatusLabel({ hasArtefact: true, verificationStatus: "tampered" }),
      /no longer matches/,
    );
  });
});

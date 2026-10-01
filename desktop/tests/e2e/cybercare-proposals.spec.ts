import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

// Agents' proposals (Gemini G1/G3/G4): the card only lets an approver sign
// when what it shows is what Cybercare will change, records the decision in
// Cybercare, and My tasks lists what is still open.

const GENERAL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const ORG = "cb000000-0000-0000-0000-000000000001";
const AGENT = `${"a".repeat(63)}1`;
const A1 = "aaaaaaaa-0000-4000-8000-000000000001";
const A2 = "aaaaaaaa-0000-4000-8000-000000000002";

async function setup(page: Page) {
  await page.addInitScript(() =>
    window.localStorage.setItem("e2e-cybercare-signed-in", "1"),
  );
  await installMockBridge(page);
  await page.addInitScript(
    ([channel, org]) => {
      const raw = window.localStorage.getItem("buzz-communities");
      if (!raw) return;
      const list = JSON.parse(raw);
      for (const c of list) {
        c.cybercare = {
          baseUrl: "http://g:8100",
          keycloakUrl: "http://k/auth",
          realm: "cybota",
        };
        window.localStorage.setItem(
          `cybercare-room-binding:${c.id}:${channel}`,
          JSON.stringify({
            orgId: org,
            orgLabel: "Cybota Bank",
            moduleId: "11111111-0000-4000-8000-000000000001",
            moduleName: "Riskcare",
            assessmentId: "22222222-0000-4000-8000-000000000001",
            assessmentName: "Q3 2026 Riskcare",
          }),
        );
      }
      window.localStorage.setItem("buzz-communities", JSON.stringify(list));
    },
    [GENERAL, ORG],
  );
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await page.waitForTimeout(500);
}

async function emitProposal(page: Page, tagged: string[], shown: string[]) {
  await page.evaluate(
    ({ agent, org, tagged, shown }) => {
      const items = [
        { label: "Patch FortiOS to 7.4.4", actionId: shown[0] },
        { label: "Rotate the VPN admin credentials", actionId: shown[1] },
      ];
      (
        window as unknown as {
          __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (input: unknown) => void;
        }
      ).__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
        channelName: "general",
        kind: 46201,
        pubkey: agent,
        content: JSON.stringify({
          title: "Remediation plan · VPN Gateway (edge-fw-02)",
          items,
          subject: { name: "VPN Gateway (edge-fw-02)", orgId: org },
          requested: "approval",
        }),
        extraTags: [
          ["t", "proposal"],
          ["cybercare_org", org],
          ...tagged.map((id) => ["cybercare_action", id]),
        ],
      });
    },
    { agent: AGENT, org: ORG, tagged, shown },
  );
}

test("an approver signs a matching proposal and Cybercare opens its actions", async ({
  page,
}) => {
  await setup(page);
  await emitProposal(page, [A1, A2], [A1, A2]);
  const card = page.getByTestId("proposal-card");
  await expect(card).toContainText("Signing changes 2 remediation actions");
  await page.getByTestId("proposal-approve").click();
  await card.getByRole("textbox").fill("Patch first.");
  await page.getByTestId("proposal-sign").click();
  await expect(page.getByTestId("proposal-cybercare")).toContainText(
    "Cybercare opened 2 actions",
  );
  await expect(page.getByTestId("proposal-decided")).toContainText("Approved");
  await waitForAnimations(page);
});

test("a proposal whose steps don't match its actions can't be signed", async ({
  page,
}) => {
  await setup(page);
  // Shows one action, would change two.
  await emitProposal(page, [A1, A2], [A1, ""]);
  await expect(page.getByTestId("proposal-problem")).toContainText(
    "don't match",
  );
  await expect(page.getByTestId("proposal-approve")).toHaveCount(0);
});

test("My tasks lists an open proposal from a channel with an assessment", async ({
  page,
}) => {
  await setup(page);
  await emitProposal(page, [A1], [A1]);
  await page.getByTestId("open-my-tasks").click();
  await expect(page.getByTestId("my-tasks-list")).toContainText(
    "Remediation plan · VPN Gateway (edge-fw-02)",
  );
  // The organisation also has two graph evidence items awaiting review: 1 + 2.
  await expect(page.getByTestId("my-tasks-list")).toContainText(
    "2 evidence items awaiting review",
  );
  await expect(page.getByTestId("sidebar-my-tasks-count")).toHaveText("3");
});

test("an approver reviews the organisation's evidence of record", async ({
  page,
}) => {
  await setup(page);
  await page.getByTestId("cybercare-records-trigger").click();
  const list = page.getByTestId("cybercare-evidence-list");
  await expect(list).toContainText(
    "CBK on-site cyber inspection report — H2 2025",
  );
  await expect(page.getByTestId("graph-evidence-file")).toContainText(
    "Metadata only",
  );
  await page.getByTestId("graph-evidence-approve").click();
  await page
    .getByTestId("graph-evidence-review")
    .getByRole("textbox")
    .fill("Inspection findings closed.");
  await page.getByTestId("graph-evidence-sign").click();
  const progress = page.getByTestId("graph-evidence-progress");
  await expect(progress).toContainText("Approved · by Cybota Bank Test");
  await expect(progress).toContainText("posted to this channel");
  await waitForAnimations(page);
});

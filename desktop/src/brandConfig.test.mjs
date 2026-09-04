import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse as yamlParse } from "yaml";

import { DEEP_LINK_SCHEME, PRODUCT_NAME } from "./brand.ts";

const DESKTOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
// This test file lives at desktop/src/brandConfig.test.mjs; the workflow it
// checks below lives at the repo root's .github/, two levels up from DESKTOP_ROOT.
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "..");

// Config files cannot import the brand constants, so this test is the joint
// that keeps them honest. A rename that updates brand.ts but not tauri.conf.json
// ships an app whose window says one thing and whose installer says another.
test("tauri.conf.json agrees with the brand constants", () => {
  const conf = JSON.parse(
    fs.readFileSync(
      path.join(DESKTOP_ROOT, "src-tauri/tauri.conf.json"),
      "utf8",
    ),
  );
  assert.equal(conf.productName, PRODUCT_NAME);
  assert.equal(conf.identifier, "africa.cybota.cybercare.commons");
  assert.deepEqual(conf.plugins["deep-link"].desktop.schemes, [
    DEEP_LINK_SCHEME,
  ]);
});

test("index.html title is the product name", () => {
  const html = fs.readFileSync(path.join(DESKTOP_ROOT, "index.html"), "utf8");
  assert.match(html, new RegExp(`<title>${PRODUCT_NAME}</title>`));
});

// Deferred to Task 9 of the brand plan: the workflow's branded literals
// (installer filename match, artifact name) are written there, so this is
// where the joint could first go stale. Same failure mode as the two tests
// above — a rename that updates brand.ts but not the workflow silently
// stops the "Locate NSIS installer" step from ever matching a file, or
// uploads an artifact under the old name.
test("windows-canary.yml agrees with the brand constants", () => {
  const workflow = yamlParse(
    fs.readFileSync(
      path.join(REPO_ROOT, ".github/workflows/windows-canary.yml"),
      "utf8",
    ),
  );
  const steps = workflow.jobs.build.steps;

  const locate = steps.find((s) => s.name === "Locate NSIS installer");
  assert.ok(locate, "expected a 'Locate NSIS installer' step");
  assert.match(
    locate.run,
    new RegExp(`-name "${PRODUCT_NAME}_\\$\\{VERSION\\}`),
    "installer glob should match on the product name",
  );

  const upload = steps.find(
    (s) => s.name === "Upload Windows canary installer",
  );
  assert.ok(upload, "expected an 'Upload Windows canary installer' step");
  const artifactSlug = PRODUCT_NAME.toLowerCase().replace(/\s+/g, "-");
  assert.match(
    upload.with.name,
    new RegExp(`^${artifactSlug}-windows-canary-`),
    "artifact name should be the branded one",
  );
});

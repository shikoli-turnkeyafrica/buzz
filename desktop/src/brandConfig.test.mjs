import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { DEEP_LINK_SCHEME, PRODUCT_NAME } from "./brand.ts";

const DESKTOP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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

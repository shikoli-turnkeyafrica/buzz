import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkCybercareConfig,
  draftFromConfig,
  signInErrorMessage,
} from "./cybercareConfig.ts";

const good = {
  baseUrl: "http://phi3:8100/",
  keycloakUrl: " https://phi3.tail963f23.ts.net:8443/auth/ ",
  realm: "cybota",
};

describe("checkCybercareConfig", () => {
  it("trims whitespace and trailing slashes", () => {
    assert.deepEqual(checkCybercareConfig(good), {
      ok: true,
      config: {
        baseUrl: "http://phi3:8100",
        keycloakUrl: "https://phi3.tail963f23.ts.net:8443/auth",
        realm: "cybota",
      },
    });
  });

  it("names the field that is wrong", () => {
    assert.equal(
      checkCybercareConfig({ ...good, baseUrl: "phi3:8100" }).field,
      "baseUrl",
    );
    assert.equal(
      checkCybercareConfig({ ...good, keycloakUrl: "ftp://kc" }).field,
      "keycloakUrl",
    );
    assert.equal(
      checkCybercareConfig({ ...good, realm: "a/b" }).field,
      "realm",
    );
    assert.equal(checkCybercareConfig({ ...good, realm: "" }).field, "realm");
  });

  it("refuses query strings and fragments", () => {
    assert.equal(
      checkCybercareConfig({ ...good, baseUrl: "http://x/?a=1" }).ok,
      false,
    );
  });
});

describe("draftFromConfig", () => {
  it("defaults the realm to cybota for a new community", () => {
    assert.deepEqual(draftFromConfig(undefined), {
      baseUrl: "",
      keycloakUrl: "",
      realm: "cybota",
    });
  });
});

describe("signInErrorMessage", () => {
  it("translates the Rust errors into plain language", () => {
    assert.equal(
      signInErrorMessage("Cybercare sign-in canceled"),
      "Sign-in canceled.",
    );
    assert.match(
      signInErrorMessage("Keycloak unreachable: dns"),
      /Can't reach/,
    );
    assert.equal(
      signInErrorMessage("Keycloak refused: invalid_grant (Code not valid)"),
      "The sign-in server refused: invalid_grant (Code not valid)",
    );
    assert.equal(
      signInErrorMessage(null),
      "Sign-in didn't complete. Try again.",
    );
  });
});

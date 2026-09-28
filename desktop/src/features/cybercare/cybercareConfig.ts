import type { CybercareConfig } from "./cybercareApi";

export type CybercareConfigDraft = {
  baseUrl: string;
  keycloakUrl: string;
  realm: string;
};

export type CybercareConfigCheck =
  | { ok: true; config: CybercareConfig }
  | { ok: false; field: keyof CybercareConfigDraft; message: string };

function checkHttpUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "Enter a full address, starting with http:// or https://";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Use an http:// or https:// address";
  }
  if (parsed.search || parsed.hash) {
    return "Leave off anything after ? or #";
  }
  return null;
}

/**
 * Turns what a person typed into a config the Rust side will accept, or says
 * which field is wrong and why. Rust validates again; this is for the form.
 */
export function checkCybercareConfig(
  draft: CybercareConfigDraft,
): CybercareConfigCheck {
  const baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
  const keycloakUrl = draft.keycloakUrl.trim().replace(/\/+$/, "");
  const realm = draft.realm.trim();

  const baseError = checkHttpUrl(baseUrl);
  if (baseError) return { ok: false, field: "baseUrl", message: baseError };
  const keycloakError = checkHttpUrl(keycloakUrl);
  if (keycloakError)
    return { ok: false, field: "keycloakUrl", message: keycloakError };
  if (!/^[A-Za-z0-9_-]+$/.test(realm)) {
    return {
      ok: false,
      field: "realm",
      message: "Realm is letters, digits, - or _ only",
    };
  }
  return { ok: true, config: { baseUrl, keycloakUrl, realm } };
}

export function draftFromConfig(
  config: CybercareConfig | undefined,
): CybercareConfigDraft {
  return {
    baseUrl: config?.baseUrl ?? "",
    keycloakUrl: config?.keycloakUrl ?? "",
    realm: config?.realm ?? "cybota",
  };
}

/** Plain-language reason for a failed sign-in, from the Rust error string. */
export function signInErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  if (message.includes("canceled")) return "Sign-in canceled.";
  if (message.includes("timed out")) return "Sign-in took too long. Try again.";
  if (message.includes("Keycloak unreachable"))
    return "Can't reach the sign-in server. Check the Keycloak address and your connection.";
  if (message.startsWith("Keycloak refused"))
    return `The sign-in server refused: ${message.replace(/^Keycloak refused:\s*/, "")}`;
  return message || "Sign-in didn't complete. Try again.";
}

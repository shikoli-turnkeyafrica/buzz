import { invoke } from "@tauri-apps/api/core";

/**
 * Where a community's Cybercare identity lives. Stored on the community
 * record; sent to Rust with each call, which validates it before any request.
 */
export type CybercareConfig = {
  /** Cybercare API gateway, e.g. http://host:8100 */
  baseUrl: string;
  /** Keycloak base including the /auth prefix on Keycloak <= 16. */
  keycloakUrl: string;
  realm: string;
  /** Defaults to "cybercare-commons" in Rust when omitted. */
  clientId?: string;
};

/** The only session shape the webview sees. Tokens stay in the keyring. */
export type CybercareSession = {
  subject: string;
  username: string | null;
  name: string | null;
  email: string | null;
  organisationIds: string[];
  /** Unix seconds. */
  expiresAt: number;
};

function keycloakConfig(config: CybercareConfig) {
  return {
    keycloakUrl: config.keycloakUrl,
    realm: config.realm,
    clientId: config.clientId ?? null,
  };
}

/** Opens the system browser at Keycloak; resolves once the app holds tokens. */
export function signInToCybercare(
  communityId: string,
  config: CybercareConfig,
) {
  return invoke<CybercareSession>("cybercare_sign_in", {
    communityId,
    config: keycloakConfig(config),
  });
}

export function cancelCybercareSignIn() {
  return invoke<void>("cybercare_cancel_sign_in");
}

export function getCybercareSession(communityId: string) {
  return invoke<CybercareSession | null>("cybercare_session", { communityId });
}

export function signOutOfCybercare(
  communityId: string,
  config: CybercareConfig,
) {
  return invoke<void>("cybercare_sign_out", {
    communityId,
    config: keycloakConfig(config),
  });
}

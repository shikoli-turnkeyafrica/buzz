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

function rustConfig(config: CybercareConfig) {
  return {
    baseUrl: config.baseUrl,
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
    config: rustConfig(config),
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
    config: rustConfig(config),
  });
}

export type CybercareBinding = {
  commonsPubkey: string;
  enrolledAt: string;
  enrolledVia: string;
};

export type CybercareIdentityStatus = {
  enrolled: boolean;
  binding: CybercareBinding | null;
  /** False with `enrolled` = another device or key is linked, not this app. */
  isThisKey: boolean;
};

export function getCybercareIdentity(
  communityId: string,
  config: CybercareConfig,
  orgId: string,
) {
  return invoke<CybercareIdentityStatus>("cybercare_identity", {
    communityId,
    config: rustConfig(config),
    orgId,
  });
}

/**
 * Proves this app's key to Cybercare and records the link. `replaceExisting`
 * first revokes the key linked now, so this app's key takes its place.
 */
export function linkKeyToCybercare(
  communityId: string,
  config: CybercareConfig,
  orgId: string,
  replaceExisting = false,
) {
  return invoke<CybercareIdentityStatus>("cybercare_enrol", {
    communityId,
    config: rustConfig(config),
    orgId,
    replaceExisting,
  });
}

/** A module, an assessment, a review status: an id and a label. */
export type CybercareNamed = { id: string; name: string };

export type CybercareEvidenceReview = {
  id: string;
  status: CybercareNamed | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type CybercareEvidenceItem = {
  /** Evidence definition id: what the review endpoints call `evidenceId`. */
  id: string;
  name: string;
  reference: string | null;
  description: string | null;
  submitted: boolean;
  /** Platform's `reviewed` flag, which means "has files". */
  hasFiles: boolean;
  review: CybercareEvidenceReview | null;
};

export function listCybercareModules(
  communityId: string,
  config: CybercareConfig,
) {
  return invoke<CybercareNamed[]>("cybercare_modules", {
    communityId,
    config: rustConfig(config),
  });
}

export function listCybercareAssessments(
  communityId: string,
  config: CybercareConfig,
  orgId: string,
  moduleId: string,
) {
  return invoke<CybercareNamed[]>("cybercare_assessments", {
    communityId,
    config: rustConfig(config),
    orgId,
    moduleId,
  });
}

export function listCybercareReviewStatuses(
  communityId: string,
  config: CybercareConfig,
) {
  return invoke<CybercareNamed[]>("cybercare_review_statuses", {
    communityId,
    config: rustConfig(config),
  });
}

export function listCybercareEvidence(
  communityId: string,
  config: CybercareConfig,
  orgId: string,
  moduleId: string,
  pageNumber = 0,
) {
  return invoke<CybercareEvidenceItem[]>("cybercare_evidence", {
    communityId,
    config: rustConfig(config),
    orgId,
    moduleId,
    pageNumber,
  });
}

export type CybercareRecordedReview = {
  reviewId: string;
  status: CybercareNamed | null;
  reviewedBy: string | null;
};

/** Records the review in Cybercare under the signed-in person. */
export function verifyCybercareEvidence(input: {
  communityId: string;
  config: CybercareConfig;
  orgId: string;
  evidenceId: string;
  reviewStatusId: string;
  riskAssessmentId: string | null;
  updateExisting: boolean;
}) {
  return invoke<CybercareRecordedReview>("cybercare_verify_evidence", {
    communityId: input.communityId,
    config: rustConfig(input.config),
    orgId: input.orgId,
    evidenceId: input.evidenceId,
    reviewStatusId: input.reviewStatusId,
    riskAssessmentId: input.riskAssessmentId,
    updateExisting: input.updateExisting,
  });
}

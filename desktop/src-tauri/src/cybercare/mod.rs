//! Cybercare Platform integration: sign-in (Keycloak OIDC + PKCE) and binding
//! this app's signing key to the signed-in identity; the evidence record
//! panel lands in later Mercury tasks.

pub(crate) mod auth;
pub(crate) mod decisions;
pub(crate) mod graph_evidence;
pub(crate) mod identity;
pub(crate) mod platform;
pub(crate) mod session_store;

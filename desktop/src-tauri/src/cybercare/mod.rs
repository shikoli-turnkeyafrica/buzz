//! Cybercare Platform integration: sign-in (Keycloak OIDC + PKCE) and binding
//! this app's signing key to the signed-in identity; the evidence record
//! panel lands in later Mercury tasks.

pub(crate) mod auth;
pub(crate) mod identity;

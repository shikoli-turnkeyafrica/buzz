//! Cybercare sign-in: Keycloak OpenID Connect, authorization code + PKCE (S256).
//!
//! The password never reaches this app. The system browser shows Keycloak's own
//! login, one-time-code and account-setup screens; Keycloak redirects to a
//! loopback listener bound on 127.0.0.1 for this sign-in only; the app then
//! exchanges the code (with the PKCE verifier) for tokens.
//!
//! Tokens are persisted in the OS keyring under a per-community key, never
//! handed to the webview. Claims are read from the access token without
//! verifying its signature: the app is the token's holder, not its relying
//! party. The gateway and sherpa-ai verify it on every request.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use axum::{
    extract::{Query, State as AxumState},
    response::{Html, IntoResponse, Response},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;
use tokio::{net::TcpListener, sync::oneshot};
use url::Url;

const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);
/// Refresh this long before expiry so a request never goes out with a token
/// that dies in flight.
const REFRESH_SKEW_SECS: u64 = 30;
pub(crate) const DEFAULT_CLIENT_ID: &str = "cybercare-commons";

const SIGNED_IN_HTML: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signed in to Cybercare</title>
<style>:root{color-scheme:light dark;font-family:"Source Sans 3",ui-sans-serif,system-ui,sans-serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#eff1f5;color:#1e2030}
main{max-width:440px;padding:40px;border-radius:14px;background:#fff;border:1px solid #dce0e8}
h1{margin:0 0 8px;font-size:22px}p{margin:0;color:#4c4f69;line-height:1.5}
@media (prefers-color-scheme:dark){body{background:#1e2030;color:#e6e9ef}main{background:#24273a;border-color:#363a4f}p{color:#b8bcd0}}</style>
</head><body><main><h1>Signed in to Cybercare</h1><p>You can close this tab and return to Cybercare Commons.</p></main></body></html>"#;

/// Where a community's Cybercare identity lives. Supplied by the webview from
/// the community record; validated here before any network call.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CybercareConfig {
    /// Cybercare API gateway. Needed for Platform and identity calls; sign-in
    /// alone does not use it.
    #[serde(default)]
    pub base_url: Option<String>,
    /// Keycloak base, including the `/auth` prefix on Keycloak <= 16.
    pub keycloak_url: String,
    pub realm: String,
    #[serde(default)]
    pub client_id: Option<String>,
}

impl CybercareConfig {
    pub(crate) fn client_id(&self) -> &str {
        self.client_id
            .as_deref()
            .filter(|id| !id.is_empty())
            .unwrap_or(DEFAULT_CLIENT_ID)
    }

    fn realm_url(&self) -> Result<String, String> {
        let base = Url::parse(self.keycloak_url.trim_end_matches('/'))
            .map_err(|error| format!("invalid Keycloak URL: {error}"))?;
        if !matches!(base.scheme(), "http" | "https") {
            return Err("Keycloak URL must be http or https".to_owned());
        }
        if self.realm.is_empty()
            || !self
                .realm
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err("realm must be letters, digits, '-' or '_'".to_owned());
        }
        Ok(format!(
            "{}/realms/{}",
            base.as_str().trim_end_matches('/'),
            self.realm
        ))
    }

    /// Gateway base with no trailing slash, validated as http(s).
    pub(crate) fn gateway(&self) -> Result<String, String> {
        let raw = self
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Cybercare address is not set for this community".to_owned())?;
        let parsed = Url::parse(raw.trim().trim_end_matches('/'))
            .map_err(|error| format!("invalid Cybercare address: {error}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("Cybercare address must be http or https".to_owned());
        }
        Ok(parsed.as_str().trim_end_matches('/').to_owned())
    }

    pub(crate) fn authorize_endpoint(&self) -> Result<String, String> {
        Ok(format!(
            "{}/protocol/openid-connect/auth",
            self.realm_url()?
        ))
    }

    pub(crate) fn token_endpoint(&self) -> Result<String, String> {
        Ok(format!(
            "{}/protocol/openid-connect/token",
            self.realm_url()?
        ))
    }

    pub(crate) fn logout_endpoint(&self) -> Result<String, String> {
        Ok(format!(
            "{}/protocol/openid-connect/logout",
            self.realm_url()?
        ))
    }
}

/// RFC 7636 verifier and S256 challenge.
#[derive(Debug, Clone)]
pub(crate) struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub(crate) fn from_verifier(verifier: String) -> Self {
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Self {
            verifier,
            challenge,
        }
    }

    pub(crate) fn generate() -> Result<Self, String> {
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).map_err(|error| format!("no randomness: {error}"))?;
        Ok(Self::from_verifier(URL_SAFE_NO_PAD.encode(bytes)))
    }
}

fn random_state() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|error| format!("no randomness: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

pub(crate) fn authorize_url(
    config: &CybercareConfig,
    redirect_uri: &str,
    pkce: &Pkce,
    state: &str,
) -> Result<Url, String> {
    let mut url = Url::parse(&config.authorize_endpoint()?)
        .map_err(|error| format!("invalid authorize URL: {error}"))?;
    url.query_pairs_mut()
        .append_pair("client_id", config.client_id())
        .append_pair("response_type", "code")
        .append_pair("scope", "openid")
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);
    Ok(url)
}

#[derive(Debug, Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    #[serde(default)]
    pub id_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenError {
    error: String,
    #[serde(default)]
    error_description: Option<String>,
}

/// Claims the app shows and uses. `organisation_id` comes from the
/// `cybercare-commons` client's attribute mapper (multivalued).
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct Claims {
    pub sub: String,
    #[serde(default)]
    pub preferred_username: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub iss: Option<String>,
    #[serde(default, deserialize_with = "string_or_list")]
    pub organisation_id: Vec<String>,
}

fn string_or_list<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(String),
        Many(Vec<String>),
    }
    Ok(match Option::<OneOrMany>::deserialize(deserializer)? {
        None => Vec::new(),
        Some(OneOrMany::One(value)) => vec![value],
        Some(OneOrMany::Many(values)) => values,
    })
}

/// Reads a JWT's payload. Deliberately unverified: see the module comment.
pub(crate) fn decode_claims(jwt: &str) -> Result<Claims, String> {
    let payload = jwt
        .split('.')
        .nth(1)
        .ok_or_else(|| "token is not a JWT".to_owned())?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|error| format!("token payload is not base64url: {error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("token claims unreadable: {error}"))
}

/// What is persisted in the keyring. Tokens never cross into the webview.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct StoredSession {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    /// Unix seconds.
    pub expires_at: u64,
    pub claims: Claims,
}

impl StoredSession {
    pub(crate) fn from_tokens(tokens: TokenResponse, now: u64) -> Result<Self, String> {
        let claims = decode_claims(&tokens.access_token)?;
        if claims.sub.is_empty() {
            return Err("token has no subject".to_owned());
        }
        Ok(Self {
            expires_at: now.saturating_add(tokens.expires_in),
            claims,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            id_token: tokens.id_token,
        })
    }

    pub(crate) fn needs_refresh(&self, now: u64) -> bool {
        now.saturating_add(REFRESH_SKEW_SECS) >= self.expires_at
    }
}

/// The only session shape the webview ever sees.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CybercareSessionInfo {
    pub subject: String,
    pub username: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub organisation_ids: Vec<String>,
    pub expires_at: u64,
}

impl From<&StoredSession> for CybercareSessionInfo {
    fn from(session: &StoredSession) -> Self {
        Self {
            subject: session.claims.sub.clone(),
            username: session.claims.preferred_username.clone(),
            name: session.claims.name.clone(),
            email: session.claims.email.clone(),
            organisation_ids: session.claims.organisation_id.clone(),
            expires_at: session.expires_at,
        }
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Keyring key for one community's session. The community id is the
/// webview's opaque id; restrict it so it cannot collide with other entries.
pub(crate) fn session_key(community_id: &str) -> Result<String, String> {
    if community_id.is_empty()
        || community_id.len() > 128
        || !community_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("invalid community id".to_owned());
    }
    Ok(format!("cybercare.session.{community_id}"))
}

/// Cybercare sessions live in their own keyring entry, never in the identity
/// blob: a sign-in, refresh or sign-out must not be able to disturb the key
/// the app signs with.
pub(crate) fn session_service(identity_service: &str) -> String {
    format!("{identity_service}.cybercare-sessions")
}

fn service() -> String {
    session_service(crate::app_state::keyring_service())
}

pub(crate) fn load_session(community_id: &str) -> Result<Option<StoredSession>, String> {
    let key = session_key(community_id)?;
    match super::session_store::load(&service(), &key)? {
        None => Ok(None),
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|error| format!("stored Cybercare session unreadable: {error}")),
    }
}

fn save_session(community_id: &str, session: &StoredSession) -> Result<(), String> {
    let raw = serde_json::to_string(session).map_err(|error| error.to_string())?;
    super::session_store::store(&service(), &session_key(community_id)?, &raw)
}

fn delete_session(community_id: &str) -> Result<(), String> {
    super::session_store::delete(&service(), &session_key(community_id)?)
}

async fn post_token_form(
    client: &reqwest::Client,
    endpoint: &str,
    form: &[(&str, &str)],
) -> Result<TokenResponse, String> {
    let response = client
        .post(endpoint)
        .form(form)
        .timeout(HTTP_TIMEOUT)
        .send()
        .await
        .map_err(|error| format!("Keycloak unreachable: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Keycloak response unreadable: {error}"))?;
    if status.is_success() {
        return serde_json::from_str(&body)
            .map_err(|error| format!("Keycloak token response unreadable: {error}"));
    }
    Err(match serde_json::from_str::<TokenError>(&body) {
        Ok(error) => match error.error_description {
            Some(description) => format!("Keycloak refused: {} ({description})", error.error),
            None => format!("Keycloak refused: {}", error.error),
        },
        Err(_) => format!("Keycloak refused with HTTP {status}"),
    })
}

/// Returns a valid access token for the community, refreshing once if due.
/// Fails closed: an unrefreshable session is deleted and the caller must sign
/// in again.
pub(crate) async fn access_token(
    client: &reqwest::Client,
    config: &CybercareConfig,
    community_id: &str,
) -> Result<String, String> {
    let session =
        load_session(community_id)?.ok_or_else(|| "Not signed in to Cybercare".to_owned())?;
    if !session.needs_refresh(now_secs()) {
        return Ok(session.access_token);
    }
    let Some(refresh_token) = session.refresh_token.as_deref() else {
        delete_session(community_id)?;
        return Err("Cybercare session expired; sign in again".to_owned());
    };
    match post_token_form(
        client,
        &config.token_endpoint()?,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", config.client_id()),
            ("refresh_token", refresh_token),
        ],
    )
    .await
    {
        Ok(tokens) => {
            let refreshed = StoredSession::from_tokens(tokens, now_secs())?;
            if refreshed.claims.sub != session.claims.sub {
                delete_session(community_id)?;
                return Err("Cybercare refresh returned a different user; sign in again".into());
            }
            save_session(community_id, &refreshed)?;
            Ok(refreshed.access_token)
        }
        Err(error) => {
            delete_session(community_id)?;
            Err(format!(
                "Cybercare session expired; sign in again ({error})"
            ))
        }
    }
}

#[derive(Default)]
pub(crate) struct CybercareSignIn(Mutex<Option<oneshot::Sender<()>>>);

struct CallbackState {
    state: String,
    sender: Mutex<Option<oneshot::Sender<Result<String, String>>>>,
}

/// Pure: turns a callback's query into the code, or the reason there is none.
pub(crate) fn code_from_callback(
    expected_state: &str,
    query: &HashMap<String, String>,
) -> Result<String, String> {
    if query.get("state").map(String::as_str) != Some(expected_state) {
        return Err("sign-in response did not match this request".to_owned());
    }
    if let Some(error) = query.get("error") {
        return Err(match query.get("error_description") {
            Some(description) => format!("Keycloak refused: {error} ({description})"),
            None => format!("Keycloak refused: {error}"),
        });
    }
    query
        .get("code")
        .filter(|code| !code.is_empty())
        .cloned()
        .ok_or_else(|| "sign-in response had no code".to_owned())
}

async fn callback(
    Query(query): Query<HashMap<String, String>>,
    AxumState(state): AxumState<std::sync::Arc<CallbackState>>,
) -> Response {
    let result = code_from_callback(&state.state, &query);
    let ok = result.is_ok();
    if let Some(sender) = state.sender.lock().ok().and_then(|mut s| s.take()) {
        let _ = sender.send(result);
    }
    if ok {
        Html(SIGNED_IN_HTML).into_response()
    } else {
        Html("<!doctype html><title>Sign-in failed</title><p>Sign-in did not complete. Return to Cybercare Commons for details.</p>").into_response()
    }
}

#[tauri::command]
pub(crate) async fn cybercare_sign_in(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, crate::app_state::AppState>,
    pending: tauri::State<'_, CybercareSignIn>,
    community_id: String,
    config: CybercareConfig,
) -> Result<CybercareSessionInfo, String> {
    session_key(&community_id)?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("could not start local sign-in callback: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("could not read local sign-in callback: {error}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let pkce = Pkce::generate()?;
    let state = random_state()?;
    let url = authorize_url(&config, &redirect_uri, &pkce, &state)?;

    let (sender, receiver) = oneshot::channel();
    let router = Router::new()
        .route("/callback", get(callback))
        .with_state(std::sync::Arc::new(CallbackState {
            state,
            sender: Mutex::new(Some(sender)),
        }));
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        server.abort();
        return Err(format!("could not open the browser for sign-in: {error}"));
    }

    let (cancel_sender, mut cancel_receiver) = oneshot::channel();
    if let Ok(mut slot) = pending.0.lock() {
        if let Some(previous) = slot.replace(cancel_sender) {
            let _ = previous.send(());
        }
    }

    let outcome = tokio::select! {
        result = tokio::time::timeout(SIGN_IN_TIMEOUT, receiver) => match result {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("local sign-in callback stopped unexpectedly".to_owned()),
            Err(_) => Err("Cybercare sign-in timed out".to_owned()),
        },
        _ = &mut cancel_receiver => Err("Cybercare sign-in canceled".to_owned()),
    };
    server.abort();
    let code = outcome?;

    let tokens = post_token_form(
        &app_state.http_client,
        &config.token_endpoint()?,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", config.client_id()),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
            ("code_verifier", &pkce.verifier),
        ],
    )
    .await?;
    let session = StoredSession::from_tokens(tokens, now_secs())?;
    save_session(&community_id, &session)?;
    Ok(CybercareSessionInfo::from(&session))
}

#[tauri::command]
pub(crate) fn cybercare_cancel_sign_in(pending: tauri::State<'_, CybercareSignIn>) {
    if let Some(sender) = pending.0.lock().ok().and_then(|mut slot| slot.take()) {
        let _ = sender.send(());
    }
}

#[tauri::command]
pub(crate) fn cybercare_session(
    community_id: String,
) -> Result<Option<CybercareSessionInfo>, String> {
    Ok(load_session(&community_id)?
        .as_ref()
        .map(CybercareSessionInfo::from))
}

/// Ends the Keycloak session (best effort) and always forgets the tokens.
#[tauri::command]
pub(crate) async fn cybercare_sign_out(
    app_state: tauri::State<'_, crate::app_state::AppState>,
    community_id: String,
    config: CybercareConfig,
) -> Result<(), String> {
    if let Some(session) = load_session(&community_id)? {
        if let (Some(refresh_token), Ok(endpoint)) =
            (session.refresh_token.as_deref(), config.logout_endpoint())
        {
            let _ = app_state
                .http_client
                .post(endpoint)
                .form(&[
                    ("client_id", config.client_id()),
                    ("refresh_token", refresh_token),
                ])
                .timeout(HTTP_TIMEOUT)
                .send()
                .await;
        }
    }
    delete_session(&community_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> CybercareConfig {
        CybercareConfig {
            base_url: Some("http://127.0.0.1:8100/".into()),
            keycloak_url: "http://127.0.0.1:8026/auth/".into(),
            realm: "cybota".into(),
            client_id: None,
        }
    }

    fn jwt(payload: &str) -> String {
        format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(payload.as_bytes()))
    }

    #[test]
    fn pkce_matches_the_rfc_7636_appendix_b_vector() {
        let pkce = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        assert_eq!(
            pkce.challenge,
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn generated_verifiers_are_long_enough_and_unique() {
        let a = Pkce::generate().unwrap();
        let b = Pkce::generate().unwrap();
        assert!(a.verifier.len() >= 43 && a.verifier.len() <= 128);
        assert_ne!(a.verifier, b.verifier);
    }

    #[test]
    fn endpoints_keep_the_auth_prefix_and_drop_trailing_slashes() {
        let c = config();
        assert_eq!(
            c.token_endpoint().unwrap(),
            "http://127.0.0.1:8026/auth/realms/cybota/protocol/openid-connect/token"
        );
        assert_eq!(c.client_id(), DEFAULT_CLIENT_ID);
    }

    #[test]
    fn bad_realm_or_scheme_is_refused_before_any_request() {
        let mut c = config();
        c.realm = "cybota/../master".into();
        assert!(c.token_endpoint().is_err());
        let mut c = config();
        c.keycloak_url = "file:///etc/passwd".into();
        assert!(c.token_endpoint().is_err());
    }

    #[test]
    fn authorize_url_carries_pkce_s256_state_and_loopback_redirect() {
        let pkce = Pkce::from_verifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".into());
        let url = authorize_url(&config(), "http://127.0.0.1:5555/callback", &pkce, "st8").unwrap();
        let q: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "cybercare-commons");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], pkce.challenge);
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555/callback");
        assert_eq!(q["state"], "st8");
        assert!(!q.contains_key("code_verifier"));
    }

    #[test]
    fn callback_requires_matching_state_then_a_code() {
        let mut q = HashMap::new();
        q.insert("state".to_string(), "other".to_string());
        q.insert("code".to_string(), "abc".to_string());
        assert!(code_from_callback("st8", &q).is_err());
        q.insert("state".to_string(), "st8".to_string());
        assert_eq!(code_from_callback("st8", &q).unwrap(), "abc");
        q.remove("code");
        q.insert("error".to_string(), "access_denied".to_string());
        assert_eq!(
            code_from_callback("st8", &q).unwrap_err(),
            "Keycloak refused: access_denied"
        );
    }

    #[test]
    fn claims_read_organisation_id_as_list_or_single_value() {
        let many = decode_claims(&jwt(
            r#"{"sub":"u1","preferred_username":"wanjiru","organisation_id":["cb00","cb01"]}"#,
        ))
        .unwrap();
        assert_eq!(many.organisation_id, vec!["cb00", "cb01"]);
        let one = decode_claims(&jwt(r#"{"sub":"u1","organisation_id":"cb00"}"#)).unwrap();
        assert_eq!(one.organisation_id, vec!["cb00"]);
        let none = decode_claims(&jwt(r#"{"sub":"u1"}"#)).unwrap();
        assert!(none.organisation_id.is_empty());
    }

    #[test]
    fn session_from_tokens_requires_a_subject_and_computes_expiry() {
        let tokens = TokenResponse {
            access_token: jwt(r#"{"sub":"u1"}"#),
            refresh_token: Some("r".into()),
            expires_in: 300,
            id_token: None,
        };
        let session = StoredSession::from_tokens(tokens, 1_000).unwrap();
        assert_eq!(session.expires_at, 1_300);
        assert!(!session.needs_refresh(1_000));
        assert!(session.needs_refresh(1_271));
        let anonymous = TokenResponse {
            access_token: jwt(r#"{"sub":""}"#),
            refresh_token: None,
            expires_in: 300,
            id_token: None,
        };
        assert!(StoredSession::from_tokens(anonymous, 0).is_err());
    }

    #[test]
    fn session_info_never_carries_tokens() {
        let session = StoredSession::from_tokens(
            TokenResponse {
                access_token: jwt(r#"{"sub":"u1","email":"w@bank"}"#),
                refresh_token: Some("secret-refresh".into()),
                expires_in: 60,
                id_token: Some("secret-id".into()),
            },
            0,
        )
        .unwrap();
        let json = serde_json::to_string(&CybercareSessionInfo::from(&session)).unwrap();
        assert!(!json.contains("secret"));
        assert!(!json.contains(&session.access_token));
    }

    #[test]
    fn sessions_use_a_keyring_service_separate_from_the_identity() {
        let identity = crate::app_state::keyring_service();
        let sessions = session_service(identity);
        assert_ne!(sessions, identity);
        assert!(sessions.starts_with(identity));
    }

    #[test]
    fn session_keys_are_namespaced_and_reject_odd_ids() {
        assert_eq!(session_key("abc-1").unwrap(), "cybercare.session.abc-1");
        assert!(session_key("").is_err());
        assert!(session_key("a/b").is_err());
        assert!(session_key("cybercare.session.x").is_err());
    }
}

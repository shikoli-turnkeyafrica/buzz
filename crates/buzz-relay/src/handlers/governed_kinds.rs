//! Pure policy-evaluation core for Cybota governed decision kinds
//! (46200–46204 — digest/staged/advice/ratification/dissent).
//!
//! This is the security heart of Rung 1: the single function that decides
//! whether an author is authorized to post a governed decision event into a
//! channel, given the channel's (optional) governance policy and the
//! author's resolved authority. It is deliberately DB-free and total — no
//! IO, no panics, no `state`/`tenant`/pool — so it can be exhaustively unit
//! tested here and reused unchanged by the async gate in `ingest.rs` (Task 4)
//! that resolves the DB inputs and calls it.
//!
//! ## The security property (rulings D1/D4 — spec
//! `docs/superpowers/specs/2026-08-28-buzz-governed-kinds-design.md`)
//!
//! - A channel with **no** governance policy row is un-opted: every kind,
//!   governed or not, is allowed exactly as today (default-OPEN).
//! - A channel **with** a policy row is opted in: a governed kind the policy
//!   does not explicitly authorize is REJECTED, even if the kind is simply
//!   absent from the policy map (default-CLOSED once opted in).
//! - Any policy rule shape this function does not understand fails CLOSED
//!   (`Reject`, never `Allow`) — see [`evaluate_governed_post`]'s malformed
//!   arm.
//!
//! ## Deviation from the task brief
//!
//! The brief's sketch has `GovernedDecision::Reject(&'static str)`, but the
//! reject messages below interpolate the kind's label and (for role rules)
//! the required role — both of which are not known at compile time (the
//! role comes from the policy JSON at runtime). `Reject` therefore holds an
//! owned `String` here. This is a deliberate, honest deviation: the message
//! text is data, not a fixed set of `&'static str` literals.

use buzz_core::kind::{cybota_governed_kind_label, is_cybota_governed_kind};
use buzz_core::CommunityId;
use nostr::Event;

use super::ingest::{extract_channel_id, IngestError};

/// Resolved author authority for one channel, passed to the pure core.
///
/// Both fields are borrowed by the caller (Task 4's async gate) after it has
/// already done the DB reads and hex-encoding; this module never IOs to
/// produce them.
pub struct AuthorAuthority<'a> {
    /// Highest role the author holds in this channel/community:
    /// `Some("owner" | "admin" | "member")`, or `None` if the author holds
    /// no role at all.
    pub role: Option<&'a str>,
    /// The author's x-only pubkey hex (lowercase 64-char), for
    /// explicit-pubkey policies. Compared case-insensitively against the
    /// policy's pubkey list.
    pub pubkey_hex: &'a str,
}

/// The result of evaluating a governed post against the channel's policy.
///
/// `Reject` carries an owned, client-safe denial message (see module docs
/// for why this is `String` rather than `&'static str`). The message never
/// discloses the author's pubkey or which/how-many pubkeys are on an
/// allowlist — only the kind's label and (for role rules) the required
/// role.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GovernedDecision {
    /// The author is authorized to post this event.
    Allow,
    /// The author is not authorized; the message is safe to return to the
    /// client verbatim.
    Reject(String),
}

/// PURE. No IO, never panics. The whole governed-kind authorization
/// decision, given the three resolved inputs.
///
/// See module docs for the full security property. Branch order mirrors the
/// task brief's numbered logic exactly:
///
/// 1. Non-governed kind → `Allow` unconditionally (this core is total; the
///    async ingest gate also early-returns before ever calling this, but
///    the core must be correct standing alone).
/// 2. No policy row (`policy: None`) → `Allow` (un-opted channel).
/// 3. Policy present but has no rule for this kind → `Reject` (default
///    closed once opted in).
/// 4. Rule present → evaluated by shape (`role` or `pubkeys`); any other
///    shape fails closed.
pub fn evaluate_governed_post(
    kind: u32,
    policy: Option<&serde_json::Value>,
    author: &AuthorAuthority<'_>,
) -> GovernedDecision {
    if !is_cybota_governed_kind(kind) {
        return GovernedDecision::Allow;
    }

    // Label is guaranteed `Some` here: `is_cybota_governed_kind` and
    // `cybota_governed_kind_label` are defined over the exact same five-kind
    // set in buzz-core. Fall back to a generic word rather than panicking if
    // that invariant is ever violated — this function must never panic.
    let label = cybota_governed_kind_label(kind).unwrap_or("decision");

    let Some(policy) = policy else {
        // Un-opted channel: default-open (ruling D1).
        return GovernedDecision::Allow;
    };

    let Some(rule) = policy.get(kind.to_string()) else {
        // Opted-in channel with no rule for this kind: default-closed
        // (ruling D4).
        return GovernedDecision::Reject(format!(
            "restricted: {label} is not authorized in this channel"
        ));
    };

    evaluate_rule(rule, label, author)
}

/// Evaluate one rule value (the JSON found at `policy[kind]`) against the
/// author's resolved authority. Split out of [`evaluate_governed_post`] only
/// for readability — still pure, still total.
fn evaluate_rule(
    rule: &serde_json::Value,
    label: &str,
    author: &AuthorAuthority<'_>,
) -> GovernedDecision {
    let Some(obj) = rule.as_object() else {
        return malformed(label);
    };

    let has_role = obj.contains_key("role");
    let has_pubkeys = obj.contains_key("pubkeys");

    match (has_role, has_pubkeys) {
        (true, false) => {
            let Some(required_role) = obj.get("role").and_then(|v| v.as_str()) else {
                // "role" present but not a string.
                return malformed(label);
            };
            let authorized = match required_role {
                "owner" => author.role == Some("owner"),
                "admin" => matches!(author.role, Some("owner") | Some("admin")),
                "member" => author.role.is_some(),
                _ => {
                    // Unknown role value — fail closed, never guess a policy.
                    return malformed(label);
                }
            };
            if authorized {
                GovernedDecision::Allow
            } else {
                GovernedDecision::Reject(format!(
                    "restricted: {label} may only be authored by the channel {required_role}"
                ))
            }
        }
        (false, true) => {
            let Some(pubkeys) = obj.get("pubkeys").and_then(|v| v.as_array()) else {
                // "pubkeys" present but not an array.
                return malformed(label);
            };
            // Every entry must be a string for the allowlist to be
            // well-formed; a non-string entry anywhere fails the whole rule
            // closed rather than silently skipping it.
            let mut authorized = false;
            for entry in pubkeys {
                let Some(s) = entry.as_str() else {
                    return malformed(label);
                };
                if s.eq_ignore_ascii_case(author.pubkey_hex) {
                    authorized = true;
                    // Keep scanning: a later malformed entry must still be
                    // caught (fail-closed takes priority over an early
                    // match, since malformed policy is a config error the
                    // channel owner needs to see, not one this call should
                    // paper over).
                }
            }
            if authorized {
                GovernedDecision::Allow
            } else {
                // Never disclose which pubkey (or how many) is on the
                // allowlist — the message only names the kind's label.
                GovernedDecision::Reject(format!(
                    "restricted: {label} may only be authored by the designated author"
                ))
            }
        }
        // Neither key, or both keys present, or not an object at all
        // (handled above): every other shape is malformed. Fail closed.
        _ => malformed(label),
    }
}

fn malformed(label: &str) -> GovernedDecision {
    GovernedDecision::Reject(format!("restricted: {label} policy is malformed"))
}

/// Task 4: the async ingest-time gate. This is the only place the pure core
/// above is called from production code — it resolves the three DB-backed
/// inputs (`extract_channel_id`, `get_channel_governance_policy`, and the
/// author's resolved role) and hands them to [`evaluate_governed_post`]
/// unchanged.
///
/// Wired into `handle_event`/`ingest_event_inner` (ingest.rs) immediately
/// after the scope check and before command-kind routing.
///
/// ## The zero-cost common path (structural, not just a doc claim)
///
/// The very first statement is the non-governed-kind early return, and it
/// returns before `db` is ever named again — every `db.*().await` call below
/// it is unreachable for a non-governed kind. A reviewer can verify this by
/// inspection: there is no `.await` on `db` above the `is_cybota_governed_kind`
/// check, and the check is the function's first line.
pub async fn enforce_governed_kind_policy(
    db: &buzz_db::Db,
    community: CommunityId,
    event: &Event,
    kind: u32,
) -> Result<(), IngestError> {
    if !is_cybota_governed_kind(kind) {
        return Ok(());
    }

    let Some(channel_id) = extract_channel_id(event) else {
        return Err(IngestError::Rejected(
            "restricted: governed event requires a channel".into(),
        ));
    };

    // The pure core treats an empty `pubkey_hex` as an empty string to
    // compare against a `pubkeys` allowlist — which can never match a
    // populated allowlist, but *would* vacuously match an explicit `[""]`
    // entry, and (more importantly) is simply the wrong shape of input to
    // hand to a security decision. `nostr::PublicKey::to_hex()` always
    // produces exactly 64 lowercase hex chars in practice, but this gate
    // must never trust that invariant blindly for a value that flows into
    // an authorization decision — so it is checked explicitly, via a
    // free function so the guard itself is unit-testable without needing
    // to forge a malformed `Event`.
    let pubkey_hex = event.pubkey.to_hex();
    if !is_well_formed_pubkey_hex(&pubkey_hex) {
        return Err(IngestError::Rejected(
            "restricted: invalid author identity".into(),
        ));
    }

    let policy = db
        .get_channel_governance_policy(community, channel_id)
        .await
        .map_err(|e| IngestError::Internal(format!("error: {e}")))?;

    // Resolve the author's highest role from both the community-wide
    // `relay_members` roll (mirrors moderation_authz.rs's tenant-fenced
    // query) and the channel-local `channel_members` roll. Neither read is
    // skipped: a community owner who never joined this channel must still
    // be recognized as owner, and a channel owner who holds no community
    // role must still be recognized as channel owner.
    //
    // Both resolved strings are passed through `qualifying_role` before
    // ranking: `channel_members.role` is a 5-value enum (owner/admin/member/
    // guest/bot — `MemberRole` in buzz-core), and `guest`/`bot` are NOT
    // authority the pure core's `role: "member"` arm may treat as
    // `author.role.is_some()` — a read-only guest or an automated bot must
    // never satisfy a member-gated governed-kind policy. `relay_members.role`
    // is already 3-valued by its own DB CHECK constraint, but is filtered
    // too, for defense in depth and so this invariant lives in one place.
    let community_role = qualifying_role(
        db.get_relay_member(community, &pubkey_hex)
            .await
            .map_err(|e| IngestError::Internal(format!("error: {e}")))?
            .map(|m| m.role),
    );
    let channel_role = qualifying_role(
        db.get_member_role(community, channel_id, event.pubkey.as_bytes())
            .await
            .map_err(|e| IngestError::Internal(format!("error: {e}")))?,
    );

    let role = highest_role(community_role.as_deref(), channel_role.as_deref());
    let author = AuthorAuthority {
        role,
        pubkey_hex: &pubkey_hex,
    };

    match evaluate_governed_post(kind, policy.as_ref(), &author) {
        GovernedDecision::Allow => Ok(()),
        GovernedDecision::Reject(msg) => Err(IngestError::Rejected(msg)),
    }
}

/// `true` iff `pubkey_hex` is exactly 64 lowercase-or-uppercase hex chars —
/// the only shape `evaluate_governed_post` should ever be trusted with for
/// an identity comparison. Split out as a free function so the guard is
/// exercisable without needing to construct a malformed signed `Event`
/// (`nostr::PublicKey` cannot represent an empty or short key).
fn is_well_formed_pubkey_hex(pubkey_hex: &str) -> bool {
    pubkey_hex.len() == 64 && pubkey_hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// `Some(role)` only for the three role strings [`AuthorAuthority::role`]'s
/// doc comment promises (`"owner"`, `"admin"`, `"member"`) — anything else
/// (`"guest"`, `"bot"`, or any other unrecognized value a role column might
/// ever hold) normalizes to `None`, i.e. "no qualifying authority".
///
/// This is the fix for a wrong-Allow: `channel_members.role` is a 5-value
/// enum (`MemberRole` in buzz-core: owner/admin/member/guest/bot), and the
/// pure core's `role: "member"` rule treats *any* `Some(_)` as satisfying
/// membership (`author.role.is_some()`). Without this filter, a read-only
/// `guest` or a `bot` (buzz-core's own docs: guest = "read-only external
/// participant", bot = "not in the role hierarchy") could author a
/// member-gated governed decision — a privilege escalation. Called on both
/// the community-role and channel-role strings before either reaches
/// [`highest_role`] or [`AuthorAuthority`], so an unqualified role can never
/// be ranked, never substitutes for a real role, and never reaches the pure
/// core at all.
fn qualifying_role(role: Option<String>) -> Option<String> {
    match role.as_deref() {
        Some("owner") | Some("admin") | Some("member") => role,
        _ => None,
    }
}

/// The stronger of two resolved roles, per the precedence
/// `owner > admin > member > none`. Ties keep the first (community)
/// argument; either side may be `None`.
///
/// Callers MUST run both inputs through [`qualifying_role`] first: this
/// function has no way to distinguish a legitimate role from an unqualified
/// one (e.g. `guest`/`bot`) — the `Some(_) => 1` arm below only exists as a
/// defense-in-depth fallback (ranked below `member`, never elevated to it)
/// in case that invariant is ever violated by a future caller. See
/// `gate_tests::highest_role_ranks_unqualified_strings_below_member` for
/// what that fallback guarantees — it is not a claim that any string is a
/// usable role.
fn highest_role<'a>(
    community_role: Option<&'a str>,
    channel_role: Option<&'a str>,
) -> Option<&'a str> {
    fn rank(role: Option<&str>) -> u8 {
        match role {
            Some("owner") => 4,
            Some("admin") => 3,
            Some("member") => 2,
            Some(_) => 1,
            None => 0,
        }
    }
    if rank(community_role) >= rank(channel_role) {
        community_role
    } else {
        channel_role
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::kind::{
        KIND_CYBOTA_ADVICE, KIND_CYBOTA_DIGEST, KIND_CYBOTA_DISSENT, KIND_CYBOTA_RATIFICATION,
        KIND_CYBOTA_STAGED,
    };
    use serde_json::json;

    const EXPERT_PUBKEY: &str = "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd12";
    const OWNER_PUBKEY: &str = "1111111111111111111111111111111111111111111111111111111111ab";
    const OTHER_PUBKEY: &str = "9999999999999999999999999999999999999999999999999999999999cd";

    fn author<'a>(role: Option<&'a str>, pubkey_hex: &'a str) -> AuthorAuthority<'a> {
        AuthorAuthority { role, pubkey_hex }
    }

    fn assert_allow(decision: GovernedDecision) {
        assert_eq!(decision, GovernedDecision::Allow);
    }

    fn assert_reject_containing(decision: GovernedDecision, needle: &str) -> String {
        match decision {
            GovernedDecision::Reject(msg) => {
                assert!(
                    msg.contains(needle),
                    "expected reject message to contain {needle:?}, got {msg:?}"
                );
                msg
            }
            GovernedDecision::Allow => panic!("expected Reject containing {needle:?}, got Allow"),
        }
    }

    // ---- 1. Non-governed kinds are always Allow, policy or not ----

    #[test]
    fn non_governed_kind_is_always_allowed_even_with_a_policy_present() {
        let policy = json!({ "46203": { "role": "owner" } });
        assert_allow(evaluate_governed_post(
            9,
            Some(&policy),
            &author(None, OTHER_PUBKEY),
        ));
        assert_allow(evaluate_governed_post(9, None, &author(None, OTHER_PUBKEY)));
    }

    // ---- 2. No policy row -> Allow (un-opted, default-open) ----

    #[test]
    fn governed_kind_with_no_policy_row_is_allowed() {
        for kind in [
            KIND_CYBOTA_DIGEST,
            KIND_CYBOTA_STAGED,
            KIND_CYBOTA_ADVICE,
            KIND_CYBOTA_RATIFICATION,
            KIND_CYBOTA_DISSENT,
        ] {
            assert_allow(evaluate_governed_post(
                kind,
                None,
                &author(None, OTHER_PUBKEY),
            ));
        }
    }

    // ---- 3. Policy present but omits this kind -> Reject, default-closed ----

    #[test]
    fn governed_kind_omitted_from_present_policy_is_rejected_default_closed() {
        // Policy opts the channel in for a *different* kind only.
        let policy = json!({ "46203": { "role": "owner" } });
        let msg = assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_ADVICE,
                Some(&policy),
                &author(Some("owner"), OTHER_PUBKEY),
            ),
            "is not authorized in this channel",
        );
        assert!(msg.contains("advice"), "expected label in message: {msg:?}");
    }

    // ---- Ratification (46203), role: owner ----

    #[test]
    fn ratification_role_owner_allows_only_exact_owner() {
        let policy = json!({ "46203": { "role": "owner" } });
        assert_allow(evaluate_governed_post(
            KIND_CYBOTA_RATIFICATION,
            Some(&policy),
            &author(Some("owner"), OTHER_PUBKEY),
        ));
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(Some("admin"), OTHER_PUBKEY),
            ),
            "may only be authored by the channel owner",
        );
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(Some("member"), OTHER_PUBKEY),
            ),
            "may only be authored by the channel owner",
        );
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(None, OTHER_PUBKEY),
            ),
            "may only be authored by the channel owner",
        );
    }

    // ---- Advice (46202), pubkeys allowlist ----

    #[test]
    fn advice_pubkeys_allows_only_the_listed_key_case_insensitively() {
        let policy = json!({ "46202": { "pubkeys": [EXPERT_PUBKEY] } });

        // Exact match.
        assert_allow(evaluate_governed_post(
            KIND_CYBOTA_ADVICE,
            Some(&policy),
            &author(None, EXPERT_PUBKEY),
        ));
        // Case-insensitive match.
        let uppercased = EXPERT_PUBKEY.to_uppercase();
        assert_allow(evaluate_governed_post(
            KIND_CYBOTA_ADVICE,
            Some(&policy),
            &author(None, &uppercased),
        ));
        // A different key, even with role owner, is rejected: role does not
        // substitute for the bound identity (ATTACK 2).
        let msg = assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_ADVICE,
                Some(&policy),
                &author(Some("owner"), OWNER_PUBKEY),
            ),
            "may only be authored by the designated author",
        );
        // Never echo which pubkey (or how many) is on the allowlist.
        assert!(!msg.to_lowercase().contains(&EXPERT_PUBKEY.to_lowercase()));
        assert!(!msg.to_lowercase().contains(&OWNER_PUBKEY.to_lowercase()));
    }

    // ---- Digest/Staged/Dissent, role: member ----

    #[test]
    fn member_role_rule_allows_any_role_denies_none() {
        for kind in [KIND_CYBOTA_DIGEST, KIND_CYBOTA_STAGED, KIND_CYBOTA_DISSENT] {
            let policy = json!({ kind.to_string(): { "role": "member" } });
            for role in ["owner", "admin", "member"] {
                assert_allow(evaluate_governed_post(
                    kind,
                    Some(&policy),
                    &author(Some(role), OTHER_PUBKEY),
                ));
            }
            assert_reject_containing(
                evaluate_governed_post(kind, Some(&policy), &author(None, OTHER_PUBKEY)),
                "may only be authored by the channel member",
            );
        }
    }

    // ---- role: admin, owner satisfies admin ----

    #[test]
    fn admin_rule_is_satisfied_by_owner_and_admin_but_not_member() {
        let policy = json!({ "46201": { "role": "admin" } });
        assert_allow(evaluate_governed_post(
            KIND_CYBOTA_STAGED,
            Some(&policy),
            &author(Some("owner"), OTHER_PUBKEY),
        ));
        assert_allow(evaluate_governed_post(
            KIND_CYBOTA_STAGED,
            Some(&policy),
            &author(Some("admin"), OTHER_PUBKEY),
        ));
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_STAGED,
                Some(&policy),
                &author(Some("member"), OTHER_PUBKEY),
            ),
            "may only be authored by the channel admin",
        );
    }

    // ---- Malformed rule shapes: fail closed, never Allow ----

    #[test]
    fn malformed_rule_shapes_all_fail_closed() {
        let cases: Vec<serde_json::Value> = vec![
            json!({ "role": 5 }),
            json!({ "role": "emperor" }),
            json!({ "pubkeys": "notarray" }),
            json!({ "pubkeys": [5] }),
            json!({ "nonsense": true }),
            json!("just a string"),
            json!({}),
            json!({ "role": "owner", "pubkeys": [EXPERT_PUBKEY] }),
        ];
        for rule in cases {
            let policy = json!({ "46203": rule.clone() });
            let msg = assert_reject_containing(
                evaluate_governed_post(
                    KIND_CYBOTA_RATIFICATION,
                    Some(&policy),
                    &author(Some("owner"), OWNER_PUBKEY),
                ),
                "policy is malformed",
            );
            assert!(
                msg.contains("ratification"),
                "expected label in malformed message for rule {rule:?}: {msg:?}"
            );
        }
    }

    #[test]
    fn malformed_pubkeys_entry_fails_closed_even_when_a_valid_entry_also_matches() {
        // A mixed array (one good string entry that matches the author, one
        // non-string entry) must still fail closed — a malformed policy is a
        // config error, not something to silently tolerate.
        let policy = json!({ "46202": { "pubkeys": [EXPERT_PUBKEY, 5] } });
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_ADVICE,
                Some(&policy),
                &author(None, EXPERT_PUBKEY),
            ),
            "policy is malformed",
        );
    }

    // ---- Hardening round (coordinator security review): committed
    // regression tests for adversarial shapes previously proven safe only in
    // an external review harness, not pinned by any test in this file. ----

    // ---- DEFAULT-CLOSED on non-object policy shapes ----
    //
    // `serde_json::Value::get` returns `None` for any non-object target
    // (Null, Array, Number, String), so a `policy: Some(...)` that isn't a
    // JSON object at all takes the same "rule absent" branch as an object
    // policy that simply omits the kind — default-closed once opted in,
    // never a wrong-Allow, and never a panic. Confirmed here as committed
    // coverage for each shape individually.
    #[test]
    fn default_closed_on_non_object_policy_shapes() {
        let cases: [(&str, serde_json::Value); 5] = [
            ("null", serde_json::Value::Null),
            ("empty array", json!([])),
            ("scalar number", json!(5)),
            ("scalar string", json!("hi")),
            ("empty object (no rule for this kind)", json!({})),
        ];
        for (name, policy) in cases {
            assert_reject_containing(
                evaluate_governed_post(
                    KIND_CYBOTA_RATIFICATION,
                    Some(&policy),
                    // Even the channel owner is rejected here — this is the
                    // default-closed/rule-absent path, not a role check.
                    &author(Some("owner"), OWNER_PUBKEY),
                ),
                "is not authorized in this channel",
            );
            let _ = name; // case label kept for failure messages via loop position
        }
    }

    // ---- MALFORMED rule shapes: fail-closed, never a wrong-Allow, never a panic ----

    #[test]
    fn malformed_rule_value_is_json_null() {
        // {"46203": null} — the rule itself parses but isn't an object.
        let policy = json!({ "46203": null });
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(Some("owner"), OWNER_PUBKEY),
            ),
            "policy is malformed",
        );
    }

    #[test]
    fn malformed_role_value_is_json_null() {
        // {"46203": {"role": null}} — "role" key present but not a string.
        let policy = json!({ "46203": { "role": null } });
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(Some("owner"), OWNER_PUBKEY),
            ),
            "policy is malformed",
        );
    }

    #[test]
    fn malformed_role_value_case_variants_are_unknown_not_wrong_allow() {
        // "Owner"/"OWNER" are NOT case-normalized against the canonical
        // lowercase "owner" — an unrecognized role value must fail closed as
        // malformed, and must NEVER be silently treated as authorized
        // (a wrong-Allow here would be a privilege-escalation bug).
        for variant in ["Owner", "OWNER"] {
            let policy = json!({ "46203": { "role": variant } });
            assert_reject_containing(
                evaluate_governed_post(
                    KIND_CYBOTA_RATIFICATION,
                    Some(&policy),
                    &author(Some("owner"), OWNER_PUBKEY),
                ),
                "policy is malformed",
            );
        }
    }

    #[test]
    fn malformed_role_value_trailing_space_is_unknown() {
        // {"46203": {"role": "admin "}} — a stray trailing space makes the
        // value an unrecognized string, not "admin". Fail closed.
        let policy = json!({ "46203": { "role": "admin " } });
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(Some("admin"), OWNER_PUBKEY),
            ),
            "policy is malformed",
        );
    }

    #[test]
    fn malformed_pubkeys_non_string_entries_do_not_panic() {
        // {"46202": {"pubkeys": [null]}}, [5], [{}] — each non-string entry
        // must fail the whole rule closed via a checked `as_str()` match,
        // never an indexing/unwrap panic.
        for entry in [json!(null), json!(5), json!({})] {
            let policy = json!({ "46202": { "pubkeys": [entry.clone()] } });
            assert_reject_containing(
                evaluate_governed_post(
                    KIND_CYBOTA_ADVICE,
                    Some(&policy),
                    &author(None, EXPERT_PUBKEY),
                ),
                "policy is malformed",
            );
        }
    }

    #[test]
    fn malformed_rule_with_both_role_and_pubkeys_present() {
        // {"46203": {"role":"owner","pubkeys":[...]}} — an ambiguous rule
        // that names both a role and an allowlist must fail closed rather
        // than picking one arbitrarily.
        let policy = json!({ "46203": { "role": "owner", "pubkeys": [EXPERT_PUBKEY] } });
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(Some("owner"), OWNER_PUBKEY),
            ),
            "policy is malformed",
        );
    }

    // ---- PUBKEY empty allowlist and near-miss strings ----

    #[test]
    fn pubkeys_empty_allowlist_never_allows_anyone() {
        // {"46202": {"pubkeys": []}} — an empty allowlist must reject every
        // author, including the channel owner. An empty list is not the
        // same as "no rule" and must not default-open.
        let policy = json!({ "46202": { "pubkeys": [] } });
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_ADVICE,
                Some(&policy),
                &author(Some("owner"), OWNER_PUBKEY),
            ),
            "may only be authored by the designated author",
        );
    }

    #[test]
    fn pubkeys_near_miss_strings_fail_closed() {
        // pubkeys:[X], author "0x"+X (prefixed) and " "+X (leading space) —
        // neither is byte-equal (case-insensitively) to X, so both must
        // reject. Proves the match is exact-modulo-case, not a substring or
        // trimmed comparison.
        let policy = json!({ "46202": { "pubkeys": [EXPERT_PUBKEY] } });
        let prefixed = format!("0x{EXPERT_PUBKEY}");
        let leading_space = format!(" {EXPERT_PUBKEY}");
        for candidate in [prefixed, leading_space] {
            assert_reject_containing(
                evaluate_governed_post(
                    KIND_CYBOTA_ADVICE,
                    Some(&policy),
                    &author(None, &candidate),
                ),
                "may only be authored by the designated author",
            );
        }
    }

    // ---- ATTACK 1: forged ratification ----
    //
    // The core guarantee this proves: any room writer (a plain member) can
    // never ratify a decision gated `role: owner`. This is the "any room
    // writer can't ratify" property, moved from the application layer (where
    // it was previously just a convention Sherpa's client happened to
    // respect) down into the relay itself, where a forged/compromised client
    // cannot bypass it.
    #[test]
    fn attack_forged_ratification_by_member_is_rejected() {
        let policy = json!({ "46203": { "role": "owner" } });
        assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_RATIFICATION,
                Some(&policy),
                &author(Some("member"), OTHER_PUBKEY),
            ),
            "may only be authored by the channel owner",
        );
    }

    // ---- ATTACK 2: forged advice under a foreign key ----
    //
    // The core guarantee this proves: an explicit `pubkeys` allowlist binds
    // to an *identity*, not a *role*. Being the channel owner (the highest
    // role in the system) must NOT let you author advice bound to a
    // different, specific expert pubkey — role can never substitute for the
    // bound identity.
    #[test]
    fn attack_forged_advice_under_foreign_key_owner_role_does_not_substitute() {
        let policy = json!({ "46202": { "pubkeys": [EXPERT_PUBKEY] } });
        let msg = assert_reject_containing(
            evaluate_governed_post(
                KIND_CYBOTA_ADVICE,
                Some(&policy),
                &author(Some("owner"), OWNER_PUBKEY),
            ),
            "may only be authored by the designated author",
        );
        assert!(!msg.to_lowercase().contains(&OWNER_PUBKEY.to_lowercase()));
        assert!(!msg.to_lowercase().contains(&EXPERT_PUBKEY.to_lowercase()));
    }
}

/// Task 4: tests for the async ingest-time gate (`enforce_governed_kind_policy`).
///
/// Split from the pure-core `mod tests` above: these tests exercise real IO
/// (a Postgres pool) and the DB-role-resolution logic the pure core never
/// sees. Fast, network-free tests (the early-return path, the no-h-tag
/// rejection, and the pubkey-shape guard) are plain `#[tokio::test]`s; tests
/// that need seeded rows are `#[ignore = "requires Postgres"]` against
/// `BUZZ_TEST_DATABASE_URL`, mirroring `ingest.rs`'s
/// `ingest_write_fence_follows_community_deletion_lifecycle` and
/// buzz-db's `channel.rs` governance-policy tests.
#[cfg(test)]
mod gate_tests {
    use super::*;
    use buzz_core::channel::{ChannelType, ChannelVisibility, MemberRole};
    use buzz_core::kind::{
        KIND_CYBOTA_ADVICE, KIND_CYBOTA_DIGEST, KIND_CYBOTA_RATIFICATION, KIND_CYBOTA_STAGED,
    };
    use nostr::{EventBuilder, Keys, Kind, Tag};
    use uuid::Uuid;

    fn signed_event(keys: &Keys, kind: u32, tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::Custom(kind as u16), "")
            .tags(tags)
            .sign_with_keys(keys)
            .expect("sign test event")
    }

    fn h_tag(channel_id: Uuid) -> Tag {
        Tag::parse(["h", &channel_id.to_string()]).expect("valid h tag")
    }

    /// A pool that resolves the hostname to nothing and is built with
    /// `connect_lazy`, so constructing it never dials out — a query
    /// attempted against it would eventually error, but merely *holding*
    /// one proves nothing was queried yet. Used to prove the early-return
    /// and no-h-tag paths never touch `db`.
    fn never_queried_db() -> buzz_db::Db {
        let pool =
            sqlx::PgPool::connect_lazy("postgres://nobody:nobody@203.0.113.1:5432/does-not-exist")
                .expect("connect_lazy never dials out at construction time");
        buzz_db::Db::from_pool(pool)
    }

    // ---- Structural: non-governed kind never touches the db ----

    #[tokio::test]
    async fn non_governed_kind_is_ok_and_never_queries_the_db() {
        let db = never_queried_db();
        let community = CommunityId::from_uuid(Uuid::new_v4());
        let keys = Keys::generate();
        // Even inside a channel and even for a kind that, if it were
        // governed, would be gated — kind 9 (ordinary text note) is not
        // governed, so this must resolve to Ok without ever awaiting a
        // query on the unreachable `db` above (which would hang/error).
        let event = signed_event(&keys, 9, vec![h_tag(Uuid::new_v4())]);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            enforce_governed_kind_policy(&db, community, &event, 9),
        )
        .await
        .expect("must return immediately: no db query on the non-governed path");
        assert!(
            result.is_ok(),
            "non-governed kind must be Ok, got {result:?}"
        );
    }

    // ---- No h tag -> Rejected, before any db query ----

    #[tokio::test]
    async fn governed_kind_with_no_h_tag_is_rejected_without_a_db_query() {
        let db = never_queried_db();
        let community = CommunityId::from_uuid(Uuid::new_v4());
        let keys = Keys::generate();
        let event = signed_event(&keys, KIND_CYBOTA_RATIFICATION, vec![]);
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            enforce_governed_kind_policy(&db, community, &event, KIND_CYBOTA_RATIFICATION),
        )
        .await
        .expect("must return immediately: no db query before the h-tag check");
        match result {
            Err(IngestError::Rejected(msg)) => {
                assert!(
                    msg.contains("requires a channel"),
                    "unexpected message: {msg:?}"
                );
            }
            other => panic!("expected Rejected, got {other:?}"),
        }
    }

    // ---- The empty/malformed pubkey guard, unit-tested directly ----
    //
    // `nostr::PublicKey::to_hex()` always yields exactly 64 lowercase hex
    // chars in practice, so a real `Event` can never carry an empty or
    // malformed pubkey through this path — but the gate must never simply
    // trust that. The guard is a free function precisely so it can be
    // exercised here without forging an impossible `Event`.
    #[test]
    fn pubkey_guard_rejects_empty_and_malformed_hex() {
        assert!(!is_well_formed_pubkey_hex(""));
        assert!(!is_well_formed_pubkey_hex("abcd"));
        // 63 chars: one short of a real pubkey.
        assert!(!is_well_formed_pubkey_hex(&"a".repeat(63)));
        // 65 chars: one over.
        assert!(!is_well_formed_pubkey_hex(&"a".repeat(65)));
        // Right length, non-hex character.
        assert!(!is_well_formed_pubkey_hex(&format!("{}z", "a".repeat(63))));
        // A real, well-formed pubkey hex must pass.
        assert!(is_well_formed_pubkey_hex(
            &Keys::generate().public_key().to_hex()
        ));
    }

    #[test]
    fn highest_role_picks_the_strongest_present() {
        assert_eq!(highest_role(Some("owner"), Some("admin")), Some("owner"));
        assert_eq!(highest_role(Some("admin"), Some("owner")), Some("owner"));
        assert_eq!(highest_role(None, Some("owner")), Some("owner"));
        assert_eq!(highest_role(Some("member"), None), Some("member"));
        assert_eq!(highest_role(None, None), None);
    }

    // ---- wrong-Allow regression: guest/bot must never qualify ----

    #[test]
    fn qualifying_role_admits_only_owner_admin_member() {
        assert_eq!(
            qualifying_role(Some("owner".to_string())),
            Some("owner".to_string())
        );
        assert_eq!(
            qualifying_role(Some("admin".to_string())),
            Some("admin".to_string())
        );
        assert_eq!(
            qualifying_role(Some("member".to_string())),
            Some("member".to_string())
        );
        // The wrong-Allow this whole fix exists for: channel_members.role
        // also admits "guest" (read-only external participant) and "bot"
        // (never meets any role requirement) — neither is a qualifying
        // authority.
        assert_eq!(qualifying_role(Some("guest".to_string())), None);
        assert_eq!(qualifying_role(Some("bot".to_string())), None);
        // Any other unrecognized string, and no role at all, also normalize
        // to None rather than being passed through.
        assert_eq!(qualifying_role(Some("emperor".to_string())), None);
        assert_eq!(qualifying_role(None), None);
    }

    /// Defense-in-depth only (see `highest_role`'s doc comment): proves an
    /// unqualified string can never outrank — or be mistaken for — `member`,
    /// in case `qualifying_role` were ever skipped by a future caller. This
    /// is NOT a claim that `"guest"`/`"bot"` are usable roles; the gate never
    /// lets them reach `highest_role` in the first place (see
    /// `channel_guest_and_bot_never_qualify_for_a_role_member_policy` below
    /// for the real, end-to-end regression proof).
    #[test]
    fn highest_role_ranks_unqualified_strings_below_member_never_elevating_them() {
        assert_eq!(highest_role(Some("member"), Some("guest")), Some("member"));
        assert_eq!(highest_role(Some("guest"), Some("member")), Some("member"));
        // An unqualified string alone (no real role on either side) is still
        // ranked above `None` here — which is exactly why `qualifying_role`
        // MUST run first: this function alone cannot make "guest" disappear.
        assert_eq!(highest_role(None, Some("guest")), Some("guest"));
    }

    // ---- DB-backed fixtures ----

    async fn test_db_and_pool() -> (buzz_db::Db, sqlx::PgPool) {
        let url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .or_else(|_| std::env::var("TEST_DATABASE_URL"))
            .unwrap_or_else(|_| "postgres://buzz:buzz_dev@localhost:55432/buzz".to_string()); // sadscan:disable np.postgres.1 -- local test-only credentials
        let pool = sqlx::PgPool::connect(&url).await.expect("connect test DB");
        (buzz_db::Db::from_pool(pool.clone()), pool)
    }

    async fn seed_community(db: &buzz_db::Db) -> CommunityId {
        let host = format!("governed-gate-{}.example", Uuid::new_v4().simple());
        db.ensure_configured_community(&host)
            .await
            .expect("seed community")
            .id
    }

    async fn seed_channel(db: &buzz_db::Db, community: CommunityId, creator: &[u8]) -> Uuid {
        db.create_channel(
            community,
            "governed-gate-channel",
            ChannelType::Stream,
            ChannelVisibility::Open,
            None,
            creator,
            None,
        )
        .await
        .expect("create channel")
        .id
    }

    async fn set_policy(
        pool: &sqlx::PgPool,
        community: CommunityId,
        channel_id: Uuid,
        policy: serde_json::Value,
    ) {
        sqlx::query(
            "INSERT INTO channel_governance_policy (community_id, channel_id, policy) \
             VALUES ($1, $2, $3)",
        )
        .bind(community.as_uuid())
        .bind(channel_id)
        .bind(&policy)
        .execute(pool)
        .await
        .expect("seed governance policy");
    }

    /// Un-opted channel (no policy row): a governed kind by a plain member
    /// is allowed — default-open (ruling D1), proven through the real DB
    /// role-resolution path rather than the pure core directly.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn unopted_channel_allows_governed_kind_from_a_member() {
        let (db, _pool) = test_db_and_pool().await;
        let community = seed_community(&db).await;
        let owner_keys = Keys::generate();
        let owner_bytes = owner_keys.public_key().to_bytes();
        let channel_id = seed_channel(&db, community, &owner_bytes).await;

        let member_keys = Keys::generate();
        let member_bytes = member_keys.public_key().to_bytes();
        db.add_member(
            community,
            channel_id,
            &member_bytes,
            buzz_core::channel::MemberRole::Member,
            Some(&owner_bytes),
        )
        .await
        .expect("add member");

        let event = signed_event(&member_keys, KIND_CYBOTA_DIGEST, vec![h_tag(channel_id)]);
        let result = enforce_governed_kind_policy(&db, community, &event, KIND_CYBOTA_DIGEST).await;
        assert!(
            result.is_ok(),
            "expected Ok on un-opted channel, got {result:?}"
        );
    }

    /// `{"46203":{"role":"owner"}}`: a plain member is rejected (and the
    /// rejection names the required role), the channel owner is allowed.
    /// This is ATTACK 1 (forged ratification) proven end-to-end through the
    /// real DB, not just the pure core.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn ratification_role_owner_policy_rejects_member_allows_owner() {
        let (db, pool) = test_db_and_pool().await;
        let community = seed_community(&db).await;
        let owner_keys = Keys::generate();
        let owner_bytes = owner_keys.public_key().to_bytes();
        let channel_id = seed_channel(&db, community, &owner_bytes).await;

        let member_keys = Keys::generate();
        let member_bytes = member_keys.public_key().to_bytes();
        db.add_member(
            community,
            channel_id,
            &member_bytes,
            buzz_core::channel::MemberRole::Member,
            Some(&owner_bytes),
        )
        .await
        .expect("add member");

        set_policy(
            &pool,
            community,
            channel_id,
            serde_json::json!({ "46203": { "role": "owner" } }),
        )
        .await;

        // ATTACK: a forged ratification from a plain member must be
        // rejected by the gate — never allowed to reach storage.
        let forged = signed_event(
            &member_keys,
            KIND_CYBOTA_RATIFICATION,
            vec![h_tag(channel_id)],
        );
        let forged_result =
            enforce_governed_kind_policy(&db, community, &forged, KIND_CYBOTA_RATIFICATION).await;
        match forged_result {
            Err(IngestError::Rejected(msg)) => {
                assert!(msg.contains("owner"), "unexpected message: {msg:?}");
            }
            other => panic!("expected Rejected for member-forged ratification, got {other:?}"),
        }

        // Storage-absence proof (gate level, per Task 4 brief's fallback):
        // the forged event's id was never even attempted for storage — the
        // gate rejected it before `ingest_event_inner` reaches any of its
        // `dispatch_persistent_event` calls (ingest.rs, well after this
        // gate's insertion point). Confirm directly against the events
        // table that nothing was ever written for this id.
        let stored: Option<(Vec<u8>,)> = sqlx::query_as("SELECT id FROM events WHERE id = $1")
            .bind(forged.id.as_bytes().to_vec())
            .fetch_optional(&pool)
            .await
            .expect("query events table");
        assert!(
            stored.is_none(),
            "forged ratification must be absent from storage after rejection"
        );

        // The legitimate owner posting the same kind is allowed.
        let legit = signed_event(
            &owner_keys,
            KIND_CYBOTA_RATIFICATION,
            vec![h_tag(channel_id)],
        );
        let legit_result =
            enforce_governed_kind_policy(&db, community, &legit, KIND_CYBOTA_RATIFICATION).await;
        assert!(
            legit_result.is_ok(),
            "expected Ok for owner ratification, got {legit_result:?}"
        );
    }

    /// `{"46202":{"pubkeys":["<experthex>"]}}`: a non-listed key — even the
    /// channel owner — is rejected; the listed expert key is allowed. This
    /// is ATTACK 2 (role does not substitute for a bound identity), proven
    /// end-to-end through the real DB.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn advice_pubkeys_policy_rejects_owner_allows_bound_expert() {
        let (db, pool) = test_db_and_pool().await;
        let community = seed_community(&db).await;
        let owner_keys = Keys::generate();
        let owner_bytes = owner_keys.public_key().to_bytes();
        let channel_id = seed_channel(&db, community, &owner_bytes).await;

        let expert_keys = Keys::generate();
        let expert_hex = expert_keys.public_key().to_hex();

        set_policy(
            &pool,
            community,
            channel_id,
            serde_json::json!({ "46202": { "pubkeys": [expert_hex] } }),
        )
        .await;

        // Even the channel owner is rejected: role never substitutes for a
        // bound identity.
        let owner_attempt = signed_event(&owner_keys, KIND_CYBOTA_ADVICE, vec![h_tag(channel_id)]);
        let owner_result =
            enforce_governed_kind_policy(&db, community, &owner_attempt, KIND_CYBOTA_ADVICE).await;
        match owner_result {
            Err(IngestError::Rejected(msg)) => {
                assert!(
                    msg.contains("designated author"),
                    "unexpected message: {msg:?}"
                );
            }
            other => panic!("expected Rejected for owner-not-on-allowlist, got {other:?}"),
        }

        // The bound expert key is allowed, even without any channel/community
        // role record at all.
        let expert_attempt =
            signed_event(&expert_keys, KIND_CYBOTA_ADVICE, vec![h_tag(channel_id)]);
        let expert_result =
            enforce_governed_kind_policy(&db, community, &expert_attempt, KIND_CYBOTA_ADVICE).await;
        assert!(
            expert_result.is_ok(),
            "expected Ok for the bound expert key, got {expert_result:?}"
        );
    }

    /// A community owner (`relay_members.role = 'owner'`) who never joined
    /// this channel must still be recognized as owner — proving the gate
    /// checks *both* the community and channel role rolls, not just
    /// whichever one happens to be non-empty.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn community_owner_satisfies_role_owner_policy_without_channel_membership() {
        let (db, pool) = test_db_and_pool().await;
        let community = seed_community(&db).await;
        let creator_keys = Keys::generate();
        let creator_bytes = creator_keys.public_key().to_bytes();
        let channel_id = seed_channel(&db, community, &creator_bytes).await;

        // A separate community owner, added only to `relay_members` — never
        // added as a channel member.
        let community_owner_keys = Keys::generate();
        let community_owner_hex = community_owner_keys.public_key().to_hex();
        db.add_relay_member(community, &community_owner_hex, "owner", None)
            .await
            .expect("add community owner");

        set_policy(
            &pool,
            community,
            channel_id,
            serde_json::json!({ "46203": { "role": "owner" } }),
        )
        .await;

        let event = signed_event(
            &community_owner_keys,
            KIND_CYBOTA_RATIFICATION,
            vec![h_tag(channel_id)],
        );
        let result =
            enforce_governed_kind_policy(&db, community, &event, KIND_CYBOTA_RATIFICATION).await;
        assert!(
            result.is_ok(),
            "community-role owner must satisfy a role:owner policy, got {result:?}"
        );
    }

    /// WRONG-ALLOW REGRESSION (coordinator review, fix round 1): a channel
    /// `guest` (read-only external participant) or `bot` (never in the role
    /// hierarchy) must be rejected under a `{"role":"member"}` policy — not
    /// silently accepted because the pure core's member arm only checks
    /// `author.role.is_some()`. A genuine `member` under the identical
    /// policy is still allowed, proving the fix does not over-correct.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn channel_guest_and_bot_never_qualify_for_a_role_member_policy() {
        let (db, pool) = test_db_and_pool().await;
        let community = seed_community(&db).await;
        let owner_keys = Keys::generate();
        let owner_bytes = owner_keys.public_key().to_bytes();
        let channel_id = seed_channel(&db, community, &owner_bytes).await;

        set_policy(
            &pool,
            community,
            channel_id,
            serde_json::json!({ "46201": { "role": "member" } }),
        )
        .await;

        for (label, role) in [("guest", MemberRole::Guest), ("bot", MemberRole::Bot)] {
            let keys = Keys::generate();
            let pubkey = keys.public_key().to_bytes();
            db.add_member(community, channel_id, &pubkey, role, Some(&owner_bytes))
                .await
                .unwrap_or_else(|e| panic!("add {label} member: {e}"));

            let event = signed_event(&keys, KIND_CYBOTA_STAGED, vec![h_tag(channel_id)]);
            let result =
                enforce_governed_kind_policy(&db, community, &event, KIND_CYBOTA_STAGED).await;
            match result {
                Err(IngestError::Rejected(_)) => {}
                other => panic!(
                    "channel {label} must be Rejected under a role:member policy \
                     (wrong-Allow regression), got {other:?}"
                ),
            }
        }

        // A genuine member under the identical policy is still allowed —
        // the fix must not over-correct into rejecting real members.
        let member_keys = Keys::generate();
        let member_bytes = member_keys.public_key().to_bytes();
        db.add_member(
            community,
            channel_id,
            &member_bytes,
            MemberRole::Member,
            Some(&owner_bytes),
        )
        .await
        .expect("add genuine member");
        let member_event = signed_event(&member_keys, KIND_CYBOTA_STAGED, vec![h_tag(channel_id)]);
        let member_result =
            enforce_governed_kind_policy(&db, community, &member_event, KIND_CYBOTA_STAGED).await;
        assert!(
            member_result.is_ok(),
            "a genuine member must still satisfy a role:member policy, got {member_result:?}"
        );
    }
}

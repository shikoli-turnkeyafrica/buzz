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
            assert_allow(evaluate_governed_post(kind, None, &author(None, OTHER_PUBKEY)));
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

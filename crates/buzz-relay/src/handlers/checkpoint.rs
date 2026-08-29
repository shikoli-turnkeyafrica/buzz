//! Buzz rung 3 — completeness checkpoint hash.
//!
//! The pure, deterministic core of the relay's periodic checkpoint emitter
//! (`KIND_CYBOTA_CHECKPOINT = 46220`, see `buzz_core::kind`). This module is
//! deliberately DB-free and IO-free — no pool, no clock, no randomness — so
//! its reproducibility contract can be exhaustively unit tested here and
//! independently reimplemented by any auditor (see the controller capstone,
//! `prove_checkpoint.py`) without needing Buzz's source at all.

use sha2::{Digest, Sha256};

/// Compute the completeness-checkpoint fingerprint over a channel's event set.
///
/// **Reproducibility contract:** H = SHA-256 over the ascending-sorted raw
/// 32-byte event ids.
///
/// The input slice is cloned and sorted ascending (byte-lexicographic order
/// on the 32-byte arrays) before hashing, so the result is identical
/// regardless of the order `event_ids` was passed in. Ids are concatenated
/// raw (no separator, no length prefix — every element is a fixed 32 bytes,
/// so the encoding is unambiguous). An empty slice hashes to the fixed
/// SHA-256-of-empty-input value, exactly as `Sha256::new().finalize()` on no
/// input would.
///
/// Pure and deterministic: no IO, no clock, no randomness. Any two callers
/// with the same event-id set — computed independently, in any order —
/// arrive at the same H. This is what lets an external auditor recompute the
/// checkpoint from an export and prove nothing was omitted.
pub fn compute_checkpoint_hash(event_ids: &[[u8; 32]]) -> [u8; 32] {
    let mut sorted: Vec<[u8; 32]> = event_ids.to_vec();
    sorted.sort_unstable();

    let mut hasher = Sha256::new();
    for id in &sorted {
        hasher.update(id);
    }
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    #[test]
    fn hash_is_order_independent() {
        let a = id(0x01);
        let b = id(0x02);
        let c = id(0x03);

        let forward = compute_checkpoint_hash(&[a, b, c]);
        let shuffled = compute_checkpoint_hash(&[c, a, b]);
        let reversed = compute_checkpoint_hash(&[c, b, a]);

        assert_eq!(forward, shuffled);
        assert_eq!(forward, reversed);
    }

    #[test]
    fn hash_changes_on_add_remove_change() {
        let a = id(0x01);
        let b = id(0x02);
        let c = id(0x03);

        let base = compute_checkpoint_hash(&[a, b]);

        // Adding an id changes H.
        let added = compute_checkpoint_hash(&[a, b, c]);
        assert_ne!(base, added);

        // Removing an id changes H.
        let removed = compute_checkpoint_hash(&[a]);
        assert_ne!(base, removed);

        // Flipping one id (same count, different member) changes H.
        let flipped = compute_checkpoint_hash(&[a, c]);
        assert_ne!(base, flipped);
    }

    #[test]
    fn empty_set_hash_is_sha256_of_empty() {
        // The well-known SHA-256 digest of the empty byte string.
        let expected =
            hex::decode("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
                .expect("valid hex");
        let expected: [u8; 32] = expected.try_into().expect("32 bytes");

        assert_eq!(compute_checkpoint_hash(&[]), expected);
    }
}

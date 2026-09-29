//! Keyring storage for Cybercare sessions, split across several entries.
//!
//! A Keycloak session (access, refresh and id tokens) is 3–4 KB. Windows
//! Credential Manager caps one credential at 2560 bytes of UTF-16, so the
//! session cannot live in a single entry there. Each session is written as
//! numbered chunk entries plus a header entry naming how many there are.

#[cfg(feature = "system-keyring")]
use std::sync::Mutex;

/// Characters per chunk. Session JSON is ASCII, so 1000 chars is 2000 bytes
/// of UTF-16, under the Windows limit with room to spare.
const CHUNK_CHARS: usize = 1000;
const HEADER_PREFIX: &str = "chunks:";

pub(crate) fn split_chunks(value: &str) -> Vec<String> {
    let chars: Vec<char> = value.chars().collect();
    chars
        .chunks(CHUNK_CHARS)
        .map(|chunk| chunk.iter().collect())
        .collect()
}

pub(crate) fn header_value(count: usize) -> String {
    format!("{HEADER_PREFIX}{count}")
}

pub(crate) fn parse_header(value: &str) -> Result<usize, String> {
    value
        .strip_prefix(HEADER_PREFIX)
        .and_then(|n| n.parse().ok())
        .filter(|n| *n <= 64)
        .ok_or_else(|| "stored Cybercare session header unreadable".to_owned())
}

pub(crate) fn chunk_key(key: &str, index: usize) -> String {
    format!("{key}#{index}")
}

/// Serialises read-modify-write of chunk sets within this process.
#[cfg(feature = "system-keyring")]
static LOCK: Mutex<()> = Mutex::new(());

#[cfg(feature = "system-keyring")]
fn entry(service: &str, key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, key).map_err(|error| format!("keyring entry: {error}"))
}

#[cfg(feature = "system-keyring")]
fn read(service: &str, key: &str) -> Result<Option<String>, String> {
    match entry(service, key)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("keyring read: {error}")),
    }
}

#[cfg(feature = "system-keyring")]
fn remove(service: &str, key: &str) -> Result<(), String> {
    match entry(service, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("keyring delete: {error}")),
    }
}

#[cfg(feature = "system-keyring")]
fn stored_count(service: &str, key: &str) -> usize {
    read(service, key)
        .ok()
        .flatten()
        .and_then(|header| parse_header(&header).ok())
        .unwrap_or(0)
}

/// Loads the value stored under `key`. `Ok(None)` when nothing is stored.
pub(crate) fn load(service: &str, key: &str) -> Result<Option<String>, String> {
    #[cfg(feature = "system-keyring")]
    {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let Some(header) = read(service, key)? else {
            return Ok(None);
        };
        let count = parse_header(&header)?;
        let mut value = String::new();
        for index in 0..count {
            let chunk = read(service, &chunk_key(key, index))?
                .ok_or_else(|| "stored Cybercare session is incomplete".to_owned())?;
            value.push_str(&chunk);
        }
        Ok(Some(value))
    }
    #[cfg(not(feature = "system-keyring"))]
    {
        let _ = (service, key);
        Err("system-keyring feature disabled".to_owned())
    }
}

/// Stores `value` under `key`, replacing any earlier value.
pub(crate) fn store(service: &str, key: &str, value: &str) -> Result<(), String> {
    #[cfg(feature = "system-keyring")]
    {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let previous = stored_count(service, key);
        let chunks = split_chunks(value);
        for (index, chunk) in chunks.iter().enumerate() {
            entry(service, &chunk_key(key, index))?
                .set_password(chunk)
                .map_err(|error| format!("keyring write: {error}"))?;
        }
        entry(service, key)?
            .set_password(&header_value(chunks.len()))
            .map_err(|error| format!("keyring write: {error}"))?;
        for index in chunks.len()..previous {
            remove(service, &chunk_key(key, index))?;
        }
        Ok(())
    }
    #[cfg(not(feature = "system-keyring"))]
    {
        let _ = (service, key, value);
        Err("system-keyring feature disabled".to_owned())
    }
}

/// Deletes the value stored under `key`. Nothing stored is not an error.
pub(crate) fn delete(service: &str, key: &str) -> Result<(), String> {
    #[cfg(feature = "system-keyring")]
    {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let count = stored_count(service, key);
        remove(service, key)?;
        for index in 0..count {
            remove(service, &chunk_key(key, index))?;
        }
        Ok(())
    }
    #[cfg(not(feature = "system-keyring"))]
    {
        let _ = (service, key);
        Err("system-keyring feature disabled".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_fit_the_windows_credential_limit_and_rejoin() {
        let value = "x".repeat(3_700);
        let chunks = split_chunks(&value);
        assert_eq!(chunks.len(), 4);
        assert!(chunks.iter().all(|c| c.encode_utf16().count() * 2 < 2_560));
        assert_eq!(chunks.concat(), value);
    }

    #[test]
    fn empty_value_is_zero_chunks() {
        assert!(split_chunks("").is_empty());
    }

    #[test]
    fn header_round_trips_and_rejects_junk() {
        assert_eq!(parse_header(&header_value(4)), Ok(4));
        assert!(parse_header("4").is_err());
        assert!(parse_header("chunks:many").is_err());
        assert!(parse_header("chunks:9999").is_err());
    }

    #[test]
    fn chunk_keys_are_distinct_from_the_header() {
        assert_eq!(
            chunk_key("cybercare.session.c1", 0),
            "cybercare.session.c1#0"
        );
        assert_ne!(chunk_key("k", 1), "k");
    }
}

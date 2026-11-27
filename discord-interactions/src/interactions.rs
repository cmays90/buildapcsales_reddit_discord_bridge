//! Pure Discord Interactions logic: no network, no `worker` crate, so this
//! module compiles and runs under plain `cargo test` on the host target.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

pub const NOTIFY_CUSTOM_ID: &str = "notify-roles";

// `CATCH_ALL_ROLE_NAME`, `Role`, `SelectOption`, `is_notification_role` and
// `notify_options` below build the pinned select-menu message's content from
// live guild roles. Nothing in this Worker posts or refreshes that message
// yet — see the pinned-message checklist item in docs/testing.md — so these
// are exercised by tests only for now, not dead by mistake.
#[allow(dead_code)]
pub const CATCH_ALL_ROLE_NAME: &str = "All Posts";

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct Role {
    pub id: String,
    pub name: String,
    pub permissions: String,
    #[serde(default)]
    pub managed: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[allow(dead_code)]
pub struct SelectOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct Interaction {
    #[serde(rename = "type")]
    pub kind: u8,
    #[serde(default)]
    pub guild_id: Option<String>,
    pub data: Option<InteractionData>,
    pub member: Option<Member>,
    pub message: Option<Message>,
}

#[derive(Debug, Deserialize)]
pub struct InteractionData {
    #[serde(default)]
    pub custom_id: String,
    #[serde(default)]
    pub values: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct Member {
    pub roles: Vec<String>,
    pub user: UserRef,
}

#[derive(Debug, Deserialize)]
pub struct UserRef {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct Message {
    #[serde(default)]
    pub components: Vec<ActionRow>,
}

#[derive(Debug, Deserialize)]
pub struct ActionRow {
    #[serde(default)]
    pub components: Vec<Component>,
}

#[derive(Debug, Deserialize)]
pub struct Component {
    #[serde(default)]
    pub custom_id: String,
    #[serde(default)]
    pub options: Vec<ComponentOption>,
}

#[derive(Debug, Deserialize)]
pub struct ComponentOption {
    pub value: String,
}

pub const PING: u8 = 1;
pub const MESSAGE_COMPONENT: u8 = 3;

/// Verifies Discord's Ed25519 request signature over `timestamp + body`.
pub fn verify_signature(
    public_key_hex: &str,
    signature_hex: &str,
    timestamp: &str,
    body: &str,
) -> bool {
    let Ok(key_bytes) = hex::decode(public_key_hex) else {
        return false;
    };
    let Ok(key_bytes): Result<[u8; 32], _> = key_bytes.try_into() else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&key_bytes) else {
        return false;
    };

    let Ok(sig_bytes) = hex::decode(signature_hex) else {
        return false;
    };
    let Ok(sig_bytes): Result<[u8; 64], _> = sig_bytes.try_into() else {
        return false;
    };
    let signature = Signature::from_bytes(&sig_bytes);

    let message = [timestamp.as_bytes(), body.as_bytes()].concat();
    verifying_key.verify(&message, &signature).is_ok()
}

/// A role is treated as one of ours if it carries no permissions and isn't
/// Discord-managed (a bot's own role, a boost role, etc.) — the roles this
/// app creates are always plain, zero-permission, mentionable roles.
#[allow(dead_code)]
pub fn is_notification_role(role: &Role) -> bool {
    !role.managed && role.permissions == "0"
}

/// Builds the select menu's options from the guild's current roles, with the
/// catch-all role always last.
#[allow(dead_code)]
pub fn notify_options(roles: &[Role]) -> Vec<SelectOption> {
    let mut flair_roles: Vec<&Role> = roles
        .iter()
        .filter(|r| is_notification_role(r) && r.name != CATCH_ALL_ROLE_NAME)
        .collect();
    flair_roles.sort_by(|a, b| a.name.cmp(&b.name));

    let mut options: Vec<SelectOption> = flair_roles
        .into_iter()
        .map(|r| SelectOption {
            label: r.name.clone(),
            value: r.id.clone(),
        })
        .collect();

    if let Some(catch_all) = roles
        .iter()
        .find(|r| is_notification_role(r) && r.name == CATCH_ALL_ROLE_NAME)
    {
        options.push(SelectOption {
            label: catch_all.name.clone(),
            value: catch_all.id.clone(),
        });
    }

    options
}

/// The full set of role ids a select component offered, read back from the
/// original message — Discord's submit payload only carries what was
/// *selected*, not what was on offer, so this is how we learn what to clear.
pub fn offered_role_ids(message: &Message, custom_id: &str) -> Vec<String> {
    message
        .components
        .iter()
        .flat_map(|row| &row.components)
        .find(|c| c.custom_id == custom_id)
        .map(|c| c.options.iter().map(|o| o.value.clone()).collect())
        .unwrap_or_default()
}

/// Roles to grant and revoke so the member ends up holding exactly
/// `selected`, touching only roles this picker actually offered.
pub fn diff_roles(
    offered: &[String],
    currently_held: &[String],
    selected: &[String],
) -> (Vec<String>, Vec<String>) {
    let to_add = selected
        .iter()
        .filter(|id| !currently_held.contains(id))
        .cloned()
        .collect();
    let to_remove = offered
        .iter()
        .filter(|id| currently_held.contains(id) && !selected.contains(id))
        .cloned()
        .collect();
    (to_add, to_remove)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn role(id: &str, name: &str, permissions: &str, managed: bool) -> Role {
        Role {
            id: id.to_string(),
            name: name.to_string(),
            permissions: permissions.to_string(),
            managed,
        }
    }

    #[test]
    fn verifies_a_genuine_signature() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let public_key_hex = hex::encode(signing_key.verifying_key().to_bytes());
        let timestamp = "1700000000";
        let body = r#"{"type":1}"#;
        let signature = signing_key.sign(&[timestamp.as_bytes(), body.as_bytes()].concat());
        let signature_hex = hex::encode(signature.to_bytes());

        assert!(verify_signature(
            &public_key_hex,
            &signature_hex,
            timestamp,
            body
        ));
    }

    #[test]
    fn rejects_a_tampered_body() {
        let signing_key = SigningKey::from_bytes(&[7u8; 32]);
        let public_key_hex = hex::encode(signing_key.verifying_key().to_bytes());
        let timestamp = "1700000000";
        let signature =
            signing_key.sign(&[timestamp.as_bytes(), br#"{"type":1}"#.as_slice()].concat());
        let signature_hex = hex::encode(signature.to_bytes());

        assert!(!verify_signature(
            &public_key_hex,
            &signature_hex,
            timestamp,
            r#"{"type":2}"#
        ));
    }

    #[test]
    fn rejects_malformed_hex() {
        assert!(!verify_signature(
            "not hex",
            "also not hex",
            "1700000000",
            "{}"
        ));
    }

    #[test]
    fn notify_options_filters_to_plain_roles_and_puts_catch_all_last() {
        let roles = vec![
            role("1", "Moderator", "8", false),
            role("2", "GPUs", "0", false),
            role("3", "All Posts", "0", false),
            role("4", "Bots", "0", true),
            role("5", "Deals", "0", false),
        ];

        let options = notify_options(&roles);

        assert_eq!(
            options,
            vec![
                SelectOption {
                    label: "Deals".into(),
                    value: "5".into()
                },
                SelectOption {
                    label: "GPUs".into(),
                    value: "2".into()
                },
                SelectOption {
                    label: "All Posts".into(),
                    value: "3".into()
                },
            ]
        );
    }

    #[test]
    fn offered_role_ids_reads_the_original_message_options() {
        let message = Message {
            components: vec![ActionRow {
                components: vec![Component {
                    custom_id: NOTIFY_CUSTOM_ID.to_string(),
                    options: vec![
                        ComponentOption {
                            value: "2".to_string(),
                        },
                        ComponentOption {
                            value: "3".to_string(),
                        },
                    ],
                }],
            }],
        };

        assert_eq!(
            offered_role_ids(&message, NOTIFY_CUSTOM_ID),
            vec!["2".to_string(), "3".to_string()]
        );
    }

    #[test]
    fn diff_roles_only_touches_offered_roles() {
        let offered = vec!["2".to_string(), "3".to_string()];
        let currently_held = vec!["2".to_string(), "9".to_string()]; // 9 = unrelated role
        let selected = vec!["3".to_string()];

        let (to_add, to_remove) = diff_roles(&offered, &currently_held, &selected);

        assert_eq!(to_add, vec!["3".to_string()]);
        assert_eq!(to_remove, vec!["2".to_string()]);
    }
}

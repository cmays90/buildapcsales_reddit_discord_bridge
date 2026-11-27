// interactions.rs is only ever called from the wasm32 glue below; a native
// `cargo test` run has no caller for it and would otherwise warn on every
// item as dead code.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

mod interactions;

// The `worker` crate only builds for wasm32 (it binds to the Workers JS
// runtime), so this module is the entire surface that isn't exercised by
// plain `cargo test` — see interactions.rs for what is.
#[cfg(target_arch = "wasm32")]
mod worker_glue {
    use serde_json::json;
    use worker::wasm_bindgen::JsValue;
    use worker::{
        Context, Env, Error, Fetch, Headers, Method, Request, RequestInit, Response, Result, event,
    };

    use crate::interactions::{
        Interaction, MESSAGE_COMPONENT, NOTIFY_CUSTOM_ID, PING, diff_roles, offered_role_ids,
        verify_signature,
    };

    const DISCORD_API: &str = "https://discord.com/api/v10";

    #[event(fetch)]
    pub async fn fetch(mut req: Request, env: Env, _ctx: Context) -> Result<Response> {
        if req.method() != Method::Post || req.path() != "/interactions" {
            return Response::error("not found", 404);
        }

        let signature = req
            .headers()
            .get("X-Signature-Ed25519")?
            .unwrap_or_default();
        let timestamp = req
            .headers()
            .get("X-Signature-Timestamp")?
            .unwrap_or_default();
        let body = req.text().await?;

        let public_key = env.var("DISCORD_PUBLIC_KEY")?.to_string();
        if !verify_signature(&public_key, &signature, &timestamp, &body) {
            return Response::error("invalid request signature", 401);
        }

        let Ok(interaction) = serde_json::from_str::<Interaction>(&body) else {
            return Response::error("bad request", 400);
        };

        match interaction.kind {
            PING => Response::from_json(&json!({"type": 1})),
            MESSAGE_COMPONENT => handle_component(&env, &interaction).await,
            _ => Response::error("unsupported interaction type", 400),
        }
    }

    async fn handle_component(env: &Env, interaction: &Interaction) -> Result<Response> {
        let (Some(data), Some(member), Some(message), Some(guild_id)) = (
            &interaction.data,
            &interaction.member,
            &interaction.message,
            &interaction.guild_id,
        ) else {
            return Response::error("bad request", 400);
        };
        if data.custom_id != NOTIFY_CUSTOM_ID {
            return Response::error("unknown component", 400);
        }

        let offered = offered_role_ids(message, NOTIFY_CUSTOM_ID);
        let (to_add, to_remove) = diff_roles(&offered, &member.roles, &data.values);

        let bot_token = env.secret("DISCORD_BOT_TOKEN")?.to_string();
        for role_id in &to_add {
            let path = format!(
                "/guilds/{guild_id}/members/{}/roles/{role_id}",
                member.user.id
            );
            discord_empty(&path, Method::Put, &bot_token).await?;
        }
        for role_id in &to_remove {
            let path = format!(
                "/guilds/{guild_id}/members/{}/roles/{role_id}",
                member.user.id
            );
            discord_empty(&path, Method::Delete, &bot_token).await?;
        }

        let content = if to_add.is_empty() && to_remove.is_empty() {
            "No changes.".to_string()
        } else {
            format!(
                "Updated your notification roles ({} added, {} removed).",
                to_add.len(),
                to_remove.len()
            )
        };
        Response::from_json(&json!({"type": 4, "data": {"flags": 64, "content": content}}))
    }

    async fn discord_call(
        path: &str,
        method: Method,
        bot_token: &str,
        body: Option<String>,
    ) -> Result<Response> {
        let headers = Headers::new();
        headers.set("Authorization", &format!("Bot {bot_token}"))?;
        headers.set("Content-Type", "application/json")?;

        let mut init = RequestInit::new();
        init.with_method(method.clone()).with_headers(headers);
        if let Some(body) = &body {
            init.with_body(Some(JsValue::from_str(body)));
        }

        let req = Request::new_with_init(&format!("{DISCORD_API}{path}"), &init)?;
        let mut resp = Fetch::Request(req).send().await?;
        if resp.status_code() >= 400 {
            let text = resp.text().await.unwrap_or_default();
            return Err(Error::from(format!(
                "Discord API {method:?} {path} -> {}: {text}",
                resp.status_code()
            )));
        }
        Ok(resp)
    }

    async fn discord_empty(path: &str, method: Method, bot_token: &str) -> Result<()> {
        discord_call(path, method, bot_token, None)
            .await
            .map(|_| ())
    }
}

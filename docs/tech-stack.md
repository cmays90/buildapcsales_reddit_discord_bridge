# Tech stack

One repository, two independently deployed packages, two different toolchains: npm workspaces (plus Biome) around `reddit-interactions`, Cargo on its own for `discord-interactions`. Nothing is shared between them, including the language.

## Repo layout

- `reddit-interactions/` — the Reddit-side Devvit project (`devvit new`, TypeScript), one trigger: `PostSubmit`.
- `discord-interactions/` — the Cloudflare Worker, written in Rust (`workers-rs`), one route: `POST /interactions`.
- Root `package.json` with `"workspaces": ["reddit-interactions"]`, Biome for the TypeScript side only; `discord-interactions/` is its own Cargo crate using `rustfmt`/`clippy` instead — `devvit publish` and `wrangler deploy` still target unrelated platforms either way.
- No shared internal library for the Discord REST calls both sides make (post a message, create/toggle a role) — different languages rule that out outright now, and it was only a couple dozen lines in each anyway.

## reddit-interactions (Node)

- Scaffolded from Reddit's official TypeScript template.
- Single trigger: `PostSubmit`. On each new post, it looks up (or creates, if missing) the Discord role matching the post's flair, then posts the embed and crosspost-publishes it — no separate flair-watching job, since creating the role lazily on first use still satisfies "never requires manual role setup," and there's nothing to notify about for a flair with zero posts yet.
- Bot token stored as a Devvit secret; Discord calls go out over Devvit's fetch, with the Discord API domain declared in `devvit.json`.

## discord-interactions (Rust)

- Built with `workers-rs` (Cloudflare's official Rust SDK), compiled to WebAssembly; deployed with Wrangler — `wrangler.toml` points its build command at `worker-build`, the same `wrangler deploy` as a JS Worker would use.
- `ed25519-dalek` verifies Discord's signature headers before the one route (`POST /interactions`) handles the body.
- `serde`/`serde_json` for request and response bodies; the `fetch` binding `workers-rs` exposes for the outbound calls to Discord's REST API.
- Bot token and the Discord application's public key stored as Wrangler secrets, same as before.
- Trade-off worth naming: `workers-rs` is official but smaller and less battle-tested than the JS Workers ecosystem, and its local-test story is thinner — tests run as plain `cargo test` against the extracted logic (signature check, payload parsing, role-toggle request building), not against a simulated Workers runtime the way `@cloudflare/vitest-pool-workers` does for JS.

## CI/CD

- GitHub Actions on every push to `main`, one job per package: `reddit-interactions` runs `npm install`, lint (Biome), typecheck, test; `discord-interactions` installs the Rust toolchain plus the `wasm32-unknown-unknown` target and runs `cargo fmt --check`, `cargo clippy` (both the native and wasm32 targets), and `cargo test` — then both deploy.
- `discord-interactions` deploys automatically (`wrangler deploy`, which runs `worker-build` for the Rust compile step, authenticated with a `CLOUDFLARE_API_TOKEN` repo secret).
- Publishing `reddit-interactions` needs confirming once we're in the code: `devvit publish` may or may not support a non-interactive token in CI. If it doesn't, CI still runs lint/typecheck/test on `reddit-interactions`, and publishing stays a manual `devvit upload`/`publish` until that's resolved.

# BAPCS Bot

Connects r/buildapcsales to its Discord server: new subreddit posts become Discord announcements, and members choose which categories of posts ping them.

See [docs/product-spec.md](docs/product-spec.md) for what it does, [docs/architecture.md](docs/architecture.md) for how the two pieces fit together, [docs/tech-stack.md](docs/tech-stack.md) for the concrete implementation choices, and [docs/testing.md](docs/testing.md) for how to verify any of it actually works.

## Repo layout

- [`reddit-interactions/`](reddit-interactions) — Devvit app (Node/TypeScript). Posts the announcement embed on every new subreddit post and lazily creates the matching Discord role.
- [`discord-interactions/`](discord-interactions) — Cloudflare Worker (Rust). Handles the self-service role picker via Discord's Interactions webhook.

Nothing is shared between them — not even the language — on purpose; see [docs/tech-stack.md](docs/tech-stack.md) for why.

## Development

### reddit-interactions

Requires Node (version pinned in [`.nvmrc`](reddit-interactions/.nvmrc)).

```bash
npm install
npm run test --workspace=reddit-interactions
```

`test` runs typecheck, lint (Biome), unit tests, and the esbuild bundle, in that order.

### discord-interactions

Requires Rust with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`).

```bash
cd discord-interactions
cargo fmt --check
cargo clippy --all-targets
cargo clippy --target wasm32-unknown-unknown
cargo test
```

`cargo test` only exercises the pure logic in `src/interactions.rs` — the `worker`-crate glue in `src/lib.rs` only builds for `wasm32-unknown-unknown` (see the trade-off noted in [docs/tech-stack.md](docs/tech-stack.md)).

To build the deployable bundle locally:

```bash
cargo install worker-build
worker-build --release
```

## Deployment

CI (`.github/workflows/ci.yml`) lints, typechecks, and tests both packages on every push to `main`.

- **discord-interactions** deploys automatically via `wrangler deploy`, authenticated with a `CLOUDFLARE_API_TOKEN` repository secret. Secrets it needs at runtime: `DISCORD_BOT_TOKEN` (`wrangler secret put DISCORD_BOT_TOKEN`) and `DISCORD_PUBLIC_KEY` (plain var in `wrangler.toml`).
- **reddit-interactions** is not yet auto-published — whether `devvit publish` supports non-interactive CI auth is still unconfirmed. Until then, publish by hand with `npm run publish --workspace=reddit-interactions`. It needs the Devvit app's own settings configured per subreddit install: `discordBotToken` (global secret), `discordGuildId`, and `discordChannelId` (per-subreddit settings).

Both sides need a Discord bot application with: a bot token, the application's public key, the pinned select-menu message posted in the server (no slash command to register — see [docs/architecture.md](docs/architecture.md)), and the bot invited to the target server with `Manage Roles`.

## License

[AGPL-3.0-or-later](LICENSE) — if you run a modified version of this bot as a service, you must make your modified source available to its users.

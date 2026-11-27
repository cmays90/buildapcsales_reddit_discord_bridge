# AGENTS.md

Two independently deployed packages in one repo. Don't assume code can be shared between them — see [docs/tech-stack.md](docs/tech-stack.md) for why not.

## Repo layout

- `reddit-interactions/` — Devvit app (Node/TypeScript). Reddit → Discord.
- `discord-interactions/` — Cloudflare Worker (Rust, `workers-rs`). Discord → member.
- `docs/` — [product-spec.md](docs/product-spec.md), [architecture.md](docs/architecture.md), [tech-stack.md](docs/tech-stack.md), [testing.md](docs/testing.md). Read the relevant one before an architectural change; update it if the change invalidates what it says.

## Build / test

### reddit-interactions (from repo root)

```bash
npm install
npm run test --workspace=reddit-interactions     # tsc --build, biome check, unit tests, esbuild — in that order
npm run format --workspace=reddit-interactions   # biome --fix
```

### discord-interactions (from `discord-interactions/`)

```bash
cargo fmt --check
cargo clippy --all-targets
cargo clippy --target wasm32-unknown-unknown
cargo test
```

CI runs clippy with `-- -D warnings`; a clean local run with warnings still means CI will fail. `cargo test` only exercises `src/interactions.rs` (pure logic, no network) — `src/lib.rs` is the `worker`-crate glue, only compiles for `wasm32-unknown-unknown`, and isn't run by `cargo test` at all.

## Definition of done

Per [docs/testing.md](docs/testing.md): new logic needs a unit test; the code path it runs in needs an integration test against a mocked Discord REST API, not the live one; the user-visible flow needs E2E coverage where feasible. The mocks needed to do that are part of the change, not a follow-up task. Neither mock harness exists yet — build whichever one your change actually needs, not all of it speculatively.

## Code style

Don't hand-format or write a style guide — Biome and `cargo fmt`/`cargo clippy` are it, and CI enforces them. If a formatter and your own judgment disagree, run the formatter.

Never silence a lint instead of fixing what it's pointing at. `#[allow(dead_code)]` (or `#[expect(dead_code)]`, `biome-ignore`, etc.) on logic with no caller is a sign the code isn't ready to land, not a reason to suppress the warning — delete it and re-add it later when something actually calls it.

## Conventions to preserve

- No shared library between the two packages, even though both call Discord's REST API. Deliberate — see tech-stack.md. Don't add one to deduplicate a few dozen lines.
- Discord's own guild roles are the only datastore (see architecture.md): the flair-to-role mapping is always looked up live by name, never cached or persisted. Don't add a database or KV store for it.
- Package names are `reddit-interactions` and `discord-interactions` — deliberately renamed from generic `devvit-app`/`worker`. Don't revert.
- Pure logic with no `worker`-crate dependency belongs in `discord-interactions/src/interactions.rs` so it stays testable with plain `cargo test`; `lib.rs` stays thin glue to the `worker` crate.

## Git workflow

No direct commits to `main`, even though GitHub currently lets an admin bypass the branch protection rule. Branch, push, open a PR, let CI run, merge. This applies to Claude too — don't push straight to `main` just because the rule can be bypassed.

## Secrets

Never commit a real token. `.env`, `.dev.vars`, and `.dev.vars.*` are gitignored on purpose — if you're about to put a real secret value in a tracked file, stop.

## License

AGPL-3.0-or-later ([LICENSE](LICENSE)). Keep the `license` fields in `package.json`/`Cargo.toml` in sync with it.

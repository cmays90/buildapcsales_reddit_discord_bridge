# Testing & verification

Any change in this repo — new logic, a new route, a new Discord call — isn't done until it has:

1. **Unit tests** for the new logic itself.
2. **Integration tests** exercising the code path it runs in (real routing, real request/response shapes) against a mock of the external platform, so they run in CI, not against live Reddit/Discord.
3. **E2E coverage** of the user-visible flow it's part of, automated against that same mock environment where the flow allows it.

## Current status

This repo is scaffolding, not a shipped feature: a Devvit app that routes one trigger, and a Worker that routes one endpoint, neither doing anything beyond what's described in [architecture.md](architecture.md). Nothing has been built against the DoD above yet, so there is no integration or E2E harness yet — that arrives with the first real feature, built alongside it, per the DoD. What exists today:

### Unit tests

```bash
npm run test --workspace=reddit-interactions   # tsc --build, biome check, unit tests, build
cd discord-interactions && cargo test
```

- `reddit-interactions`: `sourceDomain` and `commentsUrl` (`src/server/discord.test.ts`) — the pure helpers in `discord.ts`.
- `discord-interactions`: Ed25519 signature verification, the notification-role filtering heuristic, reading a select menu's offered options back off a message, and the add/remove role diff (`src/interactions.rs`).

Neither touches `server.ts`'s routing, `lib.rs`'s `worker`-crate glue, or any real Discord REST call — those need the integration harness below, which doesn't exist yet.

## Building the integration tier (next up)

What each side needs before its first feature can meet the DoD:

- **A fake Discord REST API.** `discord.ts`'s `ensureRoleId`/`postAnnouncement` and `lib.rs`'s `discord_*` helpers call `https://discord.com/api/v10` directly today. Point them at a local double instead (`wiremock` on the Rust side; `msw` or a hand-rolled listener on the Node side) so integration tests can assert on the outgoing requests and script the responses, in CI, with no live Discord app involved.
- **A way to drive `reddit-interactions`'s HTTP route outside the real Devvit platform.** `server.ts` reaches for `settings`/`reddit` from `@devvit/web/server` directly, which only resolve inside `devvit playtest` or a real deployment today. Either use whatever harness Devvit provides for faking those bindings, or restructure `server.ts` to take them as injected arguments so `node --test` can fake them directly.
- **An E2E shape that doesn't require a human.** Once both components can run against the mock Discord API, the E2E flow (post → role created → `/notify` → role toggled → pinged) can run the same way, scripted, in CI.

The first feature built on this scaffolding should include whichever of these its own tests need — not all three at once, speculatively, but whatever that feature's DoD requires.

## Manual smoke testing (pre-release, not a substitute)

Use a **test** subreddit and a **test** Discord application/server — never production. This is a sanity check before a release, not where you should expect to first catch a regression.

### reddit-interactions: `devvit playtest`

```bash
npm run playtest --workspace=reddit-interactions
```

Requires `devvit login` once, and a subreddit you moderate. Configure the app's settings for that subreddit first: `discordBotToken` (global), `discordGuildId`, `discordChannelId` — leaving any unset makes the trigger a silent no-op (logged, not an error).

Check:

- **New flair, first post**: the matching Discord role is created (zero permissions, mentionable, name matches the flair text).
- **Same flair, second post**: no duplicate role.
- **Embed content**: title, link, author, source domain, comments link all match.
- **Pings**: the message mentions both the flair's role and the catch-all ("All Posts") role.
- **Crosspost**: publishes if the channel is Announcement-type; fails loudly-logged-but-non-blocking otherwise.

### discord-interactions: `wrangler dev` + a tunnel

Discord requires a public HTTPS URL to save an Interactions Endpoint URL and to deliver interactions:

```bash
cd discord-interactions
wrangler dev
# in another terminal:
cloudflared tunnel --url http://localhost:8787
```

`wrangler dev` reads secrets from a local `.dev.vars` file (gitignored):

```
DISCORD_BOT_TOKEN=...
```

(`DISCORD_PUBLIC_KEY` can stay in `wrangler.toml`'s `[vars]` — point it at your **test** application's key.)

In the Discord Developer Portal for the test application: set the Interactions Endpoint URL to `<tunnel-url>/interactions` (Discord PINGs it immediately — the Worker must answer `{"type": 1}` or the save fails), register `/notify`, and invite the bot with `applications.commands` + `bot` + `Manage Roles`. Discord enforces role hierarchy: the bot's own role must sit **above** every role it's asked to grant or revoke.

Create a few zero-permission, non-managed test roles so `/notify` has something to offer, then check:

- `/notify` lists exactly those roles, catch-all last.
- Selecting and submitting actually changes your roles, and the confirmation text's counts match.
- Giving yourself an unrelated role first, then submitting a selection that excludes it, leaves that unrelated role untouched — the one check that most directly stands in for the missing integration test on `diff_roles`'s "only touch offered roles" guarantee.
- Garbled/missing signature headers → `401`. Malformed but well-signed JSON → `400`.

## Before deploying to production

- [ ] Both CI jobs are green on the branch being deployed.
- [ ] `wrangler.toml`'s `DISCORD_PUBLIC_KEY` and the `DISCORD_BOT_TOKEN` secret belong to the **production** Discord application.
- [ ] `/notify` is registered against the **production** application id.
- [ ] The production bot's role is invited and positioned **above** every role it will manage.
- [ ] `discordGuildId`/`discordChannelId` are configured for the production subreddit install, and the announcement channel is Announcement-type if auto-publish is wanted.
- [ ] One real post, end to end, confirmed before calling it done.

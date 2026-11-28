# Discord bot permissions

What this bot's Discord application needs when invited to a guild, and why — for both `discord-interactions` (the Worker) and `reddit-interactions` (the Devvit app), since they share one bot per environment (see [architecture.md](architecture.md)).

## Required permission set

| Permission | Bit value | Why |
| --- | --- | --- |
| View Channel | `1024` | Baseline — every other action below requires the bot to be able to see the announcement and picker channels at all. |
| Send Messages | `2048` | Posts the announcement embed ([`postAnnouncement`](../reddit-interactions/src/server/discord.ts)) and the role-picker message ([`createPickerMessage`](../reddit-interactions/src/server/discord.ts)). |
| Embed Links | `16384` | Both the announcement and the role-picker message are sent as embeds. |
| Read Message History | `65536` | Discord's `GET /channels/{channel}/messages/{message}` (fetching a single message by id) requires this in addition to View Channel — used by [`getPickerState`](../reddit-interactions/src/server/discord.ts) to read the picker message's current select-menu options before deciding whether to update them. |
| Manage Roles | `268435456` | Creates the per-flair roles and the catch-all role ([`ensureRoleId`](../reddit-interactions/src/server/discord.ts)). The bot's own role must sit **above** every role it creates or manages — Discord enforces this by hierarchy position, not a permission bit. |
| Pin Messages | `2251799813685248` | Pins the role-picker message so it's easy to find ([`pinMessage`](../reddit-interactions/src/server/discord.ts)). Discord split this out of Manage Messages into its own permission as of 2026-02-23 — see "Explicitly not needed" below. |

**Total invite permission integer: `2251800082205696`**

## Invite URL

```
https://discord.com/api/oauth2/authorize?client_id=<bot's application/user id>&permissions=2251800082205696&scope=bot
```

Re-running this (with the bot already in the guild) updates its existing managed role to match — this is how to *change* the bot's permissions later too, not just the initial invite. No `applications.commands` scope is needed; there's no slash command (see [architecture.md](architecture.md)).

## Explicitly not needed

- **Manage Messages** — doesn't gate anything this bot does. Editing a message you authored needs no special permission (only editing *someone else's* message needs Manage Messages); crossposting a message you authored only needs Send Messages (Manage Messages is only required to crosspost someone else's); and as of 2026-02-23, pinning is gated by the separate Pin Messages permission above, not Manage Messages. Older guidance (including earlier drafts of this project's own docs) assumed Manage Messages covered pinning — it no longer does.
- **Administrator** — never grant this. It was used once, briefly, purely as a diagnostic to confirm a permission problem was real (it bypasses every permission check, including channel-specific overwrites), then immediately reverted. It's categorically inappropriate for a bot running in a 50k-member production server: it would let a bug in this code, or a leaked token, do anything in that guild.

## Debugging a "Missing Permissions" / `50013` error

If a permission-looking error shows up again, check Discord's API responses directly rather than guessing from Discord's UI — role permissions, channel-specific overwrites, and category overwrites can all disagree with what the UI implies:

```bash
# the role Discord assigned this bot on invite
curl -s -H "Authorization: Bot $discord_token" "https://discord.com/api/v10/guilds/<guild_id>/roles"

# the bot's own assigned roles
curl -s -H "Authorization: Bot $discord_token" "https://discord.com/api/v10/guilds/<guild_id>/members/<bot_user_id>"

# a channel's permission overwrites (and its parent category's, if nested)
curl -s -H "Authorization: Bot $discord_token" "https://discord.com/api/v10/channels/<channel_id>"
```

None of this output is sensitive — only `$discord_token` itself needs to stay out of anything shared.

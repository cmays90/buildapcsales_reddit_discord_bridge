# Privacy Policy

**App:** bapcs-bridge (Reddit Developer Platform) / discord-interactions (Discord)
**Last updated:** 2026-11-27

This app connects r/buildapcsales to its Discord server: it announces new subreddit posts in Discord, and lets Discord members opt into pings for specific post categories. This policy covers both halves of the bridge — the Reddit (Devvit) app and the Discord (Cloudflare Worker) interactions endpoint.

## What data this app touches

- **Reddit post data**, read only for posts submitted to the subreddit: title, URL, permalink, author's username, and flair text. All of this is already public on Reddit — the app doesn't read anything private (no private messages, no account details beyond a public username).
- **The subreddit's flair templates** (also public, set by moderators), to know what categories exist.
- **Discord's own guild data**: role names and IDs in the connected server, and the contents of the pinned role-picker message. This is the only place "who opted into what" is stored — as Discord role membership itself, not a separate database.
- **One internal value**: the Discord message ID of the role-picker message, stored in the Reddit app's own per-install storage (Devvit's Redis) so the app can find and update it later. This is not personal data — it doesn't identify any user.
- **Discord interaction payloads**, when a member uses the role-picker: the member's Discord user ID, used in that moment to add or remove *that member's own* role via Discord's API. This isn't logged or stored anywhere beyond that single request.

## What this app does not do

- It doesn't maintain its own user accounts, database of members, or user profiles.
- It doesn't track browsing activity, use cookies, or run analytics on members.
- It doesn't sell, share, or otherwise hand off any data to third parties. The only systems involved are Reddit's own platform (which runs the app) and Discord's API (which the app calls directly with a bot token).
- It doesn't read or store direct messages, private posts, or anything outside the subreddit's public posts and the connected Discord server's roles/messages.

## Secrets

The Discord bot token and the Discord application's public key are stored as platform-managed secrets (Devvit app settings, Cloudflare Worker secrets) — not committed to source control, not accessible to app users, and not shared outside what's needed to call Discord's and Reddit's own APIs.

## Data retention

Role membership lives in Discord and is controlled entirely by Discord's own retention rules and by members themselves (they can remove their own roles via the picker at any time). The one value this app persists on its own (the picker message ID) has no retention concern since it identifies a message, not a person.

## Source

This project is open source under AGPL-3.0-or-later: [github.com/cmays90/buildapcsales_reddit_discord_bridge](https://github.com/cmays90/buildapcsales_reddit_discord_bridge). You're welcome to read the actual code that handles this data rather than take this document's word for it.

## Contact

Questions about this policy or how the app handles data: open an issue on the repository above, or contact the moderators of r/buildapcsales.

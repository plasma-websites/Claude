# Orders bot

Discord bot for taking **Uber Rides**, **Uber Eats**, **Deliveroo** and **Just Eat** orders, with order tickets,
support tickets, a verify panel and moderation commands.

## Order flow
1. In your order channel (panel posted with `/orderpanel`), a member picks the company from a dropdown.
2. They pick a promo from `promos.json`:
   - Uber Rides: **10 off**
   - Uber Eats: **10 off**, **12 off**
   - Deliveroo: **15f20**
   - Just Eat: **10 off**
3. They answer **VC?** Yes / No.
4. A form pops up for the address: **delivery address** for Uber Eats / Deliveroo / Just Eat, **pickup + drop-off**
   for Uber Rides, plus optional notes.
5. The bot DMs them asking for their **order screenshot** (15 minutes to send it) and gives them a random
   6-digit **order number**, e.g. `#483920`.
6. The order appears in the **staff orders channel** with the screenshot, pinging the orderer role, with
   **Accept order** and **Decline** buttons.
7. **Accept order** (orderer role only, one person per order) creates a private ticket in the tickets category,
   named after the order number with a status emoji, e.g. `🔵-order-483920`. Its panel shows all the order info
   and the screenshot.
8. In the ticket, **Complete order** renames it `🟢-order-483920` and it **auto-closes 2 hours later**
   (`AUTO_CLOSE_HOURS`). **Close ticket** closes it immediately.
9. Closing **locks** the ticket (`🔒-order-483920`): the customer loses access, staff keep it.
   **Delete ticket** (staff only) removes the channel; it's available on every ticket at any stage.

The customer gets DMs along the way. Auto-close times are saved, so tickets still close on schedule if the bot restarts.

Ticket status emojis: 🔵 in progress · 🟢 completed · 🔒 closed. Discord limits channel renames to 2 per
10 minutes, so a rename can show up a few minutes late if a ticket changes status quickly.

## Support tickets
Post the panel with `/supportpanel`. Members click **Open support ticket**, type what they need, and get a private
`🟢-support-123456` channel with the support role. The member or staff can **Close** it (locks it, `🔒`), and staff
can **Delete** it. One open support ticket per member.

## Verification (RestoreCord / VaultCord)
RestoreCord and VaultCord are separate services: they do the actual verifying, hand out your Verified role, and
back up your members so you can pull them into a new server if this one is ever lost. This bot posts a matching
verify panel with a button to your verify link.

1. Create a `✅-verify` channel and a `Verified` role.
2. Sign up on [restorecord.com](https://restorecord.com) or [vaultcord.com](https://vaultcord.com), add your
   server, invite **their** bot, and set the role it gives to `Verified`. Drag their bot's role above `Verified`.
3. Copy your verify link from their dashboard into `.env` as `VERIFY_URL=...` and restart this bot.
4. Run `/verifypanel channel:#✅-verify`.
5. Lock the server down: for `@everyone`, turn off **View Channels** on every category except the verify channel,
   and turn it on for `Verified`.
6. Optional: set `VERIFIED_ROLE_ID` in `.env` so only verified members can place orders.

## Commands
| Command | Who (default) | What |
|---|---|---|
| `/orderpanel [channel:]` | Manage Server | Post the order panel |
| `/supportpanel [channel:]` | Manage Server | Post the support tickets panel |
| `/verifypanel [channel:]` | Manage Server | Post the verify panel (needs `VERIFY_URL`) |
| `/myorders` | everyone | Your recent orders and their status |
| `/cancel id:` | everyone | Cancel your order before it's accepted |
| `/purge amount: [user:]` | Manage Messages | Delete up to 100 recent messages (optionally from one user) |
| `/mute user: duration: [reason:]` | Timeout Members | Timeout, e.g. `10m`, `2h`, `1d` (max 28d) |
| `/unmute user:` | Timeout Members | Remove timeout |
| `/ban user: [reason:] [delete_days:]` | Ban Members | Ban, optionally deleting up to 7 days of messages |
| `/unban user_id:` | Ban Members | Unban by user ID |

You can change who sees each command under **Server Settings → Integrations → your bot**. Moderators can't
mute/ban someone with an equal or higher role.

## Setup
1. Create an application at https://discord.com/developers/applications, then **Bot → Reset Token** and copy it.
   No privileged intents are needed.
2. Invite it: **OAuth2 → URL Generator**, scopes `bot` + `applications.commands`, permissions:
   *Manage Channels, Manage Roles, View Channels, Send Messages, Embed Links, Attach Files, Read Message History,
   Manage Messages, Timeout Members, Ban Members, Mention Everyone*. In **Server Settings → Roles**, drag the bot's
   role **above** the roles of people it should be able to mute or ban.
3. In your server create:
   - a `submit-orders` channel (everyone can see it, but turn off Send Messages so only the panel is there)
   - a staff-only `orders` channel
   - optionally a `Tickets` category (if you don't, the bot creates a staff-only `🎫 Tickets` one on startup)
   - an `Orderer` role (and optionally a `Support` role)
   - a `support` channel for the support panel
4. Configure and run (Node 20.6+):
   ```
   cd discord-bot
   npm install
   cp .env.example .env               # fill in the IDs (turn on Developer Mode in Discord to copy IDs)
   npm run deploy                     # registers slash commands; rerun after changing src/commands.js
   npm start
   ```
5. Run `/orderpanel channel:#submit-orders` and `/supportpanel channel:#support` (and `/verifypanel`, see above). Run them again any time to
   repost a panel (delete the old one by hand).

Members need **DMs from server members** turned on to send their screenshot; the bot tells them if it can't DM them.

Orders, tickets and screenshots are saved under `data/` (git-ignored). Screenshots contain customers' personal
details, so delete old ones from `data/screenshots/` periodically.

To change promos, edit `promos.json` and restart the bot. To change the address form, edit `fields` in
`src/services.js`. Run `npm test` after making changes.

## Hosting on Vultr
1. Vultr → **Deploy +** → **Cloud Compute – Shared CPU**, any location near you, image **Ubuntu 24.04**,
   the cheapest plan (1 vCPU / 1 GB is plenty). Deploy it, then copy its IP and root password.
2. Connect: `ssh root@YOUR_SERVER_IP` (Windows: PowerShell or PuTTY).
3. Get the code and run the setup:
   ```
   apt-get update && apt-get install -y git
   git clone -b claude/exciting-curie-d07k1y https://github.com/plasma-websites/claude.git /opt/bot
   cd /opt/bot/discord-bot
   bash deploy/setup.sh     # first run creates .env and stops
   nano .env                # paste your settings, Ctrl+O Enter Ctrl+X to save
   bash deploy/setup.sh     # installs, registers commands, starts the bot
   ```
   The repo is private, so for `git clone` use your GitHub username and a personal access token
   (GitHub → Settings → Developer settings → Personal access tokens) as the password.
4. Useful commands:
   - logs: `journalctl -u orders-bot -f`
   - restart after changing `.env` or `promos.json`: `systemctl restart orders-bot`
   - update to the latest code: `cd /opt/bot && git pull && cd discord-bot && bash deploy/setup.sh`

Only run the bot in one place at a time — two copies on the same token will both answer every button.

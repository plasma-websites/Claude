# Orders bot

Discord bot for taking **Uber Rides**, **Uber Eats**, **Deliveroo**, **Just Eat** and **Uber Trains** orders, with order tickets,
support tickets, a verify panel and moderation commands.

## Order flow
1. In your order channel (panel posted with `/orderpanel`), a member picks the company from a dropdown.
2. They pick a promo from `promos.json`:
   - Uber Rides: **10 off**
   - Uber Eats: **10 off**, **12 off**
   - Deliveroo: **15f20**
   - Just Eat: **10 off**
   - Uber Trains: **5 off**, **10 off**
3. They answer **VC?** Yes / No.
4. A form pops up for the address: **delivery address** for Uber Eats / Deliveroo / Just Eat, **pickup + drop-off**
   for Uber Rides, from/to stations and date for Uber Trains, plus optional notes and an optional
   **discount / referral code** (see Referrals). A valid code lowers the service fee shown everywhere.
5. The bot DMs them asking for their **order screenshot** (15 minutes to send it) and gives them a random
   6-digit **order number**, e.g. `#483920`.
6. The order appears in the **staff orders channel** with the screenshot, pinging the orderer role **and** the
   orderers online for that service, with **Accept order** and **❓ Ask question** buttons. Ask question DMs the customer; they answer with
   the button or by typing in DMs, and the answer is posted under the order, pinging whoever asked.
7. **Accept order** (orderer or trial orderer role, one person per order) first shows a quick private check
   ("press the 🍕"), so a script can't grab orders. Then it creates a private ticket in the tickets category,
   named with a status emoji, the order number and the customer's username, e.g. `🔵-order-483920-plasma`. Its panel shows all the order info
   and the screenshot.
8. In the ticket, **Complete order** renames it `🟢-order-483920` and it is **deleted automatically 2 hours later**
   (`AUTO_DELETE_HOURS`), after a transcript is saved. **📌 Keep ticket open** stops the auto-delete.
   **Close ticket** / **Close now** locks it immediately. **❌ Cancel order** (staff) asks for an optional reason,
   DMs the customer, gives back any discount code, and deletes the ticket 10 seconds later.
9. Closing **locks** the ticket (`🔒-order-483920`): the customer loses access, staff keep it.
   **Delete ticket** (staff only) removes the channel; it's available on every ticket at any stage.
10. Instead of scrolling up to the buttons, staff can type `/complete`, `/close`, `/delete` or `/rename name:` in any
    order or support ticket.

The customer gets DMs along the way. Auto-delete times are saved, so tickets are still deleted on schedule if the bot
restarts. A member can have up to `MAX_OPEN_ORDERS` (default 2) orders waiting or in progress at once; completed
orders don't count.

Ticket status emojis: 🔵 in progress · 🟢 completed · 🔒 closed (support tickets: 👨‍💻 in progress · ✅ completed).
Discord limits channel renames to 2 per 10 minutes, so a rename can show up a few minutes late if a ticket changes status quickly.

## Transcripts
Every message in order and support tickets is saved as it's sent (in `data/transcripts`), so a transcript exists
however the ticket ends, even if someone deletes the channel by hand. When the bot deletes a ticket itself (auto-delete
or **Delete ticket**) it re-reads the whole channel first, which also picks up edited messages.

Post the staff panel with `/transcriptpanel` in a staff channel. **🔎 Search by user ID** opens a box for a member's
ID; the reply (only you see it) lists all of their orders and support tickets, with one `.txt` transcript per ticket
that has the order details at the top. Orderers, the support role and admins can use it.

Turn on **Message Content Intent** (Developer Portal → Bot) or transcripts only contain the bot's panels, not what
members type. Links to attachments in transcripts are Discord links and can stop working after a while; order
screenshots are also kept in `data/screenshots`. Tickets from before this feature only have their order details.

## Trial orderers
Set `TRIAL_ORDERER_ROLE_ID` to a role for trial orderers. They can do everything orderers can (go online, accept,
complete, request payments). When a trial orderer accepts an order, the ticket pings the orderer role so a full
orderer joins to supervise. `/trialpanel` posts a panel listing every trial orderer's **successful (completed)
orders** with order numbers and dates, plus orders in progress, updated live.

## Referrals
`/referralpanel` posts the **🎉 Foodhub Referrals — Win-Win!** panel:
- **🔗 Get my invite link** creates a personal, never-expiring invite link for that member.
- When someone joins through it, the bot records who invited them and DMs both.
- **🎟️ I was invited** gives the new member a **50p off** code for their first order (once).
- **🏆 Claim my reward**: once 3 friends have joined and 2 of them have **completed** an order, the member gets a
  **free-fee** code. No limit — every 2 more friends who order earn another. Otherwise it shows their progress.
- **📋 My codes** lists their codes. Every code message has a **📋 Copy code** button.

Codes are personal and single-use. They're typed into the order form; the fee drops straight away and the code is
marked used on that order. If the order is cancelled (by the customer, staff, or a deleted ticket), the code
becomes valid again and the owner is DMed it.

Needs **Server Members Intent** on (Developer Portal → Bot) and the bot's **Manage Server** permission (to read
invite counts) and **Create Invite** in the panel's channel.

## Bot suggestions
`/suggestionpanel [channel:]` turns a channel into the suggestions list: a numbered, formatted list with a panel
under it that's always the last message. **➕ Add suggestion** opens a form and the list updates; **🧹 Clear list**
(admins) empties it after a confirm. Turn off Send Messages there so only the bot posts.

## Applications
`/applypanel` posts **Apply to be an orderer** and **Apply to be a partner**. The bot asks the questions one by one in
DMs:
- **Orderer:** VC proof (images in one message), vouches yes/no, order proof (images), other servers yes/no, active times.
- **Partner:** server invite link, member count, members gained organically yes/no, what the server is about, what
  they want from the partnership.

The finished application is posted in `APPLICATIONS_CHANNEL_ID` (default: the staff orders channel) with the images
underneath and **Accept** / **Deny** buttons for admins. Accepting an orderer gives them the trial orderer role. The
applicant is DMed either way.

## Giveaways
`/giveaway [channel:]` (Manage Server) opens a form: **title**, **duration** (`30m`, `2h`, `1d`, `1w`, max 28d),
**number of winners** (default 1) and **info**. The bot posts it with a **🎉 Enter** button showing the entry count;
pressing it again leaves. When time's up it picks random winners, edits the post and pings them. Admins can press
**🔁 Reroll** on an ended giveaway to draw again. Giveaways are saved, so they still end if the bot restarts.

## Staff panel, fees & payments
Post the **🧑‍🍳 Orderer control panel** in a staff channel with `/staffpanel`. Orderers use it to:
- **Go online** for the services they're taking (multi-select), then pick **how long** (30 min – 8 hours). They're
  set offline automatically (and DMed) when the time's up, so nobody stays online by accident. **Go offline** ends it early.
  The order panel shows who's online for each service, live.
- **🗓️ My schedule:** the times they're usually online, e.g. `Mon-Fri 6pm-10pm`, `Sat 12:00-23:30`,
  `weekends 10-14`, `daily 22:00-02:00` (`TIMEZONE`, default UK time). At the start of each slot the bot DMs them
  "you're usually online now — go online?" with **Yes** / **Not today**. Yes puts them online for the services they
  last picked until the slot ends.
- **Payment details:** save their PayPal, Revolut, Starling and Wise links and LTC address.
- **My status:** see what's saved, when they go offline, and their schedule.

Service fees (in `src/services.js`, or per promo in `promos.json`): Uber Rides **£1.50**, Uber Eats **£2.50**,
Deliveroo **£2.50**, Just Eat **£2.00**, Uber Trains **£1.00** (5 off) / **£2.50** (10 off).
They show on the order panel, the promo step, the order post and the ticket.

In an order ticket, orderers run `/paypal amount:`, `/rev amount:`, `/starling amount:`, `/wise amount:` or `/crypto amount:`. The bot
posts a **💳 PAYMENT DUE** panel pinging the customer with the amount in £ and the orderer's saved link/address. The
customer presses **✅ I've paid**, the orderer is pinged and presses **💰 Confirm received** or **❌ Not received**.

**🔁 Forfeit** (in the ticket, accepting orderer or admin): the order goes back to the queue with its ticket kept, the
old staff post is replaced by a fresh one that re-pings, and whoever accepts next joins the same ticket.

Every message the bot sends is an embed panel (pings are sent alongside the embed), all in one colour:
`BRAND_COLOR` in `.env` (a hex code like `#ff7a00`, default Discord blurple).

## Food Hub AI
Set `ANTHROPIC_API_KEY` (from console.anthropic.com) and restart. There are two personalities:

- **Support assistant** (support tickets, Claude Sonnet 5.5): answers the reason the ticket was opened with, then the
  member's messages (or **💬 Ask a follow-up**), in 1-2 sentence plain messages. It knows the services, promos, fees,
  how ordering works, the rules and that member's recent orders. It goes quiet once staff speak in the ticket or the
  member presses **🙋 Talk to a human** (which pings the support role). Max 15 answers per ticket. Server-side
  fallback is on, so if Sonnet declines a question another model answers instead.
- **Chat bot** (Claude Haiku 5.5): slangy, 😭-heavy Discord personality. In the channels listed in `CHAT_CHANNEL_IDS`
  it replies when someone @mentions it, replies to it, or says "food hub". In order tickets it replies when
  @mentioned, or when the customer replies to one of its messages. It ignores replies to the bot's panels (order
  details, payments…) and only answers orderers when they @ping it directly. A direct @ping (of the bot or its role) gets an answer in any channel.

Spam protection: 6s cooldown per person, 3s per channel, 20 replies a minute and `AI_DAILY_LIMIT` (default 1000) a day.
It can never ping roles, @everyone or @here, and pings at most one person per message.

**Message Content intent:** to read normal messages (not just @mentions), turn on **Message Content Intent** in the
Developer Portal → your app → Bot, then restart. The bot detects whether it's on; without it, the AI only answers
@mentions, replies and the support ticket buttons.

When an order is completed, a **✅ ORDER COMPLETED** post (service, customer, staff member) goes into the
completed-orders channel if `COMPLETED_CHANNEL_ID` is set.

## Vouches
Set `VOUCH_CHANNEL_ID`, restart, and run `/vouchpanel`. The channel gets a **⭐ Leave a vouch** panel explaining
what a good vouch looks like, and the bot keeps it as the last message in the channel.
- Only customers with a **completed order** can vouch, **once per order**, with 1-5 stars and a message.
- Each vouch is posted by the bot with a "✅ Verified purchase • Order #…" footer.
- Anything else typed in the channel is deleted (staff with Manage Messages are allowed). Best to also turn off
  **Send Messages** for `@everyone` in that channel.
- Customers get a reminder to vouch in their "order completed" DM.

## Announcements & ToS
- `/announce [channel:] [ping:]` opens a form (title, message, optional image link) and posts it as a bot panel,
  optionally pinging @everyone or @here.
- `/tos [channel:]` posts the **📜 FOOD HUB | ORDER POLICY & SERVER RULES** panel. Edit the text in `src/tos.js`.

## Support tickets
Post the panel with `/supportpanel`. Members click **Open support ticket**, type what they need, and get a private
`👨‍💻-support-123456` channel with the support role. The member or staff can **Close** it (or `/close`), which saves
a transcript and deletes the channel straight away. One open support ticket per member.

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
| `/vouchpanel` | Manage Server | Post / move the vouch panel to the bottom of the vouch channel |
| `/tos [channel:]` | Manage Server | Post the order policy & server rules panel |
| `/staffpanel [channel:]` | Manage Server | Post the orderer control panel |
| `/transcriptpanel [channel:]` | Manage Server | Post the staff transcript search panel |
| `/giveaway [channel:]` | Manage Server | Start a giveaway (opens a form) |
| `/trialpanel [channel:]` | Manage Server | Post the trial orderer panel |
| `/referralpanel [channel:]` | Manage Server | Post the referrals panel |
| `/suggestionpanel [channel:]` | Manage Server | Post / move the bot suggestions list |
| `/applypanel [channel:]` | Manage Server | Post the orderer / partner applications panel |
| `/complete` `/close` `/delete` | Staff (checked by the bot) | Same as the ticket buttons, in the current ticket |
| `/rename name:` | Staff | Rename the current ticket channel |
| `/paypal` `/rev` `/starling` `/wise` `/crypto` `amount:` | Orderer role | Post a payment-due panel with your saved details |
| `/whyfoodhub [channel:]` | Manage Server | Post the Why Food Hub panel (2 buttons, text in `src/whyfoodhub.js`) |
| `/announce [channel:] [ping:]` | Manage Server | Post an announcement panel |
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
   On the same page turn on **Message Content Intent** (transcripts, AI) and **Server Members Intent** (referrals).
2. Invite it: **OAuth2 → URL Generator**, scopes `bot` + `applications.commands`, permissions:
   *Manage Server, Manage Channels, Manage Roles, Create Invite, View Channels, Send Messages, Embed Links, Attach
   Files, Read Message History, Manage Messages, Timeout Members, Ban Members, Mention Everyone*. Manage Server lets it
   read invite counts for referrals; Manage Roles lets it give the trial role (its role must be above that role). In **Server Settings → Roles**, drag the bot's
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

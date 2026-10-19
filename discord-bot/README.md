# Orders bot

Discord bot for taking **Uber Rides**, **Uber Eats** and **Deliveroo** orders, with order tickets, support tickets
and moderation commands.

## Order flow
1. In your **submit-orders** channel (panel posted with `/panel type:Submit orders`), a member picks the company
   from a dropdown.
2. They pick a promo from `promos.json`:
   - Uber Rides: **10 off**
   - Uber Eats: **10 off**, **12 off**
   - Deliveroo: **15f20**
3. They answer **VC?** Yes / No.
4. A form pops up for the address: **delivery address** for Uber Eats / Deliveroo, **pickup + drop-off** for
   Uber Rides, plus optional notes.
5. The bot DMs them asking for their **order screenshot**. They have 15 minutes to send it as an image.
6. The order appears in the **staff orders channel** with the screenshot, pinging the orderer role, with
   **Accept order** and **Decline** buttons.
7. **Accept order** (orderer role only, one person per order) creates a private ticket channel `order-0001` for the
   customer, the accepting staff member and the orderer role. Its panel shows all the order info and the screenshot.
8. In the ticket, **Complete order** marks it done and the ticket **auto-closes 2 hours later** (`AUTO_CLOSE_HOURS`).
   **Close ticket** / **Close now** closes it immediately. The customer gets DMs along the way.

Auto-close times are saved, so tickets still close on schedule if the bot restarts.

## Support tickets
Post the panel with `/panel type:Support tickets`. Members click **Open support ticket**, type what they need, and
get a private `support-0001` channel with the support role. The member or support staff can close it with
**Close ticket**. One open support ticket per member.

## Commands
| Command | Who (default) | What |
|---|---|---|
| `/panel type:` | Manage Server | Post the submit-orders or support panel in this channel |
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
   - a `Tickets` category (staff-only by default; the bot adds the customer per ticket)
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
5. Run `/panel type:Submit orders` in `submit-orders` and `/panel type:Support tickets` in `support`.

Members need **DMs from server members** turned on to send their screenshot; the bot tells them if it can't DM them.

Orders, tickets and screenshots are saved under `data/` (git-ignored). Screenshots contain customers' personal
details, so delete old ones from `data/screenshots/` periodically.

To change promos, edit `promos.json` and restart the bot. To change the address form, edit `fields` in
`src/services.js`. Run `npm test` after making changes.

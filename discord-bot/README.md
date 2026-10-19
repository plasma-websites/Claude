# Orders bot

Discord bot where members submit **Uber Eats**, **Uber Ride** and **Deliveroo** orders, and members with the
**orderer** role accept them in an orders channel.

## How it works
1. A member clicks a button on the order panel (or runs `/order service:<...>`) and fills in a popup form.
2. The order is posted in the orders channel, pinging the orderer role, with an **Accept** button.
3. An orderer clicks **Accept**. Only one orderer can take it. The customer gets a DM saying who accepted.
4. The orderer then has **Mark completed**, **Release** (put it back in the queue) and **Cancel**. The customer
   gets a DM when it's completed or cancelled.

Commands:
| Command | Who | What |
|---|---|---|
| `/order service:` | everyone | Open the order form |
| `/myorders` | everyone | Your last 10 orders and their status |
| `/cancel id:` | customer (before it's accepted), the accepting orderer, admins | Cancel an order |
| `/panel` | Manage Server | Post the order panel with buttons in the current channel |

Rules: members can have up to `MAX_OPEN_ORDERS` (default 2) open orders at once, and can't accept their own orders.
Admins (Manage Server) can complete, release or cancel any order.

## Setup
1. Go to https://discord.com/developers/applications, create an application, then **Bot → Reset Token** and copy the token.
   No privileged intents are needed.
2. Invite it: **OAuth2 → URL Generator**, scopes `bot` + `applications.commands`, permissions
   *View Channels, Send Messages, Embed Links, Mention Everyone* (the last one only lets it ping the orderer role;
   alternatively make that role mentionable).
3. In your server create an `Orderer` role and an `#orders` channel. **Make `#orders` visible only to orderers
   and admins**, because orders contain addresses. Put the panel in a separate public channel, e.g. `#place-order`.
4. Configure and run (Node 20.6+):
   ```
   cd discord-bot
   npm install
   cp .env.example .env     # fill in the IDs (turn on Developer Mode in Discord to copy IDs)
   npm run deploy           # registers slash commands; rerun after changing src/commands.js
   npm start
   ```
5. In `#place-order`, run `/panel`.

Orders are saved to `data/orders.json` (keep it out of git; it's in `.gitignore`), so they survive restarts.

## Customising
Order types and their form fields are in `src/services.js` (Discord allows at most 5 fields per form).
Run `npm test` after changes.

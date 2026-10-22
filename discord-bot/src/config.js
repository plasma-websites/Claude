import fs from 'node:fs';
import { SERVICES } from './services.js';

const root = new URL('..', import.meta.url).pathname;

// Promo options per company, shown in the promo dropdown. Each entry is a name,
// or { "name": "...", "fee": 2.5 } when that promo has its own fee. Returns
// { serviceKey: [{ name, fee }] }.
export function loadPromos(file = `${root}promos.json`) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const promos = {};
  for (const [key, service] of Object.entries(SERVICES)) {
    const list = raw[key] ?? [];
    if (!Array.isArray(list) || list.length < 1 || list.length > 25) throw new Error(`${file}: "${key}" needs 1-25 promos (Discord menu limit)`);
    promos[key] = list.map((entry) => {
      const { name, fee = service.fee } = typeof entry === 'string' ? { name: entry } : entry;
      if (typeof name !== 'string' || !name.trim() || name.length > 100) {
        throw new Error(`${file}: "${key}" must be a list of promo names (1-100 characters each)`);
      }
      if (typeof fee !== 'number' || !(fee >= 0)) throw new Error(`${file}: promo "${name}" for "${key}" needs a fee (the service has no default fee)`);
      return { name, fee };
    });
  }
  return promos;
}

export function loadConfig(required) {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  const dataDir = process.env.DATA_DIR || `${root}data`;
  return {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    staffChannelId: process.env.STAFF_ORDERS_CHANNEL_ID,
    ordererRoleId: process.env.ORDERER_ROLE_ID,
    supportRoleId: process.env.SUPPORT_ROLE_ID || process.env.ORDERER_ROLE_ID,
    ticketCategoryId: process.env.TICKET_CATEGORY_ID,
    supportCategoryId: process.env.SUPPORT_CATEGORY_ID, // falls back to the ticket category at startup
    completedChannelId: process.env.COMPLETED_CHANNEL_ID || null,
    vouchChannelId: process.env.VOUCH_CHANNEL_ID || null,
    chatChannelIds: (process.env.CHAT_CHANNEL_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    verifyUrl: process.env.VERIFY_URL || null,
    verifiedRoleId: process.env.VERIFIED_ROLE_ID || null,
    // AUTO_CLOSE_HOURS is the old name, from when completed tickets were locked instead of deleted.
    autoDeleteHours: Number(process.env.AUTO_DELETE_HOURS || process.env.AUTO_CLOSE_HOURS) || 2,
    maxOpenOrders: Number(process.env.MAX_OPEN_ORDERS) || 2,
    dataFile: `${dataDir}/store.json`,
    screenshotDir: `${dataDir}/screenshots`,
    transcriptDir: `${dataDir}/transcripts`,
  };
}

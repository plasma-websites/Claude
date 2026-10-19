import fs from 'node:fs';
import { SERVICES } from './services.js';

const root = new URL('..', import.meta.url).pathname;

// promos.json (yours, not in git) falls back to promos.example.json.
export function loadPromos(file = fs.existsSync(`${root}promos.json`) ? `${root}promos.json` : `${root}promos.example.json`) {
  const promos = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const key of Object.keys(SERVICES)) {
    const list = promos[key] ?? [];
    if (!Array.isArray(list) || list.some((p) => typeof p !== 'string' || !p.trim() || p.length > 100)) {
      throw new Error(`${file}: "${key}" must be a list of promo names (1-100 characters each)`);
    }
    if (list.length > 24) throw new Error(`${file}: "${key}" has more than 24 promos (Discord menu limit)`);
    promos[key] = list;
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
    supportCategoryId: process.env.SUPPORT_CATEGORY_ID || process.env.TICKET_CATEGORY_ID,
    autoCloseHours: Number(process.env.AUTO_CLOSE_HOURS) || 2,
    maxOpenOrders: Number(process.env.MAX_OPEN_ORDERS) || 2,
    dataFile: `${dataDir}/store.json`,
    screenshotDir: `${dataDir}/screenshots`,
  };
}

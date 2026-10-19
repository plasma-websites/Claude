export function loadConfig(required) {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID,
    ordersChannelId: process.env.ORDERS_CHANNEL_ID,
    ordererRoleId: process.env.ORDERER_ROLE_ID,
    maxOpenOrders: Number(process.env.MAX_OPEN_ORDERS) || 2,
    dataFile: process.env.DATA_FILE || new URL('../data/orders.json', import.meta.url).pathname,
  };
}

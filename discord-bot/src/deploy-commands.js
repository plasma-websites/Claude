// Registers the slash commands with your server. Run once, and again whenever
// src/commands.js changes: npm run deploy
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { loadConfig } from './config.js';

const config = loadConfig(['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID']);
const rest = new REST().setToken(config.token);

await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
  body: commands.map((c) => c.toJSON()),
});
console.log(`Registered ${commands.length} commands in guild ${config.guildId}.`);

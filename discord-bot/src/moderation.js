import { MessageFlags } from 'discord.js';
import { ephemeral } from './util.js';

const UNITS = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 };
const MAX_TIMEOUT_MS = 28 * UNITS.d; // Discord's limit

// "10m", "2h", "1d" -> milliseconds, or null if invalid / longer than 28 days.
export function parseDuration(text) {
  const match = /^(\d+)\s*([smhdw])$/i.exec(text.trim());
  if (!match) return null;
  const ms = Number(match[1]) * UNITS[match[2].toLowerCase()];
  return ms > 0 && ms <= MAX_TIMEOUT_MS ? ms : null;
}

// The invoker must outrank the target, so mods can't act on admins.
function hierarchyError(interaction, target) {
  if (!target) return null;
  if (target.id === interaction.user.id) return 'You can\'t do that to yourself.';
  if (target.id === interaction.guild.ownerId) return 'You can\'t do that to the server owner.';
  const isOwner = interaction.user.id === interaction.guild.ownerId;
  if (!isOwner && target.roles.highest.position >= interaction.member.roles.highest.position) {
    return 'That member has the same or a higher role than you.';
  }
  return null;
}

async function purge(interaction) {
  const amount = interaction.options.getInteger('amount', true);
  const user = interaction.options.getUser('user');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let messages = await interaction.channel.messages.fetch({ limit: 100 });
  if (user) messages = messages.filter((m) => m.author.id === user.id);
  const deleted = await interaction.channel.bulkDelete([...messages.values()].slice(0, amount), true);
  const skipped = Math.min(amount, messages.size) - deleted.size;
  return interaction.editReply(
    `🧹 Deleted ${deleted.size} message(s)${user ? ` from ${user}` : ''}.` + (skipped > 0 ? ` ${skipped} were older than 14 days and can't be bulk deleted.` : ''),
  );
}

async function mute(interaction) {
  const member = interaction.options.getMember('user');
  if (!member) return interaction.reply(ephemeral('That user isn\'t in this server.'));
  const ms = parseDuration(interaction.options.getString('duration', true));
  if (!ms) return interaction.reply(ephemeral('Invalid duration. Use e.g. `10m`, `2h`, `1d` (max 28d).'));
  const error = hierarchyError(interaction, member) ?? (member.moderatable ? null : 'I can\'t mute that member (their role is above mine).');
  if (error) return interaction.reply(ephemeral(error));
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  await member.timeout(ms, `${reason} — by ${interaction.user.tag}`);
  return interaction.reply(`🔇 ${member} muted until <t:${Math.floor((Date.now() + ms) / 1000)}:f>. Reason: ${reason}`);
}

async function unmute(interaction) {
  const member = interaction.options.getMember('user');
  if (!member) return interaction.reply(ephemeral('That user isn\'t in this server.'));
  const error = hierarchyError(interaction, member) ?? (member.moderatable ? null : 'I can\'t unmute that member.');
  if (error) return interaction.reply(ephemeral(error));
  await member.timeout(null, `Unmuted by ${interaction.user.tag}`);
  return interaction.reply(`🔊 ${member} unmuted.`);
}

async function ban(interaction) {
  const user = interaction.options.getUser('user', true);
  const member = interaction.options.getMember('user'); // null if they already left
  const error = hierarchyError(interaction, member) ?? (member && !member.bannable ? 'I can\'t ban that member (their role is above mine).' : null);
  if (error) return interaction.reply(ephemeral(error));
  const reason = interaction.options.getString('reason') ?? 'No reason given';
  const days = interaction.options.getInteger('delete_days') ?? 0;
  await interaction.guild.members.ban(user, { reason: `${reason} — by ${interaction.user.tag}`, deleteMessageSeconds: days * 86400 });
  return interaction.reply(`🔨 ${user.tag} banned. Reason: ${reason}`);
}

async function unban(interaction) {
  const userId = interaction.options.getString('user_id', true).trim();
  try {
    await interaction.guild.members.unban(userId, `Unbanned by ${interaction.user.tag}`);
  } catch {
    return interaction.reply(ephemeral('That user ID isn\'t banned (or isn\'t valid).'));
  }
  return interaction.reply(`✅ <@${userId}> unbanned.`);
}

export const moderationCommands = { purge, mute, unmute, ban, unban };

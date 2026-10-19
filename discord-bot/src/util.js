import { ChannelType, EmbedBuilder, MessageFlags, OverwriteType, PermissionFlagsBits as P } from 'discord.js';

export const COLORS = { brand: 0x5865f2, success: 0x57f287, warning: 0xfee75c, danger: 0xed4245, info: 0x5865f2 };

// The bot never sends bare text: every message is an embed. `panel` builds a
// small one from a line of text; `say`/`ephemeral` wrap it into a message.
export function panel(text, { title, color = COLORS.brand } = {}) {
  const embed = new EmbedBuilder().setColor(color).setDescription(text);
  return title ? embed.setTitle(title) : embed;
}

export const say = (text, extra = {}, style = {}) => ({ embeds: [panel(text, style)], ...extra });
export const ephemeral = (text, extra = {}, style = {}) => ({ ...say(text, extra, style), flags: MessageFlags.Ephemeral });

export function hasRole(member, roleId) {
  const roles = member?.roles;
  // Cached members expose a RoleManager, uncached ones a plain array of IDs.
  return Array.isArray(roles) ? roles.includes(roleId) : Boolean(roles?.cache.has(roleId));
}

export const isAdmin = (interaction) => Boolean(interaction.memberPermissions?.has(P.ManageGuild));

export function dm(client, userId, payload) {
  const message = typeof payload === 'string' ? say(payload) : payload;
  return client.users.send(userId, message).then(() => true, () => false); // user may have DMs closed
}

export async function editMessage(client, channelId, messageId, payload) {
  if (!channelId || !messageId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel.messages.fetch(messageId);
    await message.edit(payload);
  } catch (err) {
    console.error(`Could not edit message ${messageId}:`, err.message);
  }
}

const MEMBER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

// Private text channel visible only to the given members and roles (plus the bot).
export function createTicketChannel(guild, { name, parent, memberIds, roleIds }) {
  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parent || null,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: guild.client.user.id, type: OverwriteType.Member, allow: [...MEMBER_PERMS, P.ManageChannels] },
      ...memberIds.map((id) => ({ id, type: OverwriteType.Member, allow: MEMBER_PERMS })),
      ...roleIds.map((id) => ({ id, type: OverwriteType.Role, allow: MEMBER_PERMS })),
    ],
  });
}

export async function deleteChannel(client, channelId, reason) {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.delete(reason);
  } catch (err) {
    if (err.code !== 10003) console.error(`Could not delete channel ${channelId}:`, err.message); // 10003 = already gone
  }
}

// Renames are rate limited by Discord (2 per channel per 10 minutes), so don't
// make the caller wait for them.
export function renameChannel(client, channelId, name) {
  client.channels
    .fetch(channelId)
    .then((channel) => channel.setName(name))
    .catch((err) => console.error(`Could not rename channel ${channelId}:`, err.message));
}

// Takes the member's access away from a ticket channel (staff keep it).
export async function lockTicket(client, channelId, userId) {
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.permissionOverwrites.edit(userId, { ViewChannel: false }, { type: OverwriteType.Member });
  } catch (err) {
    console.error(`Could not lock channel ${channelId}:`, err.message);
  }
}

// Uses TICKET_CATEGORY_ID if set, otherwise finds a category with "ticket" in
// its name, otherwise creates a staff-only "🎫 Tickets" category.
export async function ensureTicketCategory(guild, config) {
  if (config.ticketCategoryId) return config.ticketCategoryId;
  const channels = await guild.channels.fetch();
  let category = channels.find((c) => c?.type === ChannelType.GuildCategory && /ticket/i.test(c.name));
  if (!category) {
    const staffRoles = [...new Set([config.ordererRoleId, config.supportRoleId])];
    category = await guild.channels.create({
      name: '🎫 Tickets',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
        { id: guild.client.user.id, type: OverwriteType.Member, allow: [...MEMBER_PERMS, P.ManageChannels] },
        ...staffRoles.map((id) => ({ id, type: OverwriteType.Role, allow: MEMBER_PERMS })),
      ],
    });
    console.log(`Created ticket category "${category.name}" (${category.id}).`);
  }
  return category.id;
}

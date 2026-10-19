import { ChannelType, MessageFlags, OverwriteType, PermissionFlagsBits as P } from 'discord.js';

export const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });

export function hasRole(member, roleId) {
  const roles = member?.roles;
  // Cached members expose a RoleManager, uncached ones a plain array of IDs.
  return Array.isArray(roles) ? roles.includes(roleId) : Boolean(roles?.cache.has(roleId));
}

export const isAdmin = (interaction) => Boolean(interaction.memberPermissions?.has(P.ManageGuild));

export function dm(client, userId, payload) {
  return client.users.send(userId, payload).then(() => true, () => false); // user may have DMs closed
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

export const pad = (n) => String(n).padStart(4, '0');

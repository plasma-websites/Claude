import { ChannelType, PermissionFlagsBits as P, SlashCommandBuilder } from 'discord.js';

const panelCommand = (name, description) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(ChannelType.GuildText),
    );

export const commands = [
  panelCommand('orderpanel', 'Post the submit-orders panel'),
  panelCommand('supportpanel', 'Post the support tickets panel'),
  new SlashCommandBuilder().setName('myorders').setDescription('Show your recent orders'),
  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel one of your orders that hasn\'t been accepted yet')
    .addIntegerOption((o) => o.setName('id').setDescription('Order number').setRequired(true).setMinValue(1)),

  // Moderation
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete recent messages in this channel')
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('amount').setDescription('How many (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user')),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Time out a member')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to mute').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a member\'s timeout')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to unmute').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user')
    .setDefaultMemberPermissions(P.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400))
    .addIntegerOption((o) => o.setName('delete_days').setDescription('Delete their messages from the last N days (0-7)').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by ID')
    .setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('User ID').setRequired(true)),
];

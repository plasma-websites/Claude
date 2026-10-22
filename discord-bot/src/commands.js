import { ChannelType, PermissionFlagsBits as P, SlashCommandBuilder } from 'discord.js';
import { PAYMENT_METHODS } from './services.js';

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
  panelCommand('verifypanel', 'Post the verify panel (RestoreCord / VaultCord link)'),
  panelCommand('tos', 'Post the order policy & server rules'),
  panelCommand('whyfoodhub', 'Post the Why Food Hub panel'),
  panelCommand('staffpanel', 'Post the orderer control panel (online status & payment details)'),
  panelCommand('transcriptpanel', 'Post the staff panel for searching ticket transcripts by user ID'),
  panelCommand('trialpanel', 'Post the trial orderer panel (their successful orders, updated live)'),
  panelCommand('referralpanel', 'Post the referrals panel (invite links, rewards and codes)'),
  panelCommand('suggestionpanel', 'Post (or move) the bot suggestions list and panel'),
  panelCommand('applypanel', 'Post the orderer / partner applications panel'),

  // In a ticket, instead of scrolling up to the buttons (staff only, checked by the bot)
  new SlashCommandBuilder().setName('complete').setDescription('Complete the order in this ticket'),
  new SlashCommandBuilder().setName('close').setDescription('Close this ticket (support tickets are deleted)'),
  new SlashCommandBuilder().setName('delete').setDescription('Delete this ticket (a transcript is saved first)'),
  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Rename this ticket channel')
    .addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(90)),
  new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Start a giveaway (opens a form)')
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
  new SlashCommandBuilder()
    .setName('vouchpanel')
    .setDescription('Post (or move to the bottom) the vouch panel in the vouch channel')
    .setDefaultMemberPermissions(P.ManageGuild),
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post an announcement as a panel from the bot')
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((o) =>
      o
        .setName('ping')
        .setDescription('Ping anyone?')
        .addChoices({ name: 'No ping', value: 'none' }, { name: '@everyone', value: 'everyone' }, { name: '@here', value: 'here' }),
    ),
  new SlashCommandBuilder().setName('myorders').setDescription('Show your recent orders'),
  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel one of your orders that hasn\'t been accepted yet')
    .addIntegerOption((o) => o.setName('id').setDescription('Order number, e.g. 483920').setRequired(true).setMinValue(1)),

  // Payment requests (orderers): /paypal /rev /starling /crypto amount:
  ...Object.values(PAYMENT_METHODS).map((m) =>
    new SlashCommandBuilder()
      .setName(m.command)
      .setDescription(`Request a payment via ${m.label} (posts your saved details)`)
      .addNumberOption((o) => o.setName('amount').setDescription('Amount in £, e.g. 12.50').setRequired(true).setMinValue(0.01).setMaxValue(10000)),
  ),

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

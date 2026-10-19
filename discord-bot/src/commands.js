import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { SERVICES } from './services.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('order')
    .setDescription('Submit a new order')
    .addStringOption((o) =>
      o
        .setName('service')
        .setDescription('What do you want ordered?')
        .setRequired(true)
        .addChoices(...Object.entries(SERVICES).map(([value, s]) => ({ name: s.label, value }))),
    ),
  new SlashCommandBuilder().setName('myorders').setDescription('Show your recent orders'),
  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel one of your orders that hasn\'t been accepted yet')
    .addIntegerOption((o) => o.setName('id').setDescription('Order number').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Post the order panel (buttons) in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { SERVICES, STATUS } from './services.js';

export function orderModal(serviceKey) {
  const service = SERVICES[serviceKey];
  const modal = new ModalBuilder().setCustomId(`order:${serviceKey}`).setTitle(`${service.label} order`);
  for (const f of service.fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(f.required)
      .setMaxLength(f.max);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

export function orderEmbed(order) {
  const service = SERVICES[order.service];
  const status = STATUS[order.status];
  const embed = new EmbedBuilder()
    .setTitle(`${service.emoji} ${service.label} — Order #${order.id}`)
    .setColor(service.color)
    .addFields({ name: 'Customer', value: `<@${order.customerId}>`, inline: true })
    .addFields({ name: 'Status', value: `${status.emoji} ${status.label}`, inline: true })
    .setTimestamp(new Date(order.createdAt));
  if (order.ordererId) embed.addFields({ name: 'Orderer', value: `<@${order.ordererId}>`, inline: true });
  for (const f of service.fields) {
    const value = order.details[f.id]?.trim();
    if (value) embed.addFields({ name: f.label, value });
  }
  return embed;
}

// Buttons shown under the order in the orders channel, depending on its status.
export function orderButtons(order) {
  if (order.status === 'pending') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept:${order.id}`).setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
      ),
    ];
  }
  if (order.status === 'accepted') {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`complete:${order.id}`).setLabel('Mark completed').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`release:${order.id}`).setLabel('Release').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`cancel:${order.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
      ),
    ];
  }
  return [];
}

// Shown on the customer's private confirmation: they can cancel, not accept.
export function customerButtons(order) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cancel:${order.id}`).setLabel('Cancel order').setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function panel() {
  const embed = new EmbedBuilder()
    .setTitle('Place an order')
    .setDescription(
      'Pick a service below and fill in the form. An orderer will pick it up and you\'ll get a DM when it\'s accepted.\n' +
        'Use `/myorders` to check status and `/cancel` to cancel before it\'s accepted.',
    )
    .setColor(0x5865f2);
  const row = new ActionRowBuilder().addComponents(
    Object.entries(SERVICES).map(([key, s]) =>
      new ButtonBuilder().setCustomId(`panel:${key}`).setLabel(s.label).setEmoji(s.emoji).setStyle(ButtonStyle.Secondary),
    ),
  );
  return { embeds: [embed], components: [row] };
}

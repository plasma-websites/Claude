import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { SERVICES, STATUS } from './services.js';

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
const timestamp = (iso, style = 'R') => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
export const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

// --- order flow (submit-orders channel) ---

export function ordersPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Submit an order')
    .setDescription(
      'Pick a company below, choose your promo, and the bot will DM you to collect your order screenshot.\n' +
        'Make sure your DMs are open for this server. Use `/myorders` to check on your orders.',
    )
    .setColor(0x5865f2);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('order:service')
    .setPlaceholder('Which company?')
    .addOptions(Object.entries(SERVICES).map(([value, s]) => ({ label: s.label, value, emoji: s.emoji })));
  return { embeds: [embed], components: [row(menu)] };
}

export function promoPicker(serviceKey, promos) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`order:promo:${serviceKey}`)
    .setPlaceholder('Select a promo')
    .addOptions(
      ...promos.map((label, i) => ({ label, value: String(i) })),
      { label: 'No promo', value: 'none' },
    );
  return { content: `**${SERVICES[serviceKey].label}** — which promo?`, components: [row(menu)] };
}

export function vcPicker(serviceKey, promoValue) {
  const base = `order:vc:${serviceKey}:${promoValue}`;
  return {
    content: '**VC?**',
    components: [row(button(`${base}:yes`, 'Yes', ButtonStyle.Success), button(`${base}:no`, 'No', ButtonStyle.Secondary))],
  };
}

export function orderEmbed(order) {
  const service = SERVICES[order.service];
  const status = STATUS[order.status];
  const embed = new EmbedBuilder()
    .setTitle(`${service.emoji} ${service.label} — Order #${order.id}`)
    .setColor(service.color)
    .addFields(
      { name: 'Customer', value: `<@${order.customerId}>`, inline: true },
      { name: 'Company', value: service.label, inline: true },
      { name: 'Promo', value: order.promo ?? 'None', inline: true },
      { name: 'VC', value: order.vc ? 'Yes' : 'No', inline: true },
      { name: 'Status', value: `${status.emoji} ${status.label}`, inline: true },
    )
    .setTimestamp(new Date(order.createdAt));
  if (order.ordererId) embed.addFields({ name: 'Staff', value: `<@${order.ordererId}>`, inline: true });
  if (order.closeAt) embed.addFields({ name: 'Ticket closes', value: timestamp(order.closeAt), inline: true });
  if (order.screenshot) embed.setFooter({ text: 'Order screenshot attached' });
  return embed;
}

// Buttons under the order in the staff channel.
export function staffButtons(order, guildId) {
  if (order.status === 'pending') {
    return [
      row(
        button(`order:accept:${order.id}`, 'Accept order', ButtonStyle.Success, '✅'),
        button(`order:decline:${order.id}`, 'Decline', ButtonStyle.Danger),
      ),
    ];
  }
  if (order.ticketChannelId && ['accepted', 'completed'].includes(order.status)) {
    return [row(new ButtonBuilder().setLabel('Open ticket').setStyle(ButtonStyle.Link).setURL(channelUrl(guildId, order.ticketChannelId)))];
  }
  return [];
}

// Buttons on the panel inside the order ticket.
export function ticketButtons(order) {
  if (order.status === 'accepted') {
    return [
      row(
        button(`order:complete:${order.id}`, 'Complete order', ButtonStyle.Success, '✅'),
        button(`order:close:${order.id}`, 'Close ticket', ButtonStyle.Danger),
      ),
    ];
  }
  if (order.status === 'completed') return [row(button(`order:close:${order.id}`, 'Close now', ButtonStyle.Danger))];
  return [];
}

// --- support tickets ---

export function supportPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Need help?')
    .setDescription('Click the button below to open a private support ticket with our team.')
    .setColor(0xfee75c);
  return { embeds: [embed], components: [row(button('support:open', 'Open support ticket', ButtonStyle.Primary, '🎫'))] };
}

export function supportModal() {
  return new ModalBuilder()
    .setCustomId('support:modal')
    .setTitle('Open a support ticket')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('What do you need help with?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
}

export function supportTicketMessage(ticket) {
  const embed = new EmbedBuilder()
    .setTitle(`🎫 Support ticket #${ticket.id}`)
    .setColor(0xfee75c)
    .addFields({ name: 'Opened by', value: `<@${ticket.userId}>` }, { name: 'Reason', value: ticket.reason })
    .setTimestamp(new Date(ticket.createdAt));
  return { embeds: [embed], components: [row(button('support:close', 'Close ticket', ButtonStyle.Danger, '🔒'))] };
}

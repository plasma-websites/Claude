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
import { SERVICES, STATUS, SUPPORT_STATUS } from './services.js';

const BRAND = 0x5865f2;
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━';

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
const linkButton = (url, label, emoji) => new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link).setEmoji(emoji);
const timestamp = (iso, style = 'R') => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
export const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

// Ticket channel names carry the status emoji, e.g. 🔵-order-483920.
export const orderTicketName = (order) => `${STATUS[order.status].emoji}-order-${order.id}`;
export const supportTicketName = (ticket) => `${SUPPORT_STATUS[ticket.status].emoji}-support-${ticket.id}`;

// --- order flow (submit-orders channel) ---

export function ordersPanel(promos) {
  const menu = Object.entries(SERVICES)
    .map(([key, s]) => `${s.emoji} **${s.label}** — ${promos[key].map((p) => `\`${p}\``).join(' • ')}`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setTitle('🍽️  PLACE YOUR ORDER  🍽️')
    .setColor(BRAND)
    .setDescription(
      [
        '> Food or a ride, sorted. Pick a company below and our team will take it from there. 🚀',
        DIVIDER,
        '### 🏷️ Available promos',
        menu,
        DIVIDER,
        '### 📋 How it works',
        '**1️⃣** Choose the company from the menu below',
        '**2️⃣** Pick your promo 🏷️',
        '**3️⃣** Answer **VC?** with yes or no 🎙️',
        '**4️⃣** Fill in your address 📍',
        '**5️⃣** Send your **order screenshot** in DMs 📸',
        '**6️⃣** A staff member accepts it and opens your private ticket 🎫',
        DIVIDER,
        '⚠️ **Make sure your DMs are open** or the bot can\'t ask for your screenshot.',
        '📦 Check your orders any time with `/myorders`.',
      ].join('\n'),
    )
    .setFooter({ text: '🔒 Your details are only shared with staff in your private ticket' });
  const select = new StringSelectMenuBuilder()
    .setCustomId('order:service')
    .setPlaceholder('🛒 Choose a company to start your order…')
    .addOptions(
      Object.entries(SERVICES).map(([value, s]) => ({
        label: s.label,
        value,
        emoji: s.emoji,
        description: `Promos: ${promos[value].join(', ')}`.slice(0, 100),
      })),
    );
  return { embeds: [embed], components: [row(select)] };
}

export function promoPicker(serviceKey, promos) {
  const service = SERVICES[serviceKey];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`order:promo:${serviceKey}`)
    .setPlaceholder('🏷️ Select your promo…')
    .addOptions(promos.map((label, i) => ({ label, value: String(i), emoji: '🏷️' })));
  return { content: `${service.emoji} **${service.label}** selected!\n\n**Step 2/5** — 🏷️ Which promo do you want?`, components: [row(menu)] };
}

export function vcPicker(serviceKey, promoValue) {
  const base = `order:vc:${serviceKey}:${promoValue}`;
  return {
    content: '**Step 3/5** — 🎙️ **VC?**',
    components: [row(button(`${base}:yes`, 'Yes', ButtonStyle.Success, '✅'), button(`${base}:no`, 'No', ButtonStyle.Danger, '✖️'))],
  };
}

// Address form, shown after the VC question. Earlier answers ride along in the ID.
export function detailsModal(serviceKey, promoValue, vc) {
  const service = SERVICES[serviceKey];
  const modal = new ModalBuilder().setCustomId(`order:details:${serviceKey}:${promoValue}:${vc}`).setTitle(`${service.emoji} ${service.label} — your address`);
  for (const f of service.fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(f.required)
      .setMaxLength(f.max);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    modal.addComponents(row(input));
  }
  return modal;
}

export function orderEmbed(order) {
  const service = SERVICES[order.service];
  const status = STATUS[order.status];
  const embed = new EmbedBuilder()
    .setTitle(`${service.emoji} ${service.label} • Order #${order.id}`)
    .setColor(service.color)
    .setDescription(`${status.emoji} **${status.label}**`)
    .addFields(
      { name: '👤 Customer', value: `<@${order.customerId}>`, inline: true },
      { name: '🏢 Company', value: service.label, inline: true },
      { name: '🏷️ Promo', value: order.promo ?? 'None', inline: true },
      { name: '🎙️ VC', value: order.vc ? '✅ Yes' : '✖️ No', inline: true },
      { name: '🕒 Placed', value: timestamp(order.createdAt), inline: true },
    )
    .setFooter({ text: `Order #${order.id}${order.screenshot ? ' • 📸 screenshot attached' : ''}` })
    .setTimestamp(new Date(order.createdAt));
  if (order.ordererId) embed.addFields({ name: '🧑‍🍳 Staff', value: `<@${order.ordererId}>`, inline: true });
  for (const f of service.fields) {
    const value = order.details?.[f.id]?.trim();
    if (value) embed.addFields({ name: `${f.id === 'notes' ? '📝' : '📍'} ${f.label.replace(' (optional)', '')}`, value });
  }
  if (order.closeAt) embed.addFields({ name: '⏳ Ticket auto-closes', value: timestamp(order.closeAt) });
  return embed;
}

// Buttons under the order in the staff channel.
export function staffButtons(order, guildId) {
  if (order.status === 'pending') {
    return [
      row(
        button(`order:accept:${order.id}`, 'Accept order', ButtonStyle.Success, '✅'),
        button(`order:decline:${order.id}`, 'Decline', ButtonStyle.Danger, '✖️'),
      ),
    ];
  }
  if (order.ticketChannelId && ['accepted', 'completed', 'closed'].includes(order.status)) {
    return [row(linkButton(channelUrl(guildId, order.ticketChannelId), 'Open ticket', '🎫'))];
  }
  return [];
}

// Buttons on the panel inside the order ticket.
export function ticketButtons(order) {
  const del = button(`order:delete:${order.id}`, 'Delete ticket', ButtonStyle.Secondary, '🗑️');
  if (order.status === 'accepted') {
    return [
      row(
        button(`order:complete:${order.id}`, 'Complete order', ButtonStyle.Success, '✅'),
        button(`order:close:${order.id}`, 'Close ticket', ButtonStyle.Danger, '🔒'),
        del,
      ),
    ];
  }
  if (order.status === 'completed') return [row(button(`order:close:${order.id}`, 'Close now', ButtonStyle.Danger, '🔒'), del)];
  if (order.status === 'closed') return [row(del)];
  return [];
}

export function ticketWelcome(order) {
  const service = SERVICES[order.service];
  return [
    `👋 Hey <@${order.customerId}>, welcome to your ticket!`,
    `🧑‍🍳 <@${order.ordererId}> has accepted your **${service.emoji} ${service.label}** order **#${order.id}** and will look after you here.`,
    '💬 Feel free to ask any questions in this channel.',
  ].join('\n');
}

// --- support tickets ---

export function supportPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🆘  SUPPORT  🆘')
    .setColor(0xfee75c)
    .setDescription(
      [
        '> Got a problem or a question? Our team is here to help! 💛',
        DIVIDER,
        '### 💡 Open a ticket for',
        '❓ Questions about an order',
        '⚠️ Problems with a delivery or ride',
        '💳 Anything else you need a hand with',
        DIVIDER,
        '🎫 Click the button below, tell us what\'s up, and a private channel will open with our support team.',
        '⏱️ Please be patient — we\'ll get back to you as soon as possible.',
      ].join('\n'),
    )
    .setFooter({ text: '🙏 Please don\'t open more than one ticket for the same issue' });
  return { embeds: [embed], components: [row(button('support:open', 'Open support ticket', ButtonStyle.Primary, '🎫'))] };
}

export function supportModal() {
  return new ModalBuilder()
    .setCustomId('support:modal')
    .setTitle('🎫 Open a support ticket')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('What do you need help with?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder('Include your order number if it\'s about an order'),
      ),
    );
}

export function supportButtons(ticket) {
  const del = button('support:delete', 'Delete ticket', ButtonStyle.Secondary, '🗑️');
  if (ticket.status === 'open') return [row(button('support:close', 'Close ticket', ButtonStyle.Danger, '🔒'), del)];
  return [row(del)];
}

export function supportEmbed(ticket) {
  const status = SUPPORT_STATUS[ticket.status];
  return new EmbedBuilder()
    .setTitle(`🎫 Support ticket #${ticket.id}`)
    .setColor(0xfee75c)
    .setDescription(`${status.emoji} **${status.label}**\n\n👋 Thanks for reaching out! Our team will be with you shortly.`)
    .addFields(
      { name: '👤 Opened by', value: `<@${ticket.userId}>`, inline: true },
      { name: '🕒 Opened', value: timestamp(ticket.createdAt), inline: true },
      { name: '📝 Reason', value: ticket.reason },
    )
    .setTimestamp(new Date(ticket.createdAt));
}

// --- verification (RestoreCord / VaultCord) ---

export function verifyPanel(url) {
  const embed = new EmbedBuilder()
    .setTitle('✅  VERIFY TO GET ACCESS  ✅')
    .setColor(0x57f287)
    .setDescription(
      [
        '> Welcome! 👋 Verify below to unlock the rest of the server.',
        DIVIDER,
        '**1️⃣** Click **Verify** below 👇',
        '**2️⃣** Log in with Discord and click **Authorize** 🔐',
        '**3️⃣** You\'ll get your role and see all channels instantly 🎉',
        DIVIDER,
        '🛡️ Verifying keeps you in the community even if the server ever has to move.',
      ].join('\n'),
    );
  return { embeds: [embed], components: [row(linkButton(url, 'Verify', '✅'))] };
}

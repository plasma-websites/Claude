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
import { PAYMENT_METHODS, SERVICES, STATUS, SUPPORT_STATUS, feeSummary, money, orderFee } from './services.js';

const BRAND = 0x5865f2;
const COLORS_SUCCESS = 0x57f287;
const DIVIDER = '━━━━━━━━━━━━━━━━━━━━━━━━';

const row = (...components) => new ActionRowBuilder().addComponents(...components);
const button = (id, label, style, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
const linkButton = (url, label, emoji) => new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link).setEmoji(emoji);
const timestamp = (iso, style = 'R') => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;
export const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

// Ticket channel names carry the status emoji, number and customer's username,
// e.g. 🔵-order-483920-plasma. Discord only allows a-z, 0-9, - and _ here.
const slug = (name) => (name ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const withName = (base, name) => (slug(name) ? `${base}-${slug(name)}` : base);
export const orderTicketName = (order) => withName(`${STATUS[order.status].emoji}-order-${order.id}`, order.customerName);
export const supportTicketName = (ticket) => withName(`${SUPPORT_STATUS[ticket.status].emoji}-support-${ticket.id}`, ticket.userName);

// `5 off` • `10 off` · 💷 Fee £2.50 — or per-promo fees when they differ.
function promoLine(list) {
  const sameFee = list.every((p) => p.fee === list[0].fee);
  if (sameFee) return `${list.map((p) => `\`${p.name}\``).join(' • ')} · 💷 Fee **${money(list[0].fee)}**`;
  return list.map((p) => `\`${p.name}\` (💷 **${money(p.fee)}**)`).join(' • ');
}

// --- order flow (submit-orders channel) ---

const onlineLine = (ids = []) =>
  ids.length ? `└ 🟢 **Online:** ${ids.map((id) => `<@${id}>`).join(', ')}` : '└ 🔴 *No orderers online right now*';

// `online` is { serviceKey: [userId, …] } from the staff panel.
export function ordersPanel(promos, online = {}) {
  const menu = Object.entries(SERVICES)
    .map(([key, s]) =>
      [
        `${s.emoji} **${s.label}** — ${promoLine(promos[key])}`,
        onlineLine(online[key]),
      ].join('\n'),
    )
    .join('\n\n');
  const embed = new EmbedBuilder()
    .setTitle('🍽️  PLACE YOUR ORDER  🍽️')
    .setColor(BRAND)
    .setDescription(
      [
        '> Food or a ride, sorted. Pick a company below and our team will take it from there. 🚀',
        DIVIDER,
        '### 🏷️ Promos, fees & who\'s online',
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
    .setFooter({ text: '🔒 Your details are only shared with staff in your private ticket • 🟢 Online list updates live' })
    .setTimestamp();
  const select = new StringSelectMenuBuilder()
    .setCustomId('order:service')
    .setPlaceholder('🛒 Choose a company to start your order…')
    .addOptions(
      Object.entries(SERVICES).map(([value, s]) => ({
        label: s.label,
        value,
        emoji: s.emoji,
        description: `Fee ${feeSummary(promos[value])} · ${online[value]?.length ? `🟢 ${online[value].length} online` : '🔴 nobody online'} · ${promos[value].map((p) => p.name).join(', ')}`.slice(0, 100),
      })),
    );
  return { embeds: [embed], components: [row(select)] };
}

export function promoPicker(serviceKey, promos, onlineIds = []) {
  const service = SERVICES[serviceKey];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`order:promo:${serviceKey}`)
    .setPlaceholder('🏷️ Select your promo…')
    .addOptions(promos.map((p, i) => ({ label: p.name, value: String(i), emoji: '🏷️', description: `Service fee ${money(p.fee)}` })));
  const embed = new EmbedBuilder()
    .setColor(service.color)
    .setTitle(`${service.emoji} ${service.label} selected!`)
    .setDescription(
      [
        `💷 Service fee: **${feeSummary(promos)}**`,
        onlineIds.length
          ? `🟢 Online now: ${onlineIds.map((id) => `<@${id}>`).join(', ')}`
          : '🔴 **Nobody is online for this service right now** — you can still order and it\'ll be picked up as soon as someone is.',
        DIVIDER,
        '**Step 2/5** — 🏷️ Which promo do you want?',
      ].join('\n'),
    );
  return { embeds: [embed], components: [row(menu)] };
}

export function vcPicker(serviceKey, promoValue) {
  const base = `order:vc:${serviceKey}:${promoValue}`;
  return {
    embeds: [new EmbedBuilder().setColor(BRAND).setDescription('**Step 3/5** — 🎙️ **VC?**')],
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
      { name: '💷 Service fee', value: money(orderFee(order)), inline: true },
      { name: '🕒 Placed', value: timestamp(order.createdAt), inline: true },
    )
    .setFooter({ text: `Order #${order.id}${order.screenshot ? ' • 📸 screenshot attached' : ''}` })
    .setTimestamp(new Date(order.createdAt));
  if (order.ordererId) embed.addFields({ name: '🧑‍🍳 Staff', value: `<@${order.ordererId}>`, inline: true });
  if (order.forfeitedBy?.length) {
    embed.addFields({ name: '🔁 Forfeited by', value: order.forfeitedBy.filter(Boolean).map((id) => `<@${id}>`).join(', ') || '—', inline: true });
  }
  for (const f of service.fields) {
    const value = order.details?.[f.id]?.trim();
    if (value) embed.addFields({ name: `${f.id === 'notes' ? '📝' : '📍'} ${f.label.replace(' (optional)', '')}`, value });
  }
  if (order.closeAt) embed.addFields({ name: '⏳ Ticket auto-deletes', value: timestamp(order.closeAt) });
  return embed;
}

// Buttons under the order in the staff channel.
export function staffButtons(order, guildId) {
  if (order.status === 'pending') {
    return [
      row(
        button(`order:accept:${order.id}`, 'Accept order', ButtonStyle.Success, '✅'),
        button(`order:ask:${order.id}`, 'Ask question', ButtonStyle.Secondary, '❓'),
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
        button(`order:forfeit:${order.id}`, 'Forfeit', ButtonStyle.Secondary, '🔁'),
        button(`order:close:${order.id}`, 'Close ticket', ButtonStyle.Danger, '🔒'),
        del,
      ),
    ];
  }
  if (order.status === 'pending') return [row(del)]; // forfeited, waiting for a new orderer
  if (order.status === 'completed') return [row(button(`order:close:${order.id}`, 'Close now', ButtonStyle.Danger, '🔒'), del)];
  if (order.status === 'closed') return [row(del)];
  return [];
}

export function ticketWelcome(order) {
  const service = SERVICES[order.service];
  return new EmbedBuilder()
    .setColor(service.color)
    .setTitle('👋 Welcome to your ticket!')
    .setDescription(
      [
        `🧑‍🍳 <@${order.ordererId}> has accepted your **${service.emoji} ${service.label}** order **#${order.id}** and will look after you here.`,
        `💷 Service fee: **${money(orderFee(order))}**`,
        '💬 Feel free to ask any questions in this channel.',
      ].join('\n'),
    );
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

// --- completed orders feed ---

export function completedEmbed(order) {
  const service = SERVICES[order.service];
  return new EmbedBuilder()
    .setTitle('✅  ORDER COMPLETED  ✅')
    .setColor(0x57f287)
    .setDescription(
      [
        '🎉 **Another order completed successfully!**',
        DIVIDER,
        `${service.emoji} **Service:** ${service.label}`,
        `👤 **For:** <@${order.customerId}>`,
        `🧑‍🍳 **By:** <@${order.ordererId}>`,
        order.promo ? `🏷️ **Promo:** ${order.promo}` : null,
        DIVIDER,
        '🛒 Want yours? Head to the order channel and place an order! 🚀',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: `Order #${order.id}` })
    .setTimestamp();
}

// --- vouches ---

const stars = (n) => '⭐'.repeat(n) + '☆'.repeat(5 - n);

export function vouchSticky() {
  const embed = new EmbedBuilder()
    .setTitle('⭐  LEAVE A VOUCH  ⭐')
    .setColor(0xfee75c)
    .setDescription(
      [
        '> Had a great order? Let everyone know! 💛 Every vouch here is from a **real, completed order**.',
        DIVIDER,
        '### ✅ What makes a good vouch',
        '🍔 Say **what you ordered** and which service',
        '⚡ Mention the **speed** and how smooth it was',
        '🧑‍🍳 Shout out the **staff member** who helped you',
        '📝 Be **honest** and keep it clean',
        DIVIDER,
        '### 🛡️ Vouch rules',
        '🔐 Only customers with a **completed order** can vouch',
        '1️⃣ **One vouch per order**',
        '🚫 Normal messages here are removed automatically',
        DIVIDER,
        '👇 Click **Leave a vouch** to get started!',
      ].join('\n'),
    );
  return { embeds: [embed], components: [row(button('vouch:start', 'Leave a vouch', ButtonStyle.Success, '⭐'))] };
}

export function starPicker(orderId) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`vouch:stars:${orderId}`)
    .setPlaceholder('⭐ How many stars?')
    .addOptions([5, 4, 3, 2, 1].map((n) => ({ label: `${n} star${n > 1 ? 's' : ''}`, value: String(n), emoji: '⭐', description: stars(n) })));
  return menu;
}

export function vouchModal(orderId, starCount) {
  return new ModalBuilder()
    .setCustomId(`vouch:submit:${orderId}:${starCount}`)
    .setTitle(`⭐ Vouch for order #${orderId}`)
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Your vouch')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(10)
          .setMaxLength(800)
          .setPlaceholder('What did you order, how fast was it, who helped you?'),
      ),
    );
}

export function vouchEmbed(vouch, order) {
  const service = SERVICES[order.service];
  return new EmbedBuilder()
    .setTitle(`${stars(vouch.stars)}  Vouch #${vouch.number}`)
    .setColor(0xfee75c)
    .setDescription(`> ${vouch.message.replace(/\n/g, '\n> ')}`)
    .addFields(
      { name: '👤 Customer', value: `<@${vouch.userId}>`, inline: true },
      { name: `${service.emoji} Service`, value: service.label, inline: true },
      { name: '🧑‍🍳 Staff', value: order.ordererId ? `<@${order.ordererId}>` : '—', inline: true },
    )
    .setFooter({ text: `✅ Verified purchase • Order #${order.id}` })
    .setTimestamp(new Date(vouch.createdAt));
}

// --- announcements & ToS ---

export function announceModal(channelId, ping) {
  return new ModalBuilder()
    .setCustomId(`announce:${channelId}:${ping}`)
    .setTitle('📢 New announcement')
    .addComponents(
      row(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
      row(new TextInputBuilder().setCustomId('message').setLabel('Message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000)),
      row(
        new TextInputBuilder()
          .setCustomId('image')
          .setLabel('Image URL (optional)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('https://…'),
      ),
    );
}

export function announcementEmbed({ title, message, image, author }) {
  const embed = new EmbedBuilder()
    .setTitle(`📢  ${title}`)
    .setColor(BRAND)
    .setDescription(message)
    .setFooter({ text: `Posted by ${author}` })
    .setTimestamp();
  if (image) embed.setImage(image);
  return embed;
}

export function tosPanel(tos) {
  const embed = new EmbedBuilder()
    .setTitle(tos.title)
    .setColor(0xed4245)
    .setDescription(`> Please read these carefully before placing an order. ⚠️\n${DIVIDER}`)
    .addFields(tos.sections)
    .setFooter({ text: `🙏 ${tos.footer}` })
    .setTimestamp();
  return { embeds: [embed] };
}

// --- why Food Hub ---

export function whyPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🍔  WHY FOOD HUB?  🍔')
    .setColor(0xf1c40f)
    .setDescription(
      [
        '> Thinking about ordering with us? Here\'s what we\'re about. 💛',
        DIVIDER,
        '🍔 **Why Food Hub?** — what you can expect from us',
        '🆚 **Why Food Hub over Foodplug?** — what makes us different',
        DIVIDER,
        '👇 Tap a button below to read more!',
      ].join('\n'),
    );
  return {
    embeds: [embed],
    components: [
      row(
        button('why:hub', 'Why Food Hub?', ButtonStyle.Primary, '🍔'),
        button('why:foodplug', 'Why Food Hub over Foodplug?', ButtonStyle.Secondary, '🆚'),
      ),
    ],
  };
}

export function whyFoodHubEmbed(why) {
  return new EmbedBuilder()
    .setTitle(why.title)
    .setColor(0xf1c40f)
    .setDescription([`> ${why.intro}`, DIVIDER, why.points.join('\n\n'), DIVIDER, why.tagline, '', why.outro].join('\n'));
}

export function whyOverFoodplugEmbed(why) {
  return new EmbedBuilder().setTitle(why.title).setColor(0xf1c40f).setDescription(why.paragraphs.join('\n\n'));
}

// --- staff panel (availability & payment details) ---

export function staffPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🧑‍🍳  ORDERER CONTROL PANEL  🧑‍🍳')
    .setColor(0x2ecc71)
    .setDescription(
      [
        '> Everything you need as an orderer, in one place. 💪',
        DIVIDER,
        '### 🟢 Going online',
        'Pick the services you\'re taking orders for from the menu below. Customers see who\'s online on the order panel, and new orders for those services ping you.',
        '🔴 Hit **Go offline** when you\'re done.',
        DIVIDER,
        '### 💳 Getting paid',
        'Save your **PayPal**, **Revolut**, **Starling** and **LTC** details with **Payment details**. Then in a ticket use:',
        '`/paypal amount:` • `/rev amount:` • `/starling amount:` • `/crypto amount:`',
        'The customer gets a payment panel with an **I\'ve paid** button, and you confirm when it lands. ✅',
        DIVIDER,
        '### 🔁 Can\'t finish an order?',
        'Press **Forfeit** in the ticket. It goes back to the queue and staff are pinged to pick it up.',
      ].join('\n'),
    );
  const select = new StringSelectMenuBuilder()
    .setCustomId('staff:online')
    .setPlaceholder('🟢 Select the services you\'re online for…')
    .setMinValues(1)
    .setMaxValues(Object.keys(SERVICES).length)
    .addOptions(Object.entries(SERVICES).map(([value, s]) => ({ label: s.label, value, emoji: s.emoji })));
  return {
    embeds: [embed],
    components: [
      row(select),
      row(
        button('staff:offline', 'Go offline', ButtonStyle.Danger, '🔴'),
        button('staff:payments', 'Payment details', ButtonStyle.Primary, '💳'),
        button('staff:me', 'My status', ButtonStyle.Secondary, '👀'),
      ),
    ],
  };
}

export function paymentDetailsModal(current = {}) {
  const modal = new ModalBuilder().setCustomId('staff:paymentsave').setTitle('💳 Your payment details');
  for (const [key, m] of Object.entries(PAYMENT_METHODS)) {
    const input = new TextInputBuilder()
      .setCustomId(key)
      .setLabel(`${m.label} ${m.kind === 'link' ? 'link' : 'address'} (optional)`)
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(200)
      .setPlaceholder(m.example);
    if (current[key]) input.setValue(current[key]);
    modal.addComponents(row(input));
  }
  return modal;
}

export function staffStatusEmbed(staff) {
  const online = staff.online?.length
    ? staff.online.map((k) => `${SERVICES[k].emoji} ${SERVICES[k].label}`).join(', ')
    : '🔴 Offline';
  const details = Object.entries(PAYMENT_METHODS)
    .map(([key, m]) => `${m.emoji} **${m.label}:** ${staff.payments?.[key] ? `\`${staff.payments[key]}\`` : '*not set*'}`)
    .join('\n');
  return new EmbedBuilder()
    .setTitle('👀 Your orderer status')
    .setColor(0x2ecc71)
    .addFields({ name: '🟢 Online for', value: online }, { name: '💳 Payment details', value: details });
}

// --- payment requests ---

const PAYMENT_STATUS = {
  due: { label: 'Payment due', emoji: '🟡', color: 0xfee75c },
  marked_paid: { label: 'Customer says paid — waiting for confirmation', emoji: '🔵', color: 0x5865f2 },
  confirmed: { label: 'Payment confirmed', emoji: '🟢', color: 0x57f287 },
};

export function paymentEmbed(payment, destination) {
  const m = PAYMENT_METHODS[payment.method];
  const status = PAYMENT_STATUS[payment.status];
  const who = payment.customerId ? `<@${payment.customerId}> your` : 'Your';
  const where =
    m.kind === 'address'
      ? `Send **${money(payment.amount)}** worth of **${m.label}** to this address:\n\`\`\`${destination}\`\`\``
      : `Please pay **${money(payment.amount)}** via **${m.label}** here:\n👉 ${destination}`;
  const lines = [
    `💷 ${who} payment is now due.`,
    '',
    where,
    DIVIDER,
    `${status.emoji} **${status.label}**`,
  ];
  if (payment.status === 'due') lines.push('✅ Once you\'ve paid, click **I\'ve paid** below.');
  return new EmbedBuilder()
    .setTitle(`${m.emoji}  PAYMENT DUE — ${money(payment.amount)}  ${m.emoji}`)
    .setColor(status.color)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: '🧑‍🍳 Pay to', value: `<@${payment.ordererId}>`, inline: true },
      { name: '💳 Method', value: m.label, inline: true },
      ...(payment.orderId ? [{ name: '🧾 Order', value: `#${payment.orderId}`, inline: true }] : []),
    )
    .setFooter({ text: `Payment ID ${payment.id}` })
    .setTimestamp(new Date(payment.createdAt));
}

export function paymentButtons(payment, destination) {
  const m = PAYMENT_METHODS[payment.method];
  const open = m.kind === 'link' && destination ? [linkButton(destination, `Open ${m.label}`, m.emoji)] : [];
  if (payment.status === 'due') return [row(button(`pay:paid:${payment.id}`, 'I\'ve paid', ButtonStyle.Success, '✅'), ...open)];
  if (payment.status === 'marked_paid') {
    return [
      row(
        button(`pay:confirm:${payment.id}`, 'Confirm received', ButtonStyle.Success, '💰'),
        button(`pay:notreceived:${payment.id}`, 'Not received', ButtonStyle.Danger, '❌'),
      ),
    ];
  }
  return [];
}

// --- Food Hub AI (support tickets) ---

export function aiButtons() {
  return [
    row(
      button('ai:ask', 'Ask a follow-up', ButtonStyle.Primary, '💬'),
      button('ai:human', 'Talk to a human', ButtonStyle.Secondary, '🙋'),
    ),
  ];
}

export function aiQuestionModal() {
  return new ModalBuilder()
    .setCustomId('ai:question')
    .setTitle('💬 Ask Food Hub support')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('question')
          .setLabel('Your question')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000),
      ),
    );
}

// --- orderer questions (staff channel -> customer DMs) ---

export function askQuestionModal(orderId) {
  return new ModalBuilder()
    .setCustomId(`order:askq:${orderId}`)
    .setTitle(`❓ Question for order #${orderId}`)
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('question')
          .setLabel('What do you want to ask the customer?')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500),
      ),
    );
}

export function questionDm(order, q) {
  const service = SERVICES[order.service];
  const embed = new EmbedBuilder()
    .setTitle(`❓ Question about your ${service.label} order #${order.id}`)
    .setColor(service.color)
    .setDescription(
      [
        `🧑‍🍳 <@${q.askerId}> asked:`,
        `> ${q.question.replace(/\n/g, '\n> ')}`,
        DIVIDER,
        '✍️ Press **Answer** below, or just **type your answer here** in DMs.',
      ].join('\n'),
    )
    .setTimestamp(new Date(q.createdAt));
  return { embeds: [embed], components: [row(button(`q:answer:${q.id}`, 'Answer', ButtonStyle.Primary, '✍️'))] };
}

export function answerModal(q) {
  return new ModalBuilder()
    .setCustomId(`q:submit:${q.id}`)
    .setTitle('✍️ Your answer')
    .addComponents(
      row(new TextInputBuilder().setCustomId('answer').setLabel('Answer').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
    );
}

export function answerEmbed(order, q) {
  const service = SERVICES[order.service];
  return new EmbedBuilder()
    .setTitle(`💬 Customer answered — ${service.label} order #${order.id}`)
    .setColor(COLORS_SUCCESS)
    .addFields(
      { name: '❓ Question', value: q.question.slice(0, 1024) },
      { name: '✍️ Answer', value: q.answer.slice(0, 1024) },
      { name: '👤 Customer', value: `<@${q.customerId}>`, inline: true },
      { name: '🧑‍🍳 Asked by', value: `<@${q.askerId}>`, inline: true },
    )
    .setTimestamp(new Date(q.answeredAt));
}

// --- transcripts ---

export function transcriptPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('📜 Ticket transcripts')
        .setColor(BRAND)
        .setDescription(
          [
            'Every order and support ticket is saved before it\'s deleted.',
            '',
            '🔎 Press **Search by user ID** and paste a member\'s ID to get a transcript of every order they\'ve made (and their support tickets).',
            '',
            '*Staff only.*',
          ].join('\n'),
        ),
    ],
    components: [row(button('transcript:open', 'Search by user ID', ButtonStyle.Primary, '🔎'))],
  };
}

export function transcriptSearchModal() {
  return new ModalBuilder()
    .setCustomId('transcript:search')
    .setTitle('🔎 Search transcripts')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('user')
          .setLabel('User ID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
          .setPlaceholder('e.g. 123456789012345678'),
      ),
    );
}

// --- giveaways ---

export function giveawayModal(channelId) {
  return new ModalBuilder()
    .setCustomId(`giveaway:create:${channelId}`)
    .setTitle('🎉 New giveaway')
    .addComponents(
      row(new TextInputBuilder().setCustomId('title').setLabel('Giveaway title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
      row(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
          .setPlaceholder('e.g. 30m, 2h, 1d, 1w (max 28d)'),
      ),
      row(
        new TextInputBuilder()
          .setCustomId('winners')
          .setLabel('Number of winners')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(2)
          .setPlaceholder('1'),
      ),
      row(new TextInputBuilder().setCustomId('info').setLabel('Info about the giveaway').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(3000)),
    );
}

export function giveawayEmbed(g) {
  const ended = g.status !== 'running';
  const lines = [
    g.info || null,
    g.info ? '' : null,
    ended ? `⏰ **Ended** ${timestamp(g.endsAt)}` : `⏰ **Ends** ${timestamp(g.endsAt)} (${timestamp(g.endsAt, 'f')})`,
    `🏆 **Winners:** ${ended ? (g.winnerIds.length ? g.winnerIds.map((id) => `<@${id}>`).join(', ') : 'No valid entries 😢') : g.winners}`,
    `🎟️ **Entries:** ${g.entrants.length}`,
    `🎁 **Hosted by** <@${g.hostId}>`,
    ended ? null : '',
    ended ? null : 'Press **🎉 Enter** to join! Press it again to leave.',
  ].filter((l) => l !== null);
  return new EmbedBuilder()
    .setTitle(`🎉 ${g.title}`)
    .setColor(ended ? 0x99aab5 : 0xf1c40f)
    .setDescription(lines.join('\n'))
    .setFooter({ text: ended ? `Giveaway #${g.id} • ended` : `Giveaway #${g.id} • ${g.winners} winner${g.winners === 1 ? '' : 's'}` })
    .setTimestamp(new Date(g.endsAt));
}

export function giveawayButtons(g) {
  if (g.status === 'running') return [row(button(`giveaway:enter:${g.id}`, 'Enter', ButtonStyle.Success, '🎉'))];
  return [row(button(`giveaway:enter:${g.id}`, 'Ended', ButtonStyle.Secondary, '🎉').setDisabled(true), button(`giveaway:reroll:${g.id}`, 'Reroll', ButtonStyle.Secondary, '🔁'))];
}

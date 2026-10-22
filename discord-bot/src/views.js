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
import { formatSlot } from './schedule.js';
import { THEME } from './util.js';

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
    .setColor(THEME)
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
    .setColor(THEME)
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
    embeds: [new EmbedBuilder().setColor(THEME).setDescription('**Step 3/5** — 🎙️ **VC?**')],
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
  modal.addComponents(
    row(
      new TextInputBuilder()
        .setCustomId('code')
        .setLabel('Discount / referral code (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(20)
        .setPlaceholder('e.g. FH-ABC123'),
    ),
  );
  return modal;
}

export function orderEmbed(order) {
  const service = SERVICES[order.service];
  const status = STATUS[order.status];
  const embed = new EmbedBuilder()
    .setTitle(`${service.emoji} ${service.label} • Order #${order.id}`)
    .setColor(THEME)
    .setDescription(`${status.emoji} **${status.label}**`)
    .addFields(
      { name: '👤 Customer', value: `<@${order.customerId}>`, inline: true },
      { name: '🏢 Company', value: service.label, inline: true },
      { name: '🏷️ Promo', value: order.promo ?? 'None', inline: true },
      { name: '🎙️ VC', value: order.vc ? '✅ Yes' : '✖️ No', inline: true },
      {
        name: '💷 Service fee',
        value: order.code ? `~~${money(order.originalFee)}~~ **${money(orderFee(order))}**\n🎟️ \`${order.code}\`` : money(orderFee(order)),
        inline: true,
      },
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
  const id = order.id;
  const del = button(`order:delete:${id}`, 'Delete ticket', ButtonStyle.Secondary, '🗑️');
  const cancel = button(`order:cancel:${id}`, 'Cancel order', ButtonStyle.Danger, '❌');
  if (order.status === 'accepted') {
    return [
      row(
        button(`order:complete:${id}`, 'Complete order', ButtonStyle.Success, '✅'),
        button(`order:forfeit:${id}`, 'Forfeit', ButtonStyle.Secondary, '🔁'),
        cancel,
      ),
      row(button(`order:close:${id}`, 'Close ticket', ButtonStyle.Secondary, '🔒'), del),
    ];
  }
  if (order.status === 'pending') return [row(cancel, del)]; // forfeited, waiting for a new orderer
  if (order.status === 'completed') {
    const keep = order.closeAt ? [button(`order:keepopen:${id}`, 'Keep ticket open', ButtonStyle.Primary, '📌')] : [];
    return [row(...keep, button(`order:close:${id}`, 'Close now', ButtonStyle.Secondary, '🔒'), del)];
  }
  if (order.status === 'closed') return [row(del)];
  return [];
}

export function cancelOrderModal(orderId) {
  return new ModalBuilder()
    .setCustomId(`order:cancelsubmit:${orderId}`)
    .setTitle(`❌ Cancel order #${orderId}`)
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason (sent to the customer, optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );
}

// "Press the 🍕" check before accepting an order, so it can't be done by a script.
export function captchaView({ orderId, token, choices, answer, note = '' }) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(THEME)
        .setTitle('🧩 Quick check')
        .setDescription(`${note}To accept order **#${orderId}**, press the **${answer}** below.`),
    ],
    components: [row(...choices.map((emoji, i) => new ButtonBuilder().setCustomId(`order:captcha:${token}:${i}`).setStyle(ButtonStyle.Secondary).setEmoji(emoji)))],
  };
}

export function ticketWelcome(order) {
  const service = SERVICES[order.service];
  return new EmbedBuilder()
    .setColor(THEME)
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
    .setColor(THEME)
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

// Closing deletes the ticket (after saving a transcript), so one button is enough.
export function supportButtons(ticket) {
  if (ticket.status === 'open') return [row(button('support:close', 'Close ticket', ButtonStyle.Danger, '✅'))];
  return [];
}

export function supportEmbed(ticket) {
  const status = SUPPORT_STATUS[ticket.status];
  return new EmbedBuilder()
    .setTitle(`🎫 Support ticket #${ticket.id}`)
    .setColor(THEME)
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
    .setColor(THEME)
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
    .setColor(THEME)
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
    .setColor(THEME)
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
    .setColor(THEME)
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
    .setColor(THEME)
    .setDescription(message)
    .setFooter({ text: `Posted by ${author}` })
    .setTimestamp();
  if (image) embed.setImage(image);
  return embed;
}

export function tosPanel(tos) {
  const embed = new EmbedBuilder()
    .setTitle(tos.title)
    .setColor(THEME)
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
    .setColor(THEME)
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
    .setColor(THEME)
    .setDescription([`> ${why.intro}`, DIVIDER, why.points.join('\n\n'), DIVIDER, why.tagline, '', why.outro].join('\n'));
}

export function whyOverFoodplugEmbed(why) {
  return new EmbedBuilder().setTitle(why.title).setColor(THEME).setDescription(why.paragraphs.join('\n\n'));
}

// --- staff panel (availability & payment details) ---

export function staffPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🧑‍🍳  ORDERER CONTROL PANEL  🧑‍🍳')
    .setColor(THEME)
    .setDescription(
      [
        '> Everything you need as an orderer, in one place. 💪',
        DIVIDER,
        '### 🟢 Going online',
        'Pick the services you\'re taking orders for, then **how long** you\'re online for. Customers see who\'s online on the order panel and new orders ping you. ⏰ You\'re set offline automatically when the time\'s up.',
        '🔴 Hit **Go offline** if you finish early.',
        DIVIDER,
        '### 🗓️ Your schedule',
        'Save the times you\'re usually online with **My schedule**. At those times I\'ll DM you to ask if you want to go online — one tap. ✅',
        DIVIDER,
        '### 💳 Getting paid',
        `Save your ${Object.values(PAYMENT_METHODS).map((m) => `**${m.label}**`).join(', ')} details with **Payment details**. Then in a ticket use:`,
        Object.values(PAYMENT_METHODS).map((m) => `\`/${m.command} amount:\``).join(' • '),
        'The customer gets a payment panel with an **I\'ve paid** button, and you confirm when it lands. ✅',
        DIVIDER,
        '### 🎫 In tickets',
        '`/complete` • `/close` • `/delete` • `/rename name:` — no scrolling up to the buttons.',
        '🔁 Can\'t finish an order? Press **Forfeit** and it goes back to the queue.',
      ].join('\n'),
    )
    .setFooter({ text: '🧑‍🍳 Food Hub staff' });
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
        button('staff:schedule', 'My schedule', ButtonStyle.Primary, '🗓️'),
        button('staff:payments', 'Payment details', ButtonStyle.Primary, '💳'),
        button('staff:me', 'My status', ButtonStyle.Secondary, '👀'),
      ),
    ],
  };
}

const ONLINE_DURATIONS = [
  [30, '30 min'],
  [60, '1 hour'],
  [120, '2 hours'],
  [240, '4 hours'],
  [480, '8 hours'],
];

export function onlineDurationPicker(services) {
  const keys = services.join(',');
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(THEME)
        .setDescription(`⏰ **How long are you online for?**\n${services.map((k) => `${SERVICES[k].emoji} ${SERVICES[k].label}`).join(', ')}\nYou'll be set offline automatically when the time's up.`),
    ],
    components: [row(...ONLINE_DURATIONS.map(([minutes, label]) => button(`staff:dur:${minutes}:${keys}`, label, ButtonStyle.Success)))],
  };
}

export function scheduleModal(current) {
  const input = new TextInputBuilder()
    .setCustomId('times')
    .setLabel('When are you usually online? (empty = clear)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder('Mon-Fri 6pm-10pm\nSat 12:00-23:30\nSun 14-20');
  if (current) input.setValue(current);
  return new ModalBuilder().setCustomId('staff:schedulesave').setTitle('🗓️ My usual online times').addComponents(row(input));
}

export function schedulePrompt(end) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(THEME)
        .setTitle('🗓️ You\'re usually online around now')
        .setDescription(`Want me to mark you as **online**? You'll stay online until <t:${Math.floor(end / 1000)}:t>, the end of your usual slot.`),
    ],
    components: [
      row(
        button(`staff:sched:yes:${end.getTime()}`, 'Yes, go online', ButtonStyle.Success, '🟢'),
        button('staff:sched:no', 'Not today', ButtonStyle.Secondary, '🔴'),
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

export function staffStatusEmbed(staff, timeZone) {
  const online = staff.online?.length
    ? `${staff.online.map((k) => `${SERVICES[k].emoji} ${SERVICES[k].label}`).join(', ')}${staff.onlineUntil ? `\n⏰ until ${timestamp(staff.onlineUntil, 't')} (${timestamp(staff.onlineUntil)})` : ''}`
    : '🔴 Offline';
  const details = Object.entries(PAYMENT_METHODS)
    .map(([key, m]) => `${m.emoji} **${m.label}:** ${staff.payments?.[key] ? `\`${staff.payments[key]}\`` : '*not set*'}`)
    .join('\n');
  const schedule = staff.schedule?.slots?.length ? `${staff.schedule.slots.map((sl) => `• ${formatSlot(sl)}`).join('\n')}\n*(${timeZone} time)*` : '*Not set — use **My schedule***';
  return new EmbedBuilder()
    .setTitle('👀 Your orderer status')
    .setColor(THEME)
    .addFields({ name: '🟢 Online for', value: online }, { name: '🗓️ Schedule', value: schedule }, { name: '💳 Payment details', value: details });
}

// --- payment requests ---

const PAYMENT_STATUS = {
  due: { label: 'Payment due', emoji: '🟡' },
  marked_paid: { label: 'Customer says paid — waiting for confirmation', emoji: '🔵' },
  confirmed: { label: 'Payment confirmed', emoji: '🟢' },
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
    .setColor(THEME)
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
    .setColor(THEME)
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
    .setColor(THEME)
    .addFields(
      { name: '❓ Question', value: q.question.slice(0, 1024) },
      { name: '✍️ Answer', value: q.answer.slice(0, 1024) },
      { name: '👤 Customer', value: `<@${q.customerId}>`, inline: true },
      { name: '🧑‍🍳 Asked by', value: `<@${q.askerId}>`, inline: true },
    )
    .setTimestamp(new Date(q.answeredAt));
}

// --- transcripts ---

export function transcriptPanel(messageContent = true) {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('📜  TICKET TRANSCRIPTS  📜')
        .setColor(THEME)
        .setDescription(
          [
            '> Every order and support ticket is saved before it\'s deleted. 🗂️',
            DIVIDER,
            '🔎 Press **Search by user ID** and paste a member\'s ID to get a transcript of every order they\'ve made (and their support tickets).',
            messageContent ? null : `${DIVIDER}\n⚠️ **Message Content Intent is off**, so members' messages aren't being saved — only the bot's panels. Turn it on in the Developer Portal → Bot, then restart.`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
        .setFooter({ text: '🔒 Staff only' }),
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
    .setColor(THEME)
    .setDescription(lines.join('\n'))
    .setFooter({ text: ended ? `Giveaway #${g.id} • ended` : `Giveaway #${g.id} • ${g.winners} winner${g.winners === 1 ? '' : 's'}` })
    .setTimestamp(new Date(g.endsAt));
}

export function giveawayButtons(g) {
  if (g.status === 'running') return [row(button(`giveaway:enter:${g.id}`, 'Enter', ButtonStyle.Success, '🎉'))];
  return [row(button(`giveaway:enter:${g.id}`, 'Ended', ButtonStyle.Secondary, '🎉').setDisabled(true), button(`giveaway:reroll:${g.id}`, 'Reroll', ButtonStyle.Secondary, '🔁'))];
}

// --- trial orderers ---

export function trialPanel(stats, roleId) {
  const entries = Object.entries(stats).sort(([, a], [, b]) => b.completed.length - a.completed.length);
  const lines = entries.map(([userId, s]) => {
    const recent = s.completed.slice(0, 8).map((o) => `\`#${o.id}\` ${timestamp(o.completedAt, 'd')}`);
    return [
      `🎓 <@${userId}> — ✅ **${s.completed.length}** completed${s.inProgress.length ? ` · 🔵 **${s.inProgress.length}** in progress` : ''}`,
      recent.length ? `└ ${recent.join(' • ')}${s.completed.length > recent.length ? ' …' : ''}` : '└ *No completed orders yet*',
    ].join('\n');
  });
  let body = '';
  for (const [i, line] of lines.entries()) {
    if (body.length + line.length > 3300) {
      body += `\n\n*…and ${lines.length - i} more*`;
      break;
    }
    body += `${body ? '\n\n' : ''}${line}`;
  }
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎓  TRIAL ORDERERS  🎓')
        .setColor(THEME)
        .setDescription(
          [
            `> Trial orderers${roleId ? ` (<@&${roleId}>)` : ''} can accept orders. When they do, the orderer role is pinged so a full orderer supervises the ticket. 👀`,
            DIVIDER,
            '### ✅ Successful orders',
            body || '*No trial orders yet.*',
          ].join('\n'),
        )
        .setFooter({ text: '🔄 Updates live as trial orderers accept and complete orders' })
        .setTimestamp(),
    ],
  };
}

// --- referrals ---

export function referralPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('🎉  FOODHUB REFERRALS — WIN-WIN!  🎉')
        .setColor(THEME)
        .setDescription(
          [
            'Refer **3 friends**, and if **2 place an order**, you score a **FREE FEE ORDER**! 🆓',
            '',
            '• **You both win:** They get a first-order discount, and you get yours upon confirmation. **No limits!**',
            '• **Important:** They *must* join with **your personal invite link** so it counts. 🚀',
            DIVIDER,
            '### 📋 How it works',
            '**1️⃣** Press **Get my invite link** and share it with friends 🔗',
            '**2️⃣** They join and press **I was invited** for **50p off** their first order 🎟️',
            '**3️⃣** Once 3 have joined and 2 have completed an order, press **Claim my reward** 🏆',
            '**4️⃣** Put your code in the order form — the fee comes off automatically ✅',
          ].join('\n'),
        )
        .setFooter({ text: '🎟️ Codes are personal and single-use • a cancelled order gives the code back' }),
    ],
    components: [
      row(
        button('ref:link', 'Get my invite link', ButtonStyle.Primary, '🔗'),
        button('ref:claim', 'Claim my reward', ButtonStyle.Success, '🏆'),
        button('ref:invited', 'I was invited', ButtonStyle.Secondary, '🎟️'),
        button('ref:codes', 'My codes', ButtonStyle.Secondary, '📋'),
      ),
    ],
  };
}

// A discount code: the bare code as the message text (easy to copy), the details in the embed.
export function codeMessage(code, headline) {
  const value = code.type === 'free' ? '🆓 **No service fee**' : `💷 **£${code.amount.toFixed(2)} off** the service fee`;
  return {
    content: code.code,
    embeds: [
      new EmbedBuilder()
        .setColor(THEME)
        .setTitle('🎟️ Your code')
        .setDescription([headline, '', `🔑 **Code:** \`${code.code}\``, value, '📝 Enter it in the **Discount / referral code** box when you order.'].join('\n')),
    ],
    components: [row(button(`ref:copy:${code.code}`, 'Copy code', ButtonStyle.Secondary, '📋'))],
  };
}

export function referralStatsEmbed(stats, { invites, orders, tracking }) {
  const bar = (n, total) => '🟩'.repeat(Math.min(n, total)) + '⬜'.repeat(Math.max(0, total - n));
  return new EmbedBuilder()
    .setColor(THEME)
    .setTitle('📊 Your referrals')
    .setDescription(
      [
        `👥 **Friends joined:** ${stats.invited.length}/${invites} ${bar(stats.invited.length, invites)}`,
        `🛒 **Completed an order:** ${stats.ordered.length}/${orders} ${bar(stats.ordered.length, orders)}`,
        stats.rewarded.length ? `🏆 **Already rewarded for:** ${stats.rewarded.length} friends` : null,
        '',
        'Not quite there yet — keep sharing your link! 🚀',
        tracking ? null : '\n⚠️ Invite tracking is currently off, so new joins aren\'t being counted. Let staff know.',
      ]
        .filter((l) => l !== null)
        .join('\n'),
    );
}

// --- bot suggestions ---

// The list, split into as many embeds as it needs (Discord caps one at 4096 characters).
export function suggestionListEmbeds(suggestions) {
  const entries = suggestions.map((sg) => `**\`#${sg.number}\`** ${sg.text}\n└ 💡 <@${sg.userId}> · ${timestamp(sg.createdAt)}`);
  const pages = [];
  let page = '';
  for (const entry of entries) {
    if (page && page.length + entry.length + 2 > 3900) {
      pages.push(page);
      page = '';
    }
    page += `${page ? '\n\n' : ''}${entry}`;
  }
  if (page || !pages.length) pages.push(page || '*No suggestions yet — be the first!* ✨');
  return pages.map((text, i) =>
    new EmbedBuilder()
      .setColor(THEME)
      .setTitle(i === 0 ? `💡  BOT SUGGESTIONS  💡${suggestions.length ? ` (${suggestions.length})` : ''}` : null)
      .setDescription(text),
  );
}

export function suggestionSticky(count) {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(THEME)
        .setTitle('💡 Got an idea for the bot?')
        .setDescription(`Press **Add suggestion** and it goes straight onto the list above. ✨\n📋 **${count}** suggestion${count === 1 ? '' : 's'} so far.`),
    ],
    components: [
      row(button('suggest:add', 'Add suggestion', ButtonStyle.Success, '➕'), button('suggest:clear', 'Clear list', ButtonStyle.Danger, '🧹')),
    ],
  };
}

export function suggestionModal() {
  return new ModalBuilder()
    .setCustomId('suggest:submit')
    .setTitle('💡 Suggest something for the bot')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('text')
          .setLabel('Your suggestion')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(800)
          .setPlaceholder('e.g. Add a /reorder command that repeats my last order'),
      ),
    );
}

export function suggestionClearConfirm(count) {
  return {
    embeds: [new EmbedBuilder().setColor(THEME).setDescription(`🧹 Clear all **${count}** suggestions? This can't be undone.`)],
    components: [row(button('suggest:clearyes', 'Yes, clear them', ButtonStyle.Danger, '🧹'))],
  };
}

// --- applications ---

export function applyPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('📝  APPLICATIONS  📝')
        .setColor(THEME)
        .setDescription(
          [
            '> Want to join the team or partner with us? Apply below! 🚀',
            DIVIDER,
            '### 🧑‍🍳 Become an orderer',
            'Answer a few quick questions in DMs: VC proof, vouches, order proof, other servers and your active times. Accepted applicants start as **trial orderers**. 🎓',
            DIVIDER,
            '### 🤝 Partner with us',
            'Tell us about your server: invite link, members and what you\'re looking for.',
            DIVIDER,
            '📬 **Make sure your DMs are open** — the questions are sent there.',
          ].join('\n'),
        )
        .setFooter({ text: '⏳ We review every application and DM you the result' }),
    ],
    components: [
      row(
        button('apply:orderer', 'Apply to be an orderer', ButtonStyle.Success, '🧑‍🍳'),
        button('apply:partner', 'Apply to be a partner', ButtonStyle.Primary, '🤝'),
      ),
    ],
  };
}

// One DM question. With `answered`, shows the question with its answer and no buttons.
export function applicationQuestion(form, index, answered = null) {
  const step = form.steps[index];
  const embed = new EmbedBuilder()
    .setColor(THEME)
    .setTitle(`${form.title} — question ${index + 1}/${form.steps.length}`)
    .setDescription(answered ? `${step.prompt}\n\n➡️ **${answered}**` : step.prompt);
  if (answered) return { embeds: [embed] };
  const buttons = [];
  if (step.kind === 'yesno') buttons.push(button('apply:yes', 'Yes', ButtonStyle.Success, '✅'), button('apply:no', 'No', ButtonStyle.Danger, '✖️'));
  if (step.kind === 'images' && step.skip) buttons.push(button('apply:skip', step.skip, ButtonStyle.Secondary, '🚫'));
  buttons.push(button('apply:cancel', 'Cancel application', ButtonStyle.Secondary, '🗑️'));
  embed.setFooter({ text: step.kind === 'yesno' ? 'Press a button' : step.kind === 'images' ? 'Send your images in one message' : 'Type your answer here' });
  return { embeds: [embed], components: [row(...buttons)] };
}

const APPLICATION_STATUS = { pending: '🟡 Waiting for review', accepted: '✅ Accepted', denied: '❌ Denied', failed: '⚠️ Failed to send' };

export function applicationEmbed(application, form) {
  const embed = new EmbedBuilder()
    .setColor(THEME)
    .setTitle(`${form.title} #${application.id}`)
    .setDescription(`👤 <@${application.userId}> (\`${application.userId}\`${application.userName ? ` · ${application.userName}` : ''})\n${APPLICATION_STATUS[application.status]}${application.reviewedBy ? ` by <@${application.reviewedBy}>` : ''}`)
    .addFields(form.steps.map((st) => ({ name: st.label, value: String(application.answers[st.id] ?? '—').slice(0, 1024) })))
    .setTimestamp(new Date(application.createdAt));
  return embed;
}

export function applicationButtons(application) {
  if (application.status !== 'pending') return [];
  return [
    row(
      button(`apply:accept:${application.id}`, application.type === 'orderer' ? 'Accept (give trial role)' : 'Accept', ButtonStyle.Success, '✅'),
      button(`apply:deny:${application.id}`, 'Deny', ButtonStyle.Danger, '❌'),
    ),
  ];
}

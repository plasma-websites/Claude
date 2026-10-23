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

// House style for every panel: one colour (THEME), a short bold intro line,
// sections as embed fields, numbered steps as `1` `2` `3`, and a quiet footer.
const BRAND = 'Food Hub';
const footer = (text) => ({ text: text ? `${BRAND}  •  ${text}` : BRAND });
const field = (name, value, inline = false) => ({ name, value, inline });
const steps = (list) => list.map((s, i) => `\`${i + 1}\`  ${s}`).join('\n');
const bullets = (list) => list.map((s) => `• ${s}`).join('\n');
const embed = () => new EmbedBuilder().setColor(THEME);

// Big panels carry the server's name and icon at the top (set once the bot is ready).
const brand = { name: BRAND, iconURL: undefined };
export function setBrand(name, iconURL) {
  Object.assign(brand, { name: name || BRAND, iconURL: iconURL || undefined });
}
const panelEmbed = () => embed().setAuthor({ name: brand.name, iconURL: brand.iconURL });

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

// The form field a saved address fills in: the delivery address, or the pickup for rides.
export const addressFieldOf = (serviceKey) => SERVICES[serviceKey].fields.find((f) => f.id === 'address' || f.id === 'pickup') ?? null;

// --- order flow (submit-orders channel) ---

const onlineText = (ids = []) => {
  if (!ids.length) return '⚪ Nobody online';
  const shown = ids.slice(0, 3).map((id) => `<@${id}>`).join(' ');
  return `🟢 ${shown}${ids.length > 3 ? ` +${ids.length - 3}` : ''}`;
};

// `online` is { serviceKey: [userId, …] } from the staff panel.
export function ordersPanel(promos, online = {}) {
  const services = Object.entries(SERVICES).map(([key, s]) =>
    field(`${s.emoji}  ${s.label}`, [promos[key].map((p) => `\`${p.name}\``).join(' '), `💷 ${feeSummary(promos[key])}`, onlineText(online[key])].join('\n'), true),
  );
  const e = panelEmbed()
    .setTitle('🍽️  Place an Order')
    .setDescription('**Food or a ride, sorted.** Pick a company from the menu below and an orderer will take it from there.')
    .addFields(
      ...services,
      field('🎁  Rewards', 'Loyalty, referral and award codes go in the order form', true),
      field(
        '📋  How it works',
        steps([
          'Choose a **company** from the menu',
          'Pick your **promo**',
          'Answer **VC?** with yes or no',
          'Enter your **address** (or pick a saved one) and any code',
          'Send your **order screenshot** in DMs',
          'An orderer accepts it and opens your **private ticket**',
        ]),
      ),
      field('⚠️  Before you start', bullets(['Keep your **DMs open** so the bot can ask for your screenshot', 'Check your orders any time with **My orders**'])),
    )
    .setFooter(footer('Your details are only shared with staff in your ticket  •  Online list updates live'))
    .setTimestamp();
  const select = new StringSelectMenuBuilder()
    .setCustomId('order:service')
    .setPlaceholder('🛒  Choose a company to start…')
    .addOptions(
      Object.entries(SERVICES).map(([value, s]) => ({
        label: s.label,
        value,
        emoji: s.emoji,
        description: `${feeSummary(promos[value])} fee · ${online[value]?.length ? `${online[value].length} online` : 'nobody online'} · ${promos[value].map((p) => p.name).join(', ')}`.slice(0, 100),
      })),
    );
  return {
    embeds: [e],
    components: [
      row(select),
      row(button('order:myorders', 'My orders', ButtonStyle.Secondary, '📦'), button('order:addresses', 'My addresses', ButtonStyle.Secondary, '📍')),
    ],
  };
}

export function promoPicker(serviceKey, promos, onlineIds = []) {
  const service = SERVICES[serviceKey];
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`order:promo:${serviceKey}`)
    .setPlaceholder('🏷️  Select your promo…')
    .addOptions(promos.map((p, i) => ({ label: p.name, value: String(i), emoji: '🏷️', description: `Service fee ${money(p.fee)}` })));
  const e = embed()
    .setTitle(`${service.emoji}  ${service.label}`)
    .setDescription('**Which promo would you like?**')
    .addFields(
      field('💷  Service fee', feeSummary(promos), true),
      field('🧑‍🍳  Online now', onlineIds.length ? onlineText(onlineIds) : 'Nobody right now. You can still order; it\'s picked up as soon as someone\'s on.', true),
    )
    .setFooter(footer('Step 2 of 5  •  Promo'));
  return { embeds: [e], components: [row(menu)] };
}

export function vcPicker(serviceKey, promoValue) {
  const base = `order:vc:${serviceKey}:${promoValue}`;
  return {
    embeds: [embed().setTitle('🎙️  VC?').setDescription('Answer **yes** or **no**.').setFooter(footer('Step 3 of 5  •  VC'))],
    components: [row(button(`${base}:yes`, 'Yes', ButtonStyle.Success, '✅'), button(`${base}:no`, 'No', ButtonStyle.Secondary, '✖️'))],
  };
}

// Shown before the form when the member has saved addresses.
export function addressPicker(serviceKey, promoValue, vc, addresses) {
  const f = addressFieldOf(serviceKey);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`order:addr:${serviceKey}:${promoValue}:${vc}`)
    .setPlaceholder(`📍  Choose your ${f.label.toLowerCase()}…`)
    .addOptions(
      ...addresses.map((a, i) => ({ label: a.split('\n')[0].slice(0, 100), value: String(i), emoji: '📍', description: a.replace(/\s+/g, ' ').slice(0, 100) })),
      { label: 'Enter a new address', value: 'new', emoji: '✏️' },
    );
  return {
    embeds: [embed().setTitle(`📍  ${f.label}`).setDescription('Use one of your **saved addresses**, or enter a new one.').setFooter(footer('Step 4 of 5  •  Address'))],
    components: [row(menu)],
  };
}

// Address form, shown after the VC question. Earlier answers ride along in the ID.
export function detailsModal(serviceKey, promoValue, vc, prefill = {}) {
  const service = SERVICES[serviceKey];
  const modal = new ModalBuilder().setCustomId(`order:details:${serviceKey}:${promoValue}:${vc}`).setTitle(`${service.emoji} ${service.label} · Order details`);
  for (const f of service.fields) {
    const input = new TextInputBuilder()
      .setCustomId(f.id)
      .setLabel(f.label)
      .setStyle(f.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(f.required)
      .setMaxLength(f.max);
    if (f.placeholder) input.setPlaceholder(f.placeholder);
    if (prefill[f.id]) input.setValue(prefill[f.id].slice(0, f.max));
    modal.addComponents(row(input));
  }
  modal.addComponents(
    row(
      new TextInputBuilder()
        .setCustomId('code')
        .setLabel('Discount / reward code (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(20)
        .setPlaceholder('e.g. FH-ABC123'),
    ),
  );
  return modal;
}

// --- saved addresses (My addresses on the order panel) ---

export function addressesView(addresses) {
  const e = embed()
    .setTitle('📍  My addresses')
    .setDescription(
      addresses.length
        ? addresses.map((a, i) => `\`${i + 1}\`  ${a.replace(/\n/g, ', ')}`).join('\n')
        : 'You haven\'t saved any addresses yet. Add one here, or press **Save address** after your next order.',
    )
    .setFooter(footer(`Up to 5 addresses  •  They're offered when you order`));
  const components = [row(button('order:addradd', 'Add address', ButtonStyle.Success, '➕'))];
  if (addresses.length) {
    components.unshift(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('order:addrdel')
          .setPlaceholder('🗑️  Remove an address…')
          .addOptions(addresses.map((a, i) => ({ label: a.split('\n')[0].slice(0, 100), value: String(i), emoji: '🗑️' }))),
      ),
    );
  }
  return { embeds: [e], components };
}

export function addressModal() {
  return new ModalBuilder()
    .setCustomId('order:addrsave')
    .setTitle('📍 Save an address')
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId('address')
          .setLabel('Address')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(300)
          .setPlaceholder('House number, street, city, postcode'),
      ),
    );
}

export function orderEmbed(order) {
  const service = SERVICES[order.service];
  const status = STATUS[order.status];
  const fee = order.code ? `~~${money(order.originalFee)}~~  **${money(orderFee(order))}**\n🎟️ \`${order.code}\`` : `**${money(orderFee(order))}**`;
  const e = embed()
    .setTitle(`${service.emoji}  ${service.label}  ·  Order #${order.id}`)
    .setDescription(`${status.emoji}  **${status.label}**`)
    .addFields(
      field('👤  Customer', `<@${order.customerId}>`, true),
      field('🧑‍🍳  Orderer', order.ordererId ? `<@${order.ordererId}>` : '*Waiting…*', true),
      field('🕒  Placed', timestamp(order.createdAt), true),
      field('🏷️  Promo', order.promo ?? 'None', true),
      field('💷  Service fee', fee, true),
      field('🎙️  VC', order.vc ? 'Yes' : 'No', true),
    )
    .setFooter(footer(`Order #${order.id}${order.screenshot ? '  •  📸 Screenshot attached' : ''}`))
    .setTimestamp(new Date(order.createdAt));
  if (order.forfeitedBy?.length) e.addFields(field('🔁  Forfeited by', order.forfeitedBy.filter(Boolean).map((id) => `<@${id}>`).join(', ') || '—'));
  for (const f of service.fields) {
    const value = order.details?.[f.id]?.trim();
    if (value) e.addFields(field(`${f.id === 'notes' ? '📝' : '📍'}  ${f.label.replace(' (optional)', '')}`, value));
  }
  if (order.closeAt) e.addFields(field('⏳  Ticket auto-deletes', timestamp(order.closeAt)));
  return e;
}

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
  const del = button(`order:delete:${id}`, 'Delete', ButtonStyle.Secondary, '🗑️');
  const cancel = button(`order:cancel:${id}`, 'Cancel order', ButtonStyle.Danger, '❌');
  const copy = button(`order:copyaddr:${id}`, 'Copy address', ButtonStyle.Secondary, '📋');
  if (order.status === 'accepted') {
    return [
      row(
        button(`order:complete:${id}`, 'Complete order', ButtonStyle.Success, '✅'),
        button(`order:forfeit:${id}`, 'Forfeit', ButtonStyle.Secondary, '🔁'),
        cancel,
      ),
      row(copy, button(`order:close:${id}`, 'Close', ButtonStyle.Secondary, '🔒'), del),
    ];
  }
  if (order.status === 'pending') return [row(copy, cancel, del)]; // forfeited, waiting for a new orderer
  if (order.status === 'completed') {
    const keep = order.closeAt ? [button(`order:keepopen:${id}`, 'Keep ticket open', ButtonStyle.Primary, '📌')] : [];
    return [row(...keep, copy, button(`order:close:${id}`, 'Close now', ButtonStyle.Secondary, '🔒'), del)];
  }
  if (order.status === 'closed') return [row(copy, del)];
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

export function captchaView({ orderId, token, choices, answer, note = '' }) {
  return {
    embeds: [
      embed()
        .setTitle('🧩 Quick check')
        .setDescription(`${note}To accept order **#${orderId}**, press the **${answer}** below.`),
    ],
    components: [row(...choices.map((emoji, i) => new ButtonBuilder().setCustomId(`order:captcha:${token}:${i}`).setStyle(ButtonStyle.Secondary).setEmoji(emoji)))],
  };
}

export function ticketWelcome(order) {
  const service = SERVICES[order.service];
  return embed()
    .setTitle('👋  Welcome to your ticket')
    .setDescription(`<@${order.ordererId}> has accepted your **${service.emoji} ${service.label}** order and will look after you here.`)
    .addFields(
      field('🧾  Order', `#${order.id}`, true),
      field('💷  Service fee', money(orderFee(order)), true),
      field('💬  Questions?', 'Just ask here', true),
    );
}

// --- support tickets ---

export function supportPanel() {
  const e = panelEmbed()
    .setTitle('🛟  Support')
    .setDescription('**Need a hand?** Open a ticket and our team will get back to you as soon as they can.')
    .addFields(
      field('💬  We can help with', bullets(['Questions about an order', 'Problems with a delivery or ride', 'Anything else you\'re stuck on']), true),
      field('🎫  How it works', steps(['Press **Open a ticket**', 'Tell us what\'s up', 'Chat with staff privately']), true),
    )
    .setFooter(footer('One ticket per issue, please'));
  return { embeds: [e], components: [row(button('support:open', 'Open a ticket', ButtonStyle.Primary, '🎫'))] };
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
  if (ticket.status === 'open') return [row(button('support:close', 'Close ticket', ButtonStyle.Danger, '✅'))];
  return [];
}

export function supportEmbed(ticket) {
  const status = SUPPORT_STATUS[ticket.status];
  return embed()
    .setTitle(`🛟  Support ticket #${ticket.id}`)
    .setDescription(`${status.emoji}  **${status.label}**\nThanks for reaching out. Staff will be with you shortly.`)
    .addFields(field('👤  Opened by', `<@${ticket.userId}>`, true), field('🕒  Opened', timestamp(ticket.createdAt), true), field('📝  Reason', ticket.reason))
    .setFooter(footer(`Ticket #${ticket.id}`))
    .setTimestamp(new Date(ticket.createdAt));
}

// --- verification (RestoreCord / VaultCord) ---

export function verifyPanel(url) {
  const e = panelEmbed()
    .setTitle('✅  Verify')
    .setDescription('**Welcome!** Verify below to unlock the rest of the server.')
    .addFields(
      field('🔐  How to verify', steps(['Press **Verify**', 'Log in with Discord and press **Authorize**', 'Your role and channels unlock straight away'])),
      field('🛡️  Why?', 'Verifying keeps you in the community even if the server ever has to move.'),
    )
    .setFooter(footer('Takes about 10 seconds'));
  return { embeds: [e], components: [row(linkButton(url, 'Verify', '✅'))] };
}

// --- completed orders feed ---

export function completedEmbed(order) {
  const service = SERVICES[order.service];
  return panelEmbed()
    .setTitle('✅  Order completed')
    .setDescription(`Another **${service.emoji} ${service.label}** order done. Want yours? Head to the order channel.`)
    .addFields(
      field('👤  For', `<@${order.customerId}>`, true),
      field('🧑‍🍳  By', `<@${order.ordererId}>`, true),
      ...(order.promo ? [field('🏷️  Promo', order.promo, true)] : []),
    )
    .setFooter(footer(`Order #${order.id}`))
    .setTimestamp();
}

// --- vouches ---

const stars = (n) => '⭐'.repeat(n) + '☆'.repeat(5 - n);

export function vouchSticky() {
  const e = panelEmbed()
    .setTitle('⭐  Leave a vouch')
    .setDescription('**Had a great order?** Let everyone know. Every vouch here comes from a real, completed order.')
    .addFields(
      field('✍️  A great vouch mentions', bullets(['What you ordered', 'How quick and smooth it was', 'Who helped you']), true),
      field('📏  Rules', bullets(['Completed orders only', 'One vouch per order', 'Other messages are removed']), true),
    )
    .setFooter(footer('Press Leave a vouch to start'));
  return { embeds: [e], components: [row(button('vouch:start', 'Leave a vouch', ButtonStyle.Success, '⭐'))] };
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
  return embed()
    .setTitle(`${stars(vouch.stars)}  Vouch #${vouch.number}`)
    .setDescription(`> ${vouch.message.replace(/\n/g, '\n> ')}`)
    .addFields(
      { name: '👤 Customer', value: `<@${vouch.userId}>`, inline: true },
      { name: `${service.emoji} Service`, value: service.label, inline: true },
      { name: '🧑‍🍳 Staff', value: order.ordererId ? `<@${order.ordererId}>` : '—', inline: true },
    )
    .setFooter(footer(`✅ Verified purchase  •  Order #${order.id}`))
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
  const e = embed().setTitle(`📢  ${title}`).setDescription(message).setFooter(footer(`Posted by ${author}`)).setTimestamp();
  if (image) e.setImage(image);
  return e;
}

export function tosPanel(tos) {
  const e = panelEmbed()
    .setTitle(tos.title)
    .setDescription('**Please read these carefully before placing an order.**')
    .addFields(tos.sections)
    .setFooter(footer(tos.footer))
    .setTimestamp();
  return { embeds: [e] };
}

// --- why Food Hub ---

export function whyPanel() {
  const e = panelEmbed()
    .setTitle('🍔  Why Food Hub?')
    .setDescription('**Thinking about ordering with us?** Here\'s what we\'re about.')
    .addFields(
      field('🍔  Why Food Hub?', 'What you can expect from us', true),
      field('🆚  Why us over Foodplug?', 'What makes us different', true),
    )
    .setFooter(footer('Tap a button to read more'));
  return {
    embeds: [e],
    components: [
      row(button('why:hub', 'Why Food Hub?', ButtonStyle.Primary, '🍔'), button('why:foodplug', 'Why us over Foodplug?', ButtonStyle.Secondary, '🆚')),
    ],
  };
}

export function whyFoodHubEmbed(why) {
  return embed()
    .setTitle(why.title)
    .setDescription([`**${why.intro}**`, '', why.points.join('\n\n'), '', why.tagline, why.outro].join('\n'))
    .setFooter(footer());
}

export function whyOverFoodplugEmbed(why) {
  return embed().setTitle(why.title).setDescription(why.paragraphs.join('\n\n')).setFooter(footer());
}

// --- staff panel (availability & payment details) ---

export function staffPanel() {
  const e = panelEmbed()
    .setTitle('🧑‍🍳  Orderer Control Panel')
    .setDescription('**Everything you need as an orderer, in one place.**')
    .addFields(
      field('🟢  Going online', 'Pick your services, then **how long** you\'re on for. New orders ping you, and you\'re set offline when the time\'s up.'),
      field('🗓️  Schedule', 'Save your usual times with **My schedule** and I\'ll DM you then to go online in one tap.'),
      field('💳  Getting paid', `Save your details with **Payment details**, then in a ticket use\n${Object.values(PAYMENT_METHODS).map((m) => `\`/${m.command}\``).join('  ')}`),
      field('🎫  In tickets', '`/complete`  `/close`  `/delete`  `/rename`\n**Forfeit** puts an order back in the queue.'),
    )
    .setFooter(footer('Staff only'));
  const select = new StringSelectMenuBuilder()
    .setCustomId('staff:online')
    .setPlaceholder('🟢  Go online for…')
    .setMinValues(1)
    .setMaxValues(Object.keys(SERVICES).length)
    .addOptions(Object.entries(SERVICES).map(([value, s]) => ({ label: s.label, value, emoji: s.emoji })));
  return {
    embeds: [e],
    components: [
      row(select),
      row(
        button('staff:offline', 'Go offline', ButtonStyle.Danger, '🔴'),
        button('staff:schedule', 'My schedule', ButtonStyle.Secondary, '🗓️'),
        button('staff:payments', 'Payment details', ButtonStyle.Secondary, '💳'),
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
      embed()
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
      embed()
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
  return embed()
    .setTitle('👀 Your orderer status')
    .addFields({ name: '🟢 Online for', value: online }, { name: '🗓️ Schedule', value: schedule }, { name: '💳 Payment details', value: details });
}

// --- payment requests ---

const PAYMENT_STATUS = {
  due: { label: 'Payment due', emoji: '🟡' },
  marked_paid: { label: 'Customer says paid, waiting for confirmation', emoji: '🔵' },
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
  return embed()
    .setTitle(`${m.emoji}  Payment due  ·  ${money(payment.amount)}`)
    .setDescription(`${who} payment is now due.\n\n${where}`)
    .addFields(
      field('📌  Status', `${status.emoji}  ${status.label}${payment.status === 'due' ? '\nPress **I\'ve paid** once it\'s sent.' : ''}`),
      field('🧑‍🍳  Pay to', `<@${payment.ordererId}>`, true),
      field('💳  Method', m.label, true),
      ...(payment.orderId ? [field('🧾  Order', `#${payment.orderId}`, true)] : []),
    )
    .setFooter(footer(`Payment ${payment.id}`))
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
  const e = embed()
    .setTitle(`❓  Question about your order #${order.id}`)
    .setDescription(`<@${q.askerId}> asked about your **${service.emoji} ${service.label}** order:\n> ${q.question.replace(/\n/g, '\n> ')}`)
    .setFooter(footer('Press Answer, or just type your answer here'))
    .setTimestamp(new Date(q.createdAt));
  return { embeds: [e], components: [row(button(`q:answer:${q.id}`, 'Answer', ButtonStyle.Primary, '✍️'))] };
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
  return embed()
    .setTitle(`💬 Customer answered — ${service.label} order #${order.id}`)
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
  const e = panelEmbed()
    .setTitle('📜  Ticket Transcripts')
    .setDescription('**Every order and support ticket is saved before it\'s deleted.**')
    .addFields(field('🔎  Search', 'Press **Search by user ID** and paste a member\'s ID to get every order they\'ve made, with a transcript of each ticket.'))
    .setFooter(footer('Staff only'));
  if (!messageContent) {
    e.addFields(field('⚠️  Message Content Intent is off', 'Members\' messages aren\'t being saved, only the bot\'s panels. Turn it on in the Developer Portal → Bot, then restart.'));
  }
  return { embeds: [e], components: [row(button('transcript:open', 'Search by user ID', ButtonStyle.Primary, '🔎'))] };
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
  const winners = ended ? (g.winnerIds.length ? g.winnerIds.map((id) => `<@${id}>`).join(', ') : 'No entries') : String(g.winners);
  return panelEmbed()
    .setTitle(`🎉  ${g.title}`)
    .setDescription(g.info || (ended ? 'This giveaway has ended.' : '**Press Enter to join!** Press it again to leave.'))
    .addFields(
      field(ended ? '⏰  Ended' : '⏰  Ends', ended ? timestamp(g.endsAt) : `${timestamp(g.endsAt)}\n${timestamp(g.endsAt, 'f')}`, true),
      field('🏆  Winners', winners, true),
      field('🎟️  Entries', String(g.entrants.length), true),
      field('🎁  Hosted by', `<@${g.hostId}>`, true),
    )
    .setFooter(footer(ended ? `Giveaway #${g.id}  •  Ended` : `Giveaway #${g.id}  •  Press Enter to join`))
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
    const recent = s.completed.slice(0, 6).map((o) => `\`#${o.id}\` ${timestamp(o.completedAt, 'd')}`);
    return [
      `**<@${userId}>**  ·  ✅ ${s.completed.length} completed${s.inProgress.length ? `  ·  🔵 ${s.inProgress.length} in progress` : ''}`,
      recent.length ? recent.join('  ') + (s.completed.length > recent.length ? '  …' : '') : '*No completed orders yet*',
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
      panelEmbed()
        .setTitle('🎓  Trial Orderers')
        .setDescription(
          [`Trial orderers${roleId ? ` (<@&${roleId}>)` : ''} can accept orders. When they do, the orderer role is pinged to supervise.`, '', body || '*No trial orders yet.*'].join('\n'),
        )
        .setFooter(footer('Successful orders  •  Updates live'))
        .setTimestamp(),
    ],
  };
}

// --- referrals ---

export function referralPanel() {
  return {
    embeds: [
      panelEmbed()
        .setTitle('🎉  Foodhub Referrals — Win-Win!')
        .setDescription('Refer **3 friends**, and if **2 place an order**, you score a **FREE FEE ORDER**!')
        .addFields(
          field('🤝  You both win', 'They get a first-order discount, and you get yours upon confirmation. **No limits!**'),
          field('🚀  Important', 'They *must* join with **your personal invite link** so it counts.'),
          field(
            '📋  How it works',
            steps([
              'Press **Get my invite link** and share it',
              'Friends join and press **I was invited** for **50p off**',
              'When 3 have joined and 2 have ordered, press **Claim my reward**',
              'Put your code in the order form and the fee comes off',
            ]),
          ),
        )
        .setFooter(footer('Codes are personal and single-use  •  A cancelled order gives the code back')),
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

export function codeMessage(code, headline) {
  const value = code.type === 'free' ? '🆓 **No service fee**' : `💷 **£${code.amount.toFixed(2)} off** the service fee`;
  return {
    content: code.code,
    embeds: [
      embed()
        .setTitle('🎟️ Your code')
        .setDescription([headline, '', `🔑 **Code:** \`${code.code}\``, value, '📝 Enter it in the **Discount / referral code** box when you order.'].join('\n')),
    ],
    components: [row(button(`ref:copy:${code.code}`, 'Copy code', ButtonStyle.Secondary, '📋'))],
  };
}

export function referralStatsEmbed(stats, { invites, orders, tracking }) {
  const bar = (n, total) => '🟩'.repeat(Math.min(n, total)) + '⬜'.repeat(Math.max(0, total - n));
  return embed()
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

// --- loyalty ---

export function loyaltyPanel({ orders, days }) {
  const weeks = days % 7 === 0 ? `${days / 7} weeks` : `${days} days`;
  return {
    embeds: [
      panelEmbed()
        .setTitle('🍔  Food Hub Loyalty')
        .setDescription(`**Order ${orders} times in ${weeks} and your next order's fee is on us.**`)
        .addFields(
          field('📋  How it works', steps([`Complete **${orders} orders** within **${weeks}**`, 'Your free-fee code is **DMed to you** automatically', 'Put it in the order form on your next order'])),
          field('📈  Your progress', 'Press **Check loyalty** to see how close you are.'),
        )
        .setFooter(footer(`Only completed orders count  •  Rolling ${weeks}`)),
    ],
    components: [row(button('loyalty:check', 'Check loyalty', ButtonStyle.Success, '🍔'))],
  };
}

export function loyaltyProgressEmbed(counted, { orders, days }) {
  const done = Math.min(counted.length, orders);
  const slots = Array.from({ length: orders }, (_, i) => (i < done ? '🍔' : '⚪'));
  const grid = [slots.slice(0, Math.ceil(orders / 2)).join(' '), slots.slice(Math.ceil(orders / 2)).join(' ')].filter(Boolean).join('\n');
  const left = orders - done;
  const oldest = counted[0] ? Date.parse(counted[0].completedAt) + days * 24 * 60 * 60 * 1000 : null;
  return embed()
    .setTitle('🍔  Your loyalty')
    .setDescription(`${grid}\n\n**${done} / ${orders}** orders in the last ${days} days`)
    .addFields(
      field(left ? '🎯  To go' : '🎉  Done!', left ? `**${left}** more order${left === 1 ? '' : 's'} for a free-fee code` : 'Your code is on its way to your DMs'),
      ...(oldest && left ? [field('⏳  Oldest order drops off', `<t:${Math.floor(oldest / 1000)}:R>`)] : []),
    )
    .setFooter(footer('Only completed orders count'));
}

// --- daily stats ---

const minutes = (m) => (m === null || m === undefined ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`);
const dayLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export function dailyStatsView(stats, { title = 'Daily stats' } = {}) {
  const board = Object.entries(stats.byOrderer)
    .sort(([, a], [, b]) => b.completed - a.completed)
    .slice(0, 10)
    .map(([id, s], i) => `\`${i + 1}\`  <@${id}>  ·  **${s.completed}** order${s.completed === 1 ? '' : 's'}  ·  avg ${minutes(s.avgMinutes)}`);
  return {
    embeds: [
      panelEmbed()
        .setTitle(`📊  ${title}`)
        .setDescription(`**${dayLabel(stats.date)}**`)
        .addFields(
          field('📥  Submitted', String(stats.submitted), true),
          field('✅  Completed', String(stats.completed), true),
          field('❌  Cancelled', String(stats.cancelled), true),
          field('🏆  Most orders', stats.most ? `<@${stats.most.userId}>\n${stats.most.completed} completed` : '—', true),
          field('⚡  Fastest', stats.fastest ? `<@${stats.fastest.userId}>\navg ${minutes(stats.fastest.avgMinutes)}` : '—', true),
          field('💷  Fees', money(stats.fees), true),
          field('📋  Leaderboard', board.join('\n') || '*No completed orders.*'),
        )
        .setFooter(footer('Speed = time from accept to complete')),
    ],
    components: [row(button(`stats:me:${stats.date}`, 'Get my personal stats', ButtonStyle.Primary, '📈'))],
  };
}

export function personalStatsEmbed(stats, userId) {
  const mine = stats.byOrderer[userId];
  const rank = Object.entries(stats.byOrderer).sort(([, a], [, b]) => b.completed - a.completed).findIndex(([id]) => id === userId) + 1;
  const e = embed().setTitle('📈  Your stats').setDescription(`**${dayLabel(stats.date)}**`).setFooter(footer('Only you can see this'));
  if (!mine) return e.addFields(field('✅  Completed', '0 orders that day'));
  const speeds = mine.minutes.length ? `${minutes(Math.min(...mine.minutes))} fastest  ·  ${minutes(Math.max(...mine.minutes))} slowest` : '—';
  return e.addFields(
    field('✅  Completed', String(mine.completed), true),
    field('🏅  Rank', `#${rank} of ${Object.keys(stats.byOrderer).length}`, true),
    field('💷  Fees', money(mine.fees), true),
    field('⏱️  Average time', minutes(mine.avgMinutes), true),
    field('⚡  Range', speeds, true),
    field('🧾  Orders', mine.orders.map((id) => `\`#${id}\``).join('  ').slice(0, 1024)),
  );
}

// --- bot suggestions ---

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
    embed()
      .setTitle(i === 0 ? `💡  BOT SUGGESTIONS  💡${suggestions.length ? ` (${suggestions.length})` : ''}` : null)
      .setDescription(text),
  );
}

export function suggestionSticky(count) {
  return {
    embeds: [
      panelEmbed()
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
    embeds: [embed().setDescription(`🧹 Clear all **${count}** suggestions? This can't be undone.`)],
    components: [row(button('suggest:clearyes', 'Yes, clear them', ButtonStyle.Danger, '🧹'))],
  };
}

// --- applications ---

export function applyPanel() {
  return {
    embeds: [
      panelEmbed()
        .setTitle('📝  Applications')
        .setDescription('**Want to join the team or partner with us?** Apply below. The questions are sent to your DMs.')
        .addFields(
          field('🧑‍🍳  Become an orderer', 'VC proof, vouches, order proof, other servers and your active times. Accepted applicants start as **trial orderers**.'),
          field('🤝  Partner with us', 'Your server link, members, and what you\'re looking for.'),
        )
        .setFooter(footer('Keep your DMs open  •  We DM you the result')),
    ],
    components: [
      row(button('apply:orderer', 'Apply to be an orderer', ButtonStyle.Success, '🧑‍🍳'), button('apply:partner', 'Apply to be a partner', ButtonStyle.Primary, '🤝')),
    ],
  };
}

export function applicationQuestion(form, index, answered = null) {
  const step = form.steps[index];
  const e = embed()
    .setTitle(`${form.title}  ·  Question ${index + 1} of ${form.steps.length}`)
    .setDescription(answered ? `${step.prompt}\n\n➡️ **${answered}**` : step.prompt);
  if (answered) return { embeds: [e] };
  const buttons = [];
  if (step.kind === 'yesno') buttons.push(button('apply:yes', 'Yes', ButtonStyle.Success, '✅'), button('apply:no', 'No', ButtonStyle.Danger, '✖️'));
  if (step.kind === 'images' && step.skip) buttons.push(button('apply:skip', step.skip, ButtonStyle.Secondary, '🚫'));
  buttons.push(button('apply:cancel', 'Cancel application', ButtonStyle.Secondary, '🗑️'));
  e.setFooter(footer(step.kind === 'yesno' ? 'Press a button' : step.kind === 'images' ? 'Send your images in one message' : 'Type your answer here'));
  return { embeds: [e], components: [row(...buttons)] };
}

const APPLICATION_STATUS = { pending: '🟡 Waiting for review', accepted: '✅ Accepted', denied: '❌ Denied', failed: '⚠️ Failed to send' };

export function applicationEmbed(application, form) {
  return embed()
    .setTitle(`${form.title}  ·  #${application.id}`)
    .setDescription(`<@${application.userId}>  ·  \`${application.userId}\`${application.userName ? `  ·  ${application.userName}` : ''}\n**${APPLICATION_STATUS[application.status]}**${application.reviewedBy ? ` by <@${application.reviewedBy}>` : ''}`)
    .addFields(form.steps.map((st) => field(st.label, String(application.answers[st.id] ?? '—').slice(0, 1024), st.kind === 'yesno')))
    .setFooter(footer(`Application #${application.id}`))
    .setTimestamp(new Date(application.createdAt));
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

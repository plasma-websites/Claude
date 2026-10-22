import { PAYMENT_METHODS, SERVICES, money } from './services.js';
import { MessageFlags } from 'discord.js';
import { formatSlot, localNow, parseSchedule, slotsStartingNow } from './schedule.js';
import { COLORS, dm, ephemeral, isAdmin, isOrderer as isOrdererMember, panel, say } from './util.js';
import { onlineDurationPicker, ordersPanel, paymentButtons, paymentDetailsModal, paymentEmbed, scheduleModal, schedulePrompt, staffStatusEmbed } from './views.js';

const methodByCommand = Object.fromEntries(Object.entries(PAYMENT_METHODS).map(([key, m]) => [m.command, key]));
export const PAYMENT_COMMANDS = Object.keys(methodByCommand);

// Staff panel (who's online + payment details), payment requests, and keeping
// the "who's online" list on every order panel up to date.
export function createStaffHandlers({ client, config, store, promos }) {
  const isOrderer = (interaction) => isOrdererMember(interaction.member, config) || isAdmin(interaction);
  const until = (minutes) => new Date(Date.now() + minutes * 60 * 1000);
  const ts = (date) => `<t:${Math.floor(date.getTime() / 1000)}:t>`;

  // --- order panels ---

  function recordOrderPanel(message) {
    const panels = store.getMeta('orderPanels') ?? [];
    store.setMeta('orderPanels', [...panels, { channelId: message.channelId, messageId: message.id }]);
  }

  async function refreshOrderPanels() {
    const panels = store.getMeta('orderPanels') ?? [];
    const keep = [];
    for (const p of panels) {
      try {
        const channel = await client.channels.fetch(p.channelId);
        const message = await channel.messages.fetch(p.messageId);
        await message.edit(ordersPanel(promos, store.onlineByService()));
        keep.push(p);
      } catch (err) {
        if (![10003, 10008].includes(err.code)) keep.push(p); // keep unless the channel/message is gone
      }
    }
    if (keep.length !== panels.length) store.setMeta('orderPanels', keep);
  }

  // --- staff panel ---

  const serviceList = (keys) => keys.map((k) => `${SERVICES[k].emoji} **${SERVICES[k].label}**`).join(', ');

  // Step 1: services picked on the panel → ask how long for.
  function pickServices(interaction) {
    return interaction.reply({ ...onlineDurationPicker(interaction.values), flags: MessageFlags.Ephemeral });
  }

  // Step 2: duration picked → online until then, then automatically offline.
  async function goOnline(interaction, minutes, services) {
    const end = until(minutes);
    store.setOnline(interaction.user.id, services, end);
    await interaction.update(
      say(`🟢 You're now **online** for ${serviceList(services)} until ${ts(end)} (<t:${Math.floor(end / 1000)}:R>).\nNew orders for these will ping you. 🔔\n⏰ You'll be set offline automatically after that.`, { components: [] }, { color: COLORS.success }),
    );
    await refreshOrderPanels();
  }

  async function goOffline(interaction) {
    store.setOnline(interaction.user.id, []);
    await interaction.reply(ephemeral('🔴 You\'re now **offline**. Thanks for your work! 💛', {}, { color: COLORS.danger }));
    await refreshOrderPanels();
  }

  async function savePaymentDetails(interaction) {
    const details = {};
    const problems = [];
    for (const [key, m] of Object.entries(PAYMENT_METHODS)) {
      const value = interaction.fields.getTextInputValue(key).trim();
      if (!value) continue;
      if (m.pattern.test(value)) details[key] = value;
      else problems.push(`${m.emoji} **${m.label}** doesn't look right — expected something like \`${m.example}\``);
    }
    if (problems.length) return interaction.reply(ephemeral(`❌ Nothing was saved:\n${problems.join('\n')}`, {}, { color: COLORS.danger }));
    store.setPaymentDetails(interaction.user.id, details);
    return interaction.reply({
      embeds: [panel('✅ Payment details saved!', { color: COLORS.success }), staffStatusEmbed(store.getStaff(interaction.user.id), config.timezone)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- schedules ---

  async function saveSchedule(interaction) {
    const text = interaction.fields.getTextInputValue('times').trim();
    if (!text) {
      store.setSchedule(interaction.user.id, null);
      return interaction.reply(ephemeral('🗓️ Schedule cleared. You won\'t get "are you online?" DMs.', {}, { color: COLORS.success }));
    }
    const { slots, errors } = parseSchedule(text);
    if (errors.length || !slots.length) {
      return interaction.reply(
        ephemeral(
          `❌ I couldn't read: ${errors.map((e) => `\`${e}\``).join(', ') || 'anything'}\nUse lines like \`Mon-Fri 6pm-10pm\`, \`Sat 12:00-23:30\`, \`weekends 10-14\`, \`daily 22:00-02:00\`.`,
          {},
          { color: COLORS.danger },
        ),
      );
    }
    store.setSchedule(interaction.user.id, { text, slots });
    return interaction.reply(
      ephemeral(`🗓️ **Schedule saved!** (${config.timezone} time)\n${slots.map((sl) => `• ${formatSlot(sl)}`).join('\n')}\n\nAt the start of each slot I'll DM you to ask if you want to go online.`, {}, {
        color: COLORS.success,
      }),
    );
  }

  // Buttons on the scheduled DM. They're in DMs, so there's no member to check roles on.
  async function scheduleAnswer(interaction, answer, endMs) {
    if (answer === 'no') return interaction.update(say('👍 No worries — you\'ll stay offline.', { components: [] }));
    const end = new Date(Number(endMs));
    if (end <= new Date()) return interaction.update(say('⏰ That slot has already ended.', { components: [] }));
    const staff = store.getStaff(interaction.user.id);
    const services = staff.usualServices?.length ? staff.usualServices : Object.keys(SERVICES);
    store.setOnline(interaction.user.id, services, end);
    await interaction.update(say(`🟢 You're **online** for ${serviceList(services)} until ${ts(end)}.\nChange it any time on the staff panel.`, { components: [] }, { color: COLORS.success }));
    await refreshOrderPanels();
  }

  // Runs every 30 seconds: sets staff offline when their time is up, and sends scheduled DMs.
  async function tick() {
    const expired = store.expiredOnline();
    for (const userId of expired) {
      store.setOnline(userId, []);
      dm(client, userId, say('⏰ Your online time ran out, so you\'ve been set **offline**. Go online again from the staff panel if you\'re still around!'));
    }
    if (expired.length) await refreshOrderPanels();

    const now = localNow(config.timezone);
    for (const [userId, staff] of store.allStaff()) {
      if (!staff.schedule?.slots?.length || staff.online?.length) continue;
      for (const { index, length } of slotsStartingNow(staff.schedule.slots, now)) {
        const key = `${now.date}-${now.minutes}-${index}`;
        if (staff.lastPrompt === key) continue;
        store.markPrompted(userId, key);
        const end = until(length);
        dm(client, userId, schedulePrompt(end));
      }
    }
  }

  async function handleComponent(interaction) {
    const [, action, a, b] = interaction.customId.split(':');
    if (action === 'sched') return scheduleAnswer(interaction, a, b);
    if (!isOrderer(interaction)) return interaction.reply(ephemeral(`Only <@&${config.ordererRoleId}> can use the staff panel.`, {}, { color: COLORS.danger }));
    if (action === 'dur') return goOnline(interaction, Number(a), b.split(',').filter((k) => SERVICES[k]));
    switch (interaction.customId) {
      case 'staff:online': return pickServices(interaction);
      case 'staff:schedule': return interaction.showModal(scheduleModal(store.getStaff(interaction.user.id).schedule?.text));
      case 'staff:schedulesave': return saveSchedule(interaction);
      case 'staff:offline': return goOffline(interaction);
      case 'staff:payments': return interaction.showModal(paymentDetailsModal(store.getStaff(interaction.user.id).payments));
      case 'staff:paymentsave': return savePaymentDetails(interaction);
      case 'staff:me':
        return interaction.reply({ embeds: [staffStatusEmbed(store.getStaff(interaction.user.id), config.timezone)], flags: MessageFlags.Ephemeral });
    }
  }

  // --- /paypal /rev /starling /crypto ---

  async function requestPayment(interaction) {
    if (!isOrderer(interaction)) return interaction.reply(ephemeral('Only orderers can request payments.', {}, { color: COLORS.danger }));
    const method = methodByCommand[interaction.commandName];
    const m = PAYMENT_METHODS[method];
    const destination = store.getStaff(interaction.user.id).payments?.[method];
    if (!destination) {
      return interaction.reply(ephemeral(`💳 You haven't saved your **${m.label}** details yet. Use **Payment details** on the staff panel first.`, {}, { color: COLORS.warning }));
    }
    const order = store.orderByTicket(interaction.channelId);
    const payment = store.createPayment({
      method,
      amount: interaction.options.getNumber('amount', true),
      ordererId: interaction.user.id,
      customerId: order?.customerId ?? null,
      orderId: order?.id ?? null,
      channelId: interaction.channelId,
    });
    const message = await interaction.reply({
      content: payment.customerId ? `<@${payment.customerId}>` : undefined,
      embeds: [paymentEmbed(payment, destination)],
      components: paymentButtons(payment, destination),
      withResponse: true,
    });
    store.updatePayment(payment.id, { messageId: message.resource?.message?.id ?? null });
  }

  // --- payment panel buttons ---

  async function handlePaymentButton(interaction) {
    const [, action, id] = interaction.customId.split(':');
    const payment = store.getPayment(Number(id));
    if (!payment) return interaction.reply(ephemeral('That payment request no longer exists.', {}, { color: COLORS.danger }));
    const destination = store.getStaff(payment.ordererId).payments?.[payment.method];
    const isPayee = interaction.user.id === payment.ordererId || isAdmin(interaction);
    const update = (p) => interaction.update({ embeds: [paymentEmbed(p, destination)], components: paymentButtons(p, destination) });

    switch (action) {
      case 'paid': {
        if (payment.customerId ? interaction.user.id !== payment.customerId : interaction.user.id === payment.ordererId) {
          return interaction.reply(ephemeral('Only the customer can mark this as paid.', {}, { color: COLORS.danger }));
        }
        if (payment.status !== 'due') return interaction.reply(ephemeral('This has already been marked as paid.'));
        const updated = store.updatePayment(payment.id, { status: 'marked_paid', paidBy: interaction.user.id });
        await update(updated);
        return interaction.channel.send({
          content: `<@${payment.ordererId}>`,
          ...say(
            `💸 <@${interaction.user.id}> says they've paid **${money(payment.amount)}** via **${PAYMENT_METHODS[payment.method].label}**.\nPlease check and press **Confirm received** or **Not received**.`,
            {},
            { title: '🔔 Payment sent', color: COLORS.info },
          ),
        });
      }
      case 'confirm': {
        if (!isPayee) return interaction.reply(ephemeral('Only the orderer being paid can confirm this.', {}, { color: COLORS.danger }));
        if (payment.status !== 'marked_paid') return interaction.reply(ephemeral('This payment isn\'t waiting for confirmation.'));
        return update(store.updatePayment(payment.id, { status: 'confirmed', confirmedBy: interaction.user.id }));
      }
      case 'notreceived': {
        if (!isPayee) return interaction.reply(ephemeral('Only the orderer being paid can do this.', {}, { color: COLORS.danger }));
        if (payment.status !== 'marked_paid') return interaction.reply(ephemeral('This payment isn\'t waiting for confirmation.'));
        const updated = store.updatePayment(payment.id, { status: 'due' });
        await update(updated);
        return interaction.channel.send({
          content: payment.customerId ? `<@${payment.customerId}>` : undefined,
          ...say(
            `❌ <@${interaction.user.id}> hasn't received **${money(payment.amount)}** yet. Please double-check the details and try again, then press **I've paid**.`,
            {},
            { title: '⚠️ Payment not received', color: COLORS.danger },
          ),
        });
      }
    }
  }

  return { handleComponent, handlePaymentButton, requestPayment, refreshOrderPanels, recordOrderPanel, tick };
}

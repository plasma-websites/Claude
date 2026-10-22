import fs from 'node:fs';
import path from 'node:path';
import { MessageFlags, OverwriteType } from 'discord.js';
import { randomBytes, randomInt } from 'node:crypto';
import { SERVICES, discountedFee, money } from './services.js';
import {
  COLORS,
  createTicketChannel,
  deleteChannel,
  dm,
  editMessage,
  ephemeral,
  hasRole,
  isAdmin,
  isOrderer,
  isTrial,
  lockTicket,
  panel,
  renameChannel,
  say,
} from './util.js';
import {
  answerEmbed,
  answerModal,
  askQuestionModal,
  cancelOrderModal,
  captchaView,
  channelUrl,
  completedEmbed,
  detailsModal,
  orderEmbed,
  orderTicketName,
  promoPicker,
  questionDm,
  staffButtons,
  ticketButtons,
  ticketWelcome,
  vcPicker,
} from './views.js';

const SCREENSHOT_WAIT_MS = 15 * 60 * 1000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

// Order flow: company -> promo -> VC yes/no -> address form -> screenshot in DMs -> staff channel
// -> Accept creates a ticket -> (Forfeit puts it back in the queue) -> Complete order
// -> ticket auto-closes (locks) -> staff delete it.
const CAPTCHA_EMOJIS = ['🍔', '🍕', '🍟', '🌮', '🍩', '🍣', '🥗', '🍪', '🍦', '🥐', '🌭', '🍜'];
const CAPTCHA_MS = 2 * 60 * 1000;
const CANCEL_DELETE_MS = 10 * 1000;

export function createOrderHandlers({ client, config, store, promos, transcripts, trials }) {
  // Members who finished the questions and still owe us a screenshot, by user ID.
  const awaitingScreenshot = new Map();

  // Little "press the 🍕" checks shown before accepting, by token.
  const captchas = new Map();

  const isStaff = (interaction) => isOrderer(interaction.member, config) || isAdmin(interaction);
  // Buttons on the ticket panel update it in place; the same actions as /commands answer privately.
  const ack = (interaction) => (interaction.isButton() ? interaction.deferUpdate() : interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  const done = (interaction, text) => (interaction.isButton() ? null : interaction.editReply(say(text, {}, { color: COLORS.success })));
  const label = (order) => `${SERVICES[order.service].label} order #${order.id}`;
  const screenshotFile = (order) => ({ attachment: order.screenshot, name: `order-${order.id}${path.extname(order.screenshot)}` });
  const hasScreenshot = (order) => order.screenshot && fs.existsSync(order.screenshot);

  const refreshStaffMessage = (order) =>
    editMessage(client, order.staffChannelId, order.staffMessageId, {
      embeds: [orderEmbed(order)],
      components: staffButtons(order, config.guildId),
    });

  const refreshTicketMessage = (order) =>
    editMessage(client, order.ticketChannelId, order.ticketMessageId, { embeds: [orderEmbed(order)], components: ticketButtons(order) });

  async function sendToTicket(order, payload) {
    try {
      const channel = await client.channels.fetch(order.ticketChannelId);
      await channel.send(payload);
    } catch (err) {
      console.error(`Could not post in the ticket for order #${order.id}:`, err.message);
    }
  }

  // Posts the order in the staff channel, pinging the orderer role and whoever
  // is online for that service.
  async function postToStaff(order, headline) {
    const online = (store.onlineByService()[order.service] ?? []).filter((id) => id !== order.customerId);
    const pings = [`<@&${config.ordererRoleId}>`, ...online.map((id) => `<@${id}>`)].join(' ');
    const channel = await client.channels.fetch(config.staffChannelId);
    const message = await channel.send({
      content: pings,
      allowedMentions: { users: online, roles: [config.ordererRoleId] },
      embeds: [panel(headline, { color: SERVICES[order.service].color }), orderEmbed(order)],
      files: hasScreenshot(order) ? [screenshotFile(order)] : [],
      components: staffButtons(order, config.guildId),
    });
    return store.updateOrder(order.id, { staffChannelId: channel.id, staffMessageId: message.id });
  }

  // Locks the ticket: the customer loses access, staff keep it until they delete it.
  async function closeTicket(order, note) {
    const result = store.close(order.id);
    if (result.error) return result;
    const closed = result.order;
    await lockTicket(client, closed.ticketChannelId, closed.customerId);
    renameChannel(client, closed.ticketChannelId, orderTicketName(closed));
    await refreshTicketMessage(closed);
    await refreshStaffMessage(closed);
    await sendToTicket(
      closed,
      say(`${note}\n🗑️ Staff can delete this ticket when they're done.`, { components: ticketButtons(closed) }, { title: '🔒 Ticket closed', color: COLORS.danger }),
    );
    dm(client, closed.customerId, `🔒 Your ticket for **${label(closed)}** has been closed. Thanks for ordering with us! 💛`);
    return result;
  }

  // --- steps 1-4: questions in the order channel ---

  async function pickService(interaction) {
    const serviceKey = interaction.values[0];
    if (config.verifiedRoleId && !hasRole(interaction.member, config.verifiedRoleId)) {
      return interaction.reply(ephemeral(`🔐 You need to verify first! Get the <@&${config.verifiedRoleId}> role, then come back. ✅`, {}, { color: COLORS.warning }));
    }
    const open = store.openOrdersFor(interaction.user.id);
    if (open.length >= config.maxOpenOrders) {
      return interaction.reply(
        ephemeral(
          [
            `⛔ You already have **${open.length}** open order(s) (${open.map((o) => `#${o.id}`).join(', ')}). Please wait for them to finish first. ⏳`,
            open.some((o) => o.status === 'pending') ? 'Not accepted yet and no longer need it? Use `/cancel id:` to cancel it.' : null,
          ]
            .filter(Boolean)
            .join('\n'),
          {},
          { color: COLORS.danger },
        ),
      );
    }
    const online = store.onlineByService()[serviceKey] ?? [];
    return interaction.reply({ ...promoPicker(serviceKey, promos[serviceKey], online), flags: MessageFlags.Ephemeral });
  }

  function pickPromo(interaction, serviceKey) {
    return interaction.update(vcPicker(serviceKey, interaction.values[0]));
  }

  function pickVc(interaction, serviceKey, promoValue, answer) {
    return interaction.showModal(detailsModal(serviceKey, promoValue, answer));
  }

  async function submitDetails(interaction, serviceKey, promoValue, answer) {
    const service = SERVICES[serviceKey];
    const promo = promos[serviceKey][Number(promoValue)] ?? promos[serviceKey][0];
    const details = Object.fromEntries(service.fields.map((f) => [f.id, interaction.fields.getTextInputValue(f.id)]));
    const codeText = interaction.fields.getTextInputValue('code')?.trim();
    let code = null;
    if (codeText) {
      const check = store.checkCode(codeText, interaction.user.id);
      if (check.error) {
        const retry = vcPicker(serviceKey, promoValue);
        return interaction.update({ ...retry, embeds: [panel(`❌ ${check.error}\nAnswer **VC?** again to re-open the form (leave the code empty to order without one).`), ...retry.embeds] });
      }
      code = check.code;
    }
    awaitingScreenshot.set(interaction.user.id, {
      code: code?.code ?? null,
      service: serviceKey,
      promo: promo.name,
      fee: promo.fee,
      customerName: interaction.user.username,
      vc: answer === 'yes',
      details,
      expiresAt: Date.now() + SCREENSHOT_WAIT_MS,
    });

    const sent = await dm(
      client,
      interaction.user.id,
      say(
        ['**Step 5/5** — 📸 Send your **order screenshot** here as an image.', '⏳ You have **15 minutes**.'].join('\n'),
        {},
        { title: `${service.emoji} ${service.label} order — almost done! 🙌`, color: service.color },
      ),
    );
    if (!sent) {
      awaitingScreenshot.delete(interaction.user.id);
      return interaction.update(
        say('❌ I couldn\'t DM you! Turn on **Direct Messages** for this server (click the server name → **Privacy Settings**) and start again. 🔄', { components: [] }, {
          color: COLORS.danger,
        }),
      );
    }
    const codeNote = code ? `\n🎟️ Code \`${code.code}\` will be applied: service fee **${money(discountedFee(promo.fee, code))}** instead of ${money(promo.fee)}.` : '';
    return interaction.update(say(`📬 **Check your DMs!** Send your order screenshot there to finish your order. 📸${codeNote}`, { components: [] }, { color: COLORS.success }));
  }

  // --- step 5: screenshot arrives in DMs ---

  async function handleDm(message) {
    const pending = awaitingScreenshot.get(message.author.id);
    const reply = (text, color = COLORS.warning) => message.reply(say(text, {}, { color }));
    if (!pending) {
      // Not sending a screenshot: maybe they're typing the answer to an orderer's question.
      const q = store.openQuestionFor(message.author.id);
      if (q && message.content.trim()) return recordAnswer(q.id, message.content.trim(), (text, color) => reply(text, color));
      return;
    }
    if (Date.now() > pending.expiresAt) {
      awaitingScreenshot.delete(message.author.id);
      return reply('⏰ That took too long! Please start a new order from the order channel. 🔄');
    }
    const image = message.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (!image) return reply('🖼️ Please send your order screenshot as an **image**.');
    if (image.size > MAX_SCREENSHOT_BYTES) return reply('📏 That image is too big (max 10 MB). Please send a smaller screenshot.');
    awaitingScreenshot.delete(message.author.id); // before any await, so a double-send can't create two orders

    let order = store.createOrder({ ...pending, customerId: message.author.id });
    let codeNote = '';
    if (pending.code) {
      const redeemed = store.redeemCode(pending.code, message.author.id, order.id);
      if (redeemed.error) codeNote = `\n⚠️ Your code wasn't applied: ${redeemed.error}`;
      else {
        order = store.updateOrder(order.id, { code: redeemed.code.code, originalFee: order.fee, fee: discountedFee(order.fee, redeemed.code) });
        codeNote = `\n🎟️ Code \`${order.code}\` applied — service fee **${money(order.fee)}**.`;
      }
    }
    try {
      const res = await fetch(image.url);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      fs.mkdirSync(config.screenshotDir, { recursive: true });
      const file = path.join(config.screenshotDir, `order-${order.id}${path.extname(image.name) || '.png'}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      order = store.updateOrder(order.id, { screenshot: file });
      await postToStaff(order, `🔔 New ${SERVICES[order.service].emoji} **${label(order)}** waiting to be accepted!`);
    } catch (err) {
      console.error(`Could not submit order #${order.id}:`, err.message);
      store.updateOrder(order.id, { status: 'cancelled' });
      return reply('😔 Sorry, your order could not be submitted. Please open a support ticket.', COLORS.danger);
    }
    return message.reply(
      say(
        [
          `🧾 Your order number is **#${order.id}**`,
          '👀 Our staff have been notified. When someone accepts it you\'ll be added to a private ticket. 🎫',
          '📦 Check its status any time with `/myorders`.',
        ].join('\n') + codeNote,
        {},
        { title: '✅ Order received!', color: COLORS.success },
      ),
    );
  }

  // --- staff channel: ask the customer a question ---

  async function askQuestion(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only orderers can ask customers questions.', {}, { color: COLORS.danger }));
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    return interaction.showModal(askQuestionModal(id));
  }

  async function sendQuestion(interaction, id) {
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    const q = store.createQuestion({
      orderId: id,
      askerId: interaction.user.id,
      customerId: order.customerId,
      question: interaction.fields.getTextInputValue('question').trim(),
    });
    const sent = await dm(client, order.customerId, questionDm(order, q));
    if (!sent) {
      store.answerQuestion(q.id, '(not delivered — customer has DMs closed)');
      return interaction.reply(ephemeral(`❌ Couldn't DM <@${order.customerId}> — their DMs are closed.`, {}, { color: COLORS.danger }));
    }
    return interaction.reply(ephemeral(`📨 Question sent to <@${order.customerId}>! Their answer will be posted under this order and you'll be pinged.`, {}, { color: COLORS.success }));
  }

  // Saves the customer's answer and posts it under the order in the staff channel.
  async function recordAnswer(questionId, text, respond) {
    const result = store.answerQuestion(questionId, text);
    if (result.error) return respond(result.error, COLORS.warning);
    const q = result.question;
    const order = store.getOrder(q.orderId);
    try {
      const channel = await client.channels.fetch(order.staffChannelId ?? config.staffChannelId);
      const replyTo = order.staffMessageId ? { messageReference: order.staffMessageId, failIfNotExists: false } : undefined;
      await channel.send({ content: `<@${q.askerId}>`, allowedMentions: { users: [q.askerId] }, embeds: [answerEmbed(order, q)], reply: replyTo });
    } catch (err) {
      console.error(`Could not post answer for order #${q.orderId}:`, err.message);
    }
    return respond(`✅ Thanks! Your answer has been sent to the orderer for order **#${q.orderId}**.`, COLORS.success);
  }

  async function handleQuestion(interaction) {
    const [, action, id] = interaction.customId.split(':');
    const q = store.getQuestion(Number(id));
    if (!q) return interaction.reply(ephemeral('That question no longer exists.'));
    if (interaction.user.id !== q.customerId) return interaction.reply(ephemeral('Only the customer can answer this.', {}, { color: COLORS.danger }));
    if (action === 'answer') {
      if (q.answer) return interaction.reply(ephemeral('You\'ve already answered that question. 👍'));
      return interaction.showModal(answerModal(q));
    }
    if (action === 'submit') {
      return recordAnswer(q.id, interaction.fields.getTextInputValue('answer').trim(), (text, color) => interaction.reply(ephemeral(text, {}, { color })));
    }
  }

  // --- staff channel: accept (after a quick captcha) ---

  function newCaptcha(orderId, userId, note = '') {
    const choices = [...CAPTCHA_EMOJIS].sort(() => Math.random() - 0.5).slice(0, 4);
    const answer = choices[randomInt(choices.length)];
    const token = randomBytes(6).toString('hex');
    captchas.set(token, { orderId, userId, choices, answer, expiresAt: Date.now() + CAPTCHA_MS });
    for (const [t, c] of captchas) if (Date.now() > c.expiresAt) captchas.delete(t);
    return captchaView({ orderId, token, choices, answer, note });
  }

  function startAccept(interaction, id) {
    if (!isOrderer(interaction.member, config)) {
      return interaction.reply(ephemeral(`Only members with the <@&${config.ordererRoleId}> role can accept orders.`, {}, { color: COLORS.danger }));
    }
    const order = store.getOrder(id);
    if (!order || order.status !== 'pending') return interaction.reply(ephemeral(order ? `Order #${id} is already ${order.status}.` : 'That order no longer exists.'));
    if (order.customerId === interaction.user.id) return interaction.reply(ephemeral('You can\'t accept your own order.'));
    return interaction.reply({ ...newCaptcha(id, interaction.user.id), flags: MessageFlags.Ephemeral });
  }

  function solveCaptcha(interaction, token, choice) {
    const c = captchas.get(token);
    captchas.delete(token);
    if (!c || c.userId !== interaction.user.id || Date.now() > c.expiresAt) {
      return interaction.update(say('⏰ That check expired. Press **Accept order** again.', { components: [] }));
    }
    if (c.choices[choice] !== c.answer) return interaction.update(newCaptcha(c.orderId, c.userId, '❌ Not that one — try again!\n'));
    return accept(interaction, c.orderId);
  }

  // Trial orderers always have a full orderer in the ticket with them.
  async function pingSupervisor(ticket, order) {
    if (!order.trial) return;
    await ticket.send({
      content: `<@&${config.ordererRoleId}>`,
      allowedMentions: { roles: [config.ordererRoleId] },
      ...say(`🎓 <@${order.ordererId}> is a **trial orderer**. An orderer needs to join this ticket to supervise. 👀`, {}, { title: '🎓 Supervisor needed' }),
    });
  }

  // `interaction` is the captcha button on the private accept prompt.
  async function accept(interaction, id) {
    const result = store.accept(id, interaction.user.id);
    if (result.error) return interaction.update(say(result.error, { components: [] }, { color: COLORS.danger }));
    await interaction.update(say(`⏳ Accepting order **#${id}**…`, { components: [] }));
    let order = store.updateOrder(id, { trial: isTrial(interaction.member, config) });
    const fail = async (text) => {
      store.unaccept(id);
      await refreshStaffMessage(store.getOrder(id));
      return interaction.editReply(say(text, {}, { color: COLORS.danger }));
    };

    // A forfeited order already has a ticket: the new orderer joins it.
    if (order.ticketChannelId) {
      try {
        const ticket = await client.channels.fetch(order.ticketChannelId);
        await ticket.permissionOverwrites.edit(
          interaction.user.id,
          { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true },
          { type: OverwriteType.Member },
        );
        renameChannel(client, order.ticketChannelId, orderTicketName(order));
        await refreshTicketMessage(order);
        await ticket.send({
          content: `<@${order.customerId}>`,
          ...say(`🧑‍🍳 <@${interaction.user.id}> has taken over your order and will look after you from here! 🙌`, {}, { title: '🔁 New orderer', color: COLORS.success }),
        });
        await pingSupervisor(ticket, order);
      } catch (err) {
        console.error(`Could not hand over the ticket for order #${id}:`, err.message);
        return fail('❌ Could not open the existing ticket for this order. The order is back in the queue.');
      }
      await refreshStaffMessage(order);
      trials?.refresh();
      dm(client, order.customerId, `🧑‍🍳 A new orderer has taken over your **${label(order)}**! 👉 ${channelUrl(config.guildId, order.ticketChannelId)}`);
      return interaction.editReply(say(`🎫 You've taken over <#${order.ticketChannelId}>.`, {}, { color: COLORS.success }));
    }

    let ticket;
    try {
      ticket = await createTicketChannel(interaction.guild, {
        name: orderTicketName(order),
        parent: config.ticketCategoryId,
        memberIds: [order.customerId, interaction.user.id],
        roleIds: [config.ordererRoleId],
      });
      const panelMessage = await ticket.send({
        content: `<@${order.customerId}> <@${interaction.user.id}>`,
        embeds: [ticketWelcome(order), orderEmbed(order)],
        files: hasScreenshot(order) ? [screenshotFile(order)] : [],
        components: ticketButtons(order),
      });
      order = store.updateOrder(order.id, { ticketChannelId: ticket.id, ticketMessageId: panelMessage.id });
      await pingSupervisor(ticket, order);
    } catch (err) {
      console.error(`Could not create ticket for order #${id}:`, err.message);
      if (ticket) await deleteChannel(client, ticket.id, 'Ticket setup failed');
      return fail('❌ Could not create the ticket channel (check the bot\'s permissions and that the customer is still in the server). The order is back in the queue.');
    }

    await refreshStaffMessage(order);
    trials?.refresh();
    dm(client, order.customerId, `🎉 Your **${label(order)}** was accepted! Head to your ticket 👉 ${channelUrl(config.guildId, ticket.id)}`);
    return interaction.editReply(say(`🎫 Ticket created: <#${ticket.id}>`, {}, { color: COLORS.success }));
  }

  // --- ticket panel: forfeit / complete / close / delete ---

  async function forfeit(interaction, id) {
    const result = store.forfeit(id, interaction.user.id, isAdmin(interaction));
    if (result.error) return interaction.reply(ephemeral(result.error, {}, { color: COLORS.danger }));
    let order = result.order;
    const by = order.forfeitedBy.at(-1);
    await interaction.update({ embeds: [orderEmbed(order)], components: ticketButtons(order) });
    renameChannel(client, order.ticketChannelId, orderTicketName(order));
    await interaction.channel.send({
      content: `<@${order.customerId}>`,
      ...say(`🔁 <@${by}> can no longer handle this order. We're finding a new orderer for you — hang tight! 🙏`, {}, { title: '🔁 Order forfeited', color: COLORS.warning }),
    });

    // Replace the old staff post with a fresh one so everyone gets pinged again.
    const old = { channelId: order.staffChannelId, messageId: order.staffMessageId };
    try {
      order = await postToStaff(order, `🔁 **${label(order)}** was forfeited by <@${by}> — can someone else take it? 🙏`);
      const channel = await client.channels.fetch(old.channelId);
      await channel.messages.delete(old.messageId).catch(() => {});
    } catch (err) {
      console.error(`Could not repost forfeited order #${id}:`, err.message);
      await refreshStaffMessage(order);
    }
    dm(client, order.customerId, `🔁 Your orderer had to step away from **${label(order)}**. We're finding someone new — you'll be updated in your ticket. 🙏`);
  }

  async function complete(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can complete orders.', {}, { color: COLORS.danger }));
    const closeAt = new Date(Date.now() + config.autoDeleteHours * 60 * 60 * 1000);
    const result = store.complete(id, closeAt);
    if (result.error) return interaction.reply(ephemeral(result.error, {}, { color: COLORS.danger }));
    const order = result.order;
    await ack(interaction);
    await refreshTicketMessage(order);
    renameChannel(client, order.ticketChannelId, orderTicketName(order));
    await sendToTicket(
      order,
      say(
        `🧑‍🍳 Completed by <@${interaction.user.id}>!\n⏳ This ticket will be deleted automatically <t:${Math.floor(closeAt / 1000)}:R>. A transcript is saved.\n📌 Need it longer? Press **Keep ticket open**.`,
        {},
        { title: '🎉 Order completed', color: COLORS.success },
      ),
    );
    await refreshStaffMessage(order);
    if (order.trial) trials?.refresh();
    if (config.completedChannelId) {
      client.channels
        .fetch(config.completedChannelId)
        .then((channel) => channel.send({ embeds: [completedEmbed(order)], allowedMentions: { parse: [] } }))
        .catch((err) => console.error('Could not post to the completed orders channel:', err.message));
    }
    const vouchHint = config.vouchChannelId ? `\n⭐ Happy with it? Leave a vouch in <#${config.vouchChannelId}>!` : '';
    dm(client, order.customerId, `🟢 Your **${label(order)}** has been completed! Enjoy 😋${vouchHint}`);
    await done(interaction, `✅ Order #${order.id} completed.`);
  }

  async function keepOpen(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can do this.', {}, { color: COLORS.danger }));
    const result = store.keepOpen(id);
    if (result.error) return interaction.reply(ephemeral(result.error));
    await ack(interaction);
    await refreshTicketMessage(result.order);
    await refreshStaffMessage(result.order);
    await sendToTicket(result.order, say(`📌 <@${interaction.user.id}> is keeping this ticket open, so it **won't be deleted automatically**.\nClose or delete it when you're done.`, {}, { title: '📌 Ticket kept open' }));
    await done(interaction, '📌 This ticket will stay open.');
  }

  function askCancel(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can cancel orders. Ask in the ticket if you need to cancel.', {}, { color: COLORS.danger }));
    return interaction.showModal(cancelOrderModal(id));
  }

  // Cancels the order, tells the customer, and deletes the ticket after saving its transcript.
  async function cancelOrder(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can cancel orders.', {}, { color: COLORS.danger }));
    const reason = interaction.fields.getTextInputValue('reason').trim() || null;
    const result = store.staffCancel(id, interaction.user.id, reason);
    if (result.error) return interaction.reply(ephemeral(result.error, {}, { color: COLORS.danger }));
    const order = result.order;
    const reasonLine = reason ? `\n📝 **Reason:** ${reason}` : '';
    await interaction.reply({
      content: `<@${order.customerId}>`,
      ...say(`❌ This order was cancelled by <@${interaction.user.id}>.${reasonLine}\n🗑️ This ticket will be deleted in 10 seconds. A transcript is saved.`, {}, { title: '❌ Order cancelled' }),
    });
    await refreshStaffMessage(order);
    if (order.trial) trials?.refresh();
    dm(client, order.customerId, `❌ Your **${label(order)}** was cancelled.${reasonLine}`);
    const channelId = order.ticketChannelId;
    await Promise.all([transcripts.saveChannel(channelId), new Promise((resolve) => setTimeout(resolve, CANCEL_DELETE_MS))]);
    await deleteChannel(client, channelId, `Order cancelled by ${interaction.user.tag}`);
  }

  async function close(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can close order tickets.', {}, { color: COLORS.danger }));
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    if (order.status === 'closed') return interaction.reply(ephemeral('🔒 This ticket is already closed.'));
    await ack(interaction);
    const result = await closeTicket(order, `🔒 Ticket closed by <@${interaction.user.id}>.`);
    if (result.error) return interaction.followUp(ephemeral(result.error, {}, { color: COLORS.danger }));
    await done(interaction, '🔒 Ticket closed.');
  }

  async function remove(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can delete tickets.', {}, { color: COLORS.danger }));
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    await interaction.reply(say(`🗑️ Deleting this ticket in 5 seconds… (by <@${interaction.user.id}>)\n📜 A transcript is being saved.`, {}, { color: COLORS.danger }));
    const channelId = order.ticketChannelId;
    await Promise.all([transcripts.saveChannel(channelId), new Promise((resolve) => setTimeout(resolve, 5000))]);
    await deleteChannel(client, channelId, `Deleted by ${interaction.user.tag}`);
  }

  // A ticket channel was deleted (Delete ticket, by hand, or while the bot was
  // offline), so its order no longer counts as open.
  function ticketDeleted(channelId) {
    const order = store.orderByTicket(channelId);
    if (!order) return;
    return refreshStaffMessage(store.ticketDeleted(order.id));
  }

  // On startup: catch up on ticket channels deleted while the bot was offline.
  async function sweepDeletedTickets(guild) {
    for (const order of store.ordersWithTickets()) {
      const gone = await guild.channels.fetch(order.ticketChannelId).then(() => false, (err) => err.code === 10003); // Unknown Channel
      if (gone) await ticketDeleted(order.ticketChannelId);
    }
  }

  // Runs every minute: saves a transcript of, then deletes, tickets whose
  // auto-delete time has passed. If the channel can't be deleted it's locked instead.
  async function autoClose() {
    for (const order of store.dueForClose()) {
      const channelId = order.ticketChannelId;
      await transcripts.saveChannel(channelId);
      if (await deleteChannel(client, channelId, `Auto-deleted ${config.autoDeleteHours}h after the order was completed`)) {
        await ticketDeleted(channelId); // in case the channel-delete event is missed
        dm(client, order.customerId, `🗑️ Your ticket for **${label(order)}** has been closed. Thanks for ordering with us! 💛`);
      } else {
        await closeTicket(order, '🔒 Ticket auto-closed (I couldn\'t delete it — check I have **Manage Channels**).');
      }
    }
  }

  async function handleComponent(interaction) {
    const [, action, a, b, c] = interaction.customId.split(':');
    switch (action) {
      case 'service': return pickService(interaction);
      case 'promo': return pickPromo(interaction, a);
      case 'vc': return pickVc(interaction, a, b, c);
      case 'details': return submitDetails(interaction, a, b, c);
      case 'accept': return startAccept(interaction, Number(a));
      case 'captcha': return solveCaptcha(interaction, a, Number(b));
      case 'ask': return askQuestion(interaction, Number(a));
      case 'askq': return sendQuestion(interaction, Number(a));
      // Older order posts may still show a Decline button; declining was removed.
      case 'decline': return interaction.reply(ephemeral('Declining orders has been removed — accept it, or ask the customer to `/cancel` it.'));
      case 'forfeit': return forfeit(interaction, Number(a));
      case 'complete': return complete(interaction, Number(a));
      case 'keepopen': return keepOpen(interaction, Number(a));
      case 'cancel': return askCancel(interaction, Number(a));
      case 'cancelsubmit': return cancelOrder(interaction, Number(a));
      case 'close': return close(interaction, Number(a));
      case 'delete': return remove(interaction, Number(a));
    }
  }

  return { handleComponent, handleDm, handleQuestion, autoClose, ticketDeleted, sweepDeletedTickets, complete, close, remove, label };
}

import fs from 'node:fs';
import path from 'node:path';
import { MessageFlags, OverwriteType } from 'discord.js';
import { SERVICES } from './services.js';
import {
  COLORS,
  createTicketChannel,
  deleteChannel,
  dm,
  editMessage,
  ephemeral,
  hasRole,
  isAdmin,
  lockTicket,
  panel,
  renameChannel,
  say,
} from './util.js';
import {
  answerEmbed,
  answerModal,
  askQuestionModal,
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
export function createOrderHandlers({ client, config, store, promos, transcripts }) {
  // Members who finished the questions and still owe us a screenshot, by user ID.
  const awaitingScreenshot = new Map();

  const isStaff = (interaction) => hasRole(interaction.member, config.ordererRoleId) || isAdmin(interaction);
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

  // Posts the order in the staff channel, pinging whoever is online for that
  // service (or the whole orderer role if nobody is).
  async function postToStaff(order, headline) {
    const online = (store.onlineByService()[order.service] ?? []).filter((id) => id !== order.customerId);
    const pings = online.length ? online.map((id) => `<@${id}>`).join(' ') : `<@&${config.ordererRoleId}>`;
    const channel = await client.channels.fetch(config.staffChannelId);
    const message = await channel.send({
      content: pings,
      allowedMentions: online.length ? { users: online } : { roles: [config.ordererRoleId] },
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
    awaitingScreenshot.set(interaction.user.id, {
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
    return interaction.update(say('📬 **Check your DMs!** Send your order screenshot there to finish your order. 📸', { components: [] }, { color: COLORS.success }));
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
        ].join('\n'),
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

  // --- staff channel: accept ---

  async function accept(interaction, id) {
    if (!hasRole(interaction.member, config.ordererRoleId)) {
      return interaction.reply(ephemeral(`Only members with the <@&${config.ordererRoleId}> role can accept orders.`, {}, { color: COLORS.danger }));
    }
    const result = store.accept(id, interaction.user.id);
    if (result.error) return interaction.reply(ephemeral(result.error, {}, { color: COLORS.danger }));
    await interaction.deferUpdate();
    let order = result.order;

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
      } catch (err) {
        console.error(`Could not hand over the ticket for order #${id}:`, err.message);
        store.unaccept(id);
        return interaction.followUp(ephemeral('❌ Could not open the existing ticket for this order. The order is back in the queue.', {}, { color: COLORS.danger }));
      }
      await interaction.editReply({ embeds: [orderEmbed(order)], components: staffButtons(order, config.guildId) });
      dm(client, order.customerId, `🧑‍🍳 A new orderer has taken over your **${label(order)}**! 👉 ${channelUrl(config.guildId, order.ticketChannelId)}`);
      return interaction.followUp(ephemeral(`🎫 You've taken over <#${order.ticketChannelId}>.`, {}, { color: COLORS.success }));
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
    } catch (err) {
      console.error(`Could not create ticket for order #${id}:`, err.message);
      if (ticket) await deleteChannel(client, ticket.id, 'Ticket setup failed');
      store.unaccept(id);
      return interaction.followUp(
        ephemeral('❌ Could not create the ticket channel (check the bot\'s permissions and that the customer is still in the server). The order is back in the queue.', {}, {
          color: COLORS.danger,
        }),
      );
    }

    await interaction.editReply({ embeds: [orderEmbed(order)], components: staffButtons(order, config.guildId) });
    dm(client, order.customerId, `🎉 Your **${label(order)}** was accepted! Head to your ticket 👉 ${channelUrl(config.guildId, ticket.id)}`);
    return interaction.followUp(ephemeral(`🎫 Ticket created: <#${ticket.id}>`, {}, { color: COLORS.success }));
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
    await interaction.update({ embeds: [orderEmbed(order)], components: ticketButtons(order) });
    renameChannel(client, order.ticketChannelId, orderTicketName(order));
    await interaction.channel.send(
      say(`🧑‍🍳 Completed by <@${interaction.user.id}>!\n⏳ This ticket will be deleted automatically <t:${Math.floor(closeAt / 1000)}:R>. A transcript is saved.`, {}, {
        title: '🎉 Order completed',
        color: COLORS.success,
      }),
    );
    await refreshStaffMessage(order);
    if (config.completedChannelId) {
      client.channels
        .fetch(config.completedChannelId)
        .then((channel) => channel.send({ embeds: [completedEmbed(order)], allowedMentions: { parse: [] } }))
        .catch((err) => console.error('Could not post to the completed orders channel:', err.message));
    }
    const vouchHint = config.vouchChannelId ? `\n⭐ Happy with it? Leave a vouch in <#${config.vouchChannelId}>!` : '';
    dm(client, order.customerId, `🟢 Your **${label(order)}** has been completed! Enjoy 😋${vouchHint}`);
  }

  async function close(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can close order tickets.', {}, { color: COLORS.danger }));
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    if (order.status === 'closed') return interaction.reply(ephemeral('🔒 This ticket is already closed.'));
    await interaction.deferUpdate();
    const result = await closeTicket(order, `🔒 Ticket closed by <@${interaction.user.id}>.`);
    if (result.error) return interaction.followUp(ephemeral(result.error, {}, { color: COLORS.danger }));
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
      case 'accept': return accept(interaction, Number(a));
      case 'ask': return askQuestion(interaction, Number(a));
      case 'askq': return sendQuestion(interaction, Number(a));
      // Older order posts may still show a Decline button; declining was removed.
      case 'decline': return interaction.reply(ephemeral('Declining orders has been removed — accept it, or ask the customer to `/cancel` it.'));
      case 'forfeit': return forfeit(interaction, Number(a));
      case 'complete': return complete(interaction, Number(a));
      case 'close': return close(interaction, Number(a));
      case 'delete': return remove(interaction, Number(a));
    }
  }

  return { handleComponent, handleDm, handleQuestion, autoClose, ticketDeleted, sweepDeletedTickets };
}

import fs from 'node:fs';
import { MessageFlags } from 'discord.js';
import path from 'node:path';
import { SERVICES } from './services.js';
import { createTicketChannel, deleteChannel, dm, editMessage, ephemeral, hasRole, isAdmin, lockTicket, renameChannel } from './util.js';
import {
  channelUrl,
  detailsModal,
  orderEmbed,
  orderTicketName,
  promoPicker,
  staffButtons,
  ticketButtons,
  completedEmbed,
  ticketWelcome,
  vcPicker,
} from './views.js';

const SCREENSHOT_WAIT_MS = 15 * 60 * 1000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

// Order flow: company -> promo -> VC yes/no -> address form -> screenshot in DMs -> staff channel
// -> Accept creates a ticket -> Complete order -> ticket auto-closes (locks) -> staff delete it.
export function createOrderHandlers({ client, config, store, promos }) {
  // Members who finished the questions and still owe us a screenshot, by user ID.
  const awaitingScreenshot = new Map();

  const isStaff = (interaction) => hasRole(interaction.member, config.ordererRoleId) || isAdmin(interaction);
  const label = (order) => `${SERVICES[order.service].label} order #${order.id}`;

  const screenshotFile = (order) => ({ attachment: order.screenshot, name: `order-${order.id}${path.extname(order.screenshot)}` });

  const refreshStaffMessage = (order) =>
    editMessage(client, order.staffChannelId, order.staffMessageId, {
      embeds: [orderEmbed(order)],
      components: staffButtons(order, config.guildId),
    });

  const refreshTicketMessage = (order) =>
    editMessage(client, order.ticketChannelId, order.ticketMessageId, { embeds: [orderEmbed(order)], components: ticketButtons(order) });

  // Locks the ticket: the customer loses access, staff keep it until they delete it.
  async function closeTicket(order, note) {
    const result = store.close(order.id);
    if (result.error) return result;
    const closed = result.order;
    await lockTicket(client, closed.ticketChannelId, closed.customerId);
    renameChannel(client, closed.ticketChannelId, orderTicketName(closed));
    await refreshTicketMessage(closed);
    await refreshStaffMessage(closed);
    try {
      const channel = await client.channels.fetch(closed.ticketChannelId);
      await channel.send({ content: `${note}
🗑️ Staff can delete this ticket when they're done.`, components: ticketButtons(closed) });
    } catch (err) {
      console.error(`Could not post close message for order #${closed.id}:`, err.message);
    }
    dm(client, closed.customerId, `🔒 Your ticket for ${label(closed)} has been closed. Thanks for ordering with us! 💛`);
    return result;
  }

  // --- steps 1-3: questions in the submit-orders channel ---

  async function pickService(interaction) {
    const serviceKey = interaction.values[0];
    if (config.verifiedRoleId && !hasRole(interaction.member, config.verifiedRoleId)) {
      return interaction.reply(ephemeral(`🔐 You need to verify first! Get the <@&${config.verifiedRoleId}> role, then come back. ✅`));
    }
    const open = store.openOrdersFor(interaction.user.id);
    if (open.length >= config.maxOpenOrders) {
      return interaction.reply(ephemeral(`⛔ You already have **${open.length}** open order(s) (${open.map((o) => `#${o.id}`).join(', ')}). Please wait for them to finish first. ⏳`));
    }
    return interaction.reply({ ...promoPicker(serviceKey, promos[serviceKey]), flags: MessageFlags.Ephemeral });
  }

  function pickPromo(interaction, serviceKey) {
    return interaction.update(vcPicker(serviceKey, interaction.values[0]));
  }

  function pickVc(interaction, serviceKey, promoValue, answer) {
    return interaction.showModal(detailsModal(serviceKey, promoValue, answer));
  }

  async function submitDetails(interaction, serviceKey, promoValue, answer) {
    const promo = promos[serviceKey][Number(promoValue)] ?? null;
    const details = Object.fromEntries(SERVICES[serviceKey].fields.map((f) => [f.id, interaction.fields.getTextInputValue(f.id)]));
    awaitingScreenshot.set(interaction.user.id, {
      service: serviceKey,
      promo,
      vc: answer === 'yes',
      details,
      expiresAt: Date.now() + SCREENSHOT_WAIT_MS,
    });

    const sent = await dm(
      client,
      interaction.user.id,
      [
        `${SERVICES[serviceKey].emoji} **${SERVICES[serviceKey].label}** order — almost done! 🙌`,
        '',
        '**Step 5/5** — 📸 Send your **order screenshot** here as an image.',
        '⏳ You have **15 minutes**.',
      ].join('\n'),
    );
    if (!sent) {
      awaitingScreenshot.delete(interaction.user.id);
      return interaction.update({
        content: '❌ I couldn\'t DM you! Turn on **Direct Messages** for this server (click the server name → **Privacy Settings**) and start again. 🔄',
        components: [],
      });
    }
    return interaction.update({ content: '📬 **Check your DMs!** Send your order screenshot there to finish your order. 📸', components: [] });
  }

  // --- step 4: screenshot arrives in DMs ---

  async function handleDm(message) {
    const pending = awaitingScreenshot.get(message.author.id);
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      awaitingScreenshot.delete(message.author.id);
      return message.reply('⏰ That took too long! Please start a new order from the order channel. 🔄');
    }
    const image = message.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (!image) return message.reply('🖼️ Please send your order screenshot as an **image**.');
    if (image.size > MAX_SCREENSHOT_BYTES) return message.reply('📏 That image is too big (max 10 MB). Please send a smaller screenshot.');
    awaitingScreenshot.delete(message.author.id); // before any await, so a double-send can't create two orders

    const order = store.createOrder({ ...pending, customerId: message.author.id });
    try {
      const res = await fetch(image.url);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      fs.mkdirSync(config.screenshotDir, { recursive: true });
      const file = path.join(config.screenshotDir, `order-${order.id}${path.extname(image.name) || '.png'}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      store.updateOrder(order.id, { screenshot: file });

      const channel = await client.channels.fetch(config.staffChannelId);
      const staffMessage = await channel.send({
        content: `🔔 <@&${config.ordererRoleId}> new ${SERVICES[order.service].emoji} **${label(order)}** waiting!`,
        allowedMentions: { roles: [config.ordererRoleId] },
        embeds: [orderEmbed(order)],
        files: [screenshotFile(order)],
        components: staffButtons(order, config.guildId),
      });
      store.updateOrder(order.id, { staffChannelId: channel.id, staffMessageId: staffMessage.id });
    } catch (err) {
      console.error(`Could not submit order #${order.id}:`, err.message);
      store.updateOrder(order.id, { status: 'cancelled' });
      return message.reply('😔 Sorry, your order could not be submitted. Please open a support ticket.');
    }
    return message.reply(
      [
        `✅ **Order received!** Your order number is **#${order.id}** 🧾`,
        '👀 Our staff have been notified. When someone accepts it you\'ll be added to a private ticket. 🎫',
        '📦 Check its status any time with `/myorders`.',
      ].join('\n'),
    );
  }

  // --- staff channel: accept ---

  async function accept(interaction, id) {
    if (!hasRole(interaction.member, config.ordererRoleId)) {
      return interaction.reply(ephemeral(`Only members with the <@&${config.ordererRoleId}> role can accept orders.`));
    }
    const result = store.accept(id, interaction.user.id);
    if (result.error) return interaction.reply(ephemeral(result.error));
    await interaction.deferUpdate();

    let order = result.order;
    let ticket;
    try {
      ticket = await createTicketChannel(interaction.guild, {
        name: orderTicketName(order),
        parent: config.ticketCategoryId,
        memberIds: [order.customerId, interaction.user.id],
        roleIds: [config.ordererRoleId],
      });
      const panelMessage = await ticket.send({
        content: ticketWelcome(order),
        embeds: [orderEmbed(order)],
        files: order.screenshot && fs.existsSync(order.screenshot) ? [screenshotFile(order)] : [],
        components: ticketButtons(order),
      });
      order = store.updateOrder(order.id, { ticketChannelId: ticket.id, ticketMessageId: panelMessage.id });
    } catch (err) {
      console.error(`Could not create ticket for order #${id}:`, err.message);
      if (ticket) await deleteChannel(client, ticket.id, 'Ticket setup failed');
      store.unaccept(id);
      return interaction.followUp(ephemeral('❌ Could not create the ticket channel (check the bot\'s permissions and that the customer is still in the server). The order is back in the queue.'));
    }

    await interaction.editReply({ embeds: [orderEmbed(order)], components: staffButtons(order, config.guildId) });
    dm(client, order.customerId, `🎉 Your **${label(order)}** was accepted! Head to your ticket 👉 ${channelUrl(config.guildId, ticket.id)}`);
    return interaction.followUp(ephemeral(`🎫 Ticket created: <#${ticket.id}>`));
  }

  // --- ticket panel: complete / close / delete ---

  async function complete(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can complete orders.'));
    const closeAt = new Date(Date.now() + config.autoCloseHours * 60 * 60 * 1000);
    const result = store.complete(id, closeAt);
    if (result.error) return interaction.reply(ephemeral(result.error));
    const order = result.order;
    await interaction.update({ embeds: [orderEmbed(order)], components: ticketButtons(order) });
    renameChannel(client, order.ticketChannelId, orderTicketName(order));
    await interaction.channel.send(
      `🎉 **Order completed** by <@${interaction.user.id}>!\n⏳ This ticket will close automatically <t:${Math.floor(closeAt / 1000)}:R>.`,
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
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can close order tickets.'));
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    if (order.status === 'closed') return interaction.reply(ephemeral('🔒 This ticket is already closed.'));
    await interaction.deferUpdate();
    const result = await closeTicket(order, `🔒 Ticket closed by <@${interaction.user.id}>.`);
    if (result.error) return interaction.followUp(ephemeral(result.error));
  }

  async function remove(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can delete tickets.'));
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    if (['accepted', 'completed'].includes(order.status)) await refreshStaffMessage(store.close(id).order);
    await interaction.reply(`🗑️ Deleting this ticket in 5 seconds… (by <@${interaction.user.id}>)`);
    setTimeout(() => deleteChannel(client, order.ticketChannelId, `Deleted by ${interaction.user.tag}`), 5000);
  }

  // Runs every minute: closes tickets whose auto-close time has passed.
  async function autoClose() {
    for (const order of store.dueForClose()) await closeTicket(order, `🔒 Ticket auto-closed ${config.autoCloseHours}h after the order was completed.`);
  }

  async function handleComponent(interaction) {
    const [, action, a, b, c] = interaction.customId.split(':');
    switch (action) {
      case 'service': return pickService(interaction);
      case 'promo': return pickPromo(interaction, a);
      case 'vc': return pickVc(interaction, a, b, c);
      case 'details': return submitDetails(interaction, a, b, c);
      case 'accept': return accept(interaction, Number(a));
      // Older order posts may still show a Decline button; declining was removed.
      case 'decline': return interaction.reply(ephemeral('Declining orders has been removed — accept it, or ask the customer to `/cancel` it.'));
      case 'complete': return complete(interaction, Number(a));
      case 'close': return close(interaction, Number(a));
      case 'delete': return remove(interaction, Number(a));
    }
  }

  return { handleComponent, handleDm, autoClose };
}

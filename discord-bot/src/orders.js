import fs from 'node:fs';
import { MessageFlags } from 'discord.js';
import path from 'node:path';
import { SERVICES } from './services.js';
import { createTicketChannel, deleteChannel, dm, editMessage, ephemeral, hasRole, isAdmin, pad } from './util.js';
import { channelUrl, orderEmbed, promoPicker, staffButtons, ticketButtons, vcPicker } from './views.js';

const SCREENSHOT_WAIT_MS = 15 * 60 * 1000;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

// Order flow: company -> promo -> VC yes/no -> screenshot in DMs -> staff channel
// -> Accept creates a ticket -> Complete order -> ticket auto-closes.
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

  async function closeTicket(order, reason) {
    const result = store.close(order.id);
    if (result.error) return result;
    await refreshStaffMessage(result.order);
    await deleteChannel(client, order.ticketChannelId, reason);
    return result;
  }

  // --- steps 1-3: questions in the submit-orders channel ---

  async function pickService(interaction) {
    const serviceKey = interaction.values[0];
    const open = store.openOrdersFor(interaction.user.id);
    if (open.length >= config.maxOpenOrders) {
      return interaction.reply(ephemeral(`You already have ${open.length} open order(s) (${open.map((o) => `#${o.id}`).join(', ')}). Wait for them to finish first.`));
    }
    return interaction.reply({ ...promoPicker(serviceKey, promos[serviceKey]), flags: MessageFlags.Ephemeral });
  }

  function pickPromo(interaction, serviceKey) {
    return interaction.update(vcPicker(serviceKey, interaction.values[0]));
  }

  async function pickVc(interaction, serviceKey, promoValue, answer) {
    const promo = promoValue === 'none' ? null : (promos[serviceKey][Number(promoValue)] ?? null);
    awaitingScreenshot.set(interaction.user.id, { service: serviceKey, promo, vc: answer === 'yes', expiresAt: Date.now() + SCREENSHOT_WAIT_MS });

    const sent = await dm(
      client,
      interaction.user.id,
      `📸 **${SERVICES[serviceKey].label}** — please send your **order screenshot** here as an image within 15 minutes.`,
    );
    if (!sent) {
      awaitingScreenshot.delete(interaction.user.id);
      return interaction.update({
        content: '❌ I couldn\'t DM you. Turn on **Direct Messages** for this server (Server name → Privacy Settings) and start again.',
        components: [],
      });
    }
    return interaction.update({ content: '✅ Check your DMs and send your order screenshot there.', components: [] });
  }

  // --- step 4: screenshot arrives in DMs ---

  async function handleDm(message) {
    const pending = awaitingScreenshot.get(message.author.id);
    if (!pending) return;
    if (Date.now() > pending.expiresAt) {
      awaitingScreenshot.delete(message.author.id);
      return message.reply('⏰ That took too long — please start a new order from the submit-orders channel.');
    }
    const image = message.attachments.find((a) => a.contentType?.startsWith('image/'));
    if (!image) return message.reply('Please send your order screenshot as an **image**.');
    if (image.size > MAX_SCREENSHOT_BYTES) return message.reply('That image is too big (max 10 MB). Please send a smaller screenshot.');
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
        content: `<@&${config.ordererRoleId}> new ${label(order)}`,
        allowedMentions: { roles: [config.ordererRoleId] },
        embeds: [orderEmbed(order)],
        files: [screenshotFile(order)],
        components: staffButtons(order, config.guildId),
      });
      store.updateOrder(order.id, { staffChannelId: channel.id, staffMessageId: staffMessage.id });
    } catch (err) {
      console.error(`Could not submit order #${order.id}:`, err.message);
      store.updateOrder(order.id, { status: 'cancelled' });
      return message.reply('Sorry, your order could not be submitted. Please open a support ticket.');
    }
    return message.reply(`✅ Got it! Your ${label(order)} has been sent to staff. You'll be added to a ticket when someone accepts it.`);
  }

  // --- staff channel: accept / decline ---

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
        name: `order-${pad(order.id)}`,
        parent: config.ticketCategoryId,
        memberIds: [order.customerId, interaction.user.id],
        roleIds: [config.ordererRoleId],
      });
      const panelMessage = await ticket.send({
        content: `<@${order.customerId}> your order has been accepted by <@${interaction.user.id}>.`,
        embeds: [orderEmbed(order)],
        files: order.screenshot && fs.existsSync(order.screenshot) ? [screenshotFile(order)] : [],
        components: ticketButtons(order),
      });
      order = store.updateOrder(order.id, { ticketChannelId: ticket.id, ticketMessageId: panelMessage.id });
    } catch (err) {
      console.error(`Could not create ticket for order #${id}:`, err.message);
      if (ticket) await deleteChannel(client, ticket.id, 'Ticket setup failed');
      store.unaccept(id);
      return interaction.followUp(ephemeral('Could not create the ticket channel (check the bot\'s permissions and that the customer is still in the server). The order is back in the queue.'));
    }

    await interaction.editReply({ embeds: [orderEmbed(order)], components: staffButtons(order, config.guildId) });
    dm(client, order.customerId, `✅ Your ${label(order)} was accepted! Head to your ticket: ${channelUrl(config.guildId, ticket.id)}`);
    return interaction.followUp(ephemeral(`Ticket created: <#${ticket.id}>`));
  }

  async function decline(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can decline orders.'));
    const result = store.decline(id);
    if (result.error) return interaction.reply(ephemeral(result.error));
    dm(client, result.order.customerId, `🔴 Your ${label(result.order)} was declined. Open a support ticket if you have questions.`);
    return interaction.update({ embeds: [orderEmbed(result.order)], components: staffButtons(result.order, config.guildId) });
  }

  // --- ticket panel: complete / close ---

  async function complete(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can complete orders.'));
    const closeAt = new Date(Date.now() + config.autoCloseHours * 60 * 60 * 1000);
    const result = store.complete(id, closeAt);
    if (result.error) return interaction.reply(ephemeral(result.error));
    const order = result.order;
    await interaction.update({ embeds: [orderEmbed(order)], components: ticketButtons(order) });
    await interaction.channel.send(
      `✅ Order completed by <@${interaction.user.id}>. This ticket will close automatically <t:${Math.floor(closeAt / 1000)}:R>.`,
    );
    await refreshStaffMessage(order);
    dm(client, order.customerId, `🟢 Your ${label(order)} has been completed. Thanks!`);
  }

  async function close(interaction, id) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can close order tickets.'));
    const order = store.getOrder(id);
    if (!order) return interaction.reply(ephemeral('That order no longer exists.'));
    await interaction.reply('🔒 Closing this ticket…');
    const result = await closeTicket(order, `Closed by ${interaction.user.tag}`);
    if (result.error) return interaction.editReply(result.error);
  }

  // Runs every minute: closes tickets whose auto-close time has passed.
  async function autoClose() {
    for (const order of store.dueForClose()) await closeTicket(order, 'Auto-closed after order completion');
  }

  async function handleComponent(interaction) {
    const [, action, a, b, c] = interaction.customId.split(':');
    switch (action) {
      case 'service': return pickService(interaction);
      case 'promo': return pickPromo(interaction, a);
      case 'vc': return pickVc(interaction, a, b, c);
      case 'accept': return accept(interaction, Number(a));
      case 'decline': return decline(interaction, Number(a));
      case 'complete': return complete(interaction, Number(a));
      case 'close': return close(interaction, Number(a));
    }
  }

  return { handleComponent, handleDm, autoClose };
}

import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { loadConfig, loadPromos } from './config.js';
import { moderationCommands } from './moderation.js';
import { createOrderHandlers } from './orders.js';
import { SERVICES, STATUS } from './services.js';
import { Store } from './store.js';
import { createSupportHandlers } from './support.js';
import { editMessage, ensureTicketCategory, ephemeral } from './util.js';
import { orderEmbed, ordersPanel, staffButtons, supportPanel, verifyPanel } from './views.js';

const config = loadConfig(['DISCORD_TOKEN', 'GUILD_ID', 'STAFF_ORDERS_CHANNEL_ID', 'ORDERER_ROLE_ID']);
const promos = loadPromos();
const store = new Store(config.dataFile);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel], // needed to receive DMs
});

const ctx = { client, config, store, promos };
const orders = createOrderHandlers(ctx);
const support = createSupportHandlers(ctx);

async function handleCommand(interaction) {
  const name = interaction.commandName;
  if (moderationCommands[name]) return moderationCommands[name](interaction);

  switch (name) {
    case 'orderpanel':
    case 'supportpanel':
    case 'verifypanel': {
      if (name === 'verifypanel' && !config.verifyUrl) {
        return interaction.reply(ephemeral('Set `VERIFY_URL` in `.env` to your RestoreCord / VaultCord verify link first, then restart the bot.'));
      }
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      const panel = { orderpanel: () => ordersPanel(promos), supportpanel: supportPanel, verifypanel: () => verifyPanel(config.verifyUrl) }[name]();
      try {
        await channel.send(panel);
      } catch {
        return interaction.reply(ephemeral(`I can't post in ${channel} — give me View Channel, Send Messages and Embed Links there.`));
      }
      return interaction.reply(ephemeral(`✅ Panel posted in ${channel}.`));
    }

    case 'myorders': {
      const list = store.recentOrdersFor(interaction.user.id);
      if (!list.length) return interaction.reply(ephemeral('📭 You have no orders yet.'));
      const lines = list.map((o) => {
        const s = STATUS[o.status];
        const ticket = o.ticketChannelId && ['accepted', 'completed'].includes(o.status) ? ` — <#${o.ticketChannelId}>` : '';
        return `**#${o.id}** ${SERVICES[o.service].emoji} ${SERVICES[o.service].label}: ${s.emoji} ${s.label}${ticket}`;
      });
      return interaction.reply(ephemeral(`📦 **Your recent orders**\n${lines.join('\n')}`));
    }

    case 'cancel': {
      const result = store.cancel(interaction.options.getInteger('id', true), interaction.user.id);
      if (result.error) return interaction.reply(ephemeral(result.error));
      const order = result.order;
      await editMessage(client, order.staffChannelId, order.staffMessageId, {
        embeds: [orderEmbed(order)],
        components: staffButtons(order, config.guildId),
      });
      return interaction.reply(ephemeral(`🗑️ Order #${order.id} cancelled.`));
    }
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
    if (interaction.customId.startsWith('order:')) return await orders.handleComponent(interaction);
    if (interaction.customId.startsWith('support:')) return await support.handleComponent(interaction);
  } catch (err) {
    console.error(err);
    const reply = ephemeral('Something went wrong, please try again.');
    if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || message.guildId) return;
  orders.handleDm(message).catch((err) => console.error('DM handling failed:', err));
});

// If someone deletes a ticket channel by hand, close its order/support ticket too.
client.on(Events.ChannelDelete, (channel) => {
  const order = store.orderByTicket(channel.id);
  if (order) {
    if (['accepted', 'completed'].includes(order.status)) store.close(order.id);
    const gone = store.updateOrder(order.id, { ticketChannelId: null, ticketMessageId: null }); // drops the "Open ticket" link
    editMessage(client, gone.staffChannelId, gone.staffMessageId, { embeds: [orderEmbed(gone)], components: staffButtons(gone, config.guildId) });
  }
  const ticket = store.supportByChannel(channel.id);
  if (ticket?.status === 'open') store.updateSupport(ticket.id, { status: 'closed' });
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    const guild = await c.guilds.fetch(config.guildId);
    config.ticketCategoryId = await ensureTicketCategory(guild, config);
    config.supportCategoryId ||= config.ticketCategoryId;
  } catch (err) {
    console.error('Could not set up the ticket category — tickets will be created outside a category:', err.message);
  }
  const tick = () => orders.autoClose().catch((err) => console.error('Auto-close failed:', err));
  tick(); // catch up on tickets that came due while the bot was offline
  setInterval(tick, 60 * 1000);
});

client.login(config.token);

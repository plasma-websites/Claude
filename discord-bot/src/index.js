import { Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { loadConfig } from './config.js';
import { SERVICES, STATUS } from './services.js';
import { OrderStore } from './store.js';
import { customerButtons, orderButtons, orderEmbed, orderModal, panel } from './views.js';

const config = loadConfig(['DISCORD_TOKEN', 'ORDERS_CHANNEL_ID', 'ORDERER_ROLE_ID']);
const store = new OrderStore(config.dataFile);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const ephemeral = (content, extra = {}) => ({ content, flags: MessageFlags.Ephemeral, ...extra });

function isOrderer(interaction) {
  const roles = interaction.member?.roles;
  // Cached members expose a RoleManager, uncached ones a plain array of IDs.
  return Array.isArray(roles) ? roles.includes(config.ordererRoleId) : Boolean(roles?.cache.has(config.ordererRoleId));
}

const isAdmin = (interaction) => Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));

function dm(userId, content) {
  return client.users.send(userId, content).catch(() => {}); // user may have DMs closed
}

// Keeps the order's message in the orders channel in sync with its status.
async function syncOrderMessage(order) {
  if (!order.messageId) return;
  try {
    const channel = await client.channels.fetch(order.channelId);
    const message = await channel.messages.fetch(order.messageId);
    await message.edit({ embeds: [orderEmbed(order)], components: orderButtons(order) });
  } catch (err) {
    console.error(`Could not update message for order #${order.id}:`, err.message);
  }
}

// Updates the clicked message if it's the order's own message, otherwise
// replies privately and syncs the orders-channel message separately.
async function showUpdate(interaction, order, note) {
  if (interaction.isButton() && interaction.message.id === order.messageId) {
    return interaction.update({ embeds: [orderEmbed(order)], components: orderButtons(order) });
  }
  await syncOrderMessage(order);
  if (interaction.isButton()) return interaction.update({ content: note, embeds: [orderEmbed(order)], components: [] });
  return interaction.reply(ephemeral(note));
}

async function submitOrder(interaction, serviceKey) {
  const service = SERVICES[serviceKey];
  const open = store.openOrdersFor(interaction.user.id);
  if (open.length >= config.maxOpenOrders) {
    return interaction.reply(
      ephemeral(`You already have ${open.length} open order(s) (${open.map((o) => `#${o.id}`).join(', ')}). Wait for them to finish or \`/cancel\` one.`),
    );
  }

  const details = Object.fromEntries(service.fields.map((f) => [f.id, interaction.fields.getTextInputValue(f.id)]));
  const order = store.create({ service: serviceKey, customerId: interaction.user.id, details });

  try {
    const channel = await client.channels.fetch(config.ordersChannelId);
    const message = await channel.send({
      content: `<@&${config.ordererRoleId}> new ${service.label} order`,
      allowedMentions: { roles: [config.ordererRoleId] },
      embeds: [orderEmbed(order)],
      components: orderButtons(order),
    });
    store.setMessage(order.id, channel.id, message.id);
  } catch (err) {
    console.error('Could not post order to the orders channel:', err.message);
    store.cancel(order.id, interaction.user.id, true);
    return interaction.reply(ephemeral('Sorry, your order could not be posted. Please tell a server admin.'));
  }

  return interaction.reply(
    ephemeral(`Order **#${order.id}** submitted! You'll get a DM when an orderer accepts it.`, {
      embeds: [orderEmbed(order)],
      components: customerButtons(order),
    }),
  );
}

async function handleButton(interaction) {
  const [action, arg] = interaction.customId.split(':');

  if (action === 'panel') return interaction.showModal(orderModal(arg));

  const id = Number(arg);
  const admin = isAdmin(interaction);
  let result;

  switch (action) {
    case 'accept':
      if (!isOrderer(interaction)) return interaction.reply(ephemeral(`Only members with the <@&${config.ordererRoleId}> role can accept orders.`));
      result = store.accept(id, interaction.user.id);
      if (result.error) break;
      dm(
        result.order.customerId,
        `✅ Your ${SERVICES[result.order.service].label} order #${id} was accepted by <@${interaction.user.id}>. They may message you for details.`,
      );
      break;
    case 'release':
      result = store.release(id, interaction.user.id, admin);
      break;
    case 'complete':
      result = store.complete(id, interaction.user.id, admin);
      if (!result.error) dm(result.order.customerId, `🟢 Your ${SERVICES[result.order.service].label} order #${id} has been marked completed.`);
      break;
    case 'cancel':
      result = store.cancel(id, interaction.user.id, admin);
      if (!result.error && result.order.customerId !== interaction.user.id) {
        dm(result.order.customerId, `⚫ Your ${SERVICES[result.order.service].label} order #${id} was cancelled by <@${interaction.user.id}>.`);
      }
      break;
    default:
      return;
  }

  if (result.error) return interaction.reply(ephemeral(result.error));
  return showUpdate(interaction, result.order, `Order #${id} is now **${result.order.status}**.`);
}

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'order':
      return interaction.showModal(orderModal(interaction.options.getString('service', true)));

    case 'myorders': {
      const orders = store.recentFor(interaction.user.id);
      if (!orders.length) return interaction.reply(ephemeral('You have no orders yet. Use `/order` to place one.'));
      const lines = orders.map((o) => {
        const s = STATUS[o.status];
        const by = o.ordererId ? ` — by <@${o.ordererId}>` : '';
        return `**#${o.id}** ${SERVICES[o.service].emoji} ${SERVICES[o.service].label}: ${s.emoji} ${s.label}${by}`;
      });
      return interaction.reply(ephemeral(lines.join('\n')));
    }

    case 'cancel': {
      const id = interaction.options.getInteger('id', true);
      const result = store.cancel(id, interaction.user.id, isAdmin(interaction));
      if (result.error) return interaction.reply(ephemeral(result.error));
      return showUpdate(interaction, result.order, `Order #${id} cancelled.`);
    }

    case 'panel':
      await interaction.channel.send(panel());
      return interaction.reply(ephemeral('Order panel posted.'));
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit() && interaction.customId.startsWith('order:')) {
      return await submitOrder(interaction, interaction.customId.split(':')[1]);
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply(ephemeral('Something went wrong, please try again.')).catch(() => {});
    }
  }
});

client.once(Events.ClientReady, (c) => console.log(`Logged in as ${c.user.tag}`));
client.login(config.token);

import { ApplicationFlagsBitField, Client, Events, GatewayIntentBits, MessageFlags, Partials, REST, Routes } from 'discord.js';
import { createAiHandlers } from './ai.js';
import { loadConfig, loadPromos } from './config.js';
import { moderationCommands } from './moderation.js';
import { createOrderHandlers } from './orders.js';
import { Store } from './store.js';
import { PAYMENT_COMMANDS, createStaffHandlers } from './staff.js';
import { createSupportHandlers } from './support.js';
import { TOS } from './tos.js';
import { WHY_FOOD_HUB, WHY_OVER_FOODPLUG } from './whyfoodhub.js';
import { COLORS, editMessage, ensureTicketCategory, ephemeral, hasRole, isAdmin, isOrderer, say } from './util.js';
import { createVouchHandlers } from './vouches.js';
import { createGiveawayHandlers } from './giveaways.js';
import { createTranscripts } from './transcripts.js';
import { createApplications } from './applications.js';
import { createReferrals } from './referrals.js';
import { createSuggestions } from './suggestions.js';
import { createTrials } from './trials.js';
import { createLoyalty } from './loyalty.js';
import { createStats } from './stats.js';
import {
  announceModal,
  announcementEmbed,
  orderEmbed,
  ordersPanel,
  staffButtons,
  staffPanel,
  applyPanel,
  loyaltyPanel,
  referralPanel,
  setBrand,
  supportPanel,
  tosPanel,
  transcriptPanel,
  verifyPanel,
  whyFoodHubEmbed,
  whyOverFoodplugEmbed,
  whyPanel,
} from './views.js';

const config = loadConfig(['DISCORD_TOKEN', 'GUILD_ID', 'STAFF_ORDERS_CHANNEL_ID', 'ORDERER_ROLE_ID']);
const promos = loadPromos();
const store = new Store(config.dataFile);
// Privileged intents (Developer Portal → Bot): Message Content lets the bot read
// what people type (transcripts, the AI); Server Members tells it who joined
// (referrals). Only ask for the ones switched on, otherwise Discord refuses the login.
async function privilegedIntents() {
  try {
    const app = await new REST().setToken(config.token).get(Routes.currentApplication());
    const flags = new ApplicationFlagsBitField(app.flags);
    const F = ApplicationFlagsBitField.Flags;
    return {
      messageContent: flags.any([F.GatewayMessageContent, F.GatewayMessageContentLimited]),
      members: flags.any([F.GatewayGuildMembers, F.GatewayGuildMembersLimited]),
    };
  } catch (err) {
    console.error('Could not check which privileged intents are on:', err.message);
    return { messageContent: false, members: false };
  }
}

const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildInvites];
const privileged = await privilegedIntents();
config.messageContent = privileged.messageContent;
if (privileged.messageContent) intents.push(GatewayIntentBits.MessageContent);
else console.log('⚠️ Message Content Intent is OFF: transcripts only show the bot\'s panels, not what people type, and Food Hub AI only answers @mentions. Turn it on in the Developer Portal → Bot, then restart.');
if (privileged.members) intents.push(GatewayIntentBits.GuildMembers);
else console.log('⚠️ Server Members Intent is OFF: referral invite links can\'t tell who joined. Turn it on in the Developer Portal → Bot, then restart.');
if (process.env.ANTHROPIC_API_KEY) {
  console.log(`Food Hub AI on. Chat channels: ${config.chatChannelIds.join(', ') || 'none (set CHAT_CHANNEL_IDS) — it still answers direct pings anywhere'}`);
}
const client = new Client({
  intents,
  partials: [Partials.Channel], // needed to receive DMs
});

const ctx = { client, config, store, promos };
ctx.ai = createAiHandlers(ctx);
ctx.transcripts = createTranscripts(ctx);
ctx.trials = createTrials(ctx);
ctx.loyalty = createLoyalty(ctx);
const orders = createOrderHandlers(ctx);
const support = createSupportHandlers(ctx);
const staff = createStaffHandlers(ctx);
const vouches = createVouchHandlers(ctx);
const giveaways = createGiveawayHandlers(ctx);
const referrals = createReferrals(ctx);
const suggestions = createSuggestions(ctx);
const applications = createApplications(ctx);
const stats = createStats(ctx);

async function handleCommand(interaction) {
  const name = interaction.commandName;
  if (moderationCommands[name]) return moderationCommands[name](interaction);
  if (PAYMENT_COMMANDS.includes(name)) return staff.requestPayment(interaction);

  switch (name) {
    case 'orderpanel':
    case 'supportpanel':
    case 'verifypanel':
    case 'tos':
    case 'whyfoodhub':
    case 'staffpanel':
    case 'transcriptpanel':
    case 'trialpanel':
    case 'referralpanel':
    case 'applypanel':
    case 'loyaltypanel': {
      if (name === 'verifypanel' && !config.verifyUrl) {
        return interaction.reply(ephemeral('Set `VERIFY_URL` in `.env` to your RestoreCord / VaultCord verify link first, then restart the bot.'));
      }
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      const panel = {
        orderpanel: () => ordersPanel(promos, store.onlineByService()),
        supportpanel: supportPanel,
        verifypanel: () => verifyPanel(config.verifyUrl),
        tos: () => tosPanel(TOS),
        whyfoodhub: whyPanel,
        staffpanel: staffPanel,
        transcriptpanel: () => transcriptPanel(config.messageContent),
        trialpanel: ctx.trials.view,
        referralpanel: referralPanel,
        applypanel: applyPanel,
        loyaltypanel: () => loyaltyPanel(config.loyalty),
      }[name]();
      try {
        const message = await channel.send(panel);
        if (name === 'orderpanel') staff.recordOrderPanel(message); // so its "who's online" list stays live
        if (name === 'trialpanel') ctx.trials.recordPanel(message);
      } catch {
        return interaction.reply(ephemeral(`I can't post in ${channel} — give me View Channel, Send Messages and Embed Links there.`));
      }
      return interaction.reply(ephemeral(`✅ Panel posted in ${channel}.`));
    }

    case 'vouchpanel':
      if (!config.vouchChannelId) return interaction.reply(ephemeral('Set `VOUCH_CHANNEL_ID` in `.env` first, then restart the bot.'));
      await vouches.refreshSticky();
      return interaction.reply(ephemeral(`⭐ Vouch panel posted at the bottom of <#${config.vouchChannelId}>.`));

    case 'giveaway':
      return giveaways.start(interaction);

    case 'award':
      return referrals.award(interaction);

    case 'stats':
      return stats.today(interaction);

    case 'suggestionpanel': {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await suggestions.post(channel);
      return interaction.editReply(say(`💡 Suggestions panel posted in ${channel}.`, {}, { color: COLORS.success }));
    }

    case 'complete':
    case 'close':
    case 'delete': {
      const order = store.orderByTicket(interaction.channelId);
      if (order) return orders[name === 'delete' ? 'remove' : name](interaction, order.id);
      if (store.supportByChannel(interaction.channelId)) {
        if (name === 'complete') return interaction.reply(ephemeral('Support tickets don\'t have an order to complete — use `/close`.'));
        return support[name === 'delete' ? 'remove' : 'close'](interaction);
      }
      return interaction.reply(ephemeral('Use this inside an order or support ticket.'));
    }

    case 'rename':
      return renameTicket(interaction);

    case 'announce': {
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      return interaction.showModal(announceModal(channel.id, interaction.options.getString('ping') ?? 'none'));
    }

    case 'myorders':
      return orders.myOrders(interaction);

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

// /rename: Discord allows 2 renames per channel every 10 minutes, so don't wait forever.
async function renameTicket(interaction) {
  const isTicket = store.orderByTicket(interaction.channelId) || store.supportByChannel(interaction.channelId);
  if (!isTicket) return interaction.reply(ephemeral('Use this inside an order or support ticket.'));
  if (!isOrderer(interaction.member, config) && !hasRole(interaction.member, config.supportRoleId) && !isAdmin(interaction)) {
    return interaction.reply(ephemeral('Only staff can rename tickets.'));
  }
  const name = interaction.options.getString('name', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const rename = interaction.channel.setName(name, `Renamed by ${interaction.user.tag}`).then(() => 'done');
  const result = await Promise.race([rename, new Promise((resolve) => setTimeout(() => resolve('slow'), 5000))]).catch((err) => err);
  if (result === 'done') return interaction.editReply(say(`✏️ Renamed to **${interaction.channel.name}**.`, {}, { color: COLORS.success }));
  if (result === 'slow') {
    rename.catch((err) => console.error('Rename failed:', err.message));
    return interaction.editReply(say('⏳ Discord only allows **2 renames per 10 minutes** — the new name will show up as soon as it\'s allowed.'));
  }
  return interaction.editReply(say(`❌ Couldn't rename: ${result.message}`));
}

async function postAnnouncement(interaction) {
  if (!isAdmin(interaction)) return interaction.reply(ephemeral('Only admins can post announcements.'));
  const [, channelId, ping] = interaction.customId.split(':');
  const image = interaction.fields.getTextInputValue('image').trim();
  if (image && !/^https?:\/\/\S+$/i.test(image)) return interaction.reply(ephemeral('The image has to be a link starting with https://'));
  const embed = announcementEmbed({
    title: interaction.fields.getTextInputValue('title'),
    message: interaction.fields.getTextInputValue('message'),
    image,
    author: interaction.user.username,
  });
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send({
      content: ping === 'none' ? undefined : `@${ping}`,
      allowedMentions: { parse: ping === 'none' ? [] : ['everyone'] },
      embeds: [embed],
    });
  } catch (err) {
    return interaction.reply(ephemeral(`❌ Couldn't post the announcement: ${err.message}`));
  }
  return interaction.reply(ephemeral(`📢 Announcement posted in <#${channelId}>.`));
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) return await handleCommand(interaction);
    if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;
    if (interaction.customId.startsWith('order:')) return await orders.handleComponent(interaction);
    if (interaction.customId.startsWith('support:')) return await support.handleComponent(interaction);
    if (interaction.customId.startsWith('vouch:')) return await vouches.handleComponent(interaction);
    if (interaction.customId.startsWith('announce:')) return await postAnnouncement(interaction);
    if (interaction.customId.startsWith('staff:')) return await staff.handleComponent(interaction);
    if (interaction.customId.startsWith('pay:')) return await staff.handlePaymentButton(interaction);
    if (interaction.customId.startsWith('ai:')) return await ctx.ai.handleComponent(interaction);
    if (interaction.customId.startsWith('q:')) return await orders.handleQuestion(interaction);
    if (interaction.customId.startsWith('giveaway:')) return await giveaways.handleComponent(interaction);
    if (interaction.customId.startsWith('transcript:')) return await ctx.transcripts.handleComponent(interaction);
    if (interaction.customId.startsWith('ref:')) return await referrals.handleComponent(interaction);
    if (interaction.customId.startsWith('suggest:')) return await suggestions.handleComponent(interaction);
    if (interaction.customId.startsWith('apply:')) return await applications.handleComponent(interaction);
    if (interaction.customId.startsWith('loyalty:')) return await ctx.loyalty.handleComponent(interaction);
    if (interaction.customId.startsWith('stats:')) return await stats.handleComponent(interaction);
    if (interaction.customId === 'why:hub') return await interaction.reply({ embeds: [whyFoodHubEmbed(WHY_FOOD_HUB)], flags: MessageFlags.Ephemeral });
    if (interaction.customId === 'why:foodplug') {
      return await interaction.reply({ embeds: [whyOverFoodplugEmbed(WHY_OVER_FOODPLUG)], flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error(err);
    const reply = ephemeral('😔 Something went wrong, please try again.', {}, { color: COLORS.danger });
    if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

client.on(Events.MessageCreate, (message) => {
  if (message.guildId) ctx.transcripts.record(message); // every ticket message, the bot's own included
  if (message.author.bot) return;
  if (message.guildId) {
    if (message.channelId === config.vouchChannelId) return void vouches.handleChannelMessage(message).catch((err) => console.error('Vouch channel check failed:', err));
    return void ctx.ai.handleMessage(message).catch((err) => console.error('AI chat failed:', err));
  }
  applications
    .handleDm(message)
    .then((handled) => handled || orders.handleDm(message))
    .catch((err) => console.error('DM handling failed:', err));
});

client.on(Events.InviteCreate, (invite) => referrals.inviteCreated(invite));
client.on(Events.GuildMemberAdd, (member) => {
  referrals.memberJoined(member).catch((err) => console.error('Referral check failed:', err));
});

// If someone deletes a ticket channel by hand, close its order/support ticket too.
client.on(Events.ChannelDelete, (channel) => {
  orders.ticketDeleted(channel.id)?.catch((err) => console.error('Ticket delete cleanup failed:', err));
  const ticket = store.supportByChannel(channel.id);
  if (ticket?.status === 'open') store.updateSupport(ticket.id, { status: 'closed' });
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  try {
    const guild = await c.guilds.fetch(config.guildId);
    setBrand(guild.name, guild.iconURL({ size: 128 }));
    // Shows which roles the IDs in .env point at, to catch a wrong ID (e.g. pinging the wrong role).
    for (const [label, id] of [['ORDERER_ROLE_ID', config.ordererRoleId], ['TRIAL_ORDERER_ROLE_ID', config.trialRoleId], ['SUPPORT_ROLE_ID', config.supportRoleId]]) {
      if (id) console.log(`${label} → @${(await guild.roles.fetch(id).catch(() => null))?.name ?? '⚠️ no role with this ID'}`);
    }
    await referrals.loadInvites(guild);
    config.ticketCategoryId = await ensureTicketCategory(guild, config);
    config.supportCategoryId ||= config.ticketCategoryId;
  } catch (err) {
    console.error('Could not set up the ticket category — tickets will be created outside a category:', err.message);
  }
  await c.guilds
    .fetch(config.guildId)
    .then((guild) => orders.sweepDeletedTickets(guild))
    .catch((err) => console.error('Deleted-ticket check failed:', err));
  const tick = () => orders.autoClose().catch((err) => console.error('Auto-close failed:', err));
  tick(); // catch up on tickets that came due while the bot was offline
  setInterval(tick, 60 * 1000);
  const giveawayTick = () => giveaways.tick().catch((err) => console.error('Giveaway check failed:', err));
  giveawayTick(); // ends giveaways that finished while the bot was offline
  setInterval(giveawayTick, 15 * 1000);
  const staffTick = () => staff.tick().catch((err) => console.error('Staff online check failed:', err));
  staffTick();
  setInterval(staffTick, 30 * 1000);
  const statsTick = () => stats.tick().catch((err) => console.error('Daily stats failed:', err));
  statsTick();
  setInterval(statsTick, 30 * 1000);
});

client.login(config.token);

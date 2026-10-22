import { randomInt } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { parseDuration } from './moderation.js';
import { COLORS, editMessage, ephemeral, isAdmin, say } from './util.js';
import { giveawayButtons, giveawayEmbed, giveawayModal } from './views.js';

const MAX_WINNERS = 20;

// Up to `count` different random picks from `list`.
export function pickWinners(list, count) {
  const pool = [...list];
  const winners = [];
  while (winners.length < count && pool.length) winners.push(pool.splice(randomInt(pool.length), 1)[0]);
  return winners;
}

// /giveaway opens a form (title, duration, winners, info) and posts the
// giveaway with a 🎉 Enter button. When time's up the bot draws the winners.
export function createGiveawayHandlers({ client, store }) {
  const view = (g) => ({ embeds: [giveawayEmbed(g)], components: giveawayButtons(g) });

  function start(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    return interaction.showModal(giveawayModal(channel.id));
  }

  async function create(interaction, channelId) {
    if (!isAdmin(interaction)) return interaction.reply(ephemeral('Only admins can start giveaways.'));
    const ms = parseDuration(interaction.fields.getTextInputValue('duration'));
    if (!ms) return interaction.reply(ephemeral('Invalid duration. Use e.g. `30m`, `2h`, `1d`, `1w` (max 28d).'));
    const winnersText = interaction.fields.getTextInputValue('winners').trim() || '1';
    const winners = Number(winnersText);
    if (!Number.isInteger(winners) || winners < 1 || winners > MAX_WINNERS) {
      return interaction.reply(ephemeral(`Number of winners must be a whole number from 1 to ${MAX_WINNERS}.`));
    }
    const giveaway = store.createGiveaway({
      title: interaction.fields.getTextInputValue('title'),
      info: interaction.fields.getTextInputValue('info').trim(),
      winners,
      endsAt: new Date(Date.now() + ms).toISOString(),
      hostId: interaction.user.id,
      channelId,
    });
    try {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.send(view(giveaway));
      store.updateGiveaway(giveaway.id, { messageId: message.id });
    } catch (err) {
      store.updateGiveaway(giveaway.id, { status: 'cancelled' });
      return interaction.reply(ephemeral(`❌ Couldn't post the giveaway: ${err.message}`));
    }
    return interaction.reply(ephemeral(`🎉 Giveaway posted in <#${channelId}>! It ends <t:${Math.floor(Date.parse(giveaway.endsAt) / 1000)}:R>.`));
  }

  async function enter(interaction, id) {
    const result = store.toggleEntry(id, interaction.user.id);
    if (result.error) return interaction.reply(ephemeral(result.error));
    await interaction.update(view(result.giveaway)); // refreshes the entry count
    return interaction.followUp(
      result.entered
        ? ephemeral('🎉 You\'re in! Good luck 🍀\nPress the button again if you want to leave.', {}, { color: COLORS.success })
        : ephemeral('👋 You\'ve left the giveaway.', {}, { color: COLORS.warning }),
    );
  }

  // Draws the winners, updates the giveaway post and announces them under it.
  async function draw(giveaway, note = '') {
    const winnerIds = pickWinners(giveaway.entrants, giveaway.winners);
    const ended = store.updateGiveaway(giveaway.id, { status: 'ended', winnerIds, endedAt: new Date().toISOString() });
    await editMessage(client, ended.channelId, ended.messageId, view(ended));
    try {
      const channel = await client.channels.fetch(ended.channelId);
      const reply = ended.messageId ? { messageReference: ended.messageId, failIfNotExists: false } : undefined;
      if (!winnerIds.length) {
        return await channel.send({ ...say(`Nobody entered **${ended.title}**, so there's no winner. 😢`, {}, { title: '🎉 Giveaway ended', color: COLORS.warning }), reply });
      }
      await channel.send({
        content: winnerIds.map((u) => `<@${u}>`).join(' '),
        allowedMentions: { users: winnerIds },
        reply,
        ...say(`${note}🏆 Congratulations ${winnerIds.map((u) => `<@${u}>`).join(', ')}! You won **${ended.title}**! 🎊\nHost: <@${ended.hostId}>`, {}, {
          title: '🎉 Giveaway winner' + (winnerIds.length > 1 ? 's' : ''),
          color: COLORS.success,
        }),
      });
    } catch (err) {
      console.error(`Could not announce giveaway #${ended.id}:`, err.message);
    }
  }

  async function reroll(interaction, id) {
    if (!isAdmin(interaction)) return interaction.reply(ephemeral('Only admins can reroll giveaways.'));
    const giveaway = store.getGiveaway(id);
    if (!giveaway || giveaway.status !== 'ended') return interaction.reply(ephemeral('That giveaway hasn\'t ended yet.'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await draw(giveaway, `🔁 Rerolled by <@${interaction.user.id}>.\n`);
    return interaction.editReply(say('🔁 New winners drawn.', {}, { color: COLORS.success }));
  }

  // Runs every few seconds: ends giveaways whose time is up.
  async function tick() {
    for (const giveaway of store.dueGiveaways()) await draw(giveaway);
  }

  function handleComponent(interaction) {
    const [, action, a] = interaction.customId.split(':');
    switch (action) {
      case 'create': return create(interaction, a);
      case 'enter': return enter(interaction, Number(a));
      case 'reroll': return reroll(interaction, Number(a));
    }
  }

  return { start, handleComponent, tick };
}

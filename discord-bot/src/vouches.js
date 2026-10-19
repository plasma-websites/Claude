import { ActionRowBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { ephemeral } from './util.js';
import { starPicker, vouchEmbed, vouchModal, vouchSticky } from './views.js';

// Controlled vouches: only customers with a completed order can vouch, once per
// order, through the bot. The explainer panel is kept as the last message.
export function createVouchHandlers({ client, config, store }) {
  let stickyQueue = Promise.resolve();

  // Deletes the old sticky panel and posts a fresh one at the bottom. Queued so
  // several vouches at once can't leave two panels behind.
  function refreshSticky() {
    stickyQueue = stickyQueue
      .then(async () => {
        const channel = await client.channels.fetch(config.vouchChannelId);
        const oldId = store.getMeta('vouchStickyId');
        if (oldId) await channel.messages.delete(oldId).catch(() => {});
        const message = await channel.send(vouchSticky());
        store.setMeta('vouchStickyId', message.id);
      })
      .catch((err) => console.error('Could not refresh the vouch panel:', err.message));
    return stickyQueue;
  }

  async function start(interaction) {
    const order = store.vouchableOrder(interaction.user.id);
    if (!order) {
      return interaction.reply(
        ephemeral('🔐 Only customers with a **completed order** can vouch, and only once per order. Place an order first! 🛒'),
      );
    }
    return interaction.reply({
      content: `⭐ Vouching for your order **#${order.id}** — how many stars?`,
      components: [new ActionRowBuilder().addComponents(starPicker(order.id))],
      flags: MessageFlags.Ephemeral,
    });
  }

  function pickStars(interaction, orderId) {
    return interaction.showModal(vouchModal(orderId, interaction.values[0]));
  }

  async function submit(interaction, orderId, starCount) {
    const stars = Number(starCount);
    if (!(stars >= 1 && stars <= 5)) return interaction.reply(ephemeral('Pick between 1 and 5 stars.'));
    const result = store.addVouch({ orderId, userId: interaction.user.id, stars, message: interaction.fields.getTextInputValue('message') });
    if (result.error) return interaction.update({ content: result.error, components: [] });
    try {
      const channel = await client.channels.fetch(config.vouchChannelId);
      await channel.send({ embeds: [vouchEmbed(result.vouch, result.order)], allowedMentions: { parse: [] } });
    } catch (err) {
      console.error('Could not post vouch:', err.message);
    }
    await interaction.update({ content: `💛 Thanks for your vouch! It's posted in <#${config.vouchChannelId}>.`, components: [] });
    await refreshSticky();
  }

  // Anything people type in the vouch channel is removed (staff excepted) so
  // only bot-checked vouches stay there.
  async function handleChannelMessage(message) {
    if (message.channelId !== config.vouchChannelId || message.author.bot) return;
    if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return refreshSticky();
    await message.delete().catch(() => {});
    message.author
      .send(`⭐ Vouches have to go through the **Leave a vouch** button in <#${config.vouchChannelId}> — your message was removed.`)
      .catch(() => {});
  }

  async function handleComponent(interaction) {
    if (!config.vouchChannelId) return interaction.reply(ephemeral('Vouches aren\'t set up yet (`VOUCH_CHANNEL_ID`).'));
    const [, action, a, b] = interaction.customId.split(':');
    switch (action) {
      case 'start': return start(interaction);
      case 'stars': return pickStars(interaction, Number(a));
      case 'submit': return submit(interaction, Number(a), b);
    }
  }

  return { handleComponent, handleChannelMessage, refreshSticky };
}

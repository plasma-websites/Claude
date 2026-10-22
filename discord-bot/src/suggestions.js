import { MessageFlags } from 'discord.js';
import { COLORS, ephemeral, isAdmin, say } from './util.js';
import { suggestionClearConfirm, suggestionListEmbeds, suggestionModal, suggestionSticky } from './views.js';

// Bot suggestions channel: the numbered list sits above a sticky panel with
// Add and Clear buttons. Both are re-posted whenever the list changes, so
// the panel is always the last message.
export function createSuggestions({ client, store }) {
  let queue = Promise.resolve();

  function refresh() {
    queue = queue
      .then(async () => {
        const where = store.getMeta('suggestionPanel');
        if (!where) return;
        const channel = await client.channels.fetch(where.channelId);
        for (const id of where.messageIds ?? []) await channel.messages.delete(id).catch(() => {});
        const messageIds = [];
        for (const embed of suggestionListEmbeds(store.data.suggestions)) messageIds.push((await channel.send({ embeds: [embed] })).id);
        messageIds.push((await channel.send(suggestionSticky(store.data.suggestions.length))).id);
        store.setMeta('suggestionPanel', { channelId: channel.id, messageIds });
      })
      .catch((err) => console.error('Could not refresh the suggestions panel:', err.message));
    return queue;
  }

  // /suggestionpanel: moves the list and panel to this channel.
  async function post(channel) {
    const old = store.getMeta('suggestionPanel');
    if (old && old.channelId !== channel.id) {
      const oldChannel = await client.channels.fetch(old.channelId).catch(() => null);
      for (const id of old.messageIds ?? []) await oldChannel?.messages.delete(id).catch(() => {});
      store.setMeta('suggestionPanel', { channelId: channel.id, messageIds: [] });
    } else if (!old) store.setMeta('suggestionPanel', { channelId: channel.id, messageIds: [] });
    return refresh();
  }

  async function add(interaction) {
    const text = interaction.fields.getTextInputValue('text').trim().replace(/\n{3,}/g, '\n\n');
    const suggestion = store.addSuggestion({ userId: interaction.user.id, text });
    await interaction.reply(ephemeral(`💡 Thanks! Your suggestion was added as **#${suggestion.number}**.`, {}, { color: COLORS.success }));
    await refresh();
  }

  async function clear(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(ephemeral('Only admins can clear the suggestions list.', {}, { color: COLORS.danger }));
    store.clearSuggestions();
    await interaction.update(say('🧹 Suggestions list cleared.', { components: [] }, { color: COLORS.success }));
    await refresh();
  }

  function handleComponent(interaction) {
    switch (interaction.customId) {
      case 'suggest:add': return interaction.showModal(suggestionModal());
      case 'suggest:submit': return add(interaction);
      case 'suggest:clear':
        if (!isAdmin(interaction)) return interaction.reply(ephemeral('Only admins can clear the suggestions list.', {}, { color: COLORS.danger }));
        return interaction.reply({ ...suggestionClearConfirm(store.data.suggestions.length), flags: MessageFlags.Ephemeral });
      case 'suggest:clearyes': return clear(interaction);
    }
  }

  return { post, handleComponent };
}

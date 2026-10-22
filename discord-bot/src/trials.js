import { trialPanel } from './views.js';

// The trial orderer panel: every trial orderer's completed and in-progress
// orders, kept up to date like the order panel's "who's online" list.
export function createTrials({ client, config, store }) {
  function recordPanel(message) {
    const panels = store.getMeta('trialPanels') ?? [];
    store.setMeta('trialPanels', [...panels, { channelId: message.channelId, messageId: message.id }]);
  }

  const view = () => trialPanel(store.trialStats(), config.trialRoleId);

  let queue = Promise.resolve();
  function refresh() {
    queue = queue
      .then(async () => {
        const panels = store.getMeta('trialPanels') ?? [];
        const keep = [];
        for (const p of panels) {
          try {
            const channel = await client.channels.fetch(p.channelId);
            const message = await channel.messages.fetch(p.messageId);
            await message.edit(view());
            keep.push(p);
          } catch (err) {
            if (![10003, 10008].includes(err.code)) keep.push(p); // keep unless the channel/message is gone
          }
        }
        if (keep.length !== panels.length) store.setMeta('trialPanels', keep);
      })
      .catch((err) => console.error('Could not refresh the trial panel:', err.message));
    return queue;
  }

  return { recordPanel, refresh, view };
}

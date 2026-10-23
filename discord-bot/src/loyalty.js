import { MessageFlags } from 'discord.js';
import { dm } from './util.js';
import { codeMessage, loyaltyProgressEmbed } from './views.js';

// Loyalty: config.loyalty.orders completed orders within config.loyalty.days
// earns a free-fee code, DMed as soon as the order that reaches it is completed.
export function createLoyalty({ client, config, store }) {
  // Call after an order is completed. Returns the code if one was given.
  function checkReward(userId) {
    const code = store.claimLoyalty(userId, config.loyalty);
    if (code) {
      dm(client, userId, codeMessage(code, `🍔 **That's ${config.loyalty.orders} orders!** Thanks for being loyal. Here's a **free-fee order** on us. 🎉`));
    }
    return code;
  }

  function check(interaction) {
    checkReward(interaction.user.id); // in case an earlier DM failed
    const counted = store.loyaltyOrders(interaction.user.id, config.loyalty.days);
    return interaction.reply({ embeds: [loyaltyProgressEmbed(counted, config.loyalty)], flags: MessageFlags.Ephemeral });
  }

  function handleComponent(interaction) {
    if (interaction.customId === 'loyalty:check') return check(interaction);
  }

  return { checkReward, handleComponent };
}

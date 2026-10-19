import { MessageFlags } from 'discord.js';
import { createTicketChannel, deleteChannel, ephemeral, hasRole, isAdmin, pad } from './util.js';
import { supportModal, supportTicketMessage } from './views.js';

export function createSupportHandlers({ client, config, store }) {
  async function open(interaction) {
    const existing = store.openSupportFor(interaction.user.id);
    if (existing?.channelId) return interaction.reply(ephemeral(`You already have an open support ticket: <#${existing.channelId}>`));
    return interaction.showModal(supportModal());
  }

  async function submit(interaction) {
    if (store.openSupportFor(interaction.user.id)) return interaction.reply(ephemeral('You already have an open support ticket.'));
    const ticket = store.createSupport({ userId: interaction.user.id, reason: interaction.fields.getTextInputValue('reason') });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const channel = await createTicketChannel(interaction.guild, {
        name: `support-${pad(ticket.id)}`,
        parent: config.supportCategoryId,
        memberIds: [ticket.userId],
        roleIds: [config.supportRoleId],
      });
      store.updateSupport(ticket.id, { channelId: channel.id });
      await channel.send({
        content: `<@${ticket.userId}> <@&${config.supportRoleId}>`,
        allowedMentions: { users: [ticket.userId], roles: [config.supportRoleId] },
        ...supportTicketMessage(ticket),
      });
      return interaction.editReply(`🎫 Your ticket is open: <#${channel.id}>`);
    } catch (err) {
      console.error(`Could not create support ticket #${ticket.id}:`, err.message);
      store.updateSupport(ticket.id, { status: 'closed' });
      return interaction.editReply('Sorry, the ticket could not be created. Please contact a staff member directly.');
    }
  }

  async function close(interaction) {
    const ticket = store.supportByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') return interaction.reply(ephemeral('This ticket is already closed.'));
    const allowed = ticket.userId === interaction.user.id || hasRole(interaction.member, config.supportRoleId) || isAdmin(interaction);
    if (!allowed) return interaction.reply(ephemeral('You can\'t close this ticket.'));
    store.updateSupport(ticket.id, { status: 'closed', closedBy: interaction.user.id });
    await interaction.reply('🔒 Closing this ticket…');
    await deleteChannel(client, ticket.channelId, `Support ticket closed by ${interaction.user.tag}`);
  }

  function handleComponent(interaction) {
    if (interaction.customId === 'support:open') return open(interaction);
    if (interaction.customId === 'support:close') return close(interaction);
    if (interaction.customId === 'support:modal') return submit(interaction);
  }

  return { handleComponent };
}

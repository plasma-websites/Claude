import { MessageFlags } from 'discord.js';
import { createTicketChannel, deleteChannel, editMessage, ephemeral, hasRole, isAdmin, lockTicket, renameChannel } from './util.js';
import { supportButtons, supportEmbed, supportModal, supportTicketName } from './views.js';

export function createSupportHandlers({ client, config, store }) {
  const isStaff = (interaction) => hasRole(interaction.member, config.supportRoleId) || isAdmin(interaction);

  async function open(interaction) {
    const existing = store.openSupportFor(interaction.user.id);
    if (existing?.channelId) return interaction.reply(ephemeral(`🎫 You already have an open support ticket: <#${existing.channelId}>`));
    return interaction.showModal(supportModal());
  }

  async function submit(interaction) {
    if (store.openSupportFor(interaction.user.id)) return interaction.reply(ephemeral('🎫 You already have an open support ticket.'));
    const ticket = store.createSupport({ userId: interaction.user.id, reason: interaction.fields.getTextInputValue('reason') });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const channel = await createTicketChannel(interaction.guild, {
        name: supportTicketName(ticket),
        parent: config.supportCategoryId,
        memberIds: [ticket.userId],
        roleIds: [config.supportRoleId],
      });
      const message = await channel.send({
        content: `👋 <@${ticket.userId}> welcome! <@&${config.supportRoleId}> will be with you soon.`,
        allowedMentions: { users: [ticket.userId], roles: [config.supportRoleId] },
        embeds: [supportEmbed(ticket)],
        components: supportButtons(ticket),
      });
      store.updateSupport(ticket.id, { channelId: channel.id, messageId: message.id });
      return interaction.editReply(`✅ Your ticket is open 👉 <#${channel.id}>`);
    } catch (err) {
      console.error(`Could not create support ticket #${ticket.id}:`, err.message);
      store.updateSupport(ticket.id, { status: 'closed' });
      return interaction.editReply('😔 Sorry, the ticket could not be created. Please contact a staff member directly.');
    }
  }

  // Locks the ticket: the member loses access, staff keep it until they delete it.
  async function close(interaction) {
    const ticket = store.supportByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') return interaction.reply(ephemeral('🔒 This ticket is already closed.'));
    if (ticket.userId !== interaction.user.id && !isStaff(interaction)) return interaction.reply(ephemeral('You can\'t close this ticket.'));
    const closed = store.updateSupport(ticket.id, { status: 'closed', closedBy: interaction.user.id });
    await interaction.deferUpdate();
    await lockTicket(client, closed.channelId, closed.userId);
    renameChannel(client, closed.channelId, supportTicketName(closed));
    await editMessage(client, closed.channelId, closed.messageId, { embeds: [supportEmbed(closed)], components: supportButtons(closed) });
    await interaction.channel.send({
      content: `🔒 Ticket closed by <@${interaction.user.id}>.\n🗑️ Staff can delete this ticket when they're done.`,
      components: supportButtons(closed),
    });
  }

  async function remove(interaction) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can delete tickets.'));
    const ticket = store.supportByChannel(interaction.channelId);
    if (ticket?.status === 'open') store.updateSupport(ticket.id, { status: 'closed', closedBy: interaction.user.id });
    await interaction.reply(`🗑️ Deleting this ticket in 5 seconds… (by <@${interaction.user.id}>)`);
    setTimeout(() => deleteChannel(client, interaction.channelId, `Deleted by ${interaction.user.tag}`), 5000);
  }

  function handleComponent(interaction) {
    switch (interaction.customId) {
      case 'support:open': return open(interaction);
      case 'support:modal': return submit(interaction);
      case 'support:close': return close(interaction);
      case 'support:delete': return remove(interaction);
    }
  }

  return { handleComponent };
}

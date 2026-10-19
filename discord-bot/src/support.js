import { MessageFlags } from 'discord.js';
import { COLORS, createTicketChannel, deleteChannel, editMessage, ephemeral, hasRole, isAdmin, lockTicket, panel, renameChannel, say } from './util.js';
import { supportButtons, supportEmbed, supportModal, supportTicketName } from './views.js';

export function createSupportHandlers({ client, config, store, ai }) {
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
    let channel;
    try {
      channel = await createTicketChannel(interaction.guild, {
        name: supportTicketName(ticket),
        parent: config.supportCategoryId,
        memberIds: [ticket.userId],
        roleIds: [config.supportRoleId],
      });
      const embeds = [supportEmbed(ticket)];
      if (ai?.enabled) {
        embeds.push(
          panel('🤖 While you wait, our **AI assistant** will try to answer your question below. Press **Talk to a human** any time to get staff.', {
            color: 0x9b59b6,
          }),
        );
      }
      const message = await channel.send({
        content: `<@${ticket.userId}> <@&${config.supportRoleId}>`,
        allowedMentions: { users: [ticket.userId], roles: [config.supportRoleId] },
        embeds,
        components: supportButtons(ticket),
      });
      store.updateSupport(ticket.id, { channelId: channel.id, messageId: message.id });
    } catch (err) {
      console.error(`Could not create support ticket #${ticket.id}:`, err.message);
      store.updateSupport(ticket.id, { status: 'closed' });
      return interaction.editReply(say('😔 Sorry, the ticket could not be created. Please contact a staff member directly.', {}, { color: COLORS.danger }));
    }
    await interaction.editReply(say(`✅ Your ticket is open 👉 <#${channel.id}>`, {}, { color: COLORS.success }));
    if (ai?.enabled) ai.answerInTicket(channel, store.supportByChannel(channel.id), ticket.userId, ticket.reason, { showQuestion: false });
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
    await interaction.channel.send(
      say(`🔒 Ticket closed by <@${interaction.user.id}>.\n🗑️ Staff can delete this ticket when they're done.`, { components: supportButtons(closed) }, {
        title: '🔒 Ticket closed',
        color: COLORS.danger,
      }),
    );
  }

  async function remove(interaction) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can delete tickets.'));
    const ticket = store.supportByChannel(interaction.channelId);
    if (ticket?.status === 'open') store.updateSupport(ticket.id, { status: 'closed', closedBy: interaction.user.id });
    await interaction.reply(say(`🗑️ Deleting this ticket in 5 seconds… (by <@${interaction.user.id}>)`, {}, { color: COLORS.danger }));
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

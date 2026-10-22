import { MessageFlags } from 'discord.js';
import { COLORS, createTicketChannel, deleteChannel, ephemeral, hasRole, isAdmin, lockTicket, panel, renameChannel, say } from './util.js';
import { supportButtons, supportEmbed, supportModal, supportTicketName } from './views.js';

export function createSupportHandlers({ client, config, store, ai, transcripts }) {
  const isStaff = (interaction) => hasRole(interaction.member, config.supportRoleId) || isAdmin(interaction);

  async function open(interaction) {
    const existing = store.openSupportFor(interaction.user.id);
    if (existing?.channelId) return interaction.reply(ephemeral(`🎫 You already have an open support ticket: <#${existing.channelId}>`));
    return interaction.showModal(supportModal());
  }

  async function submit(interaction) {
    if (store.openSupportFor(interaction.user.id)) return interaction.reply(ephemeral('🎫 You already have an open support ticket.'));
    const ticket = store.createSupport({ userId: interaction.user.id, userName: interaction.user.username, reason: interaction.fields.getTextInputValue('reason') });
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
          panel('🤖 While you wait, our **support assistant** will answer below — reply here or press **Ask a follow-up**. Press **Talk to a human** any time to get staff.', {
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
    if (ai?.enabled) ai.answerOpening(channel, store.supportByChannel(channel.id));
  }

  // Closing a support ticket deletes it straight away, after saving its transcript.
  async function close(interaction) {
    const ticket = store.supportByChannel(interaction.channelId);
    if (!ticket) return interaction.reply(ephemeral('This isn\'t a support ticket.'));
    if (ticket.userId !== interaction.user.id && !isStaff(interaction)) return interaction.reply(ephemeral('You can\'t close this ticket.'));
    store.updateSupport(ticket.id, { status: 'closed', closedBy: interaction.user.id, closedAt: new Date().toISOString() });
    await interaction.reply(say(`✅ Ticket closed by <@${interaction.user.id}>. Deleting it now…\n📜 A transcript has been saved.`, {}, { title: '✅ Support ticket completed' }));
    await transcripts.saveChannel(interaction.channelId);
    if (!(await deleteChannel(client, interaction.channelId, `Closed by ${interaction.user.tag}`))) {
      await lockTicket(client, interaction.channelId, ticket.userId);
      renameChannel(client, interaction.channelId, supportTicketName(store.supportByChannel(interaction.channelId)));
      await interaction.followUp(ephemeral('I couldn\'t delete this channel (check I have **Manage Channels**), so I locked it instead.'));
    }
  }

  // Staff only. Same as close, kept for the Delete button and /delete.
  async function remove(interaction) {
    if (!isStaff(interaction)) return interaction.reply(ephemeral('Only staff can delete tickets.'));
    return close(interaction);
  }

  function handleComponent(interaction) {
    switch (interaction.customId) {
      case 'support:open': return open(interaction);
      case 'support:modal': return submit(interaction);
      case 'support:close': return close(interaction);
      case 'support:delete': return remove(interaction);
    }
  }

  return { handleComponent, close, remove };
}

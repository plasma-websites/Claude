import { MessageFlags } from 'discord.js';
import { REFERRAL_ORDERS } from './store.js';
import { COLORS, dm, ephemeral, isAdmin, say } from './util.js';
import { codeMessage, referralStatsEmbed } from './views.js';

export const INVITEE_DISCOUNT = 0.5; // pounds off the invited member's second order

// Referral panel: personal invite links, tracked joins, and discount codes.
// Knowing which link someone joined with needs the Server Members intent and
// the bot's Manage Server permission (to read invite use counts).
export function createReferrals({ client, config, store }) {
  const uses = new Map(); // invite code → uses, to spot which one a new member used
  let tracking = false;

  // A cancelled order hands its code back: tell the owner.
  store.onCodeReleased = (code, order) => {
    dm(client, code.ownerId, codeMessage(code, `♻️ Order **#${order.id}** was cancelled, so your code is **valid again**! Use it on your next order.`));
  };

  async function loadInvites(guild) {
    try {
      const invites = await guild.invites.fetch();
      for (const invite of invites.values()) uses.set(invite.code, invite.uses ?? 0);
      tracking = true;
    } catch (err) {
      console.error('Referral tracking is off — the bot needs the Manage Server permission to read invites:', err.message);
    }
  }

  function inviteCreated(invite) {
    uses.set(invite.code, invite.uses ?? 0);
  }

  async function memberJoined(member) {
    if (member.user.bot || !tracking) return;
    const invites = await member.guild.invites.fetch().catch(() => null);
    if (!invites) return;
    const used = invites.filter((invite) => (invite.uses ?? 0) > (uses.get(invite.code) ?? 0));
    for (const invite of invites.values()) uses.set(invite.code, invite.uses ?? 0);
    const referrers = [...new Set(used.map((invite) => store.inviteOwner(invite.code)).filter(Boolean))];
    if (referrers.length !== 1) return; // not a referral link, or two joins at once and we can't tell which
    const [referrerId] = referrers;
    if (!store.recordJoin(member.id, referrerId)) return;
    const { invited } = store.referralStats(referrerId);
    dm(client, referrerId, say(`🎉 <@${member.id}> joined with your invite link! That's **${invited.length}** so far.`, {}, { title: '🤝 New referral' }));
    dm(client, member.id, say('👋 Welcome to Food Hub! You were invited by a friend, so once your **first order** is completed you\'ll get **50p off your second order**. The code comes to your DMs automatically.', {}, { title: '🎟️ Invite reward' }));
  }

  // Called when an order is completed. The invited member's first completed order earns
  // their 50p code, and may be the 3rd that earns their inviter's free-fee order.
  function onOrderCompleted(userId) {
    const invitee = store.claimInviteeReward(userId, INVITEE_DISCOUNT);
    if (invitee.code) {
      dm(client, userId, codeMessage(invitee.code, '🎉 **Thanks for your first order!** You joined with a friend\'s invite, so here\'s **50p off your second order**. 🍔'));
    }
    const referrerId = store.referrerOf(userId);
    if (referrerId) giveInviterReward(referrerId);
  }

  function giveInviterReward(userId) {
    const result = store.claimReferralReward(userId);
    if (result.code) {
      dm(client, userId, codeMessage(result.code, `🏆 **Referral reward unlocked!** ${REFERRAL_ORDERS} friends you invited have ordered, so here's your **FREE FEE ORDER**. 🎉`));
    }
  }

  async function getLink(interaction) {
    const existing = store.inviteLinkOf(interaction.user.id);
    if (existing && (!tracking || uses.has(existing))) {
      return interaction.reply(ephemeral(`🔗 Your personal invite link:\nhttps://discord.gg/${existing}\n\nShare it with friends — joins through it count for you.`, {}, { title: '🔗 Your invite link' }));
    }
    try {
      const invite = await interaction.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `Referral link for ${interaction.user.tag}` });
      store.setInviteLink(interaction.user.id, invite.code);
      uses.set(invite.code, invite.uses ?? 0);
      return interaction.reply(ephemeral(`🔗 Your personal invite link:\n${invite.url}\n\nShare it with friends — joins through it count for you.`, {}, { title: '🔗 Your invite link' }));
    } catch (err) {
      console.error('Could not create a referral invite:', err.message);
      return interaction.reply(ephemeral('❌ I couldn\'t create an invite here — I need the **Create Invite** permission in this channel.', {}, { color: COLORS.danger }));
    }
  }

  // My referrals: the friends who joined with their link, and their own invite reward if they were invited.
  function myReferrals(interaction) {
    onOrderCompleted(interaction.user.id); // in case an earlier reward DM failed
    giveInviterReward(interaction.user.id);
    const reward = store.referrerOf(interaction.user.id)
      ? store.data.referrals.discountClaimed.includes(interaction.user.id)
        ? 'claimed'
        : 'waiting'
      : null;
    const rules = { orders: REFERRAL_ORDERS };
    return interaction.reply({ embeds: [referralStatsEmbed(store.referralStats(interaction.user.id), { reward, tracking, rules })], flags: MessageFlags.Ephemeral });
  }

  function myCodes(interaction) {
    const codes = store.codesFor(interaction.user.id);
    if (!codes.length) return interaction.reply(ephemeral('📭 You don\'t have any codes yet.'));
    const lines = codes.map((c) => `\`${c.code}\` — ${c.type === 'free' ? '🆓 Free fee' : `💷 £${c.amount.toFixed(2)} off`} · ${c.status === 'active' ? '🟢 Ready to use' : `✅ Used on #${c.orderId}`}`);
    return interaction.reply(ephemeral(lines.join('\n'), {}, { title: '🎟️ Your codes' }));
  }

  // /award user: [reason:] — a free-fee code from staff, DMed to the member.
  async function award(interaction) {
    if (!isAdmin(interaction)) return interaction.reply(ephemeral('Only admins can award codes.', {}, { color: COLORS.danger }));
    const user = interaction.options.getUser('user', true);
    if (user.bot) return interaction.reply(ephemeral('Bots can\'t order.'));
    const reason = interaction.options.getString('reason')?.trim();
    const code = store.createCode({ type: 'free', ownerId: user.id, reason: `Award by ${interaction.user.tag}${reason ? `: ${reason}` : ''}` });
    const sent = await dm(client, user.id, codeMessage(code, `🏆 **You've been awarded a free-fee order!**${reason ? `\n📝 ${reason}` : ''}`));
    return interaction.reply(
      ephemeral(
        sent
          ? `🏆 Sent <@${user.id}> a free-fee code: \`${code.code}\``
          : `🏆 Code \`${code.code}\` created for <@${user.id}>, but their DMs are closed. Send it to them yourself.`,
        {},
        { color: COLORS.success },
      ),
    );
  }

  function handleComponent(interaction) {
    const [, action, code] = interaction.customId.split(':');
    switch (action) {
      case 'link': return getLink(interaction);
      // claim / invited are buttons on panels posted before the referral change.
      case 'stats':
      case 'claim':
      case 'invited':
        return myReferrals(interaction);
      case 'codes': return myCodes(interaction);
      // The bare code as message text, easy to long-press and copy on mobile.
      case 'copy': return interaction.reply({ content: code, flags: MessageFlags.Ephemeral });
    }
  }

  return { loadInvites, inviteCreated, memberJoined, handleComponent, award, onOrderCompleted };
}

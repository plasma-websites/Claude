import { MessageFlags } from 'discord.js';
import { REFERRAL_INVITES, REFERRAL_ORDERS } from './store.js';
import { COLORS, dm, ephemeral, say } from './util.js';
import { codeMessage, referralStatsEmbed } from './views.js';

export const INVITEE_DISCOUNT = 0.5; // pounds off the invited member's first order

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
    dm(client, member.id, say('👋 Welcome to Food Hub! You were invited by a friend, so you get **50p off your first order**.\nPress **🎟️ I was invited** on the referrals panel to get your code.', {}, { title: '🎟️ First-order discount' }));
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

  function claim(interaction) {
    const result = store.claimReferralReward(interaction.user.id);
    if (result.error) {
      return interaction.reply({ embeds: [referralStatsEmbed(result.stats, { invites: REFERRAL_INVITES, orders: REFERRAL_ORDERS, tracking })], flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({
      ...codeMessage(result.code, `🏆 **Reward unlocked!** Here's your **FREE FEE ORDER** code. Enter it in the order form and the service fee comes off. 🎉`),
      flags: MessageFlags.Ephemeral,
    });
  }

  function invitedDiscount(interaction) {
    const result = store.claimInviteeDiscount(interaction.user.id, INVITEE_DISCOUNT);
    const errors = {
      not_invited: '🤔 I don\'t have you down as joining through someone\'s invite link, so there\'s no discount to claim.',
      claimed: '✅ You\'ve already claimed your first-order discount. Press **My codes** to see it.',
      ordered: 'This discount is for your **first** order, and you\'ve already ordered with us. 💛',
    };
    if (result.error) return interaction.reply(ephemeral(errors[result.error]));
    return interaction.reply({
      ...codeMessage(result.code, '🎟️ Here\'s your **discounted order code** — **50p off** the service fee on your first order. Enter it in the order form. 🍔'),
      flags: MessageFlags.Ephemeral,
    });
  }

  function myCodes(interaction) {
    const codes = store.codesFor(interaction.user.id);
    if (!codes.length) return interaction.reply(ephemeral('📭 You don\'t have any codes yet.'));
    const lines = codes.map((c) => `\`${c.code}\` — ${c.type === 'free' ? '🆓 Free fee' : `💷 £${c.amount.toFixed(2)} off`} · ${c.status === 'active' ? '🟢 Ready to use' : `✅ Used on #${c.orderId}`}`);
    return interaction.reply(ephemeral(lines.join('\n'), {}, { title: '🎟️ Your codes' }));
  }

  function handleComponent(interaction) {
    const [, action, code] = interaction.customId.split(':');
    switch (action) {
      case 'link': return getLink(interaction);
      case 'claim': return claim(interaction);
      case 'invited': return invitedDiscount(interaction);
      case 'codes': return myCodes(interaction);
      // The bare code as message text, easy to long-press and copy on mobile.
      case 'copy': return interaction.reply({ content: code, flags: MessageFlags.Ephemeral });
    }
  }

  return { loadInvites, inviteCreated, memberJoined, handleComponent };
}

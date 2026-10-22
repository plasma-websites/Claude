import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { COLORS, dm, ephemeral, isAdmin, say } from './util.js';
import { applicationButtons, applicationEmbed, applicationQuestion } from './views.js';

const STEP_MS = 30 * 60 * 1000; // time to answer each question
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 10;

// Questions asked in DMs. kind: 'images' (one message of images), 'yesno' (buttons) or 'text'.
export const FORMS = {
  orderer: {
    title: '🧑‍🍳 Orderer application',
    steps: [
      { id: 'vcProof', label: '🎙️ VC proof', kind: 'images', skip: 'I don\'t have any', prompt: '🎙️ Do you have **proof of VCs**? Send **all** your proof as **images in one message**.' },
      { id: 'vouches', label: '⭐ Has vouches', kind: 'yesno', prompt: '⭐ Do you have **vouches**?' },
      { id: 'orderProof', label: '🧾 Order proof', kind: 'images', skip: 'I don\'t have any', prompt: '🧾 Send your **order proof** as **images in one message**.' },
      { id: 'otherServers', label: '🏢 Works in other servers', kind: 'yesno', prompt: '🏢 Do you work in any **other servers**?' },
      { id: 'times', label: '🕒 Active times', kind: 'text', prompt: '🕒 What **times** will you be active? (e.g. weekdays 6pm–11pm, weekends all day)' },
    ],
  },
  partner: {
    title: '🤝 Partner application',
    steps: [
      { id: 'link', label: '🔗 Server link', kind: 'text', invite: true, prompt: '🔗 Send your **Discord server invite link**.' },
      { id: 'members', label: '👥 Members', kind: 'text', prompt: '👥 How many **members** does your server have?' },
      { id: 'organic', label: '🌱 Members gained organically', kind: 'yesno', prompt: '🌱 Did you get these members **organically**? (no bought members, bots or member-swap servers)' },
      { id: 'about', label: '📝 About the server', kind: 'text', prompt: '📝 What is your server about?' },
      { id: 'offer', label: '🤝 Partnership', kind: 'text', prompt: '🤝 What are you looking for from the partnership, and what can you offer us?' },
    ],
  },
};

const INVITE = /(discord\.gg|discord(app)?\.com\/invite)\/[\w-]+/i;

// Orderer and partner applications, asked one question at a time in DMs and
// posted to the applications channel with Accept / Deny buttons.
export function createApplications({ client, config, store }) {
  const sessions = new Map(); // userId → { type, step, answers, images, expiresAt }

  const ask = (userId) => {
    const s = sessions.get(userId);
    const form = FORMS[s.type];
    s.expiresAt = Date.now() + STEP_MS;
    return dm(client, userId, applicationQuestion(form, s.step));
  };

  async function start(interaction, type) {
    if (store.pendingApplication(interaction.user.id, type)) {
      return interaction.reply(ephemeral('📨 You already have an application waiting for review. We\'ll DM you when it\'s been looked at!'));
    }
    sessions.set(interaction.user.id, { type, step: 0, answers: {}, images: {}, tag: interaction.user.username, expiresAt: 0 });
    if (!(await ask(interaction.user.id))) {
      sessions.delete(interaction.user.id);
      return interaction.reply(ephemeral('❌ I couldn\'t DM you! Turn on **Direct Messages** for this server (click the server name → **Privacy Settings**) and try again.', {}, { color: COLORS.danger }));
    }
    return interaction.reply(ephemeral(`📬 **Check your DMs!** I've sent you the first question of your ${FORMS[type].title.toLowerCase()}.`, {}, { color: COLORS.success }));
  }

  async function next(userId, answer, images = null) {
    const s = sessions.get(userId);
    const step = FORMS[s.type].steps[s.step];
    s.answers[step.id] = answer;
    if (images) s.images[step.id] = images;
    s.step += 1;
    if (s.step < FORMS[s.type].steps.length) return ask(userId);
    sessions.delete(userId);
    return submit(userId, s);
  }

  async function submit(userId, s) {
    const application = store.createApplication({ type: s.type, userId, userName: s.tag, answers: s.answers });
    try {
      const channel = await client.channels.fetch(config.applicationsChannelId);
      const message = await channel.send({ embeds: [applicationEmbed(application, FORMS[s.type])], components: applicationButtons(application) });
      store.updateApplication(application.id, { channelId: channel.id, messageId: message.id });
      for (const [stepId, images] of Object.entries(s.images)) {
        const label = FORMS[s.type].steps.find((st) => st.id === stepId).label;
        await channel.send({
          ...say(`${label} — application **#${application.id}** from <@${userId}>`),
          files: images.map((img) => new AttachmentBuilder(img.data, { name: img.name })),
          reply: { messageReference: message.id, failIfNotExists: false },
          allowedMentions: { parse: [] },
        });
      }
    } catch (err) {
      console.error(`Could not post application #${application.id}:`, err.message);
      store.updateApplication(application.id, { status: 'failed' });
      return dm(client, userId, say('😔 Sorry, your application couldn\'t be sent. Please open a support ticket.', {}, { color: COLORS.danger }));
    }
    return dm(client, userId, say('✅ **Application sent!** Our team will review it and DM you with the result. Thanks! 💛', {}, { title: FORMS[s.type].title }));
  }

  // DMs while an application is in progress. Returns true when the message was for us.
  async function handleDm(message) {
    const s = sessions.get(message.author.id);
    if (!s) return false;
    const reply = (text) => message.reply(say(text, {}, { color: COLORS.warning }));
    if (Date.now() > s.expiresAt) {
      sessions.delete(message.author.id);
      await reply('⏰ Your application timed out. Press the apply button again to start over.');
      return true;
    }
    const step = FORMS[s.type].steps[s.step];
    if (step.kind === 'yesno') {
      const answer = /^(y|yes|yeah|yep)\b/i.test(message.content) ? 'Yes' : /^(n|no|nope|nah)\b/i.test(message.content) ? 'No' : null;
      if (!answer) await reply('Please answer with the **Yes** or **No** buttons above. 👆');
      else await next(message.author.id, answer);
      return true;
    }
    if (step.kind === 'images') {
      const images = [...message.attachments.values()].filter((a) => a.contentType?.startsWith('image/'));
      if (!images.length) {
        await reply(`🖼️ Please send your proof as **images** (all in one message)${step.skip ? `, or press **${step.skip}**` : ''}.`);
        return true;
      }
      if (images.length > MAX_IMAGES || images.some((a) => a.size > MAX_IMAGE_BYTES)) {
        await reply(`📏 Max ${MAX_IMAGES} images, 10 MB each. Please send fewer or smaller images.`);
        return true;
      }
      try {
        const files = [];
        for (const a of images) {
          const res = await fetch(a.url);
          if (!res.ok) throw new Error(`download failed: ${res.status}`);
          files.push({ name: a.name, data: Buffer.from(await res.arrayBuffer()) });
        }
        await next(message.author.id, `${files.length} image${files.length === 1 ? '' : 's'} (attached below)`, files);
      } catch (err) {
        console.error('Could not download application images:', err.message);
        await reply('😔 I couldn\'t save those images. Please send them again.');
      }
      return true;
    }
    const text = message.content.trim();
    if (!text) await reply('✏️ Please type your answer.');
    else if (step.invite && !INVITE.test(text)) await reply('🔗 That doesn\'t look like a Discord invite link (e.g. `https://discord.gg/abc123`). Please send it again.');
    else await next(message.author.id, text.slice(0, 1000));
    return true;
  }

  async function answerButton(interaction, answer) {
    const s = sessions.get(interaction.user.id);
    if (!s || Date.now() > s.expiresAt) {
      sessions.delete(interaction.user.id);
      return interaction.update(say('⏰ This application has expired. Press the apply button again to start over.', { components: [] }));
    }
    const step = FORMS[s.type].steps[s.step];
    if (answer === 'cancel') {
      sessions.delete(interaction.user.id);
      return interaction.update(say('❌ Application cancelled.', { components: [] }));
    }
    const value = { yes: 'Yes', no: 'No', skip: 'None provided' }[answer];
    if ((answer === 'skip' && step.kind !== 'images') || (answer !== 'skip' && step.kind !== 'yesno')) {
      return interaction.reply({ ...say('That button is for an earlier question — answer the latest one. 👇'), flags: MessageFlags.Ephemeral });
    }
    await interaction.update({ ...applicationQuestion(FORMS[s.type], s.step, value), components: [] });
    return next(interaction.user.id, value);
  }

  async function review(interaction, decision, id) {
    if (!isAdmin(interaction)) return interaction.reply(ephemeral('Only admins can review applications.', {}, { color: COLORS.danger }));
    const application = store.getApplication(id);
    if (!application || application.status !== 'pending') return interaction.reply(ephemeral('This application has already been reviewed.'));
    let note = '';
    if (decision === 'accepted' && application.type === 'orderer' && config.trialRoleId) {
      try {
        const member = await interaction.guild.members.fetch(application.userId);
        await member.roles.add(config.trialRoleId, `Orderer application #${id} accepted by ${interaction.user.tag}`);
        note = `\n🎓 Given <@&${config.trialRoleId}>.`;
      } catch (err) {
        note = `\n⚠️ Couldn't give the trial role: ${err.message}`;
      }
    }
    const updated = store.updateApplication(id, { status: decision, reviewedBy: interaction.user.id, reviewedAt: new Date().toISOString() });
    await interaction.update({ embeds: [applicationEmbed(updated, FORMS[updated.type])], components: [] });
    if (note) await interaction.followUp(ephemeral(note.trim()));
    const form = FORMS[updated.type];
    const text =
      decision === 'accepted'
        ? `🎉 Good news — your **${form.title.replace(/^\S+ /, '').toLowerCase()}** was **accepted**!${updated.type === 'orderer' ? ' You\'ve been given the trial orderer role. Welcome to the team! 🧑‍🍳' : ' A staff member will be in touch. 🤝'}`
        : `Thanks for applying — unfortunately your **${form.title.replace(/^\S+ /, '').toLowerCase()}** wasn't accepted this time. 💛`;
    dm(client, updated.userId, say(text, {}, { title: form.title }));
  }

  function handleComponent(interaction) {
    const [, action, id] = interaction.customId.split(':');
    switch (action) {
      case 'orderer':
      case 'partner':
        return start(interaction, action);
      case 'yes':
      case 'no':
      case 'skip':
      case 'cancel':
        return answerButton(interaction, action);
      case 'accept': return review(interaction, 'accepted', Number(id));
      case 'deny': return review(interaction, 'denied', Number(id));
    }
  }

  return { handleDm, handleComponent };
}

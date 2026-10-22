import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { SERVICES, STATUS, SUPPORT_STATUS, money, orderFee } from './services.js';
import { COLORS, ephemeral, hasRole, isAdmin, panel } from './util.js';
import { transcriptSearchModal } from './views.js';

const MAX_FETCH_PAGES = 50; // 5,000 messages per ticket
const FILES_PER_MESSAGE = 10; // Discord's limit

// One saved message: who sent it, when, its text, its embeds as text and its attachments.
export function messageEntry(m) {
  const mentions = {};
  for (const u of m.mentions?.users?.values?.() ?? []) mentions[u.id] = u.username;
  return {
    id: m.id,
    at: new Date(m.createdTimestamp ?? Date.now()).toISOString(),
    authorId: m.author.id,
    author: m.author.username,
    bot: Boolean(m.author.bot),
    content: m.content ?? '',
    embeds: (m.embeds ?? []).map((e) =>
      [e.title, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`), e.footer?.text].filter(Boolean).join('\n'),
    ),
    attachments: [...(m.attachments?.values?.() ?? [])].map((a) => ({ name: a.name, url: a.url })),
    mentions,
  };
}

const stamp = (iso) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—');

function renderEntries(entries) {
  if (!entries.length) return '(No messages were saved for this ticket. It was either never opened or opened before transcripts were added.)';
  const names = Object.assign({}, ...entries.map((e) => e.mentions ?? {}));
  const readable = (text) => text.replace(/<@!?(\d+)>/g, (_, id) => `@${names[id] ?? id}`).replace(/<@&(\d+)>/g, '@role').replace(/<#(\d+)>/g, '#channel');
  return entries
    .map((e) => {
      const lines = [`[${stamp(e.at)}] ${e.author}${e.bot ? ' [BOT]' : ''} (${e.authorId}):${e.content ? ` ${readable(e.content)}` : ''}`];
      for (const embed of e.embeds) lines.push(...readable(embed).split('\n').map((l) => `    ┃ ${l}`));
      for (const a of e.attachments) lines.push(`    📎 ${a.name} — ${a.url}`);
      return lines.join('\n');
    })
    .join('\n');
}

export function renderOrderTranscript(order, entries) {
  const service = SERVICES[order.service];
  const details = service.fields
    .map((f) => [f.label.replace(' (optional)', ''), order.details?.[f.id]?.trim()])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`);
  return [
    `Food Hub — ${service.label} order #${order.id}`,
    `Customer: ${order.customerName ?? '—'} (${order.customerId})`,
    `Orderer: ${order.ordererId ?? '—'}${order.forfeitedBy?.length ? ` (forfeited by ${order.forfeitedBy.filter(Boolean).join(', ')})` : ''}`,
    `Promo: ${order.promo ?? 'None'} · Fee: ${money(orderFee(order))} · VC: ${order.vc ? 'Yes' : 'No'}`,
    `Status: ${STATUS[order.status]?.label ?? order.status}`,
    `Placed: ${stamp(order.createdAt)} · Last update: ${stamp(order.updatedAt)}`,
    ...details,
    '='.repeat(60),
    renderEntries(entries),
    '',
  ].join('\n');
}

export function renderSupportTranscript(ticket, entries) {
  return [
    `Food Hub — support ticket #${ticket.id}`,
    `Member: ${ticket.userName ?? '—'} (${ticket.userId})`,
    `Reason: ${ticket.reason}`,
    `Status: ${SUPPORT_STATUS[ticket.status]?.label ?? ticket.status}`,
    `Opened: ${stamp(ticket.createdAt)}`,
    '='.repeat(60),
    renderEntries(entries),
    '',
  ].join('\n');
}

// Every message in an order or support ticket is saved as it's sent, so a
// transcript survives the channel being deleted by hand. When the bot deletes
// a ticket itself it re-reads the whole channel first, which also picks up edits.
export function createTranscripts({ client, config, store }) {
  const fileFor = (kind, id) => path.join(config.transcriptDir, `${kind}-${id}.jsonl`);

  function ticketFor(channelId) {
    const order = store.orderByTicket(channelId);
    if (order) return { kind: 'order', id: order.id };
    const support = store.supportByChannel(channelId);
    return support ? { kind: 'support', id: support.id } : null;
  }

  function read(kind, id) {
    try {
      return fs.readFileSync(fileFor(kind, id), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // Called for every server message, the bot's own included.
  function record(message) {
    const ticket = ticketFor(message.channelId);
    if (!ticket) return;
    try {
      fs.mkdirSync(config.transcriptDir, { recursive: true });
      fs.appendFileSync(fileFor(ticket.kind, ticket.id), `${JSON.stringify(messageEntry(message))}\n`);
    } catch (err) {
      console.error(`Could not save a message to the ${ticket.kind} #${ticket.id} transcript:`, err.message);
    }
  }

  // Re-reads the whole ticket channel and saves it. Call before deleting a ticket.
  async function saveChannel(channelId) {
    const ticket = ticketFor(channelId);
    if (!ticket) return;
    try {
      const channel = await client.channels.fetch(channelId);
      const all = [];
      let before;
      for (let page = 0; page < MAX_FETCH_PAGES; page++) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        all.push(...batch.values());
        if (batch.size < 100) break;
        before = batch.lastKey();
      }
      const fetched = all.reverse().map(messageEntry);
      // Keep anything the live log has that the channel no longer does (e.g. deleted messages).
      const seen = new Set(fetched.map((e) => e.id));
      const entries = [...read(ticket.kind, ticket.id).filter((e) => !seen.has(e.id)), ...fetched].sort((a, b) => a.at.localeCompare(b.at));
      fs.mkdirSync(config.transcriptDir, { recursive: true });
      const file = fileFor(ticket.kind, ticket.id);
      fs.writeFileSync(`${file}.tmp`, entries.map((e) => `${JSON.stringify(e)}\n`).join(''));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error(`Could not save the full ${ticket.kind} #${ticket.id} transcript (the live log is kept):`, err.message);
    }
  }

  // All of a member's orders and support tickets, newest first, as text files.
  function filesFor(userId) {
    const orders = store.recentOrdersFor(userId, Infinity).map((o) => ({
      line: `${SERVICES[o.service].emoji} **#${o.id}** ${SERVICES[o.service].label} · ${STATUS[o.status].emoji} ${STATUS[o.status].label} · <t:${Math.floor(Date.parse(o.createdAt) / 1000)}:d>`,
      file: new AttachmentBuilder(Buffer.from(renderOrderTranscript(o, read('order', o.id))), { name: `order-${o.id}.txt` }),
    }));
    const support = store.supportFor(userId).map((t) => ({
      line: `🎫 **Support #${t.id}** · ${SUPPORT_STATUS[t.status]?.label ?? t.status} · <t:${Math.floor(Date.parse(t.createdAt) / 1000)}:d>`,
      file: new AttachmentBuilder(Buffer.from(renderSupportTranscript(t, read('support', t.id))), { name: `support-${t.id}.txt` }),
    }));
    return { orders, support };
  }

  const canSearch = (interaction) =>
    isAdmin(interaction) || hasRole(interaction.member, config.ordererRoleId) || hasRole(interaction.member, config.supportRoleId);

  async function search(interaction) {
    if (!canSearch(interaction)) return interaction.reply(ephemeral('Only staff can search transcripts.', {}, { color: COLORS.danger }));
    const userId = /\d{17,20}/.exec(interaction.fields.getTextInputValue('user'))?.[0];
    if (!userId) return interaction.reply(ephemeral('That isn\'t a user ID. Right-click the member → **Copy User ID** (needs Developer Mode).'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { orders, support } = filesFor(userId);
    if (!orders.length && !support.length) {
      return interaction.editReply({ embeds: [panel(`📭 No orders or support tickets found for <@${userId}> (\`${userId}\`).`, { color: COLORS.warning })] });
    }
    const list = (items) => {
      const lines = [];
      for (const item of items) {
        if ([...lines, item.line].join('\n').length > 1900) {
          lines.push(`…and ${items.length - lines.length} more (all attached)`);
          break;
        }
        lines.push(item.line);
      }
      return lines.join('\n');
    };
    const embed = panel(
      [
        `👤 <@${userId}> (\`${userId}\`)`,
        orders.length ? `\n🧾 **${orders.length} order(s)**\n${list(orders)}` : '\n🧾 No orders.',
        support.length ? `\n🎫 **${support.length} support ticket(s)**\n${list(support)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      { title: '📜 Transcripts', color: COLORS.info },
    );
    const files = [...orders, ...support].map((i) => i.file);
    await interaction.editReply({ embeds: [embed], files: files.slice(0, FILES_PER_MESSAGE) });
    for (let i = FILES_PER_MESSAGE; i < files.length; i += FILES_PER_MESSAGE) {
      await interaction.followUp({ files: files.slice(i, i + FILES_PER_MESSAGE), flags: MessageFlags.Ephemeral });
    }
  }

  function handleComponent(interaction) {
    switch (interaction.customId) {
      case 'transcript:open':
        if (!canSearch(interaction)) return interaction.reply(ephemeral('Only staff can search transcripts.', {}, { color: COLORS.danger }));
        return interaction.showModal(transcriptSearchModal());
      case 'transcript:search':
        return search(interaction);
    }
  }

  return { record, saveChannel, read, handleComponent };
}

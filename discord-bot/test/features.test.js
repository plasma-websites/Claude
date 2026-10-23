import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickWinners } from '../src/giveaways.js';
import { Store } from '../src/store.js';
import { createTranscripts, messageEntry, renderOrderTranscript } from '../src/transcripts.js';
import * as views from '../src/views.js';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bot-'));
const ids = (rows) => rows.flatMap((r) => r.toJSON().components.map((c) => c.custom_id));

test('giveaway entries toggle, and winners are drawn once each', () => {
  const store = new Store(path.join(tempDir(), 'store.json'));
  const g = store.createGiveaway({ title: 'Free food', info: '', winners: 2, endsAt: new Date(Date.now() + 60e3).toISOString(), hostId: 'h', channelId: 'c' });
  assert.equal(store.toggleEntry(g.id, 'a').entered, true);
  assert.equal(store.toggleEntry(g.id, 'b').entered, true);
  assert.equal(store.toggleEntry(g.id, 'a').entered, false, 'pressing again leaves');
  assert.deepEqual(store.getGiveaway(g.id).entrants, ['b']);
  assert.equal(store.dueGiveaways().length, 0);
  assert.equal(store.dueGiveaways(Date.now() + 120e3)[0].id, g.id);
  store.updateGiveaway(g.id, { status: 'ended' });
  assert.match(store.toggleEntry(g.id, 'c').error, /ended/);

  const winners = pickWinners(['1', '2', '3', '4', '5'], 3);
  assert.equal(new Set(winners).size, 3);
  assert.deepEqual(pickWinners(['1'], 3), ['1']);
  assert.deepEqual(pickWinners([], 1), []);
});

test('giveaway post shows an Enter button, then Reroll once ended', () => {
  const g = { id: 1, title: 'T', info: 'Win stuff', winners: 1, endsAt: new Date().toISOString(), hostId: 'h', entrants: ['a'], winnerIds: [], status: 'running' };
  assert.deepEqual(ids(views.giveawayButtons(g)), ['giveaway:enter:1']);
  assert.equal(views.giveawayEmbed(g).toJSON().fields.find((f) => f.name.includes('Entries')).value, '1');
  const ended = { ...g, status: 'ended', winnerIds: ['a'] };
  assert.deepEqual(ids(views.giveawayButtons(ended)), ['giveaway:enter:1', 'giveaway:reroll:1']);
  assert.equal(views.giveawayEmbed(ended).toJSON().fields.find((f) => f.name.includes('Winners')).value, '<@a>');
  assert.equal(views.giveawayModal('chan').toJSON().custom_id, 'giveaway:create:chan');
  assert.deepEqual(ids(views.transcriptPanel().components), ['transcript:open']);
});

const fakeMessage = (id, channelId, content, extra = {}) => ({
  id,
  channelId,
  content,
  createdTimestamp: Date.parse('2026-10-22T12:00:00Z') + Number(id),
  author: { id: 'u1', username: 'plasma', bot: false },
  mentions: { users: new Map([['222', { id: '222', username: 'chef' }]]) },
  embeds: [],
  attachments: new Map(),
  ...extra,
});

test('ticket messages are saved as they are sent and rendered into a transcript', () => {
  const dir = tempDir();
  const store = new Store(path.join(dir, 'store.json'));
  const order = store.createOrder({ service: 'ubereats', promo: '10 off', vc: false, details: { address: '1 Road' }, customerId: 'u1', customerName: 'plasma' });
  store.updateOrder(order.id, { ticketChannelId: 'chan' });
  const transcripts = createTranscripts({ client: null, config: { transcriptDir: path.join(dir, 't') }, store });
  transcripts.record(fakeMessage('1', 'chan', 'hi <@222>'));
  transcripts.record(fakeMessage('2', 'chan', '', { author: { id: 'bot', username: 'Food Hub', bot: true }, embeds: [{ title: 'Payment due', description: '£5', fields: [] }] }));
  transcripts.record(fakeMessage('3', 'elsewhere', 'not a ticket'));
  const entries = transcripts.read('order', order.id);
  assert.equal(entries.length, 2);
  const text = renderOrderTranscript(store.getOrder(order.id), entries);
  assert.ok(text.includes(`order #${order.id}`) && text.includes('Delivery address: 1 Road'));
  assert.ok(text.includes('plasma (u1): hi @chef'));
  assert.ok(text.includes('Food Hub [BOT]') && text.includes('┃ Payment due'));
  assert.ok(renderOrderTranscript(order, []).includes('No messages were saved'));
  assert.equal(messageEntry(fakeMessage('4', 'chan', 'x')).author, 'plasma');
});

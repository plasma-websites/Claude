import Anthropic from '@anthropic-ai/sdk';
import { PAYMENT_METHODS, SERVICES, STATUS, money } from './services.js';
import { TOS } from './tos.js';
import { COLORS, ephemeral, hasRole, isAdmin, panel } from './util.js';
import { aiAnswerEmbed, aiButtons, aiQuestionModal } from './views.js';

const MODEL = 'claude-opus-5-5';
const MAX_QUESTIONS_PER_TICKET = 15;

// Stable Food Hub knowledge. Kept free of per-ticket details so it caches.
function systemPrompt(promos, config) {
  const services = Object.entries(SERVICES)
    .map(([key, s]) => `- ${s.label}: promos ${promos[key].join(', ')}; service fee ${money(s.fee)}`)
    .join('\n');
  const rules = TOS.sections.map((s) => `${s.name}: ${s.value}`).join('\n');
  return `You are the Food Hub AI Assistant, answering customers inside a private Food Hub support ticket on Discord.

About Food Hub:
Food Hub is a Discord community where members submit Uber Eats, Uber Rides, Deliveroo and Just Eat orders and Food Hub orderers place them using legitimate promotions.

Services, promos and fees:
${services}

How ordering works:
1. In the order channel, pick the company from the order panel's menu. The panel shows which orderers are online for each service.
2. Pick a promo, answer "VC?" yes or no, and fill in the address form (delivery address, or pickup and drop-off for rides).
3. The bot DMs you asking for your order screenshot (DMs must be open; you have 15 minutes).
4. An orderer accepts it and a private order ticket opens. The order number is a random 6-digit number like #483920.
5. When payment is due, the orderer posts a payment panel (${Object.values(PAYMENT_METHODS).map((m) => m.label).join(', ')}) with the amount in pounds. Pay, then press "I've paid"; the orderer confirms when it arrives.
6. When the order is done, the orderer marks it completed and the ticket closes automatically ${config.autoCloseHours} hours later.
Other facts: members can have up to ${config.maxOpenOrders} open orders at once. /myorders shows your orders and /cancel id:<number> cancels an order before it is accepted. After a completed order you can leave one vouch per order in the vouch channel. If an orderer can't finish an order they may forfeit it and another orderer takes over in the same ticket.

Order policy & server rules:
${rules}

How to answer:
- Be friendly, clear and brief: a few short sentences or a short list, in British English, prices in pounds (£). Light emoji use is fine.
- Only state facts from this prompt or the customer context you're given. If you don't know (for example delivery times, refunds for a specific order, or anything about a particular staff member), say a staff member will help and suggest pressing "Talk to a human".
- You can't take actions: you can't cancel, refund, change or check the live progress of orders, or contact staff yourself. Explain what the customer can do instead.
- Never ask for or accept card numbers, passwords, account logins or one-time codes, and tell the customer not to share them.
- Don't help with fraud, chargebacks, payment manipulation or getting around Food Hub's rules or a provider's terms.`;
}

function customerContext(store, userId) {
  const orders = store.recentOrdersFor(userId, 5);
  if (!orders.length) return 'Customer context: this customer has no orders yet.';
  const lines = orders.map((o) => {
    const s = SERVICES[o.service];
    return `#${o.id} ${s.label}, promo ${o.promo ?? 'none'}, status: ${STATUS[o.status].label}, placed ${o.createdAt.slice(0, 10)}`;
  });
  return `Customer context (their most recent orders):\n${lines.join('\n')}`;
}

// AI answers in support tickets. Customers ask through a button + form, so the
// bot doesn't need the privileged Message Content intent.
export function createAiHandlers({ client, config, store, promos }) {
  const enabled = Boolean(process.env.ANTHROPIC_API_KEY);
  const anthropic = enabled ? new Anthropic() : null;
  const system = systemPrompt(promos, config);
  const queues = new Map(); // ticket id -> promise, so a ticket's questions are answered one at a time

  // Returns the answer text, or null when the AI can't answer.
  async function ask(ticket, userId, question) {
    const history = ticket.aiHistory ?? [];
    const userTurn = { role: 'user', content: `${customerContext(store, userId)}\n\nQuestion: ${question}` };
    const messages = [...history, userTurn];
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal') return null;
    // Keep the full assistant content (thinking blocks included) so later turns replay it unchanged.
    store.updateSupport(ticket.id, { aiHistory: [...messages, { role: 'assistant', content: response.content }] });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || null;
  }

  // Posts an AI answer in the ticket channel; `question` is shown above the answer.
  function answerInTicket(channel, ticket, userId, question, options) {
    if (!enabled) return Promise.resolve();
    const next = (queues.get(ticket.id) ?? Promise.resolve())
      .then(() => answerNow(channel, store.supportByChannel(channel.id) ?? ticket, userId, question, options))
      .catch((err) => console.error('AI answer failed:', err));
    queues.set(ticket.id, next);
    return next;
  }

  async function answerNow(channel, ticket, userId, question, { showQuestion = true } = {}) {
    if ((ticket.aiHistory?.length ?? 0) / 2 >= MAX_QUESTIONS_PER_TICKET) {
      return channel.send({ embeds: [panel('🤖 I\'ve answered as much as I can in this ticket — a staff member will take it from here. 🙋', { color: COLORS.warning })] });
    }
    await channel.sendTyping().catch(() => {});
    let answer;
    try {
      answer = await ask(ticket, userId, question);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) console.error('AI rate limited:', err.message);
      else if (err instanceof Anthropic.AuthenticationError) console.error('AI: invalid ANTHROPIC_API_KEY');
      else if (err instanceof Anthropic.APIError) console.error(`AI API error ${err.status}:`, err.message);
      else console.error('AI request failed:', err);
      return channel.send({
        embeds: [panel('🤖 Sorry, I couldn\'t answer just now. A staff member will be with you soon. 🙋', { color: COLORS.warning })],
        components: aiButtons(),
      });
    }
    const text = answer ?? 'I can\'t help with that one — press **Talk to a human** and a staff member will take over. 🙋';
    return channel.send({ embeds: [aiAnswerEmbed(text, showQuestion ? question : null)], components: aiButtons() });
  }

  async function handleComponent(interaction) {
    if (!enabled) return interaction.reply(ephemeral('🤖 The AI assistant isn\'t switched on.', {}, { color: COLORS.warning }));
    const ticket = store.supportByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') return interaction.reply(ephemeral('This ticket is closed.'));
    const isStaff = hasRole(interaction.member, config.supportRoleId) || isAdmin(interaction);
    if (ticket.userId !== interaction.user.id && !isStaff) return interaction.reply(ephemeral('Only the ticket owner can use the assistant.'));

    switch (interaction.customId) {
      case 'ai:ask':
        if (ticket.humanRequested) {
          return interaction.reply(ephemeral('🙋 A human has been called for this ticket — they\'ll be with you shortly.', {}, { color: COLORS.info }));
        }
        return interaction.showModal(aiQuestionModal());
      case 'ai:question': {
        await interaction.deferUpdate();
        return answerInTicket(interaction.channel, ticket, ticket.userId, interaction.fields.getTextInputValue('question'));
      }
      case 'ai:human': {
        if (ticket.humanRequested) return interaction.reply(ephemeral('🙋 Staff have already been called — hang tight!', {}, { color: COLORS.info }));
        store.updateSupport(ticket.id, { humanRequested: true });
        return interaction.reply({
          content: `<@&${config.supportRoleId}>`,
          allowedMentions: { roles: [config.supportRoleId] },
          embeds: [panel(`🙋 <@${interaction.user.id}> would like to talk to a human. A staff member will be with you shortly!`, { title: '🔔 Staff requested', color: COLORS.info })],
        });
      }
    }
  }

  return { enabled, answerInTicket, handleComponent };
}

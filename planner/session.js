'use strict';
/* Finishing a study session: blurt what you did → Claude (or the offline sorter)
   splits it into subjects, books, topics and pages → you confirm → it's logged. */

const findBlock = id => Object.values(S.schedule).flat().find(x => x.id === id);
const subjectByName = name => { const n = (name || '').trim().toLowerCase(); return n ? S.subjects.find(x => x.name.toLowerCase() === n) : null; };
const quickEmoji = name => (QUICK_SUBJECTS.find(([n]) => n.toLowerCase() === (name || '').toLowerCase()) || [])[1];
const resumeTimer = ctx => () => { if (ctx.fromTimer && S.timer) { delete S.timer.endedAt; save(); render(); } };

function openBlurt(ctx) {
  const hasKey = !!S.settings.apiKey, sj = subj(ctx.subjectId);
  const f = sheet(`
    <h3>${ctx.fromTimer ? 'Nice work 🎉' : 'Log this session'}</h3>
    <p class="sub">${esc(ctx.title)} · ${KINDS[ctx.kind].label}${sj ? ' · ' + sj.emoji + ' ' + esc(sj.name) : ''}</p>
    <label>Minutes<input name="minutes" type="number" inputmode="numeric" min="1" value="${ctx.minutes}" required></label>
    <label>What did you study? Just blurt it 💬<textarea name="text" placeholder="e.g. bio cgp topic 4 pg 40-52, maths paper 2 2019 q1-12, read ahead chem ch 5">${esc(ctx.text || '')}</textarea></label>
    <p class="sub">${hasKey ? '✨ Claude will sort this into your subjects, books and topics.' : 'I’ll sort this into your subjects. Add a Claude API key in Settings for smarter AI sorting.'}</p>
    <div class="actions"><button type="button" class="btn ghost" data-m="cancel">Cancel</button><button type="submit" class="btn primary">Next ›</button></div>`,
    resumeTimer(ctx));
  f.onclick = e => { if (e.target.closest('[data-m=cancel]')) closeSheet(); };
  f.onsubmit = async e => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const fd = new FormData(f);
    ctx.minutes = Math.max(1, Math.round(Number(fd.get('minutes')) || ctx.minutes));
    ctx.text = String(fd.get('text') || '').trim();
    if (!ctx.text) return confirmEntries(ctx, [{ subject: sj ? sj.name : '', emoji: sj ? sj.emoji : '', minutes: ctx.minutes, resource: '', topic: '', details: '' }]);
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Sorting…';
    let entries;
    try { entries = S.settings.apiKey ? await aiParseSession(ctx) : localParseSession(ctx); }
    catch (err) { entries = localParseSession(ctx); toast('AI sorting failed – used the quick sorter'); }
    confirmEntries(ctx, entries);
  };
}

function confirmEntries(ctx, entries) {
  const f = sheet(`
    <h3>Here’s what I’ll log</h3>
    <p class="sub">${fmtH(ctx.minutes)} · ${KINDS[ctx.kind].label}. Adjust the minutes if you need to.</p>
    <div class="entries">${entries.map((e, i) => {
      const ex = subjectByName(e.subject), work = [e.resource, e.topic].filter(Boolean).join(' · ');
      return `<div class="entry"><span class="ico">${(ex && ex.emoji) || e.emoji || quickEmoji(e.subject) || '📚'}</span>
        <div class="grow"><b>${esc(e.subject || 'General')}</b>${e.subject && !ex ? ' <span class="pill">new subject</span>' : ''}
        ${work ? `<div class="sub">${esc(work)}</div>` : ''}${e.details ? `<div class="sub">${esc(e.details)}</div>` : ''}</div>
        <label class="mins"><input type="number" inputmode="numeric" min="0" name="m${i}" value="${e.minutes}">min</label></div>`;
    }).join('')}</div>
    <div class="actions"><button type="button" class="btn ghost" data-m="back">‹ Back</button><button type="submit" class="btn primary">Save ✓</button></div>`,
    resumeTimer(ctx));
  f.onclick = e => { if (e.target.closest('[data-m=back]')) openBlurt(ctx); };
  f.onsubmit = e => {
    e.preventDefault();
    const fd = new FormData(f), logs = [];
    entries.forEach((en, i) => {
      const minutes = Math.round(Number(fd.get('m' + i)) || 0);
      if (!minutes) return;
      let sj = subjectByName(en.subject);
      if (!sj && en.subject) {
        sj = { id: uid(), name: en.subject, emoji: en.emoji || quickEmoji(en.subject) || '📘', color: SUBJECT_COLORS[S.subjects.length % SUBJECT_COLORS.length], weeklyTarget: 2, examDate: '', teacher: '', notes: '', links: [], plan: [] };
        S.subjects.push(sj);
      }
      logs.push({ subjectId: sj ? sj.id : '', kind: ctx.kind, minutes, blockId: ctx.blockId || '', start: ctx.start, resource: en.resource || '', topic: en.topic || '', details: en.details || '', note: ctx.text || '' });
    });
    if (ctx.fromTimer) S.timer = null;
    sheetOnCancel = null;
    closeSheet(false);
    const total = logs.reduce((a, l) => a + l.minutes, 0);
    toast(`Logged ${fmtH(total)}${logs.length > 1 ? ` across ${logs.length} subjects` : ''} ✓`);
    addLogs(logs); // may show a goal celebration toast on top
    save(); render();
  };
}

// make entry minutes add up exactly to the session length
function fitMinutes(entries, total) {
  if (!entries.length) return entries;
  const sum = entries.reduce((a, e) => a + Math.max(0, e.minutes || 0), 0);
  entries.forEach(e => { e.minutes = sum ? Math.round(Math.max(0, e.minutes || 0) / sum * total) : Math.round(total / entries.length); });
  entries[entries.length - 1].minutes += total - entries.reduce((a, e) => a + e.minutes, 0);
  return entries;
}

const SESSION_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string' }, emoji: { type: 'string' }, minutes: { type: 'integer' },
          resource: { type: 'string' }, topic: { type: 'string' }, details: { type: 'string' }
        },
        required: ['subject', 'emoji', 'minutes', 'resource', 'topic', 'details'],
        additionalProperties: false
      }
    }
  },
  required: ['entries'],
  additionalProperties: false
};

async function aiParseSession(ctx) {
  const { default: Anthropic } = await loadSDK();
  const client = new Anthropic({ apiKey: S.settings.apiKey, dangerouslyAllowBrowser: true });
  const model = S.settings.model in MODELS ? S.settings.model : 'claude-opus-5-5';
  const sj = subj(ctx.subjectId);
  const prompt = [
    'A school student (UK, GCSE/A-level) just finished a study session and quickly "blurted" what they did. Turn it into clean log entries for their planner.',
    '',
    `Session: ${ctx.minutes} minutes, block "${ctx.title}" (${KINDS[ctx.kind].label}).${sj ? ` They started it from their ${sj.name} page, so assume ${sj.name} unless they say otherwise.` : ''}`,
    `Their existing subjects: ${S.subjects.map(x => x.name).join(', ') || '(none yet)'}`,
    `What they wrote: <blurt>${ctx.text}</blurt>`,
    '',
    'Rules:',
    '- One entry per subject studied. Map abbreviations and nicknames to their existing subject names when they match (bio → Biology, chem → Chemistry, phys → Physics, maths/math → Maths, eng lit → English Literature, eng lang → English Language, geog → Geography, RS/RE → Religious Studies, comp sci/CS → Computer Science, etc.). Only use a new subject name if nothing existing fits, written as a proper subject name (e.g. "Biology"). Use an empty string only if no subject can be worked out at all.',
    `- Split the ${ctx.minutes} minutes across the entries so they add up to exactly ${ctx.minutes}. Use any times they mention; otherwise split sensibly by how much work each part was.`,
    '- resource: the book or source, written properly, e.g. "CGP revision guide", "CGP workbook", "Past paper", "Textbook", "Class notes", "Seneca", "Save My Exams", "Flashcards", "Physics & Maths Tutor". Read "cgp" as "CGP revision guide" unless they say workbook. Add the exam board if they mention one, e.g. "Past paper (AQA)". Empty string if none.',
    '- topic: the topic, chapter or paper, tidy and short, e.g. "Topic 4", "Paper 2 (June 2019)", "Chapter 3: Atomic structure". Empty string if none.',
    '- details: pages, questions, marks or anything else they mentioned, short, e.g. "Pages 40–52", "Q1–12 · 46/60". Empty string if none.',
    '- emoji: one emoji that fits the subject.',
    '- Never invent work they didn\'t mention.'
  ].join('\n');
  const params = {
    model, max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SESSION_SCHEMA } },
    messages: [{ role: 'user', content: prompt }]
  };
  // server-side fallback if a request is declined (Opus / Sonnet)
  if (model !== 'claude-haiku-5-5') Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  const res = await client.beta.messages.create(params);
  if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(res.stop_reason);
  const block = res.content.find(b => b.type === 'text');
  const data = JSON.parse(block.text);
  const entries = (data.entries || []).filter(e => e && typeof e.subject === 'string').map(e => ({
    subject: e.subject.trim(), emoji: e.emoji || '', minutes: Number(e.minutes) || 0,
    resource: (e.resource || '').trim(), topic: (e.topic || '').trim(), details: (e.details || '').trim()
  }));
  if (!entries.length) throw new Error('no entries');
  return fitMinutes(entries, ctx.minutes);
}

// offline sorter: keyword matching, used without an API key or if the AI call fails
const SUBJECT_ALIASES = [
  [/\bbio(logy)?\b/i, 'Biology'], [/\bchem(istry)?\b/i, 'Chemistry'], [/\bphys(ics)?\b/i, 'Physics'],
  [/\bfurther\s+maths?\b/i, 'Further Maths'], [/\bmaths?\b/i, 'Maths'], [/\beng(lish)?\s*lit(erature)?\b/i, 'English Literature'],
  [/\beng(lish)?\s*lang(uage)?\b/i, 'English Language'], [/\benglish\b/i, 'English'], [/\bhist(ory)?\b/i, 'History'],
  [/\bgeog(raphy)?\b/i, 'Geography'], [/\b(rs|re|religious\s*studies|religion)\b/i, 'Religious Studies'],
  [/\b(cs|comp\s*sci|computer\s*science|computing)\b/i, 'Computer Science'], [/\bfrench\b/i, 'French'], [/\bspanish\b/i, 'Spanish'],
  [/\bgerman\b/i, 'German'], [/\becon(omics)?\b/i, 'Economics'], [/\bpsych(ology)?\b/i, 'Psychology'], [/\bbusiness\b/i, 'Business'],
  [/\bart\b/i, 'Art'], [/\bsociology\b/i, 'Sociology'], [/\b(stats|statistics)\b/i, 'Statistics']
];
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function localParseSession(ctx) {
  const sj = subj(ctx.subjectId);
  const chunks = ctx.text.split(/[,;\n+]+|\band\b|\bthen\b/i).map(c => c.trim()).filter(Boolean);
  const out = [];
  let last = sj ? sj.name : '';
  for (const c of chunks) {
    let name = (S.subjects.find(x => new RegExp('\\b' + reEscape(x.name) + '\\b', 'i').test(c)) || {}).name || '';
    if (!name) {
      const hit = SUBJECT_ALIASES.find(([re]) => re.test(c));
      if (hit) name = (subjectByName(hit[1]) || { name: hit[1] }).name;
    }
    if (name === 'English' && !subjectByName('English')) { const e = S.subjects.find(x => /^english/i.test(x.name)); if (e) name = e.name; }
    name = name || last;
    const resource = /cgp/i.test(c) ? (/work\s*book|\bwb\b/i.test(c) ? 'CGP workbook' : 'CGP revision guide')
      : /past\s*paper|\bpp\b|\bpaper\s*\d/i.test(c) ? 'Past paper' : /text\s*book/i.test(c) ? 'Textbook' : /seneca/i.test(c) ? 'Seneca'
      : /flash\s*cards?|anki|quizlet/i.test(c) ? 'Flashcards' : /notes/i.test(c) ? 'Class notes' : '';
    const tm = c.match(/\b(topic|chapter|ch|unit|paper|module)\s*\.?\s*(\d+[a-z]?)/i);
    const topic = tm ? `${/^ch/i.test(tm[1]) ? 'Chapter' : tm[1][0].toUpperCase() + tm[1].slice(1).toLowerCase()} ${tm[2]}` : '';
    const pg = c.match(/\b(?:p|pg|pgs|page|pages)\.?\s*(\d+)\s*(?:-|–|to)\s*(\d+)/i);
    const q = c.match(/\bq(?:s|uestions?)?\.?\s*(\d+)\s*(?:-|–|to)\s*(\d+)/i);
    const details = [pg && `Pages ${pg[1]}–${pg[2]}`, q && `Q${q[1]}–${q[2]}`].filter(Boolean).join(' · ');
    const prev = out.find(e => e.subject === name);
    if (prev) {
      prev.minutes++;
      if (!prev.topic) prev.topic = topic; else if (topic && !prev.topic.includes(topic)) prev.topic += ', ' + topic;
      if (!prev.resource) prev.resource = resource;
      if (details) prev.details = [prev.details, details].filter(Boolean).join(' · ');
    } else out.push({ subject: name, emoji: '', minutes: 1, resource, topic, details });
    last = name;
  }
  if (!out.length) out.push({ subject: sj ? sj.name : '', emoji: '', minutes: 1, resource: '', topic: '', details: '' });
  return fitMinutes(out, ctx.minutes);
}

Object.assign(actions, {
  'timer-pick': el => startTimer(el.dataset.sid || '', el.dataset.kind || 'study'),
  'session-start': el => { const b = findBlock(el.dataset.id); if (b && !S.timer) startTimer(b.subjectId || '', isStudyKind(b.kind) ? b.kind : 'study', b.id); },
  'session-finish': () => {
    const t = S.timer; if (!t) return;
    t.endedAt = Date.now();
    const b = t.blockId && findBlock(t.blockId), sj = subj(t.subjectId);
    openBlurt({ fromTimer: true, minutes: Math.max(1, Math.round((t.endedAt - t.startedAt) / 60000)), kind: t.kind, blockId: t.blockId || '', subjectId: t.subjectId, start: t.startedAt, title: b ? b.title : sj ? sj.name : KINDS[t.kind].label });
  },
  'session-log': el => {
    const b = findBlock(el.dataset.id); if (!b) return;
    openBlurt({ minutes: blockLen(b), kind: isStudyKind(b.kind) ? b.kind : 'study', blockId: b.id, subjectId: b.subjectId, title: b.title });
  }
});

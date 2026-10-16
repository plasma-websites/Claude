'use strict';

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const fmtH = mins => { mins = Math.round(mins); const h = Math.floor(mins / 60), m = mins % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; };
const fmtClock = secs => { const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = Math.floor(secs % 60); return `${h ? h + ':' : ''}${pad(m)}:${pad(s)}`; };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const daysUntil = key => Math.round((parseKey(key) - parseKey(dkey())) / 864e5);
const prettyDate = key => parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ---------- state ---------- */
const KEY = 'myplan.v1';

function seed() {
  const s = (name, emoji, color, weeklyTarget, topics) => ({
    id: uid(), name, emoji, color, weeklyTarget, examDate: '', teacher: '', notes: '', links: [],
    plan: topics.map(t => ({ id: uid(), text: t, done: false }))
  });
  const subjects = [
    s('Maths', '📐', '#4f46e5', 4, ['Algebra – equations & inequalities', 'Functions & graphs', 'Trigonometry', 'Probability & statistics', 'Past paper 1']),
    s('English', '📖', '#db2777', 3, ['Re-read set text & make notes', 'Essay structure practice', 'Poetry comparison', 'Timed essay']),
    s('Science', '🧪', '#0d9488', 4, ['Cells & organisation', 'Chemical reactions', 'Forces & motion', 'Required practicals review']),
    s('History', '🏛️', '#b45309', 2, ['Timeline of key events', 'Source analysis practice', 'Essay plans'])
  ];
  const [ma, en, sc, hi] = subjects.map(x => x.id);
  const b = (start, end, title, subjectId = '') => ({ id: uid(), start, end, title, subjectId });
  const weekday = rot => [
    b('07:00', '07:45', 'Wake up, breakfast, get ready'),
    b('08:30', '15:30', 'School'),
    b('15:30', '16:15', 'Break + snack'),
    b('16:15', '17:15', 'Study block 1', rot[0]),
    b('17:30', '18:30', 'Exercise'),
    b('18:30', '19:30', 'Dinner + free time'),
    b('19:30', '20:30', 'Study block 2', rot[1]),
    b('21:30', '22:00', 'Wind down – no screens'),
    b('22:00', '07:00', 'Sleep')
  ];
  return {
    profile: { name: '' },
    life: {
      vision: 'Who I want to be in 5 years: healthy, confident, doing work I care about, with great friends and family around me.\n\n(Example – tap here and write your own.)',
      areas: [
        { id: uid(), emoji: '🎓', title: 'School & career', goals: [{ id: uid(), text: 'Get the grades I need for my next step', by: '', done: false }, { id: uid(), text: 'Research careers/courses I like', by: '', done: false }] },
        { id: uid(), emoji: '💪', title: 'Health & fitness', goals: [{ id: uid(), text: 'Exercise 4× a week', by: '', done: false }, { id: uid(), text: 'Sleep 8 hours on school nights', by: '', done: false }] },
        { id: uid(), emoji: '❤️', title: 'Friends & family', goals: [{ id: uid(), text: 'Phone-free dinner with family', by: '', done: false }] },
        { id: uid(), emoji: '🌱', title: 'Personal growth', goals: [{ id: uid(), text: 'Read 12 books this year', by: '', done: false }, { id: uid(), text: 'Learn a new skill', by: '', done: false }] },
        { id: uid(), emoji: '💰', title: 'Money', goals: [{ id: uid(), text: 'Save a little every month', by: '', done: false }] }
      ]
    },
    subjects,
    schedule: {
      1: weekday([ma, en]), 2: weekday([sc, hi]), 3: weekday([ma, sc]), 4: weekday([en, hi]), 5: weekday([sc, ''])
        .map(x => x.title === 'Study block 2' ? { ...x, title: 'Free evening', subjectId: '' } : x),
      6: [b('09:00', '10:00', 'Lie-in + breakfast'), b('10:00', '12:00', 'Weekend study', ma), b('12:00', '22:00', 'Free time / sport / friends')],
      0: [b('10:00', '11:00', 'Plan the week ahead'), b('11:00', '12:30', 'Weekend study', sc), b('12:30', '21:30', 'Free time / family'), b('21:30', '22:00', 'Pack bag for Monday')]
    },
    tasks: [],
    logs: [],
    timer: null,
    settings: { notify: false, remindBefore: 5, dailyGoalHours: 2, dailyReminderTime: '18:30' },
    notified: {}
  };
}

let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
  if (!S || !S.subjects) S = seed();
  const d = seed();
  for (const k of Object.keys(d)) if (S[k] === undefined) S[k] = d[k];
  S.settings = { ...d.settings, ...S.settings };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('Could not save – storage full or blocked'); }
}
load();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const subj = id => S.subjects.find(x => x.id === id);
const blocksFor = date => [...(S.schedule[date.getDay()] || [])].sort((a, b) => toMin(a.start) - toMin(b.start));
const minsOn = (key, subjectId) => S.logs.filter(l => l.date === key && (!subjectId || l.subjectId === subjectId)).reduce((a, l) => a + l.minutes, 0);
const minsSince = (from, subjectId) => { const k = dkey(from); return S.logs.filter(l => l.date >= k && (!subjectId || l.subjectId === subjectId)).reduce((a, l) => a + l.minutes, 0); };
const minsTotal = subjectId => S.logs.filter(l => !subjectId || l.subjectId === subjectId).reduce((a, l) => a + l.minutes, 0);
function streak() {
  const days = new Set(S.logs.map(l => l.date));
  const d = new Date(); let n = 0;
  if (!days.has(dkey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dkey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
// a block that ends before it starts (e.g. 22:00 → 07:00) wraps past midnight
function inBlock(b, m) { const s = toMin(b.start), e = toMin(b.end); return e > s ? m >= s && m < e : m >= s || m < e; }

/* ---------- ui bits ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// Generic form modal. fields: {name,label,type,value,options,placeholder}
function openForm({ title, fields, onSave, onDelete, saveLabel = 'Save' }) {
  const f = $('#modal-form');
  f.innerHTML = `<h3>${esc(title)}</h3>` + fields.map(fl => {
    const v = fl.value ?? '';
    if (fl.type === 'select') return `<label>${esc(fl.label)}<select name="${fl.name}">${fl.options.map(o => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    if (fl.type === 'textarea') return `<label>${esc(fl.label)}<textarea name="${fl.name}" placeholder="${esc(fl.placeholder || '')}">${esc(v)}</textarea></label>`;
    if (fl.type === 'days') return `<label>${esc(fl.label)}<div class="days">${DAY_ORDER.map(d => `<label><input type="checkbox" name="${fl.name}" value="${d}" ${v.includes(d) ? 'checked' : ''}>${DAYS[d]}</label>`).join('')}</div></label>`;
    return `<label>${esc(fl.label)}<input name="${fl.name}" type="${fl.type || 'text'}" value="${esc(v)}" placeholder="${esc(fl.placeholder || '')}" ${fl.step ? `step="${fl.step}"` : ''} ${fl.min !== undefined ? `min="${fl.min}"` : ''} ${fl.required ? 'required' : ''}></label>`;
  }).join('') + `<div class="actions">${onDelete ? '<button type="button" class="btn danger" data-m="del">Delete</button><span class="grow"></span>' : ''}<button type="button" class="btn ghost" data-m="cancel">Cancel</button><button type="submit" class="btn primary">${esc(saveLabel)}</button></div>`;
  const dlg = $('#modal');
  f.onsubmit = e => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const fd = new FormData(f), out = {};
    for (const fl of fields) out[fl.name] = fl.type === 'days' ? fd.getAll(fl.name).map(Number) : (fd.get(fl.name) ?? '').toString().trim();
    dlg.close(); onSave(out); save(); render();
  };
  f.onclick = e => {
    const m = e.target.closest('[data-m]'); if (!m) return;
    if (m.dataset.m === 'cancel') dlg.close();
    if (m.dataset.m === 'del' && confirm('Delete this?')) { dlg.close(); onDelete(); save(); render(); }
  };
  dlg.showModal();
  const first = f.querySelector('input:not([type=checkbox]),textarea'); if (first && !('ontouchstart' in window)) first.focus();
}

const subjectOptions = (blank = 'None') => [{ value: '', label: blank }, ...S.subjects.map(x => ({ value: x.id, label: `${x.emoji} ${x.name}` }))];

/* ---------- views ---------- */
const views = {};

views.today = () => {
  const now = new Date(), key = dkey(now), m = nowMin();
  const blocks = blocksFor(now);
  const cur = blocks.find(b => inBlock(b, m) && toMin(b.end) > toMin(b.start)) || blocks.find(b => inBlock(b, m));
  const next = blocks.find(b => toMin(b.start) > m);
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayMins = minsOn(key), goal = S.settings.dailyGoalHours * 60;
  const tasks = S.tasks.filter(t => t.date === key || (!t.done && t.date < key));
  const exams = S.subjects.filter(x => x.examDate && daysUntil(x.examDate) >= 0).sort((a, b) => a.examDate.localeCompare(b.examDate)).slice(0, 3);
  const ws = weekStart();
  const behind = S.subjects.map(x => ({ x, left: x.weeklyTarget * 60 - minsSince(ws, x.id) })).filter(o => o.left > 0).sort((a, b) => b.left - a.left)[0];
  const goals = S.life.areas.flatMap(a => a.goals.filter(g => !g.done).map(g => ({ ...g, area: a })));
  const focusGoals = goals.slice(0, 3);

  const curS = cur && subj(cur.subjectId);
  const nextTopic = curS && curS.plan.find(p => !p.done);

  return `
  <div class="topbar">
    <div><div class="sub">${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <h1>${hello}${S.profile.name ? ', ' + esc(S.profile.name) : ''}</h1></div>
    <a class="icon-btn" href="#/settings" aria-label="Settings">⚙️</a>
  </div>
  ${installBanner()}
  ${timerCard()}
  <div class="card now">
    <div class="eyebrow">Right now</div>
    ${cur ? `<div class="big">${curS ? curS.emoji + ' ' : ''}${esc(cur.title)}${curS ? ' – ' + esc(curS.name) : ''}</div>
      <div class="sub">${cur.start}–${cur.end}${next ? ` · Next: ${esc(next.title)} at ${next.start}` : ''}</div>
      ${nextTopic ? `<p class="mt">Focus on: <b>${esc(nextTopic.text)}</b></p>` : ''}
      ${curS && !S.timer ? `<button class="btn mt" data-act="timer-start" data-id="${curS.id}">▶ Start studying ${esc(curS.name)}</button>` : ''}`
      : `<div class="big">Free time</div><div class="sub">${next ? `Next: ${esc(next.title)} at ${next.start}` : 'Nothing else planned today'}</div>`}
  </div>

  <h2>Today's study</h2>
  <div class="card">
    <div class="row between"><b>${fmtH(todayMins)} of ${fmtH(goal)}</b><span class="sub">${todayMins >= goal ? '✅ Goal hit!' : fmtH(goal - todayMins) + ' to go'}</span></div>
    <div class="meter"><span style="width:${Math.min(100, goal ? todayMins / goal * 100 : 0)}%"></span></div>
    ${behind ? `<p class="sub mt">Most behind this week: ${behind.x.emoji} <a href="#/subject/${behind.x.id}">${esc(behind.x.name)}</a> – ${fmtH(behind.left)} left to hit target</p>` : ''}
    <div class="row wrap mt"><button class="btn small" data-act="log-manual">＋ Log study time</button>${S.timer ? '' : '<button class="btn small" data-act="timer-pick">▶ Start timer</button>'}</div>
  </div>

  <h2>To-do today</h2>
  <div class="card">
    <ul class="list">${tasks.length ? tasks.map(t => { const s = subj(t.subjectId); return `
      <li class="${t.done ? 'done' : ''}"><input type="checkbox" class="check" data-act="task-toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done">
      <span class="grow t">${esc(t.text)}${s ? ` <span class="pill">${s.emoji} ${esc(s.name)}</span>` : ''}${t.date < key ? ' <span class="pill warn">overdue</span>' : ''}</span>
      <button class="x" data-act="task-del" data-id="${t.id}" aria-label="Delete">×</button></li>`; }).join('') : '<li class="empty">Nothing yet – add what you need to get done today.</li>'}</ul>
    <form class="add-row" data-form="task-add"><input name="text" placeholder="Add a task…" autocomplete="off" required><button class="btn">Add</button></form>
  </div>

  <h2>Today's plan</h2>
  <div class="card">${timeline(blocks, m)}<a class="btn small ghost mt" href="#/schedule">Edit schedule →</a></div>

  ${exams.length ? `<h2>Coming up</h2><div class="card"><ul class="list">${exams.map(x => { const n = daysUntil(x.examDate); return `<li><span>${x.emoji}</span><a class="grow" href="#/subject/${x.id}">${esc(x.name)} exam</a><span class="pill ${n <= 14 ? 'warn' : ''}">${n === 0 ? 'Today!' : n === 1 ? 'Tomorrow' : n + ' days'}</span></li>`; }).join('')}</ul></div>` : ''}

  <h2>My life plan</h2>
  <a class="card" href="#/life" style="display:block;text-decoration:none;color:inherit">
    <p style="white-space:pre-line">${esc(S.life.vision.split('\n')[0])}</p>
    ${focusGoals.length ? `<ul class="list">${focusGoals.map(g => `<li><span>${g.area.emoji}</span><span class="grow">${esc(g.text)}</span></li>`).join('')}</ul>` : ''}
    <span class="sub">Open life plan →</span>
  </a>`;
};

function timeline(blocks, m, editable = false) {
  if (!blocks.length) return '<p class="empty">Nothing scheduled.</p>';
  return blocks.map(b => {
    const s = subj(b.subjectId);
    const state = m === null ? '' : inBlock(b, m) ? 'current' : toMin(b.start) < m && toMin(b.end) > toMin(b.start) && toMin(b.end) <= m ? 'past' : '';
    return `<div class="block ${state}" ${editable ? `data-act="block-edit" data-id="${b.id}" role="button" tabindex="0"` : ''}>
      <span class="time">${b.start}–${b.end}</span>
      <span class="dot" style="background:${s ? s.color : 'var(--line)'}"></span>
      <span class="grow t">${esc(b.title)}${s ? ` <span class="sub">· ${s.emoji} ${esc(s.name)}</span>` : ''}</span>
      ${editable ? '<span class="sub">✎</span>' : ''}</div>`;
  }).join('');
}

function timerCard() {
  if (!S.timer) return '';
  const s = subj(S.timer.subjectId);
  return `<div class="card" style="--c:${s ? s.color : 'var(--accent)'};border-left:6px solid var(--c)">
    <div class="eyebrow" style="color:var(--c)">Studying ${s ? s.emoji + ' ' + esc(s.name) : ''}</div>
    <div class="timer" data-timer>${fmtClock((Date.now() - S.timer.startedAt) / 1000)}</div>
    <div class="row"><button class="btn primary" data-act="timer-stop">■ Stop & log</button><button class="btn ghost" data-act="timer-cancel">Discard</button></div>
  </div>`;
}

function installBanner() {
  if (isStandalone()) return '';
  if (isIOS()) return `<div class="banner">📲 <b>Add to Home Screen:</b> tap the Share button <b>⬆︎</b> in Safari, then <b>“Add to Home Screen”</b>. Open it from there to turn on notifications.</div>`;
  return '';
}

views.subjects = () => `
  <div class="topbar"><h1>Subjects</h1><button class="icon-btn" data-act="subject-add" aria-label="Add subject">＋</button></div>
  <p class="sub">Tap a subject to see its study plan and log hours.</p>
  <div class="grid mt">${S.subjects.map(x => {
    const wk = minsSince(weekStart(), x.id), tgt = x.weeklyTarget * 60;
    const done = x.plan.filter(p => p.done).length;
    return `<a class="subject-tile" href="#/subject/${x.id}" style="--c:${x.color}">
      <div class="emoji">${x.emoji}</div><div class="name">${esc(x.name)}</div>
      <div class="sub">${fmtH(wk)} / ${fmtH(tgt)} this week</div>
      <div class="meter"><span style="width:${Math.min(100, tgt ? wk / tgt * 100 : 0)}%"></span></div>
      <div class="sub mt">${done}/${x.plan.length} topics done</div></a>`;
  }).join('')}</div>
  ${S.subjects.length ? '' : '<p class="empty">No subjects yet – tap ＋ to add one.</p>'}`;

views.subject = id => {
  const x = subj(id);
  if (!x) return `<a class="back" href="#/subjects">‹ Subjects</a><p>Subject not found.</p>`;
  const wk = minsSince(weekStart(), x.id), tgt = x.weeklyTarget * 60;
  const done = x.plan.filter(p => p.done).length;
  const logs = S.logs.filter(l => l.subjectId === x.id).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, 15);
  const n = x.examDate ? daysUntil(x.examDate) : null;
  return `
  <a class="back" href="#/subjects">‹ Subjects</a>
  <div class="hero" style="--c:${x.color}">
    <div class="row between"><div class="grow"><div style="font-size:34px">${x.emoji}</div><h1>${esc(x.name)}</h1>
    <div class="sub">${x.teacher ? esc(x.teacher) + ' · ' : ''}${x.examDate ? (n >= 0 ? `Exam in ${n} day${n === 1 ? '' : 's'} (${prettyDate(x.examDate)})` : `Exam was ${prettyDate(x.examDate)}`) : 'No exam date set'}</div></div>
    <button class="icon-btn" data-act="subject-edit" data-id="${x.id}" aria-label="Edit subject">✎</button></div>
  </div>
  <div class="stats">
    <div class="stat"><b>${fmtH(wk)}</b><span>this week / ${fmtH(tgt)}</span></div>
    <div class="stat"><b>${fmtH(minsTotal(x.id))}</b><span>total</span></div>
    <div class="stat"><b>${x.plan.length ? Math.round(done / x.plan.length * 100) : 0}%</b><span>plan done</span></div>
  </div>
  ${S.timer && S.timer.subjectId === x.id ? '<div class="mt">' + timerCard() + '</div>' : `
  <div class="row mt"><button class="btn primary grow" data-act="timer-start" data-id="${x.id}" ${S.timer ? 'disabled' : ''} style="justify-content:center">▶ Start timer</button>
  <button class="btn grow" data-act="log-manual" data-id="${x.id}" style="justify-content:center">＋ Log time</button></div>`}

  <h2>Study plan</h2>
  <div class="card" style="--c:${x.color}">
    <div class="meter" style="margin:0 0 8px"><span style="width:${x.plan.length ? done / x.plan.length * 100 : 0}%"></span></div>
    <ul class="list">${x.plan.map(p => `
      <li class="${p.done ? 'done' : ''}"><input type="checkbox" class="check" data-act="plan-toggle" data-sid="${x.id}" data-id="${p.id}" ${p.done ? 'checked' : ''} aria-label="Done">
      <span class="grow t" data-act="plan-edit" data-sid="${x.id}" data-id="${p.id}">${esc(p.text)}${p.due ? ` <span class="pill ${!p.done && p.due < dkey() ? 'warn' : ''}">${prettyDate(p.due)}</span>` : ''}</span>
      <button class="x" data-act="plan-del" data-sid="${x.id}" data-id="${p.id}" aria-label="Delete">×</button></li>`).join('') || '<li class="empty">Add topics, chapters or past papers to work through.</li>'}</ul>
    <form class="add-row" data-form="plan-add" data-sid="${x.id}"><input name="text" placeholder="Add a topic…" autocomplete="off" required><button class="btn">Add</button></form>
  </div>

  <h2>Notes</h2>
  <div class="card"><textarea data-bind="notes" data-sid="${x.id}" placeholder="Key formulas, things to ask the teacher, homework…">${esc(x.notes)}</textarea></div>

  <h2>Links & resources</h2>
  <div class="card"><ul class="list">${x.links.map(l => `<li><span>🔗</span><a class="grow" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a><button class="x" data-act="link-del" data-sid="${x.id}" data-id="${l.id}" aria-label="Delete">×</button></li>`).join('') || '<li class="empty">No links yet.</li>'}</ul>
  <button class="btn small mt" data-act="link-add" data-id="${x.id}">＋ Add link</button></div>

  <h2>Recent sessions</h2>
  <div class="card"><ul class="list">${logs.map(l => `<li><span class="grow">${prettyDate(l.date)}${l.note ? ` <span class="sub">· ${esc(l.note)}</span>` : ''}</span><b>${fmtH(l.minutes)}</b><button class="x" data-act="log-del" data-id="${l.id}" aria-label="Delete">×</button></li>`).join('') || '<li class="empty">No study logged yet.</li>'}</ul></div>`;
};

let schedDay = new Date().getDay();
views.schedule = () => {
  const blocks = blocksFor(new Date(2024, 0, 7 + schedDay)); // Jan 7 2024 was a Sunday
  return `
  <div class="topbar"><h1>Schedule</h1><button class="icon-btn" data-act="block-add" aria-label="Add block">＋</button></div>
  <p class="sub">Your routine for each day. Tap a block to edit it. This is what “Right now” on the Today page uses.</p>
  <div class="seg mt">${DAY_ORDER.map(d => `<button class="${d === schedDay ? 'on' : ''}" data-act="sched-day" data-d="${d}">${DAYS[d]}</button>`).join('')}</div>
  <div class="card mt">${timeline(blocks, schedDay === new Date().getDay() ? nowMin() : null, true)}</div>
  <div class="row wrap"><button class="btn" data-act="block-add">＋ Add block</button><button class="btn ghost" data-act="sched-copy">Copy this day to…</button></div>`;
};

views.life = () => `
  <div class="topbar"><h1>Life plan</h1><button class="icon-btn" data-act="area-add" aria-label="Add area">＋</button></div>
  <h2>My vision</h2>
  <div class="card"><textarea data-bind="vision" placeholder="Who do I want to be? What do I want my life to look like in 5–10 years?">${esc(S.life.vision)}</textarea></div>
  ${S.life.areas.map(a => {
    const done = a.goals.filter(g => g.done).length;
    return `<h2>${a.emoji} ${esc(a.title)} <span style="text-transform:none;letter-spacing:0">· ${done}/${a.goals.length}</span></h2>
    <div class="card">
      <ul class="list">${a.goals.map(g => `
        <li class="${g.done ? 'done' : ''}"><input type="checkbox" class="check" data-act="goal-toggle" data-aid="${a.id}" data-id="${g.id}" ${g.done ? 'checked' : ''} aria-label="Done">
        <span class="grow t" data-act="goal-edit" data-aid="${a.id}" data-id="${g.id}">${esc(g.text)}${g.by ? ` <span class="pill">by ${prettyDate(g.by)}</span>` : ''}</span>
        <button class="x" data-act="goal-del" data-aid="${a.id}" data-id="${g.id}" aria-label="Delete">×</button></li>`).join('') || '<li class="empty">No goals yet.</li>'}</ul>
      <form class="add-row" data-form="goal-add" data-aid="${a.id}"><input name="text" placeholder="Add a goal…" autocomplete="off" required><button class="btn">Add</button></form>
      <button class="btn small ghost mt" data-act="area-edit" data-id="${a.id}">Edit area</button>
    </div>`;
  }).join('')}
  <button class="btn mt" data-act="area-add">＋ Add life area</button>`;

views.stats = () => {
  const days = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d; });
  const vals = days.map(d => minsOn(dkey(d)));
  const max = Math.max(60, ...vals);
  const ws = weekStart();
  const all = [...S.logs].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, 30);
  return `
  <div class="topbar"><h1>Study hours</h1><button class="icon-btn" data-act="log-manual" aria-label="Log time">＋</button></div>
  <div class="stats mt">
    <div class="stat"><b>${fmtH(minsSince(ws))}</b><span>this week</span></div>
    <div class="stat"><b>${fmtH(minsTotal())}</b><span>all time</span></div>
    <div class="stat"><b>${streak()}🔥</b><span>day streak</span></div>
  </div>
  <h2>Last 7 days</h2>
  <div class="card">
    <div class="bars" role="img" aria-label="Minutes studied per day, last 7 days">${vals.map((v, i) => `<div class="col" title="${days[i].toLocaleDateString(undefined, { weekday: 'long' })}: ${fmtH(v)}"><span class="val">${v ? fmtH(v) : ''}</span><div class="bar" style="height:${v / max * 100}%"></div></div>`).join('')}</div>
    <div class="bar-labels">${days.map((d, i) => `<span class="${i === 6 ? 'today' : ''}">${DAYS[d.getDay()]}</span>`).join('')}</div>
  </div>
  <h2>This week by subject</h2>
  <div class="card"><ul class="list">${S.subjects.map(x => { const w = minsSince(ws, x.id), t = x.weeklyTarget * 60; return `
    <li style="--c:${x.color};display:block"><div class="row between"><a href="#/subject/${x.id}" style="color:inherit;text-decoration:none">${x.emoji} ${esc(x.name)}</a><span class="sub">${fmtH(w)} / ${fmtH(t)}</span></div>
    <div class="meter"><span style="width:${Math.min(100, t ? w / t * 100 : 0)}%"></span></div></li>`; }).join('')}</ul></div>
  <h2>All sessions</h2>
  <div class="card"><ul class="list">${all.map(l => { const s = subj(l.subjectId); return `<li><span>${s ? s.emoji : '📝'}</span><span class="grow">${s ? esc(s.name) : 'Other'} <span class="sub">· ${prettyDate(l.date)}${l.note ? ' · ' + esc(l.note) : ''}</span></span><b>${fmtH(l.minutes)}</b><button class="x" data-act="log-del" data-id="${l.id}" aria-label="Delete">×</button></li>`; }).join('') || '<li class="empty">Nothing logged yet. Start a timer or tap ＋.</li>'}</ul></div>`;
};

views.settings = () => {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `
  <a class="back" href="#/">‹ Today</a>
  <h1>Settings</h1>
  <h2>You</h2>
  <div class="card"><label class="sub">Your name<input data-bind="name" value="${esc(S.profile.name)}" placeholder="Name"></label></div>

  <h2>Study goal</h2>
  <div class="card">
    <label class="sub">Hours per day<input type="number" min="0" step="0.5" data-bind="dailyGoalHours" value="${S.settings.dailyGoalHours}"></label>
  </div>

  <h2>Notifications</h2>
  <div class="card">
    ${perm === 'unsupported' ? `<p>${isIOS() && !isStandalone() ? 'On iPhone, notifications only work once this site is added to your Home Screen. Tap Share ⬆︎ → “Add to Home Screen”, then open it from your Home Screen and come back here.' : 'This browser doesn’t support notifications.'}</p>`
      : perm === 'denied' ? '<p>Notifications are blocked. Turn them on in Settings → Notifications → My Plan.</p>'
      : `<div class="row between"><span>Reminders ${S.settings.notify && perm === 'granted' ? '<span class="pill">On</span>' : ''}</span>
         <button class="btn small ${S.settings.notify && perm === 'granted' ? 'ghost' : 'primary'}" data-act="notify-toggle">${S.settings.notify && perm === 'granted' ? 'Turn off' : 'Turn on'}</button></div>`}
    <label class="sub mt" style="display:block">Remind me before each block (minutes)<input type="number" min="0" max="60" data-bind="remindBefore" value="${S.settings.remindBefore}"></label>
    <label class="sub mt" style="display:block">Daily “have you studied?” reminder<input type="time" data-bind="dailyReminderTime" value="${S.settings.dailyReminderTime}"></label>
    ${perm === 'granted' ? '<button class="btn small mt" data-act="notify-test">Send a test notification</button>' : ''}
    <p class="sub mt">You’ll get a heads-up before each block in your schedule, an evening nudge if you haven’t hit your daily study goal, and a break reminder after 50 minutes on the timer. Reminders are checked while the app is open or in the background; if iOS fully closes the app, they pause until you open it again.</p>
  </div>

  <h2>Backup</h2>
  <div class="card">
    <p class="sub">Everything is saved on this device only. Export a backup now and then so you never lose your plan.</p>
    <div class="row wrap"><button class="btn small" data-act="export">⬇ Export backup</button><label class="btn small">⬆ Import backup<input type="file" accept="application/json,.json" data-act-change="import" hidden></label></div>
  </div>
  <h2>Danger zone</h2>
  <div class="card"><button class="btn danger" data-act="reset">Reset everything</button></div>`;
};

/* ---------- router ---------- */
// background refresh: skip if a form is open or the user is typing
function autoRender() {
  const a = document.activeElement;
  if ($('#modal').open || (a && a.matches('input:not([type=checkbox]), textarea, select'))) return;
  render();
}
function render() {
  const [, page = '', arg] = location.hash.split('/');
  const name = views[page] ? page : 'today';
  const scroll = window.scrollY, same = render.last === location.hash;
  $('#view').innerHTML = views[name](arg);
  render.last = location.hash;
  window.scrollTo(0, same ? scroll : 0);
  const tab = { subject: 'subjects', settings: 'today' }[name] || name;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
}
window.addEventListener('hashchange', render);

/* ---------- actions ---------- */
function pickSubject(title, cb) {
  if (!S.subjects.length) return toast('Add a subject first');
  openForm({ title, saveLabel: 'Start', fields: [{ name: 'subjectId', label: 'Subject', type: 'select', value: S.subjects[0].id, options: S.subjects.map(x => ({ value: x.id, label: `${x.emoji} ${x.name}` })) }], onSave: v => cb(v.subjectId) });
}
function startTimer(id) { S.timer = { subjectId: id, startedAt: Date.now() }; save(); render(); toast('Timer started – good luck!'); }
function addLog(subjectId, minutes, date = dkey(), note = '') {
  S.logs.push({ id: uid(), subjectId, minutes, date, note, at: Date.now() });
}
function subjectForm(x) {
  openForm({
    title: x ? 'Edit subject' : 'New subject',
    fields: [
      { name: 'name', label: 'Name', value: x?.name, required: true, placeholder: 'e.g. Biology' },
      { name: 'emoji', label: 'Emoji', value: x?.emoji || '📘' },
      { name: 'color', label: 'Colour', type: 'color', value: x?.color || '#4f46e5' },
      { name: 'weeklyTarget', label: 'Target hours per week', type: 'number', step: '0.5', min: 0, value: x?.weeklyTarget ?? 3 },
      { name: 'examDate', label: 'Exam date (optional)', type: 'date', value: x?.examDate },
      { name: 'teacher', label: 'Teacher / room (optional)', value: x?.teacher }
    ],
    onSave: v => {
      const data = { ...v, weeklyTarget: Number(v.weeklyTarget) || 0 };
      if (x) Object.assign(x, data);
      else { const n = { id: uid(), notes: '', links: [], plan: [], ...data }; S.subjects.push(n); location.hash = `#/subject/${n.id}`; }
    },
    onDelete: x && (() => { S.subjects = S.subjects.filter(s => s.id !== x.id); location.hash = '#/subjects'; })
  });
}
function blockForm(b) {
  openForm({
    title: b ? 'Edit block' : 'New block',
    fields: [
      { name: 'title', label: 'What', value: b?.title, required: true, placeholder: 'e.g. Study block, Football, Homework' },
      { name: 'start', label: 'Start', type: 'time', value: b?.start || '16:00', required: true },
      { name: 'end', label: 'End', type: 'time', value: b?.end || '17:00', required: true },
      { name: 'subjectId', label: 'Subject (optional)', type: 'select', value: b?.subjectId || '', options: subjectOptions() },
      ...(b ? [] : [{ name: 'days', label: 'Days', type: 'days', value: [schedDay] }])
    ],
    onSave: v => {
      if (b) Object.assign(b, { title: v.title, start: v.start, end: v.end, subjectId: v.subjectId });
      else for (const d of v.days) (S.schedule[d] ||= []).push({ id: uid(), title: v.title, start: v.start, end: v.end, subjectId: v.subjectId });
    },
    onDelete: b && (() => { S.schedule[schedDay] = S.schedule[schedDay].filter(x => x.id !== b.id); })
  });
}

const actions = {
  'task-toggle': el => { const t = S.tasks.find(x => x.id === el.dataset.id); t.done = el.checked; if (t.done) t.date = dkey(); },
  'task-del': el => { S.tasks = S.tasks.filter(x => x.id !== el.dataset.id); },
  'timer-start': el => startTimer(el.dataset.id),
  'timer-pick': () => pickSubject('Start timer for…', startTimer),
  'timer-stop': () => {
    const mins = Math.max(1, Math.round((Date.now() - S.timer.startedAt) / 60000));
    addLog(S.timer.subjectId, mins); S.timer = null; toast(`Logged ${fmtH(mins)} 🎉`);
  },
  'timer-cancel': () => { if (confirm('Discard this session without logging it?')) S.timer = null; },
  'log-manual': el => {
    if (!S.subjects.length) return toast('Add a subject first');
    openForm({
      title: 'Log study time', saveLabel: 'Log',
      fields: [
        { name: 'subjectId', label: 'Subject', type: 'select', value: el.dataset.id || S.subjects[0].id, options: S.subjects.map(x => ({ value: x.id, label: `${x.emoji} ${x.name}` })) },
        { name: 'minutes', label: 'Minutes', type: 'number', min: 1, value: 30, required: true },
        { name: 'date', label: 'Date', type: 'date', value: dkey(), required: true },
        { name: 'note', label: 'What did you cover? (optional)', placeholder: 'e.g. Chapter 4 questions' }
      ],
      onSave: v => { addLog(v.subjectId, Math.max(1, Number(v.minutes) || 0), v.date, v.note); toast('Logged ✔'); }
    });
  },
  'log-del': el => { if (confirm('Delete this session?')) S.logs = S.logs.filter(l => l.id !== el.dataset.id); },
  'subject-add': () => subjectForm(),
  'subject-edit': el => subjectForm(subj(el.dataset.id)),
  'plan-toggle': el => { const p = subj(el.dataset.sid).plan.find(p => p.id === el.dataset.id); p.done = el.checked; },
  'plan-del': el => { const x = subj(el.dataset.sid); x.plan = x.plan.filter(p => p.id !== el.dataset.id); },
  'plan-edit': el => {
    const x = subj(el.dataset.sid), p = x.plan.find(p => p.id === el.dataset.id);
    openForm({ title: 'Edit topic', fields: [{ name: 'text', label: 'Topic', value: p.text, required: true }, { name: 'due', label: 'Do by (optional)', type: 'date', value: p.due }],
      onSave: v => Object.assign(p, v), onDelete: () => { x.plan = x.plan.filter(q => q.id !== p.id); } });
  },
  'link-add': el => {
    const x = subj(el.dataset.id);
    openForm({ title: 'Add link', fields: [{ name: 'label', label: 'Name', placeholder: 'e.g. Revision videos' }, { name: 'url', label: 'Web address', type: 'url', required: true, placeholder: 'https://' }],
      onSave: v => x.links.push({ id: uid(), ...v }) });
  },
  'link-del': el => { const x = subj(el.dataset.sid); x.links = x.links.filter(l => l.id !== el.dataset.id); },
  'sched-day': el => { schedDay = Number(el.dataset.d); },
  'block-add': () => blockForm(),
  'block-edit': el => blockForm(S.schedule[schedDay].find(b => b.id === el.dataset.id)),
  'sched-copy': () => openForm({
    title: `Copy ${DAYS[schedDay]} to…`, saveLabel: 'Copy',
    fields: [{ name: 'days', label: 'Replace these days with ' + DAYS[schedDay] + '’s blocks', type: 'days', value: [] }],
    onSave: v => { for (const d of v.days) if (d !== schedDay) S.schedule[d] = (S.schedule[schedDay] || []).map(b => ({ ...b, id: uid() })); toast('Copied'); }
  }),
  'goal-toggle': el => { const g = S.life.areas.find(a => a.id === el.dataset.aid).goals.find(g => g.id === el.dataset.id); g.done = el.checked; if (g.done) toast('Nice one! 🎉'); },
  'goal-del': el => { const a = S.life.areas.find(a => a.id === el.dataset.aid); a.goals = a.goals.filter(g => g.id !== el.dataset.id); },
  'goal-edit': el => {
    const a = S.life.areas.find(a => a.id === el.dataset.aid), g = a.goals.find(g => g.id === el.dataset.id);
    openForm({ title: 'Edit goal', fields: [{ name: 'text', label: 'Goal', value: g.text, required: true }, { name: 'by', label: 'Achieve by (optional)', type: 'date', value: g.by }],
      onSave: v => Object.assign(g, v), onDelete: () => { a.goals = a.goals.filter(x => x.id !== g.id); } });
  },
  'area-add': () => openForm({ title: 'New life area', fields: [{ name: 'emoji', label: 'Emoji', value: '⭐' }, { name: 'title', label: 'Name', required: true, placeholder: 'e.g. Music, Travel, Faith' }],
    onSave: v => S.life.areas.push({ id: uid(), goals: [], ...v }) }),
  'area-edit': el => {
    const a = S.life.areas.find(a => a.id === el.dataset.id);
    openForm({ title: 'Edit life area', fields: [{ name: 'emoji', label: 'Emoji', value: a.emoji }, { name: 'title', label: 'Name', value: a.title, required: true }],
      onSave: v => Object.assign(a, v), onDelete: () => { S.life.areas = S.life.areas.filter(x => x.id !== a.id); } });
  },
  'notify-toggle': async () => {
    if (S.settings.notify && Notification.permission === 'granted') S.settings.notify = false;
    else {
      const p = await Notification.requestPermission();
      S.settings.notify = p === 'granted';
      toast(p === 'granted' ? 'Reminders on 🔔' : 'Notifications not allowed');
    }
    save(); render();
  },
  'notify-test': () => notify('My Plan', 'Notifications are working 🎉', 'test'),
  'export': () => {
    const name = `my-plan-backup-${dkey()}.json`;
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: 'My Plan backup' }).catch(() => {});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'reset': () => { if (confirm('Delete ALL your plans, subjects and logged hours? This cannot be undone.')) { S = seed(); toast('Reset'); location.hash = '#/'; } }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  const r = actions[el.dataset.act](el, e);
  if (!(r instanceof Promise)) { save(); render(); }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const text = new FormData(f).get('text').toString().trim(); if (!text) return;
  if (f.dataset.form === 'task-add') S.tasks.push({ id: uid(), text, date: dkey(), done: false });
  if (f.dataset.form === 'plan-add') subj(f.dataset.sid).plan.push({ id: uid(), text, done: false });
  if (f.dataset.form === 'goal-add') S.life.areas.find(a => a.id === f.dataset.aid).goals.push({ id: uid(), text, by: '', done: false });
  save(); render();
  const again = $(`form[data-form="${f.dataset.form}"]${f.dataset.sid ? `[data-sid="${f.dataset.sid}"]` : ''}${f.dataset.aid ? `[data-aid="${f.dataset.aid}"]` : ''} input`);
  if (again) again.focus();
});

// autosaving text fields
let bindT;
document.addEventListener('input', e => {
  const el = e.target; if (!el.matches('[data-bind]')) return;
  const k = el.dataset.bind, v = el.value;
  if (k === 'notes') subj(el.dataset.sid).notes = v;
  else if (k === 'vision') S.life.vision = v;
  else if (k === 'name') S.profile.name = v;
  else if (k === 'dailyGoalHours' || k === 'remindBefore') S.settings[k] = Math.max(0, Number(v) || 0);
  else S.settings[k] = v;
  clearTimeout(bindT); bindT = setTimeout(save, 300);
});

document.addEventListener('change', e => {
  const el = e.target; if (el.dataset.actChange !== 'import' || !el.files[0]) return;
  el.files[0].text().then(txt => {
    const data = JSON.parse(txt);
    if (!data.subjects || !data.life) throw new Error('bad file');
    if (!confirm('Replace everything on this device with this backup?')) return;
    S = { ...seed(), ...data }; save(); render(); toast('Backup restored');
  }).catch(() => toast('That file isn’t a My Plan backup'));
});

/* ---------- notifications ---------- */
async function notify(title, body, tag, url = './#/') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url } };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) return reg.showNotification(title, opts);
  } catch {}
  try { new Notification(title, opts); } catch {}
}

function checkReminders() {
  if (!S.settings.notify) return;
  const now = new Date(), key = dkey(now), m = nowMin();
  let changed = false;
  const once = (k, fn) => { if (!S.notified[k]) { S.notified[k] = 1; changed = true; fn(); } };

  for (const b of blocksFor(now)) {
    const start = toMin(b.start), lead = S.settings.remindBefore;
    if (m >= start - lead && m <= start + 2) {
      const s = subj(b.subjectId);
      const topic = s && s.plan.find(p => !p.done);
      once(`${key}|${b.id}`, () => notify(
        lead && m < start ? `In ${start - m} min: ${b.title}` : `Now: ${b.title}`,
        s ? `${s.emoji} ${s.name}${topic ? ' – focus on ' + topic.text : ''}` : `${b.start}–${b.end}`,
        'block', s ? `./#/subject/${s.id}` : './#/'));
    }
  }
  const r = toMin(S.settings.dailyReminderTime), goal = S.settings.dailyGoalHours * 60, done = minsOn(key);
  if (goal && m >= r && m < r + 90 && done < goal)
    once(`${key}|daily`, () => notify('Study check-in 📚', `You've done ${fmtH(done)} of your ${fmtH(goal)} goal today.`, 'daily'));
  if (S.timer && Date.now() - S.timer.startedAt > 50 * 60000)
    once(`timer|${S.timer.startedAt}`, () => notify('Time for a break ☕', '50 minutes done – stretch, drink water, then go again.', 'timer'));

  for (const k of Object.keys(S.notified)) if (!k.startsWith(key) && !(S.timer && k === `timer|${S.timer.startedAt}`)) { delete S.notified[k]; changed = true; }
  if (changed) save();
}

/* ---------- tick ---------- */
setInterval(() => {
  if (S.timer) document.querySelectorAll('[data-timer]').forEach(t => { t.textContent = fmtClock((Date.now() - S.timer.startedAt) / 1000); });
}, 1000);
let lastMin = nowMin();
setInterval(() => {
  checkReminders();
  const m = nowMin();
  if (m !== lastMin) { lastMin = m; if (['', '#/', '#/schedule'].includes(location.hash)) autoRender(); }
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); autoRender(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
checkReminders();

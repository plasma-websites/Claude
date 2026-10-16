'use strict';

/* =========================================================================
   My Plan – life plan, study plan, study hours, AI coach.
   Plain JS, no build step. State lives in localStorage on this device.
   ========================================================================= */

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const fmtH = mins => { mins = Math.max(0, Math.round(mins)); const h = Math.floor(mins / 60), m = mins % 60; return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; };
const fmtClock = secs => { secs = Math.max(0, secs); const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = Math.floor(secs % 60); return `${h ? h + ':' : ''}${pad(m)}:${pad(s)}`; };
const r2 = n => Math.round(n * 100) / 100;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const daysUntil = key => Math.round((parseKey(key) - parseKey(dkey())) / 864e5);
const prettyDate = key => parseKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const weekStart = (d = new Date()) => addDays(d, -((d.getDay() + 6) % 7));
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const KINDS = {
  study:    { label: 'Study',          ico: '📚', focus: true },
  reading:  { label: 'Reading ahead',  ico: '📖', focus: true },
  tutoring: { label: 'Tutoring',       ico: '🧑‍🏫', focus: true },
  school:   { label: 'School',         ico: '🏫' },
  exercise: { label: 'Exercise',       ico: '🏃' },
  meal:     { label: 'Meal',           ico: '🍽️' },
  travel:   { label: 'Travel',         ico: '🚆' },
  routine:  { label: 'Get ready',      ico: '🪥' },
  family:   { label: 'Family time',    ico: '🏡' },
  free:     { label: 'Free time',      ico: '🎮' },
  sleep:    { label: 'Sleep',          ico: '🌙' },
  other:    { label: 'Other',          ico: '✳️' }
};
const LOG_KINDS = ['study', 'reading', 'tutoring'];
const ACCENTS = { Indigo: '#4f46e5', Violet: '#7c3aed', Blue: '#2563eb', Teal: '#0d9488', Green: '#16a34a', Orange: '#ea580c', Rose: '#e11d48', Pink: '#db2777', Slate: '#475569' };
const MODELS = { 'claude-opus-5-5': 'Claude Opus 5.5 (smartest)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5 (balanced)', 'claude-haiku-5-5': 'Claude Haiku 5.5 (fastest, cheapest)' };
const SUBJECT_COLORS = ['#4f46e5', '#db2777', '#0d9488', '#ea580c', '#2563eb', '#7c3aed', '#16a34a', '#b45309', '#e11d48', '#0891b2'];
const QUICK_SUBJECTS = [['Maths', '📐'], ['English', '📖'], ['Biology', '🧬'], ['Chemistry', '🧪'], ['Physics', '⚛️'], ['History', '🏛️'], ['Geography', '🌍'], ['Religious Studies', '🕊️'], ['Computer Science', '💻'], ['French', '🇫🇷'], ['Spanish', '🇪🇸'], ['Economics', '📈'], ['Psychology', '🧠'], ['Art', '🎨'], ['Business', '💼']];

/* ---------- seed: the real rota from the notebook ---------- */
function seed() {
  const b = (start, end, title, kind, note = '') => ({ id: uid(), start, end, title, kind, subjectId: '', note });
  const morning = () => [
    b('07:00', '07:20', 'Wake up + exercise', 'exercise'),
    b('07:20', '07:45', 'Get dressed + breakfast', 'routine'),
    b('07:45', '08:00', 'Leave for the train', 'travel'),
    b('08:00', '15:45', 'School', 'school', 'Make use of school time')
  ];
  const monThu = () => [
    ...morning(),
    b('15:45', '17:00', 'Travel home', 'travel'),
    b('17:15', '17:45', 'Exercise', 'exercise'),
    b('17:45', '18:10', 'Dinner', 'meal'),
    b('18:10', '19:10', 'Reading ahead', 'reading', '1 hour reading ahead'),
    b('19:10', '21:00', 'Study', 'study', '1.5 hours studying'),
    b('21:00', '22:00', 'Family time', 'family'),
    b('22:00', '07:00', 'Sleep, braces, pray', 'sleep')
  ];
  return {
    v: 2,
    profile: { name: '' },
    life: {
      vision: 'Who I want to be in 5 years – write it here in your own words.',
      areas: [
        { id: uid(), emoji: '🎓', title: 'School & future', goals: [{ id: uid(), text: 'Study 18 hours every week (4h reading ahead)', by: '', done: false }, { id: uid(), text: 'Make use of school time', by: '', done: false }] },
        { id: uid(), emoji: '💪', title: 'Health & fitness', goals: [{ id: uid(), text: 'Exercise every day (runs + yoga at weekends)', by: '', done: false }, { id: uid(), text: 'In bed by 10pm', by: '', done: false }] },
        { id: uid(), emoji: '🙏', title: 'Faith', goals: [{ id: uid(), text: 'Pray every night', by: '', done: false }] },
        { id: uid(), emoji: '🏡', title: 'Family', goals: [{ id: uid(), text: 'Family time 9–10pm every evening', by: '', done: false }] },
        { id: uid(), emoji: '🌱', title: 'Personal growth', goals: [] }
      ]
    },
    subjects: [],
    schedule: {
      1: monThu(), 2: monThu(), 3: monThu(), 4: monThu(),
      5: [
        ...morning(),
        b('15:45', '17:30', 'Travel to tutoring', 'travel'),
        b('17:30', '19:30', 'Tutoring', 'tutoring', 'Counts as 2 hours of study'),
        b('19:30', '20:00', 'Come home', 'travel'),
        b('20:00', '22:00', 'Free recreational time', 'free'),
        b('22:00', '10:00', 'Sleep, braces, pray', 'sleep')
      ],
      6: [
        b('10:00', '10:30', 'Wake up + run', 'exercise'),
        b('10:30', '11:00', 'Breakfast + get ready', 'routine'),
        b('11:00', '13:00', 'Study', 'study'),
        b('13:00', '13:30', 'Lunch', 'meal'),
        b('13:30', '17:30', 'Study', 'study'),
        b('17:30', '18:00', 'Run', 'exercise'),
        b('18:00', '18:30', 'Meal', 'meal'),
        b('18:30', '19:00', 'Yoga', 'exercise'),
        b('19:00', '21:00', 'Free time', 'free'),
        b('21:00', '22:00', 'Family time', 'family'),
        b('22:00', '08:00', 'Sleep, braces, pray', 'sleep')
      ],
      0: [
        b('08:00', '08:30', 'Wake up + exercise', 'exercise'),
        b('08:30', '09:10', 'Get ready', 'routine'),
        b('09:10', '09:30', 'Travel to tutor', 'travel'),
        b('09:30', '15:30', 'Tutoring', 'tutoring'),
        b('15:30', '16:00', 'Travel home', 'travel'),
        b('16:00', '18:00', 'Study', 'study'),
        b('18:00', '18:30', 'Run', 'exercise'),
        b('18:30', '19:00', 'Dinner', 'meal'),
        b('19:00', '21:00', 'Free time', 'free'),
        b('21:00', '22:00', 'Family time', 'family'),
        b('22:00', '07:00', 'Sleep, braces, pray', 'sleep')
      ]
    },
    tasks: [],
    logs: [],
    timer: null,
    chat: [],
    settings: {
      theme: 'auto', accent: ACCENTS.Indigo,
      // h = daily goal; r = how much of it is reading ahead; tut = tutoring counts towards the day
      goals: { 1: { h: 2.5, r: 1 }, 2: { h: 2.5, r: 1 }, 3: { h: 2.5, r: 1 }, 4: { h: 2.5, r: 1 }, 5: { h: 2, r: 0, tut: true }, 6: { h: 6, r: 0 }, 0: { h: 2, r: 0 } },
      notify: false, blockReminders: 'focus', remindBefore: 5, checkinTime: '21:00', morningBrief: true,
      apiKey: '', model: 'claude-opus-5-5'
    },
    notified: {}
  };
}

/* ---------- state ---------- */
const KEY = 'myplan.v2';
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
  if (!S || !S.schedule) {
    S = seed();
    // carry over anything logged in the first version
    try {
      const old = JSON.parse(localStorage.getItem('myplan.v1'));
      if (old && old.logs && old.logs.length) {
        S.logs = old.logs.map(l => ({ kind: 'study', ...l }));
        S.tasks = old.tasks || [];
        S.subjects = (old.subjects || []).filter(x => S.logs.some(l => l.subjectId === x.id));
      }
    } catch {}
  }
  const d = seed();
  for (const k of Object.keys(d)) if (S[k] === undefined) S[k] = d[k];
  S.settings = { ...d.settings, ...S.settings };
}
let saveT;
function save(now) {
  clearTimeout(saveT);
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('Couldn’t save – storage is full or blocked'); } };
  now ? write() : (saveT = setTimeout(write, 120));
}
addEventListener('pagehide', () => save(true));
load();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- derived data ---------- */
const subj = id => S.subjects.find(x => x.id === id);
const blocksFor = dow => [...(S.schedule[dow] || [])].sort((a, b) => toMin(a.start) - toMin(b.start));
const goal = dow => S.settings.goals[dow] || { h: 0, r: 0 };
const dayGoalMins = dow => goal(dow).h * 60;
const selfGoalMins = dow => goal(dow).tut ? 0 : goal(dow).h * 60;         // goal that counts to the weekly self-study total
const weekGoalMins = () => [0, 1, 2, 3, 4, 5, 6].reduce((a, d) => a + selfGoalMins(d), 0);
const weekReadingGoalMins = () => [0, 1, 2, 3, 4, 5, 6].reduce((a, d) => a + goal(d).r * 60, 0);
const sumLogs = f => S.logs.reduce((a, l) => a + (f(l) ? l.minutes : 0), 0);
const isSelf = l => l.kind === 'study' || l.kind === 'reading';
const minsOn = (key, f = () => true) => sumLogs(l => l.date === key && f(l));
// what counts towards a day's goal: self-study, plus tutoring on days where tutoring counts
const dayDone = key => { const dow = parseKey(key).getDay(); return minsOn(key, l => isSelf(l) || (l.kind === 'tutoring' && goal(dow).tut)); };
const inRange = (l, from, to) => l.date >= from && l.date < to;
const weekMins = (ws = weekStart(), f = isSelf) => { const a = dkey(ws), b = dkey(addDays(ws, 7)); return sumLogs(l => inRange(l, a, b) && f(l)); };
const minsTotal = f => sumLogs(f);
function expectedSoFar(now = new Date()) {
  // self-study goal for days already finished this week (+ today once check-in time has passed)
  const ws = weekStart(now); let e = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    if (dkey(d) < dkey(now) || (dkey(d) === dkey(now) && nowMin() >= toMin(S.settings.checkinTime))) e += selfGoalMins(d.getDay());
  }
  return e;
}
function streak() {
  // consecutive days (ending today or yesterday) where the daily goal was hit; days with a 0h goal don't break it
  let n = 0, d = new Date();
  if (dayDone(dkey(d)) < dayGoalMins(d.getDay()) || !dayGoalMins(d.getDay())) d = addDays(d, -1);
  for (let i = 0; i < 365; i++, d = addDays(d, -1)) {
    const g = dayGoalMins(d.getDay());
    if (!g) continue;
    if (dayDone(dkey(d)) >= g) n++; else break;
  }
  return n;
}
function hitRate(days = 14) {
  let hit = 0, tot = 0;
  for (let i = 1; i <= days; i++) { const d = addDays(new Date(), -i), g = dayGoalMins(d.getDay()); if (!g) continue; tot++; if (dayDone(dkey(d)) >= g) hit++; }
  return { hit, tot };
}
// a block that ends before it starts (22:00 → 07:00) wraps past midnight
const inBlock = (b, m) => { const s = toMin(b.start), e = toMin(b.end); return e > s ? m >= s && m < e : m >= s || m < e; };
const blockLen = b => { const s = toMin(b.start), e = toMin(b.end); return e > s ? e - s : e + 1440 - s; };
function nowNext(date = new Date()) {
  const m = date.getHours() * 60 + date.getMinutes();
  const today = blocksFor(date.getDay());
  const yesterday = blocksFor(addDays(date, -1).getDay());
  // early morning: still inside last night's overnight block
  const cur = today.find(b => toMin(b.end) > toMin(b.start) && inBlock(b, m))
    || today.find(b => toMin(b.end) < toMin(b.start) && m >= toMin(b.start))
    || yesterday.find(b => toMin(b.end) < toMin(b.start) && m < toMin(b.end));
  const next = today.find(b => toMin(b.start) > m) || null;
  return { cur, next, m };
}

/* ---------- insights (local, no AI needed) ---------- */
function insights() {
  const out = [];
  if (!S.logs.length) return [{ ico: '👋', title: 'No study logged yet', text: 'Start a timer or log a session and your insights will appear here.' }];
  const wk = weekMins(), wg = weekGoalMins(), exp = expectedSoFar();
  const diff = wk - exp;
  out.push(diff >= 0
    ? { ico: '🚀', title: diff > 30 ? `Ahead of pace by ${fmtH(diff)}` : 'On pace this week', text: `${fmtH(wk)} of your ${fmtH(wg)} weekly goal done.` }
    : { ico: '⏳', title: `Behind pace by ${fmtH(-diff)}`, text: `${fmtH(wk)} of ${fmtH(wg)} so far – you’d normally be at ${fmtH(exp)} by now.` });
  const rd = weekMins(weekStart(), l => l.kind === 'reading'), rg = weekReadingGoalMins();
  if (rg) out.push({ ico: '📖', title: `Reading ahead: ${fmtH(rd)} / ${fmtH(rg)}`, text: rd >= rg ? 'Reading-ahead goal done for the week 🎉' : 'Reading ahead makes lessons way easier – keep the 1h blocks.' });
  const hr = hitRate(14);
  if (hr.tot) out.push({ ico: '🎯', title: `Daily goal hit ${hr.hit} of the last ${hr.tot} days`, text: hr.hit / hr.tot >= .8 ? 'Really consistent – keep it up.' : hr.hit / hr.tot >= .5 ? 'Solid – a few more hits and it becomes a habit.' : 'Aim to hit just the next 3 days in a row.' });
  // strongest weekday over the last 4 weeks
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 28; i++) { const d = addDays(new Date(), -i); byDow[d.getDay()] += minsOn(dkey(d), isSelf); }
  const best = byDow.indexOf(Math.max(...byDow));
  if (byDow[best] > 0) out.push({ ico: '📅', title: `${DAYS_LONG[best]} is your strongest day`, text: `${fmtH(byDow[best] / 4)} on average over the last 4 weeks.` });
  const behind = S.subjects.map(x => ({ x, left: x.weeklyTarget * 60 - weekMins(weekStart(), l => l.subjectId === x.id && isSelf(l)) })).filter(o => o.left > 0).sort((a, b) => b.left - a.left)[0];
  if (behind) out.push({ ico: behind.x.emoji, title: `${behind.x.name} needs ${fmtH(behind.left)} more this week`, text: 'It’s the furthest behind its weekly target.' });
  return out;
}

/* ---------- theme ---------- */
function applyTheme() {
  const root = document.documentElement;
  if (S.settings.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = S.settings.theme;
  root.style.setProperty('--accent', S.settings.accent);
  const meta = $('meta[name=theme-color]');
  if (meta) meta.content = getComputedStyle(document.body).backgroundColor || '#f4f4f8';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ---------- toast ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- bottom sheet form ---------- */
function closeSheet() {
  const dlg = $('#modal'); if (!dlg.open) return;
  dlg.classList.add('closing');
  setTimeout(() => { dlg.classList.remove('closing'); dlg.close(); }, 220);
}
function openForm({ title, fields, onSave, onDelete, saveLabel = 'Save' }) {
  const f = $('#modal-form');
  f.innerHTML = `<h3>${esc(title)}</h3>` + fields.map(fl => {
    const v = fl.value ?? '';
    if (fl.type === 'select') return `<label>${esc(fl.label)}<select name="${fl.name}">${fl.options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`;
    if (fl.type === 'days') return `<label>${esc(fl.label)}<div class="days">${DAY_ORDER.map(d => `<label><input type="checkbox" class="check" name="${fl.name}" value="${d}" ${v.includes(d) ? 'checked' : ''}>${DAYS[d]}</label>`).join('')}</div></label>`;
    return `<label>${esc(fl.label)}<input name="${fl.name}" type="${fl.type || 'text'}" value="${esc(v)}" placeholder="${esc(fl.placeholder || '')}" ${fl.step ? `step="${fl.step}"` : ''} ${fl.min !== undefined ? `min="${fl.min}"` : ''} ${fl.required ? 'required' : ''} ${fl.type === 'number' ? 'inputmode="decimal"' : ''}></label>`;
  }).join('') + `<div class="actions">${onDelete ? '<button type="button" class="btn danger" data-m="del">Delete</button><span class="grow"></span>' : ''}<button type="button" class="btn ghost" data-m="cancel">Cancel</button><button type="submit" class="btn primary">${esc(saveLabel)}</button></div>`;
  const dlg = $('#modal');
  f.onsubmit = e => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const fd = new FormData(f), out = {};
    for (const fl of fields) out[fl.name] = fl.type === 'days' ? fd.getAll(fl.name).map(Number) : (fd.get(fl.name) ?? '').toString().trim();
    closeSheet(); onSave(out); save(); render();
  };
  f.onclick = e => {
    const m = e.target.closest('[data-m]'); if (!m) return;
    if (m.dataset.m === 'cancel') closeSheet();
    if (m.dataset.m === 'del' && confirm('Delete this?')) { closeSheet(); onDelete(); save(); render(); }
  };
  dlg.onclick = e => { if (e.target === dlg) closeSheet(); }; // tap the backdrop to close
  dlg.oncancel = e => { e.preventDefault(); closeSheet(); };
  dlg.showModal();
}
const subjectOptions = (blank = 'General / no subject') => [{ value: '', label: blank }, ...S.subjects.map(x => ({ value: x.id, label: `${x.emoji} ${x.name}` }))];
const kindOptions = keys => keys.map(k => ({ value: k, label: `${KINDS[k].ico} ${KINDS[k].label}` }));

/* ---------- DOM morphing: update only what changed (keeps focus and scroll, lets CSS transitions run) ---------- */
function morphChildren(a, b, animate) {
  const keyed = new Map();
  for (const n of a.childNodes) if (n.nodeType === 1 && n.dataset.key) keyed.set(n.dataset.key, n);
  const news = [...b.childNodes];
  news.forEach((y, i) => {
    const cur = a.childNodes[i] || null;
    const k = y.nodeType === 1 ? y.dataset.key : undefined;
    let x = null;
    if (k) { const c = keyed.get(k); if (c && c.nodeName === y.nodeName) { x = c; keyed.delete(k); } }
    else if (cur && !(cur.nodeType === 1 && cur.dataset.key) && cur.nodeType === y.nodeType && cur.nodeName === y.nodeName) x = cur;
    if (!x) { if (animate && k) y.classList.add('enter'); a.insertBefore(y, cur); return; }
    if (x !== cur) a.insertBefore(x, cur);
    patch(x, y, animate);
  });
  while (a.childNodes.length > news.length) a.removeChild(a.lastChild);
}
function patch(x, y, animate) {
  if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; return; }
  for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
  for (const { name, value } of y.attributes) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
  const focused = x === document.activeElement;
  if (x.tagName === 'INPUT') { if (!focused && x.value !== y.value) x.value = y.value; x.checked = y.checked; return; }
  if (x.tagName === 'TEXTAREA') { if (!focused && x.value !== y.value) x.value = y.value; return; }
  morphChildren(x, y, animate);
  if (x.tagName === 'SELECT' && !focused) x.value = y.value;
}

/* ---------- router & render ---------- */
let lastRoute = null;
function route() {
  const [, page = '', arg] = location.hash.split('/');
  const name = views[page] ? page : 'today';
  return { name, arg, key: `${name}/${arg || ''}` };
}
function render() {
  const r = route();
  const html = views[r.name](r.arg);
  const view = $('#view');
  if (r.key !== lastRoute) {
    lastRoute = r.key;
    view.classList.remove('page-enter');
    view.innerHTML = html;
    void view.offsetWidth; // restart the entrance animation
    view.classList.add('page-enter');
    window.scrollTo(0, 0);
    if (r.name === 'coach') scrollChatToEnd(false);
  } else {
    const tpl = document.createElement('div');
    tpl.innerHTML = html;
    morphChildren(view, tpl, true);
  }
  const tab = { subject: 'subjects', settings: 'today', schedule: 'today' }[r.name] || r.name;
  $$('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
}
addEventListener('hashchange', render);

/* ---------- small UI builders ---------- */
function ring(done, goalMins, label, sub, href) {
  const p = goalMins ? Math.min(1, done / goalMins) : 0, C = 2 * Math.PI * 32;
  const hit = goalMins && done >= goalMins;
  return `<a class="ring-card" href="${href}">
    <div class="ring-wrap"><svg class="ring ${hit ? 'hit' : ''}" viewBox="0 0 76 76" aria-hidden="true"><circle class="bg" cx="38" cy="38" r="32"/><circle class="fg" cx="38" cy="38" r="32" stroke-dasharray="${C.toFixed(1)}" style="stroke-dashoffset:${(C * (1 - p)).toFixed(1)}"/></svg>
    <div class="ring-val">${hit ? '✓' : Math.round(p * 100) + '%'}</div></div>
    <div class="ring-sub num">${sub}</div><div class="ring-label">${label}</div></a>`;
}
function timeline(blocks, m, editable = false) {
  if (!blocks.length) return '<p class="empty">Nothing scheduled.</p>';
  return blocks.map(b => {
    const s = subj(b.subjectId), k = KINDS[b.kind] || KINDS.other;
    const ends = toMin(b.end) > toMin(b.start);
    const state = m === null ? '' : inBlock(b, m) ? 'current' : ends && toMin(b.end) <= m ? 'past' : '';
    return `<div class="block ${state} ${k.focus ? 'focus' : ''}" data-key="b${b.id}" ${editable ? `data-act="block-edit" data-id="${b.id}" role="button" tabindex="0"` : ''}>
      <span class="time">${b.start}–${b.end}</span><span class="ico">${s ? s.emoji : k.ico}</span>
      <span class="grow t">${esc(b.title)}${s ? ` <span class="sub">· ${esc(s.name)}</span>` : ''}${b.note && editable ? `<br><span class="sub">${esc(b.note)}</span>` : ''}</span>
      ${editable ? '<span class="sub">›</span>' : ''}</div>`;
  }).join('');
}
function installBanner() {
  if (isStandalone() || !isIOS()) return '';
  return `<div class="banner">📲 <b>Add to Home Screen:</b> tap Share <b>⬆︎</b> in Safari → <b>“Add to Home Screen”</b>. Open it from there to turn on notifications.</div>`;
}
function timerCard() {
  if (!S.timer) return '';
  const s = subj(S.timer.subjectId), k = KINDS[S.timer.kind] || KINDS.study;
  return `<div class="hero" data-key="timer">
    <div class="eyebrow"><span class="live-dot"></span>${esc(k.label)}${s ? ' · ' + s.emoji + ' ' + esc(s.name) : ''}</div>
    <div class="timer" data-timer>${fmtClock((Date.now() - S.timer.startedAt) / 1000)}</div>
    <div class="row mt"><button class="btn solid" data-act="timer-stop">■ Stop & log</button><button class="btn" data-act="timer-cancel">Discard</button></div>
  </div>`;
}

/* ---------- views ---------- */
const views = {};

views.today = () => {
  const now = new Date(), key = dkey(now), dow = now.getDay();
  const { cur, next, m } = nowNext(now);
  const h = now.getHours();
  const hello = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const done = dayDone(key), g = dayGoalMins(dow), gd = goal(dow);
  const wk = weekMins(), wg = weekGoalMins(), rd = weekMins(weekStart(), l => l.kind === 'reading'), rg = weekReadingGoalMins();
  const tasks = S.tasks.filter(t => t.date === key || (!t.done && t.date < key));
  const exams = S.subjects.filter(x => x.examDate && daysUntil(x.examDate) >= 0).sort((a, b) => a.examDate.localeCompare(b.examDate)).slice(0, 3);
  const st = streak();
  const curK = cur && (KINDS[cur.kind] || KINDS.other), curS = cur && subj(cur.subjectId);
  let progress = 0, left = 0;
  if (cur) { const len = blockLen(cur), into = (m - toMin(cur.start) + 1440) % 1440; progress = Math.min(1, into / len); left = len - into; }
  const loggedBlock = cur && S.logs.some(l => l.blockId === cur.id && l.date === key);
  const topic = curS && curS.plan.find(p => !p.done);
  const goalText = gd.r ? `${fmtH(gd.r * 60)} reading ahead + ${fmtH(g - gd.r * 60)} study` : gd.tut ? 'At tutoring' : g ? `${fmtH(g)} study` : 'No study goal today';

  return `
  <div class="topbar">
    <div><div class="sub">${now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <h1>${hello}${S.profile.name ? ', ' + esc(S.profile.name) : ''}</h1></div>
    <a class="icon-btn" href="#/settings" aria-label="Settings">⚙️</a>
  </div>
  ${installBanner()}
  ${timerCard()}
  <div class="hero" data-key="now">
    <div class="eyebrow"><span class="live-dot"></span>Right now</div>
    ${cur ? `<div class="big">${curS ? curS.emoji : curK.ico} ${esc(cur.title)}</div>
      <div class="sub num">${fmtH(left)} left · ${cur.start}–${cur.end}${next ? ` · then ${esc(next.title)} at ${next.start}` : ''}</div>
      <div class="track"><span style="width:${(progress * 100).toFixed(1)}%"></span></div>
      ${cur.note ? `<div class="note">💡 ${esc(cur.note)}</div>` : ''}
      ${topic ? `<div class="note">Focus on: <b>${esc(topic.text)}</b></div>` : ''}
      ${!S.timer && (cur.kind === 'study' || cur.kind === 'reading') ? `<div class="row mt wrap"><button class="btn solid" data-act="timer-pick" data-kind="${cur.kind}" data-sid="${cur.subjectId || ''}">▶ Start ${esc(curK.label.toLowerCase())}</button></div>` : ''}
      ${cur.kind === 'tutoring' ? (loggedBlock ? '<div class="note">✓ Tutoring logged</div>' : `<div class="row mt"><button class="btn solid" data-act="log-block" data-id="${cur.id}">✓ Log tutoring (${fmtH(blockLen(cur))})</button></div>`) : ''}`
      : `<div class="big">Free time</div><div class="sub">${next ? `Next: ${esc(next.title)} at ${next.start}` : 'Nothing else planned today'}</div>`}
  </div>

  <div class="rings">
    ${ring(done, g, 'Today', `${fmtH(done)} / ${fmtH(g)}`, '#/stats')}
    ${ring(wk, wg, 'This week', `${fmtH(wk)} / ${fmtH(wg)}`, '#/stats')}
    ${ring(rd, rg, 'Reading ahead', `${fmtH(rd)} / ${fmtH(rg)}`, '#/stats')}
  </div>
  <div class="card row between" data-key="goalline">
    <div class="grow"><b>${g && done >= g ? 'Goal hit today 🎉' : g ? fmtH(g - done) + ' to go today' : 'Rest day'}</b><div class="sub">${goalText}${st ? ` · 🔥 ${st}-day streak` : ''}</div></div>
    <button class="btn small" data-act="log-manual">＋ Log</button>
  </div>

  <h2>To-do today</h2>
  <div class="card">
    <ul class="list">${tasks.length ? tasks.map(t => { const s = subj(t.subjectId); return `
      <li class="${t.done ? 'done' : ''}" data-key="t${t.id}"><input type="checkbox" class="check" data-act="task-toggle" data-id="${t.id}" ${t.done ? 'checked' : ''} aria-label="Done">
      <span class="grow t">${esc(t.text)}${s ? ` <span class="pill">${s.emoji} ${esc(s.name)}</span>` : ''}${t.date < key ? ' <span class="pill warn">overdue</span>' : ''}</span>
      <button class="x" data-act="task-del" data-id="${t.id}" aria-label="Delete">×</button></li>`; }).join('') : '<li class="empty" data-key="t-empty">Nothing yet – what do you need to get done today?</li>'}</ul>
    <form class="add-row" data-form="task-add"><input name="text" placeholder="Add a task…" autocomplete="off" enterkeyhint="done" required><button class="btn">Add</button></form>
  </div>

  <h2>Today’s plan <a href="#/schedule">Edit week ›</a></h2>
  <div class="card">${timeline(blocksFor(dow), m)}</div>

  ${exams.length ? `<h2>Coming up</h2><div class="card"><ul class="list">${exams.map(x => { const n = daysUntil(x.examDate); return `<li data-key="e${x.id}"><span>${x.emoji}</span><a class="grow" href="#/subject/${x.id}">${esc(x.name)} exam</a><span class="pill ${n <= 14 ? 'warn' : ''}">${n === 0 ? 'Today!' : n === 1 ? 'Tomorrow' : n + ' days'}</span></li>`; }).join('')}</ul></div>` : ''}

  <h2>My life plan <a href="#/life">Open ›</a></h2>
  <a class="card" href="#/life">
    <p style="white-space:pre-line">${esc(S.life.vision.split('\n')[0])}</p>
    <ul class="list">${S.life.areas.flatMap(a => a.goals.filter(g => !g.done).slice(0, 1).map(g => `<li><span>${a.emoji}</span><span class="grow">${esc(g.text)}</span></li>`)).slice(0, 4).join('')}</ul>
  </a>`;
};

let schedDay = new Date().getDay();
views.schedule = () => `
  <a class="back" href="#/">‹ Today</a>
  <div class="topbar"><h1>My week</h1><button class="icon-btn" data-act="block-add" aria-label="Add block">＋</button></div>
  <p class="sub">Your rota for each day. Tap a block to edit it – the Today page and reminders follow this.</p>
  <div class="seg mt">${DAY_ORDER.map(d => `<button class="${d === schedDay ? 'on' : ''}" data-act="sched-day" data-d="${d}">${DAYS[d]}</button>`).join('')}</div>
  <div class="card mt">${timeline(blocksFor(schedDay), schedDay === new Date().getDay() ? nowMin() : null, true)}</div>
  <div class="row wrap"><button class="btn" data-act="block-add">＋ Add block</button><button class="btn ghost" data-act="sched-copy">Copy ${DAYS[schedDay]} to…</button></div>`;

views.subjects = () => `
  <div class="topbar"><h1>Subjects</h1><button class="icon-btn" data-act="subject-add" aria-label="Add subject">＋</button></div>
  <p class="sub">Each subject has its own study plan, notes and hours.</p>
  ${S.subjects.length ? `<div class="grid mt">${S.subjects.map(x => {
    const wk = weekMins(weekStart(), l => l.subjectId === x.id && isSelf(l)), tgt = x.weeklyTarget * 60, done = x.plan.filter(p => p.done).length;
    return `<a class="subject-tile" href="#/subject/${x.id}" style="--c:${x.color}" data-key="s${x.id}">
      <div class="emoji">${x.emoji}</div><div class="name">${esc(x.name)}</div>
      <div class="sub num">${fmtH(wk)}${tgt ? ' / ' + fmtH(tgt) : ''} this week</div>
      <div class="meter"><span style="width:${Math.min(100, tgt ? wk / tgt * 100 : 0)}%"></span></div>
      <div class="sub mt-s">${done}/${x.plan.length} topics done</div></a>`;
  }).join('')}</div>` : ''}
  <h2>${S.subjects.length ? 'Add another' : 'Tap to add your subjects'}</h2>
  <div class="chips" style="flex-wrap:wrap">${QUICK_SUBJECTS.filter(([n]) => !S.subjects.some(x => x.name === n)).map(([n, e]) => `<button class="chip" data-act="subject-quick" data-name="${n}" data-emoji="${e}" data-key="q${n}">${e} ${n}</button>`).join('')}<button class="chip" data-act="subject-add" data-key="q-other">＋ Other…</button></div>`;

views.subject = id => {
  const x = subj(id);
  if (!x) return `<a class="back" href="#/subjects">‹ Subjects</a><p>Subject not found.</p>`;
  const wk = weekMins(weekStart(), l => l.subjectId === x.id && isSelf(l)), tgt = x.weeklyTarget * 60;
  const done = x.plan.filter(p => p.done).length;
  const logs = S.logs.filter(l => l.subjectId === x.id).sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, 15);
  const n = x.examDate ? daysUntil(x.examDate) : null;
  return `
  <a class="back" href="#/subjects">‹ Subjects</a>
  <div class="hero s-hero" style="--c:${x.color}">
    <div class="row between"><div class="grow"><div style="font-size:34px">${x.emoji}</div><h1>${esc(x.name)}</h1>
    <div class="sub">${x.teacher ? esc(x.teacher) + ' · ' : ''}${x.examDate ? (n >= 0 ? `Exam in ${n} day${n === 1 ? '' : 's'} · ${prettyDate(x.examDate)}` : `Exam was ${prettyDate(x.examDate)}`) : 'No exam date set'}</div></div>
    <button class="icon-btn" data-act="subject-edit" data-id="${x.id}" aria-label="Edit subject">✎</button></div>
  </div>
  <div class="stats">
    <div class="stat"><b>${fmtH(wk)}</b><span>this week${tgt ? ' / ' + fmtH(tgt) : ''}</span></div>
    <div class="stat"><b>${fmtH(minsTotal(l => l.subjectId === x.id))}</b><span>total</span></div>
    <div class="stat"><b>${x.plan.length ? Math.round(done / x.plan.length * 100) : 0}%</b><span>plan done</span></div>
  </div>
  ${S.timer && S.timer.subjectId === x.id ? '<div class="mt">' + timerCard() + '</div>' : `
  <div class="row mt"><button class="btn primary grow" data-act="timer-pick" data-sid="${x.id}" ${S.timer ? 'disabled' : ''}>▶ Start timer</button>
  <button class="btn grow" data-act="log-manual" data-sid="${x.id}">＋ Log time</button></div>`}

  <h2>Study plan</h2>
  <div class="card" style="--c:${x.color}">
    <div class="meter" style="margin:0 0 8px"><span style="width:${x.plan.length ? done / x.plan.length * 100 : 0}%"></span></div>
    <ul class="list">${x.plan.map(p => `
      <li class="${p.done ? 'done' : ''}" data-key="p${p.id}"><input type="checkbox" class="check" data-act="plan-toggle" data-sid="${x.id}" data-id="${p.id}" ${p.done ? 'checked' : ''} aria-label="Done">
      <span class="grow t" data-act="plan-edit" data-sid="${x.id}" data-id="${p.id}">${esc(p.text)}${p.due ? ` <span class="pill ${!p.done && p.due < dkey() ? 'warn' : ''}">${prettyDate(p.due)}</span>` : ''}</span>
      <button class="x" data-act="plan-del" data-sid="${x.id}" data-id="${p.id}" aria-label="Delete">×</button></li>`).join('') || '<li class="empty" data-key="p-empty">Add topics, chapters or past papers to work through.</li>'}</ul>
    <form class="add-row" data-form="plan-add" data-sid="${x.id}"><input name="text" placeholder="Add a topic…" autocomplete="off" enterkeyhint="done" required><button class="btn">Add</button></form>
  </div>

  <h2>Notes</h2>
  <div class="card"><textarea data-bind="notes" data-sid="${x.id}" placeholder="Key formulas, things to ask the teacher, homework…">${esc(x.notes)}</textarea></div>

  <h2>Links & resources</h2>
  <div class="card"><ul class="list">${x.links.map(l => `<li data-key="l${l.id}"><span>🔗</span><a class="grow" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a><button class="x" data-act="link-del" data-sid="${x.id}" data-id="${l.id}" aria-label="Delete">×</button></li>`).join('') || '<li class="empty">No links yet.</li>'}</ul>
  <button class="btn small mt" data-act="link-add" data-id="${x.id}">＋ Add link</button></div>

  <h2>Recent sessions</h2>
  <div class="card"><ul class="list">${logs.map(logRow).join('') || '<li class="empty">No study logged yet.</li>'}</ul></div>`;
};

function logRow(l) {
  const s = subj(l.subjectId), k = KINDS[l.kind] || KINDS.study;
  return `<li data-key="g${l.id}"><span>${s ? s.emoji : k.ico}</span><span class="grow">${s ? esc(s.name) : k.label}${s && l.kind !== 'study' ? ` <span class="pill">${k.label}</span>` : ''}<br><span class="sub">${prettyDate(l.date)}${l.note ? ' · ' + esc(l.note) : ''}</span></span><b class="num">${fmtH(l.minutes)}</b><button class="x" data-act="log-del" data-id="${l.id}" aria-label="Delete">×</button></li>`;
}

// one series (hours) with a dashed goal marker per column
function barChart(cols, label) {
  const max = Math.max(60, ...cols.map(c => Math.max(c.value, c.goal || 0)));
  return `<div class="bars" role="img" aria-label="${esc(label)}">${cols.map((c, i) => `
    <div class="col" data-tip="${esc(c.tip)}" tabindex="0" data-key="c${i}"><span class="val">${c.value ? fmtH(c.value) : ''}</span>
      <div class="bar" style="height:${(c.value / max * 100).toFixed(1)}%"></div>
      ${c.goal ? `<div class="goal" style="bottom:${(c.goal / max * 100).toFixed(1)}%"></div>` : ''}</div>`).join('')}</div>
    <div class="bar-labels">${cols.map(c => `<span class="${c.today ? 'today' : ''}">${c.label}</span>`).join('')}</div>
    <div class="legend"><span><i></i>Hours studied</span><span><i class="dash"></i>Goal</span></div>`;
}

views.stats = () => {
  const today = new Date(), ws = weekStart();
  const wk = weekMins(), wg = weekGoalMins(), rd = weekMins(ws, l => l.kind === 'reading'), rg = weekReadingGoalMins(), tut = weekMins(ws, l => l.kind === 'tutoring');
  const days = [...Array(7)].map((_, i) => addDays(today, i - 6));
  const weeks = [...Array(8)].map((_, i) => addDays(ws, (i - 7) * 7));
  const hr = hitRate(14);
  const all = [...S.logs].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, 40);
  return `
  <div class="topbar"><h1>Study hours</h1><button class="icon-btn" data-act="log-manual" aria-label="Log time">＋</button></div>
  <div class="rings mt">
    ${ring(wk, wg, 'Week goal', `${fmtH(wk)} / ${fmtH(wg)}`, '#/stats')}
    ${ring(rd, rg, 'Reading ahead', `${fmtH(rd)} / ${fmtH(rg)}`, '#/stats')}
    ${ring(hr.hit, hr.tot, 'Goal days (14d)', `${hr.hit} / ${hr.tot}`, '#/stats')}
  </div>
  <div class="stats">
    <div class="stat"><b>${streak()}🔥</b><span>day streak</span></div>
    <div class="stat"><b>${fmtH(tut)}</b><span>tutoring this week</span></div>
    <div class="stat"><b>${fmtH(minsTotal(() => true))}</b><span>all time</span></div>
  </div>
  <h2>Last 7 days</h2>
  <div class="card">${barChart(days.map((d, i) => { const v = dayDone(dkey(d)), g = dayGoalMins(d.getDay()); return { label: DAYS[d.getDay()], value: v, goal: g, today: i === 6, tip: `${DAYS_LONG[d.getDay()]}: ${fmtH(v)} of ${fmtH(g)}` }; }), 'Hours studied per day for the last 7 days, with daily goals')}</div>
  <h2>Last 8 weeks</h2>
  <div class="card">${barChart(weeks.map((w, i) => { const v = weekMins(w); return { label: i === 7 ? 'Now' : `${w.getDate()}/${w.getMonth() + 1}`, value: v, goal: wg, today: i === 7, tip: `Week of ${w.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${fmtH(v)} of ${fmtH(wg)}` }; }), 'Self-study hours per week for the last 8 weeks, with weekly goal')}</div>
  ${S.subjects.length ? `<h2>This week by subject</h2>
  <div class="card"><ul class="list">${S.subjects.map(x => { const w = weekMins(ws, l => l.subjectId === x.id && isSelf(l)), t = x.weeklyTarget * 60; return `
    <li style="--c:${x.color};display:block" data-key="w${x.id}"><div class="row between"><a href="#/subject/${x.id}" style="color:inherit;text-decoration:none">${x.emoji} ${esc(x.name)}</a><span class="sub num">${fmtH(w)}${t ? ' / ' + fmtH(t) : ''}</span></div>
    <div class="meter"><span style="width:${Math.min(100, t ? w / t * 100 : 0)}%"></span></div></li>`; }).join('')}</ul></div>` : ''}
  <h2>Sessions</h2>
  <div class="card"><ul class="list">${all.map(logRow).join('') || '<li class="empty">Nothing logged yet. Start a timer or tap ＋.</li>'}</ul></div>`;
};

views.life = () => `
  <div class="topbar"><h1>Life plan</h1><button class="icon-btn" data-act="area-add" aria-label="Add area">＋</button></div>
  <h2>My vision</h2>
  <div class="card"><textarea data-bind="vision" placeholder="Who do I want to be? What do I want my life to look like in 5–10 years?">${esc(S.life.vision)}</textarea></div>
  ${S.life.areas.map(a => {
    const done = a.goals.filter(g => g.done).length;
    return `<h2 data-key="ah${a.id}"><span>${a.emoji} ${esc(a.title)} · ${done}/${a.goals.length}</span><a href="#/life" data-act="area-edit" data-id="${a.id}">Edit</a></h2>
    <div class="card" data-key="a${a.id}">
      <ul class="list">${a.goals.map(g => `
        <li class="${g.done ? 'done' : ''}" data-key="g${g.id}"><input type="checkbox" class="check" data-act="goal-toggle" data-aid="${a.id}" data-id="${g.id}" ${g.done ? 'checked' : ''} aria-label="Done">
        <span class="grow t" data-act="goal-edit" data-aid="${a.id}" data-id="${g.id}">${esc(g.text)}${g.by ? ` <span class="pill">by ${prettyDate(g.by)}</span>` : ''}</span>
        <button class="x" data-act="goal-del" data-aid="${a.id}" data-id="${g.id}" aria-label="Delete">×</button></li>`).join('') || '<li class="empty">No goals yet.</li>'}</ul>
      <form class="add-row" data-form="goal-add" data-aid="${a.id}"><input name="text" placeholder="Add a goal…" autocomplete="off" enterkeyhint="done" required><button class="btn">Add</button></form>
    </div>`;
  }).join('')}
  <button class="btn mt" data-act="area-add">＋ Add life area</button>`;

/* ----- coach ----- */
const CHIPS = ['How did I do this week?', 'Am I on track for my weekly goal?', 'Which days do I slip on?', 'How’s my reading ahead going?', 'Plan tomorrow’s study for me', 'Which subject needs more time?'];
let coachBusy = false;
views.coach = () => {
  const hasKey = !!S.settings.apiKey;
  return `
  <div class="topbar"><div><div class="sub">Powered by Claude</div><h1>Coach</h1></div>${S.chat.length ? '<button class="icon-btn" data-act="chat-clear" aria-label="New chat">↺</button>' : ''}</div>
  ${S.chat.length ? '' : `<div class="card" data-key="insights"><h3 style="margin-bottom:8px">This week at a glance</h3>${insights().map(i => `<div class="insight"><span class="ico">${i.ico}</span><div><b>${esc(i.title)}</b><span class="sub">${esc(i.text)}</span></div></div>`).join('')}</div>
  <p class="sub" data-key="intro" style="margin:4px 4px 12px">Ask me anything about your study hours, goals and habits – I can see your logged sessions, goals and rota.</p>`}
  <div class="chat" id="chat">${S.chat.map(msgHTML).join('')}</div>
  ${hasKey ? `<div class="chips mt" data-key="chips">${(S.chat.length ? CHIPS.slice(0, 4) : CHIPS).map(c => `<button class="chip" data-act="chat-chip" data-q="${esc(c)}" ${coachBusy ? 'disabled' : ''}>${esc(c)}</button>`).join('')}</div>
  <div class="coach-pad"></div>
  <div class="composer" data-key="composer"><form data-form="chat"><textarea name="text" rows="1" placeholder="Ask your coach…" enterkeyhint="send" data-autogrow></textarea><button class="btn primary" aria-label="Send" ${coachBusy ? 'disabled' : ''}>↑</button></form></div>`
  : `<div class="card" data-key="nokey"><h3>Connect Claude to chat</h3><p class="sub mt-s">Add your Claude API key in Settings and your coach can explain your study analytics, spot patterns and plan your week.</p><a class="btn primary mt" href="#/settings">Open Settings</a></div>`}`;
};
function msgHTML(msg) {
  if (msg.role === 'error') return `<div class="msg error" data-key="m${msg.id}">${esc(msg.content)}</div>`;
  if (msg.role === 'user') return `<div class="msg user" data-key="m${msg.id}">${esc(msg.content)}</div>`;
  return `<div class="msg assistant ${msg.pending && msg.content ? 'cursor' : ''}" data-key="m${msg.id}">${msg.content ? md(msg.content) : '<span class="typing"><i></i><i></i><i></i></span>'}</div>`;
}
function md(src) {
  const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*(?!\s)([^*]+?)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let out = '', list = null;
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const line of esc(src).split('\n')) {
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else { close(); if ((m = line.match(/^#{1,6}\s+(.*)/))) out += `<h4>${inline(m[1])}</h4>`; else if (line.trim()) out += `<p>${inline(line)}</p>`; }
  }
  close();
  return out;
}
function scrollChatToEnd(smooth = true) {
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));
}

views.settings = () => {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const st = S.settings;
  return `
  <a class="back" href="#/">‹ Today</a>
  <h1>Settings</h1>
  <h2>You</h2>
  <div class="card"><label class="field">Your name<input data-bind="name" value="${esc(S.profile.name)}" placeholder="Name" autocomplete="given-name"></label></div>

  <h2>Appearance</h2>
  <div class="card">
    <div class="field">Theme</div>
    <div class="seg mt-s">${['auto', 'light', 'dark'].map(t => `<button class="${st.theme === t ? 'on' : ''}" data-act="theme" data-v="${t}">${{ auto: '◐ Auto', light: '☀️ Light', dark: '🌙 Dark' }[t]}</button>`).join('')}</div>
    <div class="field mt">Colour</div>
    <div class="swatches mt-s">${Object.entries(ACCENTS).map(([n, c]) => `<button class="swatch ${st.accent === c ? 'on' : ''}" style="--sw:${c}" data-act="accent" data-v="${c}" aria-label="${n}"></button>`).join('')}</div>
  </div>

  <h2>Study goals</h2>
  <div class="card">
    <div class="goal-grid">
      <span class="h">Day</span><span class="h">Goal (h)</span><span class="h">Reading ahead (h)</span>
      ${DAY_ORDER.map(d => `<span>${DAYS[d]}${goal(d).tut ? ' <span class="pill">tutoring</span>' : ''}</span><input type="number" min="0" step="0.5" inputmode="decimal" data-bind="goal-h" data-d="${d}" value="${goal(d).h}"><input type="number" min="0" step="0.5" inputmode="decimal" data-bind="goal-r" data-d="${d}" value="${goal(d).r}">`).join('')}
    </div>
    <p class="sub mt">Weekly self-study goal: <b>${fmtH(weekGoalMins())}</b> (incl. ${fmtH(weekReadingGoalMins())} reading ahead). Tutoring counts towards Friday’s goal, but not the weekly self-study total.</p>
  </div>

  <h2>Notifications</h2>
  <div class="card">
    ${perm === 'unsupported' ? `<p>${isIOS() && !isStandalone() ? 'On iPhone, notifications only work after you add this app to your Home Screen (Share ⬆︎ → “Add to Home Screen”), then open it from there.' : 'This browser doesn’t support notifications.'}</p>`
      : perm === 'denied' ? '<p>Notifications are blocked. Turn them on in iPhone Settings → Notifications → My Plan.</p>'
      : `<div class="row between"><b>Notifications ${st.notify && perm === 'granted' ? '<span class="pill good">On</span>' : ''}</b>
         <button class="btn small ${st.notify && perm === 'granted' ? 'ghost' : 'primary'}" data-act="notify-toggle">${st.notify && perm === 'granted' ? 'Turn off' : 'Turn on'}</button></div>`}
    <label class="field mt">Remind me before blocks<select data-bind="blockReminders">${[['focus', 'Study, reading & tutoring blocks'], ['all', 'Every block'], ['off', 'Off']].map(([v, l]) => `<option value="${v}" ${st.blockReminders === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field">Minutes before<input type="number" min="0" max="60" inputmode="numeric" data-bind="remindBefore" value="${st.remindBefore}"></label>
    <label class="field">Daily goal check-in<input type="time" data-bind="checkinTime" value="${st.checkinTime}"></label>
    <label class="row mt" style="font-weight:600;color:var(--ink-2);font-size:14px"><input type="checkbox" class="check" data-act="toggle-brief" ${st.morningBrief ? 'checked' : ''}> Morning brief with today’s goal</label>
    ${perm === 'granted' ? '<button class="btn small mt" data-act="notify-test">Send a test notification</button>' : ''}
    <p class="sub mt">You’ll get: a heads-up before blocks, a morning brief, a buzz the moment you hit your daily, weekly or reading goal, streak milestones, an evening check-in (hit, or how far short), a midweek pace check on Wednesday and a weekly summary on Sunday. iPhone delivers these while the app is open or in the background.</p>
  </div>

  <h2>AI coach (Claude)</h2>
  <div class="card">
    <label class="field">Claude API key<input type="password" data-bind="apiKey" value="${esc(st.apiKey)}" placeholder="sk-ant-…" autocomplete="off" spellcheck="false"></label>
    <label class="field">Model<select data-bind="model">${Object.entries(MODELS).map(([v, l]) => `<option value="${v}" ${st.model === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <p class="sub mt">Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> and set a monthly spend limit there. The key is stored only on this device and sent only to Anthropic. Each chat sends a summary of your study data so the coach can answer.</p>
  </div>

  <h2>Backup</h2>
  <div class="card">
    <p class="sub">Everything is saved on this device. Export a backup now and then (your API key isn’t included).</p>
    <div class="row wrap mt-s"><button class="btn small" data-act="export">⬇ Export backup</button><label class="btn small">⬆ Import backup<input type="file" accept="application/json,.json" data-change="import" hidden></label></div>
  </div>
  <h2>Danger zone</h2>
  <div class="card"><button class="btn danger" data-act="reset">Reset everything</button></div>`;
};

/* ---------- actions ---------- */
function startTimer(subjectId, kind = 'study') {
  S.timer = { subjectId, kind, startedAt: Date.now() };
  toast(`${KINDS[kind].label} timer started – you’ve got this 💪`);
}
function addLog(entry) {
  const before = goalSnapshot();
  S.logs.push({ id: uid(), at: Date.now(), date: dkey(), note: '', subjectId: '', kind: 'study', ...entry });
  celebrate(before, goalSnapshot());
}
function subjectForm(x) {
  openForm({
    title: x ? 'Edit subject' : 'New subject',
    fields: [
      { name: 'name', label: 'Name', value: x?.name, required: true, placeholder: 'e.g. Biology' },
      { name: 'emoji', label: 'Emoji', value: x?.emoji || '📘' },
      { name: 'color', label: 'Colour', type: 'select', value: x?.color || SUBJECT_COLORS[S.subjects.length % SUBJECT_COLORS.length], options: SUBJECT_COLORS.map((c, i) => ({ value: c, label: ['Indigo', 'Pink', 'Teal', 'Orange', 'Blue', 'Violet', 'Green', 'Amber', 'Rose', 'Cyan'][i] })) },
      { name: 'weeklyTarget', label: 'Target hours per week', type: 'number', step: '0.5', min: 0, value: x?.weeklyTarget ?? 2 },
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
      { name: 'title', label: 'What', value: b?.title, required: true, placeholder: 'e.g. Study, Football, Homework' },
      { name: 'kind', label: 'Type', type: 'select', value: b?.kind || 'study', options: kindOptions(Object.keys(KINDS)) },
      { name: 'start', label: 'Start', type: 'time', value: b?.start || '16:00', required: true },
      { name: 'end', label: 'End', type: 'time', value: b?.end || '17:00', required: true },
      { name: 'subjectId', label: 'Subject (optional)', type: 'select', value: b?.subjectId || '', options: subjectOptions('None') },
      { name: 'note', label: 'Note (optional)', value: b?.note, placeholder: 'e.g. Make use of school time' },
      ...(b ? [] : [{ name: 'days', label: 'Days', type: 'days', value: [schedDay] }])
    ],
    onSave: v => {
      const data = { title: v.title, kind: v.kind, start: v.start, end: v.end, subjectId: v.subjectId, note: v.note };
      if (b) Object.assign(b, data);
      else for (const d of v.days) (S.schedule[d] ||= []).push({ id: uid(), ...data });
    },
    onDelete: b && (() => { S.schedule[schedDay] = S.schedule[schedDay].filter(x => x.id !== b.id); })
  });
}
function pickAndStart(kind, sid) {
  if (sid || !S.subjects.length) return startTimer(sid || '', kind);
  openForm({
    title: 'Start timer', saveLabel: '▶ Start',
    fields: [
      { name: 'kind', label: 'Type', type: 'select', value: kind || 'study', options: kindOptions(['study', 'reading']) },
      { name: 'subjectId', label: 'Subject', type: 'select', value: '', options: subjectOptions() }
    ],
    onSave: v => startTimer(v.subjectId, v.kind)
  });
}

const actions = {
  'task-toggle': el => { const t = S.tasks.find(x => x.id === el.dataset.id); t.done = el.checked; if (t.done) t.date = dkey(); },
  'task-del': el => { S.tasks = S.tasks.filter(x => x.id !== el.dataset.id); },
  'timer-pick': el => pickAndStart(el.dataset.kind || 'study', el.dataset.sid || ''),
  'timer-stop': () => {
    const mins = Math.max(1, Math.round((Date.now() - S.timer.startedAt) / 60000));
    const t = S.timer; S.timer = null;
    addLog({ subjectId: t.subjectId, kind: t.kind, minutes: mins, start: t.startedAt, date: dkey(new Date(t.startedAt)) });
    toast(`Logged ${fmtH(mins)} 🎉`);
  },
  'timer-cancel': () => { if (confirm('Discard this session without logging it?')) S.timer = null; },
  'log-block': el => {
    const b = Object.values(S.schedule).flat().find(x => x.id === el.dataset.id); if (!b) return;
    addLog({ kind: LOG_KINDS.includes(b.kind) ? b.kind : 'study', minutes: blockLen(b), blockId: b.id, note: b.title });
    toast(`Logged ${fmtH(blockLen(b))} of ${b.title.toLowerCase()} ✓`);
  },
  'log-manual': el => openForm({
    title: 'Log study time', saveLabel: 'Log it',
    fields: [
      { name: 'kind', label: 'Type', type: 'select', value: 'study', options: kindOptions(LOG_KINDS) },
      { name: 'subjectId', label: 'Subject', type: 'select', value: el.dataset.sid || '', options: subjectOptions() },
      { name: 'minutes', label: 'Minutes', type: 'number', min: 1, value: 60, required: true },
      { name: 'date', label: 'Date', type: 'date', value: dkey(), required: true },
      { name: 'note', label: 'What did you cover? (optional)', placeholder: 'e.g. Chapter 4 questions' }
    ],
    onSave: v => { addLog({ subjectId: v.subjectId, kind: v.kind, minutes: Math.max(1, Number(v.minutes) || 0), date: v.date, note: v.note }); toast('Logged ✓'); }
  }),
  'log-del': el => { if (confirm('Delete this session?')) S.logs = S.logs.filter(l => l.id !== el.dataset.id); },
  'subject-add': () => subjectForm(),
  'subject-quick': el => { S.subjects.push({ id: uid(), name: el.dataset.name, emoji: el.dataset.emoji, color: SUBJECT_COLORS[S.subjects.length % SUBJECT_COLORS.length], weeklyTarget: 2, examDate: '', teacher: '', notes: '', links: [], plan: [] }); toast(`${el.dataset.name} added`); },
  'subject-edit': el => subjectForm(subj(el.dataset.id)),
  'plan-toggle': el => { const p = subj(el.dataset.sid).plan.find(p => p.id === el.dataset.id); p.done = el.checked; },
  'plan-del': el => { const x = subj(el.dataset.sid); x.plan = x.plan.filter(p => p.id !== el.dataset.id); },
  'plan-edit': el => {
    const x = subj(el.dataset.sid), p = x.plan.find(p => p.id === el.dataset.id);
    openForm({ title: 'Edit topic', fields: [{ name: 'text', label: 'Topic', value: p.text, required: true }, { name: 'due', label: 'Do by (optional)', type: 'date', value: p.due }], onSave: v => Object.assign(p, v), onDelete: () => { x.plan = x.plan.filter(q => q.id !== p.id); } });
  },
  'link-add': el => { const x = subj(el.dataset.id); openForm({ title: 'Add link', fields: [{ name: 'label', label: 'Name', placeholder: 'e.g. Revision videos' }, { name: 'url', label: 'Web address', type: 'url', required: true, placeholder: 'https://' }], onSave: v => x.links.push({ id: uid(), ...v }) }); },
  'link-del': el => { const x = subj(el.dataset.sid); x.links = x.links.filter(l => l.id !== el.dataset.id); },
  'sched-day': el => { schedDay = Number(el.dataset.d); },
  'block-add': () => blockForm(),
  'block-edit': el => blockForm(S.schedule[schedDay].find(b => b.id === el.dataset.id)),
  'sched-copy': () => openForm({
    title: `Copy ${DAYS_LONG[schedDay]} to…`, saveLabel: 'Copy',
    fields: [{ name: 'days', label: `Replace these days with ${DAYS[schedDay]}’s blocks`, type: 'days', value: [] }],
    onSave: v => { for (const d of v.days) if (d !== schedDay) S.schedule[d] = (S.schedule[schedDay] || []).map(b => ({ ...b, id: uid() })); toast('Copied'); }
  }),
  'goal-toggle': el => { const g = S.life.areas.find(a => a.id === el.dataset.aid).goals.find(g => g.id === el.dataset.id); g.done = el.checked; if (g.done) toast('Nice one! 🎉'); },
  'goal-del': el => { const a = S.life.areas.find(a => a.id === el.dataset.aid); a.goals = a.goals.filter(g => g.id !== el.dataset.id); },
  'goal-edit': el => {
    const a = S.life.areas.find(a => a.id === el.dataset.aid), g = a.goals.find(g => g.id === el.dataset.id);
    openForm({ title: 'Edit goal', fields: [{ name: 'text', label: 'Goal', value: g.text, required: true }, { name: 'by', label: 'Achieve by (optional)', type: 'date', value: g.by }], onSave: v => Object.assign(g, v), onDelete: () => { a.goals = a.goals.filter(x => x.id !== g.id); } });
  },
  'area-add': () => openForm({ title: 'New life area', fields: [{ name: 'emoji', label: 'Emoji', value: '⭐' }, { name: 'title', label: 'Name', required: true, placeholder: 'e.g. Music, Travel, Money' }], onSave: v => S.life.areas.push({ id: uid(), goals: [], ...v }) }),
  'area-edit': el => {
    const a = S.life.areas.find(a => a.id === el.dataset.id);
    openForm({ title: 'Edit life area', fields: [{ name: 'emoji', label: 'Emoji', value: a.emoji }, { name: 'title', label: 'Name', value: a.title, required: true }], onSave: v => Object.assign(a, v), onDelete: () => { S.life.areas = S.life.areas.filter(x => x.id !== a.id); } });
  },
  'theme': el => { S.settings.theme = el.dataset.v; applyTheme(); },
  'accent': el => { S.settings.accent = el.dataset.v; applyTheme(); },
  'toggle-brief': el => { S.settings.morningBrief = el.checked; },
  'notify-toggle': async () => {
    if (S.settings.notify && Notification.permission === 'granted') S.settings.notify = false;
    else {
      const p = await Notification.requestPermission();
      S.settings.notify = p === 'granted';
      toast(p === 'granted' ? 'Notifications on 🔔' : 'Notifications not allowed');
    }
    save(); render();
  },
  'notify-test': () => { notify('My Plan', 'Notifications are working 🎉', 'test'); },
  'chat-chip': el => askCoach(el.dataset.q),
  'chat-clear': () => { S.chat = []; },
  'export': () => {
    const name = `my-plan-backup-${dkey()}.json`;
    const data = JSON.stringify({ ...S, settings: { ...S.settings, apiKey: '' } }, null, 2);
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: 'My Plan backup' }).catch(() => {}); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'reset': () => { if (confirm('Delete ALL your plans, subjects and logged hours? This can’t be undone.')) { S = seed(); applyTheme(); toast('Reset'); location.hash = '#/'; } }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  if (el.tagName === 'A') e.preventDefault();
  const r = actions[el.dataset.act](el, e);
  if (!(r instanceof Promise)) { save(); render(); }
});

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const text = (new FormData(f).get('text') || '').toString().trim();
  f.reset();
  if (!text) return;
  if (f.dataset.form === 'chat') { const ta = f.querySelector('textarea'); ta.style.height = ''; askCoach(text); return; }
  if (f.dataset.form === 'task-add') S.tasks.push({ id: uid(), text, date: dkey(), done: false });
  if (f.dataset.form === 'plan-add') subj(f.dataset.sid).plan.push({ id: uid(), text, done: false });
  if (f.dataset.form === 'goal-add') S.life.areas.find(a => a.id === f.dataset.aid).goals.push({ id: uid(), text, by: '', done: false });
  save(); render();
});

// enter sends in the chat box (shift+enter for a new line)
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.matches('[data-autogrow]')) { e.preventDefault(); e.target.form.requestSubmit(); }
});

// autosaving fields
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('[data-autogrow]')) { el.style.height = 'auto'; el.style.height = Math.min(140, el.scrollHeight) + 'px'; }
  if (!el.matches('[data-bind]') || el.tagName === 'SELECT') return;
  const k = el.dataset.bind, v = el.value, st = S.settings;
  if (k === 'notes') subj(el.dataset.sid).notes = v;
  else if (k === 'vision') S.life.vision = v;
  else if (k === 'name') S.profile.name = v;
  else if (k === 'goal-h' || k === 'goal-r') { const g = st.goals[el.dataset.d] ||= { h: 0, r: 0 }; g[k === 'goal-h' ? 'h' : 'r'] = Math.max(0, Number(v) || 0); }
  else if (k === 'remindBefore') st.remindBefore = Math.max(0, Number(v) || 0);
  else if (k === 'apiKey') st.apiKey = v.trim();
  else st[k] = v;
  save();
  if (k.startsWith('goal-')) render();
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.matches('select[data-bind]')) { S.settings[el.dataset.bind] = el.value; save(); return; }
  if (el.dataset.change !== 'import' || !el.files[0]) return;
  el.files[0].text().then(txt => {
    const data = JSON.parse(txt);
    if (!data.schedule || !data.life) throw new Error('bad file');
    if (!confirm('Replace everything on this device with this backup?')) return;
    const key = S.settings.apiKey, d = seed();
    S = { ...d, ...data };
    S.settings = { ...d.settings, ...data.settings, apiKey: (data.settings && data.settings.apiKey) || key };
    save(true); applyTheme(); lastRoute = null; render(); toast('Backup restored');
  }).catch(() => toast('That file isn’t a My Plan backup'));
});

// chart tooltips (hover on desktop, tap or focus on phone)
let tipEl;
function showTip(col) {
  hideTip();
  tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.textContent = col.dataset.tip;
  const r = col.getBoundingClientRect(); tipEl.style.left = r.left + r.width / 2 + 'px'; tipEl.style.top = r.top + 'px';
  document.body.appendChild(tipEl);
}
function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }
document.addEventListener('pointerover', e => { const c = e.target.closest && e.target.closest('.col[data-tip]'); if (c) showTip(c); else hideTip(); });
document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('.col[data-tip]')) showTip(e.target); });
addEventListener('scroll', hideTip, { passive: true });

/* ---------- AI coach ---------- */
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
let sdkP;
const loadSDK = () => (sdkP ||= import(SDK_URL).catch(e => { sdkP = null; throw e; }));

const COACH_PROMPT = `You are Coach, the study coach inside a school student's personal planner app called "My Plan". The student follows a weekly rota (school, travel, exercise, study blocks, family time 9–10pm, sleep at 10pm) and sets study-hour goals. Each request includes a JSON snapshot of their real data from the app.

How to answer:
- Ground everything in the data. Quote the actual numbers (as hours and minutes, like "1h 45m") and days. Never invent sessions, subjects, grades or results. If there's little data yet (e.g. only a few days logged), say so plainly and give what you can.
- Explain what the numbers mean: pace against the weekly goal, which days slip, consistency, reading-ahead progress, subject balance, trends across weeks – and why it matters.
- Be warm, encouraging and honest, like a good older mentor. Celebrate specific wins. When they're behind, be kind but direct, and suggest a realistic catch-up that fits their actual rota. Never suggest cutting sleep, family time or prayer.
- Tutoring is tracked separately: it counts towards that day's goal on tutoring days, but not towards the weekly self-study total (study + reading ahead).
- Keep it short for a phone screen: usually under 150 words, in short paragraphs or bullet points. End with one concrete next step when it helps.
- Use simple Markdown only: **bold** and bullet or numbered lists. No tables.
- You can't change their data. If they want to change something, tell them where in the app: Hours tab (log or delete sessions), Subjects, Today → Edit week (rota), Settings (goals, notifications, theme).`;

function analytics() {
  const now = new Date(), ws = weekStart(now), h = n => r2(n / 60);
  const day = d => {
    const k = dkey(d), g = dayGoalMins(d.getDay());
    return { date: k, day: DAYS[d.getDay()], studyH: h(minsOn(k, l => l.kind === 'study')), readingAheadH: h(minsOn(k, l => l.kind === 'reading')), tutoringH: h(minsOn(k, l => l.kind === 'tutoring')), countedTowardsGoalH: h(dayDone(k)), goalH: h(g), goalHit: g ? dayDone(k) >= g : null };
  };
  const tod = [0, 0, 0, 0]; let timed = 0;
  for (const l of S.logs) { if (!l.start) continue; timed++; const hr = new Date(l.start).getHours(); tod[hr < 12 ? 0 : hr < 17 ? 1 : hr < 21 ? 2 : 3] += l.minutes; }
  const { cur, next } = nowNext(now), hr14 = hitRate(14);
  return {
    now: `${DAYS_LONG[now.getDay()]} ${dkey(now)} ${hhmm(nowMin())}`,
    studentName: S.profile.name || null,
    goals: {
      perDay: DAY_ORDER.map(d => ({ day: DAYS[d], goalH: goal(d).h, ofWhichReadingAheadH: goal(d).r, tutoringDay: !!goal(d).tut })),
      weeklySelfStudyH: h(weekGoalMins()), weeklyReadingAheadH: h(weekReadingGoalMins())
    },
    thisWeek: {
      weekStarting: dkey(ws), selfStudyH: h(weekMins(ws)), readingAheadH: h(weekMins(ws, l => l.kind === 'reading')), tutoringH: h(weekMins(ws, l => l.kind === 'tutoring')),
      expectedByNowH: h(expectedSoFar(now)), days: [...Array(7)].map((_, i) => addDays(ws, i)).filter(d => dkey(d) <= dkey(now)).map(day)
    },
    last28Days: [...Array(28)].map((_, i) => day(addDays(now, i - 27))),
    last8Weeks: [...Array(8)].map((_, i) => { const w = addDays(ws, (i - 7) * 7); return { weekStarting: dkey(w), selfStudyH: h(weekMins(w)), readingAheadH: h(weekMins(w, l => l.kind === 'reading')), tutoringH: h(weekMins(w, l => l.kind === 'tutoring')), goalH: h(weekGoalMins()) }; }),
    streakDays: streak(), dailyGoalHitLast14Days: `${hr14.hit}/${hr14.tot}`,
    allTimeH: h(minsTotal(() => true)), sessionsLogged: S.logs.length,
    timerSessionsByTimeOfDayH: timed ? { morning: h(tod[0]), afternoon: h(tod[1]), evening: h(tod[2]), lateNight: h(tod[3]) } : null,
    subjects: S.subjects.map(x => ({
      name: x.name, weeklyTargetH: x.weeklyTarget, thisWeekH: h(weekMins(ws, l => l.subjectId === x.id && isSelf(l))), totalH: h(minsTotal(l => l.subjectId === x.id)),
      planTopicsDone: x.plan.filter(p => p.done).length, planTopicsTotal: x.plan.length, nextTopics: x.plan.filter(p => !p.done).slice(0, 3).map(p => p.text),
      examDate: x.examDate || null, daysToExam: x.examDate ? daysUntil(x.examDate) : null
    })),
    timerRunning: S.timer ? { kind: S.timer.kind, minutesSoFar: Math.round((Date.now() - S.timer.startedAt) / 60000) } : null,
    rightNow: cur ? `${cur.title} (${cur.start}–${cur.end})` : null, nextBlock: next ? `${next.title} at ${next.start}` : null,
    rota: Object.fromEntries(DAY_ORDER.map(d => [DAYS[d], blocksFor(d).map(b => `${b.start}-${b.end} ${b.title}`)])),
    openTasks: S.tasks.filter(t => !t.done).map(t => t.text).slice(0, 10),
    lifeGoals: S.life.areas.map(a => ({ area: a.title, open: a.goals.filter(g => !g.done).map(g => g.text), done: a.goals.filter(g => g.done).length }))
  };
}

async function askCoach(text) {
  if (coachBusy || !S.settings.apiKey) return;
  coachBusy = true;
  const history = S.chat.filter(m => (m.role === 'user' || m.role === 'assistant') && m.content).slice(-19).map(m => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: text });
  while (history.length && history[0].role !== 'user') history.shift();
  S.chat.push({ id: uid(), role: 'user', content: text });
  const reply = { id: uid(), role: 'assistant', content: '', pending: true };
  S.chat.push(reply);
  save(); render(); scrollChatToEnd();

  let frame = 0;
  const paint = () => {
    frame = 0;
    const b = $(`.msg[data-key="m${reply.id}"]`);
    if (b) { b.innerHTML = md(reply.content); b.classList.add('cursor'); }
    if (window.innerHeight + window.scrollY > document.body.scrollHeight - 200) scrollChatToEnd(false);
  };

  try {
    const { default: Anthropic } = await loadSDK();
    const client = new Anthropic({ apiKey: S.settings.apiKey, dangerouslyAllowBrowser: true });
    const model = S.settings.model in MODELS ? S.settings.model : 'claude-opus-5-5';
    const params = {
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: COACH_PROMPT }, { type: 'text', text: 'DATA (live snapshot from the app):\n' + JSON.stringify(analytics()) }],
      messages: history
    };
    // server-side fallback if a request is declined (Opus / Sonnet)
    if (model !== 'claude-haiku-5-5') Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    const stream = client.beta.messages.stream(params);
    stream.on('text', delta => { reply.content += delta; if (!frame) frame = requestAnimationFrame(paint); });
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal' && !reply.content) reply.content = 'Sorry – I can’t help with that one. Try asking about your study hours or goals.';
    if (!reply.content) reply.content = '…';
  } catch (err) {
    const status = err && err.status, m = (err && err.message) || '';
    const msg = status === 401 ? 'Your Claude API key was rejected – check it in Settings.'
      : status === 429 ? 'Too many requests right now – wait a moment and try again.'
      : /credit|billing/i.test(m) ? 'Your Anthropic account needs credit – add some at console.anthropic.com.'
      : status === 404 ? 'That model isn’t available on your API key – pick another in Settings.'
      : status >= 500 ? 'Claude is having trouble right now – try again in a minute.'
      : !navigator.onLine ? 'You’re offline – the coach needs internet.'
      : `Couldn’t reach Claude (${m || 'unknown error'}).`;
    if (!reply.content) S.chat = S.chat.filter(x => x !== reply);
    S.chat.push({ id: uid(), role: 'error', content: msg });
  } finally {
    if (frame) cancelAnimationFrame(frame);
    delete reply.pending;
    S.chat = S.chat.slice(-60);
    coachBusy = false;
    save(); render(); scrollChatToEnd();
  }
}

/* ---------- notifications ---------- */
async function notify(title, body, tag, url = './#/') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url } };
  try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) return reg.showNotification(title, opts); } catch {}
  try { new Notification(title, opts); } catch {}
}
const canNotify = () => S.settings.notify && 'Notification' in window && Notification.permission === 'granted';

function goalSnapshot() {
  const k = dkey(), g = dayGoalMins(new Date().getDay()), wg = weekGoalMins(), rg = weekReadingGoalMins();
  return { day: !!g && dayDone(k) >= g, week: wg > 0 && weekMins() >= wg, reading: rg > 0 && weekMins(weekStart(), l => l.kind === 'reading') >= rg, streak: streak() };
}
// celebrate the moment a goal is crossed (in-app toast + notification)
function celebrate(a, b) {
  const k = dkey(), wk = dkey(weekStart());
  const fire = (id, title, body) => { if (S.notified[id]) return; S.notified[id] = 1; toast(title); if (canNotify()) notify(title, body, 'goal', './#/stats'); };
  if (!a.day && b.day) fire(`${k}|hit-day`, 'Daily goal hit 🎯', `${fmtH(dayDone(k))} today – brilliant. ${b.streak > 1 ? `That’s a ${b.streak}-day streak 🔥` : 'Keep it going tomorrow.'}`);
  if (!a.reading && b.reading) fire(`${wk}|hit-reading`, 'Reading-ahead goal done 📖', `${fmtH(weekReadingGoalMins())} of reading ahead this week. Lessons will feel easier.`);
  if (!a.week && b.week) fire(`${wk}|hit-week`, 'Weekly goal smashed 🏆', `${fmtH(weekMins())} of self-study this week. Proud of you.`);
  if (b.streak > a.streak && [3, 5, 7, 14, 21, 30, 50, 100].includes(b.streak)) fire(`${k}|streak-${b.streak}`, `${b.streak}-day streak 🔥`, `You’ve hit your goal ${b.streak} days in a row.`);
}

function checkReminders() {
  if (!canNotify()) return;
  const now = new Date(), key = dkey(now), dow = now.getDay(), m = nowMin(), st = S.settings;
  let changed = false;
  const once = (k, fn) => { if (!S.notified[k]) { S.notified[k] = 1; changed = true; fn(); } };
  const blocks = blocksFor(dow);

  // heads-up before blocks
  if (st.blockReminders !== 'off') for (const b of blocks) {
    const k = KINDS[b.kind] || KINDS.other;
    if (b.kind === 'sleep' || (st.blockReminders === 'focus' && !k.focus)) continue;
    const s = toMin(b.start), lead = st.remindBefore;
    if (m >= s - lead && m <= s + 2) {
      const sj = subj(b.subjectId), topic = sj && sj.plan.find(p => !p.done);
      once(`${key}|b${b.id}`, () => notify(lead && m < s ? `${k.ico} In ${s - m} min: ${b.title}` : `${k.ico} Now: ${b.title}`,
        topic ? `Focus on ${topic.text}` : b.note || `${b.start}–${b.end}`, 'block', './#/'));
    }
  }
  // morning brief at the first block of the day
  const first = blocks.find(b => b.kind !== 'sleep');
  if (st.morningBrief && first && m >= toMin(first.start) && m < toMin(first.start) + 60) {
    const g = goal(dow);
    once(`${key}|brief`, () => notify(`Good morning${S.profile.name ? ', ' + S.profile.name : ''} ☀️`,
      g.h ? `Today’s goal: ${fmtH(g.h * 60)}${g.r ? ` (${fmtH(g.r * 60)} reading ahead + ${fmtH((g.h - g.r) * 60)} study)` : g.tut ? ' at tutoring' : ''}. Week so far: ${fmtH(weekMins())} / ${fmtH(weekGoalMins())}.` : 'No study goal today – enjoy it.', 'brief'));
  }
  // evening check-in: daily result; Wednesday adds a pace check; Sunday is the weekly summary
  const ci = toMin(st.checkinTime);
  if (m >= ci && m < ci + 120) once(`${key}|checkin`, () => {
    const g = dayGoalMins(dow), d = dayDone(key), wk = weekMins(), wg = weekGoalMins();
    if (dow === 0) {
      const rd = weekMins(weekStart(), l => l.kind === 'reading'), rg = weekReadingGoalMins();
      notify(wk >= wg ? 'Week complete 🏆' : 'Your week in review 📊', `${fmtH(wk)} of ${fmtH(wg)} self-study (${Math.round(wk / (wg || 1) * 100)}%). Reading ahead ${fmtH(rd)} / ${fmtH(rg)}. ${wk >= wg ? 'Amazing work.' : 'Fresh start tomorrow – you’ve got this.'}`, 'checkin', './#/stats');
    } else if (dow === 3) {
      const diff = wk - expectedSoFar(now);
      notify(diff >= 0 ? 'Midweek: on track ✅' : `Midweek: ${fmtH(-diff)} behind`, `${fmtH(wk)} of ${fmtH(wg)} so far.${g ? (d >= g ? ' Today’s goal hit 🎯' : ` Today: ${fmtH(d)} of ${fmtH(g)}.`) : ''}`, 'checkin', './#/stats');
    } else if (g) {
      notify(d >= g ? 'Goal hit today ✅' : `${fmtH(g - d)} short today`, d >= g ? `${fmtH(d)} done.${streak() > 1 ? ` 🔥 ${streak()}-day streak.` : ''} Week: ${fmtH(wk)} / ${fmtH(wg)}.` : `You did ${fmtH(d)} of ${fmtH(g)}. Log anything you forgot, or plan to make it up this week.`, 'checkin', './#/stats');
    }
  });
  if (S.timer && Date.now() - S.timer.startedAt > 50 * 60000) once(`${key}|timer${S.timer.startedAt}`, () => notify('Time for a break ☕', '50 minutes done – stretch, drink water, then go again.', 'timer'));

  const cutoff = dkey(addDays(now, -9));
  for (const k of Object.keys(S.notified)) if (k.slice(0, 10) < cutoff) { delete S.notified[k]; changed = true; }
  if (changed) save();
}

/* ---------- ticks ---------- */
setInterval(() => {
  if (document.hidden || !S.timer) return;
  $$('[data-timer]').forEach(t => { t.textContent = fmtClock((Date.now() - S.timer.startedAt) / 1000); });
}, 1000);
let lastMin = nowMin();
setInterval(() => {
  checkReminders();
  const m = nowMin();
  if (m !== lastMin && !document.hidden && !coachBusy) { lastMin = m; render(); }
}, 10000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); if (!coachBusy) render(); } });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
applyTheme();
render();
checkReminders();

// Staff schedules: "Mon-Fri 6pm-10pm, Sat 12-23:30" → slots the bot uses to
// DM staff "you're usually online now — go online?". Days are 0 = Monday … 6 = Sunday,
// times are minutes after midnight in the server's timezone (TIMEZONE, default UK).

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_WORDS = { mon: 0, tue: 1, tues: 1, wed: 2, thu: 3, thur: 3, thurs: 3, fri: 4, sat: 5, sun: 6 };
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(am|pm)?`;
const SLOT = new RegExp(String.raw`^(.*?)\s*${TIME}\s*(?:-|–|—|to|until)\s*${TIME}$`, 'i');

function dayIndex(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w in DAY_WORDS) return DAY_WORDS[w];
  const short = w.slice(0, 3);
  return w.length >= 3 && short in DAY_WORDS && /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/.test(w) ? DAY_WORDS[short] : null;
}

function parseDays(text) {
  const t = text
    .toLowerCase()
    .replace(/\b(every\s*day|everyday|daily|all\s*week)\b/g, 'mon-sun')
    .replace(/\bweekdays?\b/g, 'mon-fri')
    .replace(/\bweekends?\b/g, 'sat-sun')
    .replace(/\b(from|at|between|on|around|usually)\b/g, ' ')
    .replace(/\s*(-|–|—|to)\s*/g, '-');
  const days = new Set();
  for (const part of t.split(/[\s,/&+]+|\band\b/).filter(Boolean)) {
    const [a, b] = part.split('-');
    const from = dayIndex(a);
    const to = b === undefined ? from : dayIndex(b);
    if (from === null || to === null) return null;
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  return days.size ? [...days].sort((x, y) => x - y) : null;
}

function toMinutes(h, m, meridiem) {
  let hour = Number(h);
  const minute = Number(m ?? 0);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hour > 24 || minute > 59 || (hour === 24 && minute)) return null;
  return (hour * 60 + minute) % 1440;
}

// Returns { slots, errors }. Entries are split by new lines, commas or ";".
// A chunk with no times ("Mon, Wed 18-22") is joined to the next one.
export function parseSchedule(text) {
  const slots = [];
  const errors = [];
  let carry = '';
  for (const raw of text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)) {
    const chunk = carry ? `${carry} ${raw}` : raw;
    const m = SLOT.exec(chunk);
    if (!m) {
      if (!/\d/.test(raw)) carry = chunk; // just days so far
      else {
        errors.push(chunk);
        carry = '';
      }
      continue;
    }
    carry = '';
    const [, dayText, h1, m1, ap1, h2, m2, ap2] = m;
    const days = parseDays(dayText || 'daily');
    // "6-10pm": the start borrows the end's am/pm when that makes sense.
    const startMeridiem = ap1 ?? (ap2 && Number(h1) < 12 && (Number(h1) % 12) < (Number(h2) % 12) ? ap2 : null);
    const start = toMinutes(h1, m1, startMeridiem);
    const end = toMinutes(h2, m2, ap2);
    if (!days || start === null || end === null || start === end) errors.push(chunk);
    else slots.push({ days, start, end });
  }
  if (carry) errors.push(carry);
  return { slots, errors };
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function formatDays(days) {
  if (days.length === 7) return 'Every day';
  if (days.join() === '0,1,2,3,4') return 'Mon–Fri';
  if (days.join() === '5,6') return 'Sat–Sun';
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  return contiguous && days.length > 2 ? `${DAY_NAMES[days[0]]}–${DAY_NAMES[days.at(-1)]}` : days.map((d) => DAY_NAMES[d]).join(', ');
}

export const formatSlot = (slot) => `${formatDays(slot.days)} ${hhmm(slot.start)}–${hhmm(slot.end)}${slot.end < slot.start ? ' (next day)' : ''}`;

// Day of week (0 = Monday), minutes after midnight and the date, in `timeZone`.
export function localNow(timeZone, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { day: DAY_NAMES.indexOf(parts.weekday), minutes: Number(parts.hour) * 60 + Number(parts.minute), date: `${parts.year}-${parts.month}-${parts.day}` };
}

// Slots that start at this exact minute, with how many minutes they last.
export function slotsStartingNow(slots, now) {
  return slots
    .map((slot, index) => ({ slot, index, length: (slot.end - slot.start + 1440) % 1440 }))
    .filter(({ slot }) => slot.days.includes(now.day) && slot.start === now.minutes);
}

'use strict';
/* Personalised greetings. {n} = your name (dropped neatly if no name is set).
   Picked by time of day, day of week, what's on your rota right now, streaks and goals. */

const GREETINGS = {
  // ---------- by time of day ----------
  lateNight: [ // 00:00–04:59
    'Moonlit study, {n}?', 'Still up, {n}? 🌙', 'Night owl mode, {n}', 'The stars are out, {n}', 'Burning the midnight oil, {n}?',
    'Quiet hours, {n}', 'It’s very late, {n} – sleep is revision too', 'Hello, night owl', 'Midnight thoughts, {n}?', 'The world’s asleep, {n}',
    'Can’t sleep, {n}?', 'Small hours, big dreams, {n}', 'Lights low, {n}', 'Hey {n} – bed’s calling 🛏️', 'Late night, {n}. Be kind to tomorrow-you',
    'Owl hours, {n} 🦉', 'Starlight shift, {n}?', 'Sleep beats cramming, {n}', 'Shh… it’s past midnight, {n}', 'A quiet one, {n}',
    'Rest up soon, {n}', 'Dreamland is waiting, {n}', 'Night, {n} 🌌', 'Tomorrow’s brain thanks you for sleeping, {n}', 'Moon’s up, {n}'
  ],
  dawn: [ // 05:00–06:59
    'Early bird, {n}? 🐦', 'Up with the sun, {n}', 'Rise and shine, {n} ☀️', 'Dawn patrol, {n}', 'First light, {n}',
    'Before the world wakes, {n}', 'Morning, early riser', 'The early bird gets the grades, {n}', 'Sunrise mode, {n} 🌅', 'Quiet morning, {n}',
    'Fresh start, {n}', 'You beat the alarm, {n}', 'Good morning, early bird', 'Up and at it, {n}', 'Crack of dawn, {n}',
    'New day, clean slate, {n}', 'Morning has broken, {n}', 'Golden hour, {n}', 'Hello sunshine, {n}', 'Early start, strong finish, {n}'
  ],
  morning: [ // 07:00–11:59
    'Good morning, {n}', 'Morning, {n} ☀️', 'Rise and grind, {n}', 'Top of the morning, {n}', 'Hey {n}, let’s make today count',
    'Morning, superstar', 'Ready for today, {n}?', 'New day, new pages, {n}', 'Good morning, sunshine', 'Morning, {n} – you’ve got this',
    'Hello, {n}! Big day?', 'Fresh mind, {n}', 'Wakey wakey, {n}', 'Bright and early, {n}', 'Morning, legend',
    'Let’s go, {n} 🚀', 'Coffee or cereal, {n}?', 'Today’s a good day to learn, {n}', 'Mornin’, {n}', 'Another day, another win, {n}',
    'Hey {n} – one step at a time', 'Good morning, scholar', 'Sun’s up, {n}', 'Make it a great one, {n}', 'Morning, future graduate 🎓'
  ],
  midday: [ // 12:00–13:59
    'Good afternoon, {n}', 'Lunchtime, {n}? 🥪', 'Halfway there, {n}', 'Midday check-in, {n}', 'Hey {n}, how’s the day going?',
    'Refuel time, {n}', 'Noon, {n} – keep it rolling', 'Afternoon, {n}', 'Half the day done, {n}', 'Hey {n} 👋',
    'Lunch break vibes, {n}', 'Recharge, {n}', 'High noon, {n} 🤠', 'Good to see you, {n}', 'Keep the momentum, {n}'
  ],
  afternoon: [ // 14:00–16:59
    'Good afternoon, {n}', 'Afternoon, {n} ☕', 'Hey {n}, nearly home time', 'Afternoon push, {n}', 'Keep going, {n}',
    'The home stretch, {n}', 'Hi {n} – how was today?', 'Afternoon, champ', 'Second wind, {n}?', 'Hey {n}, you’re doing great',
    'Afternoon energy, {n} ⚡', 'Almost there, {n}', 'Good afternoon, scholar', 'Tea time soon, {n}', 'Stay sharp, {n}',
    'Afternoon, {n} – nice to see you', 'Hey {n}, keep it steady', 'Golden afternoon, {n}', 'Onwards, {n}', 'Afternoon focus, {n}'
  ],
  evening: [ // 17:00–20:59
    'Good evening, {n}', 'Evening, {n} 🌆', 'Study o’clock, {n}?', 'Evening session, {n}?', 'Hey {n}, time to lock in',
    'Golden hour, {n}', 'Evening, scholar', 'Let’s make tonight count, {n}', 'Good evening, legend', 'Focus mode, {n}? 🎧',
    'Evening, {n} – the best work happens now', 'Ready when you are, {n}', 'Sunset study, {n}?', 'Hey {n}, how was your day?', 'Evening grind, {n}',
    'Cosy study time, {n}', 'Lamp on, phone away, {n}', 'Evening, {n} – one block at a time', 'Dusk mode, {n} 🌇', 'Let’s finish strong, {n}',
    'Evening, {n} – future you says thanks', 'Desk time, {n}', 'Evening, champ', 'Hey {n}, small steps tonight', 'Time to shine, {n} ✨'
  ],
  night: [ // 21:00–23:59
    'Good night, {n} 🌙', 'Winding down, {n}?', 'Evening, {n} – nearly bedtime', 'Family time, {n}?', 'Cosy night, {n}',
    'Time to rest, {n}', 'Night, {n} – well done today', 'Stars out, {n} ✨', 'Sleep well soon, {n}', 'Wind-down time, {n}',
    'Rest is part of the plan, {n}', 'Hey {n}, braces in? 😁', 'Lights out soon, {n}', 'Night-night, {n}', 'Proud of today, {n}?',
    'Moonrise, {n}', 'Calm night, {n}', 'Phone down soon, {n}', 'Sweet dreams ahead, {n}', 'Good night, scholar'
  ],

  // ---------- by day ----------
  monday: ['Fresh week, {n}!', 'Monday mode, {n} 💪', 'New week, new wins, {n}', 'Monday, {n} – set the tone', 'Week one-of-the-rest-of-your-life, {n}', 'Let’s start the week right, {n}'],
  tuesday: ['Tuesday, {n} – keep it rolling', 'Two days in, {n}', 'Tuesday grind, {n}', 'Happy Tuesday, {n}'],
  wednesday: ['Halfway through the week, {n}', 'Hump day, {n} 🐪', 'Midweek, {n} – how’s the pace?', 'Wednesday, {n} – keep going'],
  thursday: ['Nearly Friday, {n}', 'Thursday push, {n}', 'One more school day after this, {n}', 'Thursday, {n} – finish the week strong'],
  friday: ['Happy Friday, {n}! 🎉', 'Friday feeling, {n}', 'Tutoring day, {n}', 'TGIF, {n}', 'Weekend’s nearly here, {n}', 'Friday, {n} – you made it'],
  saturday: ['Happy Saturday, {n}', 'Weekend mode, {n} 😎', 'Big study Saturday, {n}', 'Lie-in done, {n}?', 'Saturday, {n} – six hours, you’ve got this', 'Slow morning, strong afternoon, {n}'],
  sunday: ['Happy Sunday, {n}', 'Sunday, {n} – tutoring then study', 'Lazy Sunday? Not you, {n}', 'Sunday reset, {n}', 'Plan the week ahead, {n}', 'Sunday vibes, {n} ☀️'],

  // ---------- by what's on the rota right now ----------
  study: ['Lock in, {n} 🔒', 'Study time, {n} 📚', 'Deep work, {n}', 'Brain on, {n} 🧠', 'Let’s get this bread, {n}', 'Pages won’t turn themselves, {n}', 'Focus mode on, {n}', 'You vs the syllabus, {n}', 'Time to revise, {n}', 'Eyes on the prize, {n}', 'Make it count, {n}', 'Study block, {n} – go!'],
  reading: ['Reading-ahead time, {n} 📖', 'Get ahead, stay ahead, {n}', 'Tomorrow’s lessons, today, {n}', 'Read ahead, walk in confident, {n}', 'One hour of reading, {n}', 'Turn the page, {n}', 'Future-you will thank you, {n}', 'Pre-reading power hour, {n}'],
  tutoring: ['Tutoring time, {n} 🧑‍🏫', 'Ask all the questions, {n}', 'Tutor mode, {n}', 'Make the most of tutoring, {n}', 'Learning from the best, {n}'],
  school: ['Have a great day at school, {n} 🏫', 'Make use of school time, {n}', 'School day, {n} – soak it up', 'Learn loads today, {n}', 'Sit near the front, {n} 😉', 'Every lesson counts, {n}'],
  exercise: ['Move it, {n} 🏃', 'Run time, {n}', 'Sweat now, focus later, {n}', 'Strong body, sharp mind, {n}', 'Get those steps in, {n}', 'Exercise o’clock, {n} 💪'],
  family: ['Family time, {n} 🏡', 'Enjoy family time, {n}', 'Phones down, family up, {n}', 'Quality time, {n}', 'Go hang with the fam, {n}'],
  free: ['Free time, {n} 🎮', 'You earned this, {n}', 'Chill time, {n}', 'Recharge mode, {n}', 'Enjoy your break, {n}'],
  meal: ['Food time, {n} 🍽️', 'Fuel up, {n}', 'Bon appétit, {n}', 'Brain food, {n}'],
  travel: ['Safe travels, {n} 🚆', 'On the move, {n}', 'Podcast or flashcards, {n}?', 'Commute mode, {n}'],
  routine: ['Getting ready, {n}?', 'Teeth, uniform, breakfast, go, {n}', 'Morning routine, {n}'],
  sleep: ['Sleep, braces, pray, {n} 🙏', 'Bedtime, {n} 🌙', 'Rest up, {n}', 'Goodnight, {n} – well done today'],

  // ---------- by progress ----------
  streak: ['On a {s}-day streak, {n} 🔥', '{s} days strong, {n}', 'Streak alive, {n} – day {s}!', 'Don’t break the chain, {n} ({s} days)', 'Unstoppable, {n} 🔥', '{s} in a row, {n}. Legend.'],
  goalHit: ['Goal smashed today, {n} 🎯', 'You did it today, {n}!', 'Today’s done – proud of you, {n}', 'Champion behaviour, {n} 🏆', 'Goal hit, {n}. Enjoy your evening', 'That’s a win, {n} ✅'],
  weekHit: ['Weekly goal done, {n} 🏆', 'Week smashed, {n}!', 'All hours banked, {n} 💰'],
  examSoon: ['Exam season, {n} – you’re ready', 'Final push, {n} 💪', 'Exams soon, {n}. Trust the work', 'Countdown’s on, {n}', 'Calm, prepared, confident, {n}'],
  comeback: ['Welcome back, {n}', 'Good to see you, {n}', 'Let’s pick it back up, {n}', 'New day, new chance, {n}', 'Back at it, {n}?']
};

function slotFor(h) {
  return h < 5 ? 'lateNight' : h < 7 ? 'dawn' : h < 12 ? 'morning' : h < 14 ? 'midday' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}
const DAY_POOLS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ctx: { name, now, kind, streak, goalHit, weekHit, examSoon, idleDays }
function pickGreeting(ctx, recent = []) {
  const h = ctx.now.getHours();
  const weighted = [];
  const add = (key, w) => (GREETINGS[key] || []).forEach((t, i) => weighted.push({ id: `${key}:${i}`, t, w }));
  add(slotFor(h), 3);
  add(DAY_POOLS[ctx.now.getDay()], 1);
  if (ctx.kind && GREETINGS[ctx.kind]) add(ctx.kind, 3);
  if (ctx.streak >= 2) add('streak', 2);
  if (ctx.goalHit) add('goalHit', 3);
  if (ctx.weekHit) add('weekHit', 3);
  if (ctx.examSoon) add('examSoon', 2);
  if (ctx.idleDays >= 2) add('comeback', 4);
  const pool = weighted.filter(g => !recent.includes(g.id));
  const list = pool.length ? pool : weighted;
  let r = Math.random() * list.reduce((a, g) => a + g.w, 0), pick = list[0];
  for (const g of list) { r -= g.w; if (r <= 0) { pick = g; break; } }
  return { id: pick.id, text: fillGreeting(pick.t, ctx) };
}
function fillGreeting(t, ctx) {
  let s = t.replace(/\{s\}/g, ctx.streak);
  if (ctx.name) return s.replace(/\{n\}/g, ctx.name);
  return s.replace(/,\s*\{n\}/g, '').replace(/\s*\{n\}/g, '').replace(/\s+([?!.])/g, '$1').trim();
}
const GREETING_COUNT = Object.values(GREETINGS).reduce((a, l) => a + l.length, 0);

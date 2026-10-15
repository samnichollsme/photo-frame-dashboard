import { BINS, NIGHT, TEAM_STYLE } from './config.js';
import { binIcon, playIcons, umbrellaIcon, weatherIcon } from './icons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => (n < 10 ? '0' : '') + n;
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Fetch JSON from our own server. Failures keep the last good data and retry with backoff, since
// Wi-Fi is often not up for the first minute after the frame boots.
function poll(path, everyMs, render) {
  let last = null;
  let delay = 5e3;
  const run = async () => {
    let wait = typeof everyMs === 'function' ? everyMs(last) : everyMs;
    try {
      const r = await fetch(path, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      last = await r.json();
      delay = 5e3;
      render(last, null);
      wait = typeof everyMs === 'function' ? everyMs(last) : everyMs;
    } catch (err) {
      render(last, err);
      wait = delay;
      delay = Math.min(delay * 2, 5 * 60e3);
    }
    setTimeout(run, wait);
  };
  run();
  return () => last;
}

// ---------- Clock, night mode, daily reload ----------

const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
let lastMinute = '';
function tick() {
  const now = new Date();
  const m = hhmm(now);
  if (m !== lastMinute) {
    lastMinute = m;
    $('clock').textContent = m;
    $('date').textContent = dateFmt.format(now);
    const h = now.getHours();
    const night = NIGHT.from > NIGHT.to ? h >= NIGHT.from || h < NIGHT.to : h >= NIGHT.from && h < NIGHT.to;
    $('night').className = night ? 'night on' : 'night';
    renderBins(now);
    renderCalendar();
    // Reload once a day at 03:00 to clear any slow leaks.
    if (m === '03:00' && performance.now() > 120e3) location.reload();
  }
}
setInterval(tick, 1000);

// ---------- Weather ----------

poll('/api/weather', 15 * 60e3, (w) => {
  if (!w) return;
  const icon = weatherIcon(w.now.code, w.now.isDay);
  $('weather-now').innerHTML =
    `<span class="wx ${icon.tone}">${icon.svg}</span>` +
    `<div><div class="temp">${w.now.temp}°</div><div class="muted">${w.today.max}° / ${w.today.min}° · ${icon.label}</div></div>`;
  $('weather-hint').innerHTML = w.rainFrom
    ? `${umbrellaIcon} Rain from ${esc(w.rainFrom)}, take a coat`
    : (w.now.temp <= 3 ? 'Cold out, wrap up' : '');
  $('weather-days').innerHTML = w.days.slice(0, 2).map((d) => {
    const i = weatherIcon(d.code, true);
    const day = DAY[new Date(`${d.date}T12:00:00`).getDay()];
    return `<div class="mini"><span class="muted">${day}</span><span class="wx ${i.tone}">${i.svg}</span><span>${d.max}°</span></div>`;
  }).join('');
});

// ---------- Bins ----------

function renderBins(now) {
  const known = new Date(`${BINS.knownDate}T00:00:00`);
  const today = addDays(now, 0);
  // Next collection on the same weekday as knownDate, today included until collectedByHour.
  let next = addDays(today, (known.getDay() - today.getDay() + 7) % 7);
  if (+next === +today && now.getHours() >= BINS.collectedByHour) next = addDays(next, 7);
  const weeks = Math.round((next - known) / (7 * 864e5));
  const other = BINS.knownBin === 'green' ? 'black' : 'green';
  const bin = Math.abs(weeks) % 2 === 0 ? BINS.knownBin : other;

  let when = DAY[next.getDay()];
  let urgent = false;
  if (+next === +today) { when = 'Out now'; urgent = true; }
  else if (+next === +addDays(today, 1) && now.getHours() >= BINS.outFromHour) { when = 'Out tonight'; urgent = true; }
  else if (+next === +addDays(today, 1)) when = 'Tomorrow';

  $('bin').className = `bin ${bin}${urgent ? ' urgent' : ''}`;
  $('bin').innerHTML = `${binIcon}<b>${bin === 'green' ? 'Green' : 'Black'}</b><span>${when}</span>`;
}

// ---------- Calendar ----------

let calData = null;
let calError = null;
poll('/api/calendar', 5 * 60e3, (c, err) => { calData = c; calError = err; renderCalendar(); });

function eventsOn(day) {
  const key = dateKey(day);
  const start = +day;
  const end = +addDays(day, 1);
  return calData.events.filter((e) => (e.allDay
    ? e.start <= key && e.end > key
    : Date.parse(e.start) < end && Date.parse(e.end) > start));
}

function relative(ms) {
  const min = Math.round(ms / 60e3);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  return `in ${h} hour${h === 1 ? '' : 's'}`;
}

function eventRow(e, now, isToday) {
  const s = new Date(e.start);
  const past = isToday && !e.allDay && Date.parse(e.end) < +now;
  const soon = isToday && !e.allDay && +s > +now ? ` · ${relative(+s - +now)}` : '';
  return `<div class="ev${past ? ' past' : ''}"><span class="t">${e.allDay ? 'All day' : hhmm(s)}</span>` +
    `<span class="b" style="border-color:${esc(e.colour || '#B4B2A9')}">${esc(e.title)}<small>${esc(e.calendar)}${soon}</small></span></div>`;
}

function renderCalendar() {
  const el = $('calendar');
  if (!calData) {
    el.innerHTML = `<p class="label">Today</p><p class="muted">${calError ? 'Calendar unavailable, retrying' : 'Loading…'}</p>`;
    return;
  }
  if (!calData.configured) {
    el.innerHTML = '<p class="label">Today</p><p class="muted">Add your iCloud calendar links to <code>.dev.vars</code> to show events here.</p>';
    return;
  }
  const now = new Date();
  const today = addDays(now, 0);
  const todays = eventsOn(today);
  let html = '<p class="label">Today</p>';
  let lineDone = false;
  for (const e of todays) {
    if (!lineDone && !e.allDay && Date.parse(e.start) > +now) {
      html += '<div class="nowline"><span>Now</span><i></i></div>';
      lineDone = true;
    }
    html += eventRow(e, now, true);
  }
  if (!todays.length) html += '<p class="muted">Nothing on</p>';
  else if (!lineDone) html += '<div class="nowline"><span>Now</span><i></i></div>';
  const tomorrow = eventsOn(addDays(today, 1));
  html += '<p class="label gap">Tomorrow</p>';
  html += tomorrow.length ? tomorrow.map((e) => eventRow(e, now, false)).join('') : '<p class="muted">Nothing on</p>';
  if (calError) html += '<p class="stale">Not updated recently</p>';
  el.innerHTML = html;
}

// ---------- Football ----------

const crest = (side, short) => side && side.logo
  ? `<img class="crest" src="/api/logo?u=${encodeURIComponent(side.logo)}" alt="">`
  : `<span class="crest">${esc(short)}</span>`;

function pickFixture(t) {
  const now = Date.now();
  if (t.next && t.next.status === 'live') return { kind: 'live', f: t.next };
  // Show a result until the evening after the match.
  if (t.last && t.last.status === 'done' && now - Date.parse(t.last.kickoff) < 14 * 3600e3) return { kind: 'result', f: t.last };
  if (t.next) return { kind: 'next', f: t.next };
  if (t.last) return { kind: 'result', f: t.last };
  return null;
}

const koFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
function kickoffText(iso) {
  const d = new Date(iso);
  const days = Math.round((+addDays(d, 0) - +addDays(new Date(), 0)) / 864e5);
  const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days < 7 ? DAY[d.getDay()] : koFmt.format(d);
  return `${day} ${hhmm(d)}`;
}

function resultLetter(t, f) {
  const us = f.home.id === t.id ? f.home.goals : f.away.goals;
  const them = f.home.id === t.id ? f.away.goals : f.home.goals;
  return us > them ? '<b class="w">W</b>' : us < them ? '<b class="l">L</b>' : '<b class="d">D</b>';
}

function teamCard(t) {
  const st = TEAM_STYLE[t.key] || { short: t.name.slice(0, 3).toUpperCase(), style: 'solid' };
  const p = pickFixture(t);
  const stripe = st.style === 'halves' ? '<div class="stripe"><i></i><i></i></div>' : '';
  const cls = `team kit-${st.style}${p && p.kind === 'live' ? ' live' : ''}`;
  if (!p) return `<div class="${cls}">${stripe}<div class="pad"><p class="label">${esc(t.name)}</p><p class="muted">No fixtures found</p></div></div>`;
  const f = p.f;
  if (p.kind === 'next') {
    const home = f.home.id === t.id;
    const opp = home ? f.away : f.home;
    return `<div class="${cls}">${stripe}<div class="pad">
      <p class="label">${esc(f.league)}</p>
      <div class="row">${crest(home ? f.home : f.away, st.short)}<span>${esc(t.name)}</span></div>
      <div class="sub">v ${esc(opp.name)} (${home ? 'home' : 'away'})</div>
      <div class="ko">${kickoffText(f.kickoff)}</div>
      ${t.last && t.last.status === 'done' ? `<div class="sub">Last: ${resultLetter(t, t.last)} ${t.last.home.goals}–${t.last.away.goals} v ${esc(t.last.home.id === t.id ? t.last.away.name : t.last.home.name)}</div>` : ''}
    </div></div>`;
  }
  const badge = p.kind === 'live'
    ? `<span class="badge">${f.statusShort === 'HT' ? 'Half time' : `Live ${f.elapsed || 0}'`}</span>`
    : `<span class="badge quiet">Full time ${resultLetter(t, f)}</span>`;
  const progress = p.kind === 'live' ? `<div class="bar"><i style="width:${Math.min(100, Math.round((f.elapsed || 0) / 90 * 100))}%"></i></div>` : '';
  return `<div class="${cls}">${stripe}<div class="pad">
    <div class="head"><p class="label">${esc(f.league)}</p>${badge}</div>
    <div class="row score">${crest(f.home, f.home.id === t.id ? st.short : '')}<span>${esc(f.home.name)}</span><b>${f.home.goals == null ? '' : f.home.goals}</b></div>
    <div class="row score">${crest(f.away, f.away.id === t.id ? st.short : '')}<span>${esc(f.away.name)}</span><b>${f.away.goals == null ? '' : f.away.goals}</b></div>
    ${progress}
  </div></div>`;
}

poll('/api/football', (d) => {
  // Every minute while a match is on or about to start, otherwise every 15 minutes.
  const busy = d && d.teams && d.teams.some((t) => t.next && (t.next.status === 'live' || Math.abs(Date.parse(t.next.kickoff) - Date.now()) < 15 * 60e3));
  return busy ? 60e3 : 15 * 60e3;
}, (d, err) => {
  const el = $('teams');
  if (!d) { el.innerHTML = `<div class="team kit-solid"><div class="pad"><p class="label">Football</p><p class="sub">${err ? 'Unavailable, retrying' : 'Loading…'}</p></div></div>`; return; }
  if (!d.configured) {
    el.innerHTML = ['Liverpool', 'Kidderminster Harriers'].map((n, i) =>
      `<div class="team ${i ? 'kit-halves' : 'kit-solid'}">${i ? '<div class="stripe"><i></i><i></i></div>' : ''}<div class="pad"><p class="label">${n}</p><p class="sub">Football data isn't set up.</p></div></div>`).join('');
    return;
  }
  el.innerHTML = d.teams.map(teamCard).join('');
});

// ---------- Spotify (hidden until connected and playing) ----------

poll('/api/spotify', 15e3, (s) => {
  const el = $('player');
  const playing = s && s.configured && s.item;
  el.hidden = !playing;
  $('screen').classList.toggle('with-player', !!playing);
  if (!playing) return;
  const pct = Math.round(s.progress / s.duration * 100);
  el.innerHTML = `<img class="art" src="${esc(s.item.art)}" alt="">
    <div class="track"><b>${esc(s.item.title)}</b><span>${esc(s.item.artist)} · ${esc(s.item.album)}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
    <div class="controls"><button data-a="previous">${playIcons.prev}</button><button class="main" data-a="${s.isPlaying ? 'pause' : 'play'}">${s.isPlaying ? playIcons.pause : playIcons.play}</button><button data-a="next">${playIcons.next}</button></div>
    <div class="device">${playIcons.speaker} ${esc(s.device || '')}</div>`;
});

tick();

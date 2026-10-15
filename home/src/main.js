import { BINS, NIGHT, TEAM_STYLE } from './config.js';
import { binIcon, feelsIcon, playIcons, sunriseIcon, sunsetIcon, umbrellaIcon, weatherIcon, windIcon } from './icons.js';
import { espnIdFor, loadFootball, loadTables } from './football.js';

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
    updateNight(now);
    renderBins(now);
    renderCalendar();
    // Reload once a day at 03:00 to clear any slow leaks.
    if (m === '03:00' && performance.now() > 120e3) location.reload();
  }
}
setInterval(tick, 1000);

// Night: the page goes black (the kiosk switches the backlight off too). A tap wakes it for a
// minute, and every touch while awake extends that. The tap that wakes it is swallowed, so it
// can't press whatever was under the blackout.
let awakeUntil = 0;
let swallowClickUntil = 0;
function isNight(now) {
  const h = now.getHours();
  return NIGHT.from > NIGHT.to ? h >= NIGHT.from || h < NIGHT.to : h >= NIGHT.from && h < NIGHT.to;
}
function updateNight(now) {
  $('night').className = isNight(now) && Date.now() > awakeUntil ? 'night on' : 'night';
}
document.addEventListener('touchstart', () => {
  if ($('night').classList.contains('on')) swallowClickUntil = Date.now() + 1000;
  awakeUntil = Date.now() + 60e3;
  updateNight(new Date());
}, { capture: true, passive: true });
document.addEventListener('click', (e) => {
  if (Date.now() < swallowClickUntil) { e.stopPropagation(); e.preventDefault(); swallowClickUntil = 0; }
}, true);
setInterval(() => updateNight(new Date()), 5e3);

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
  // Older cached payloads (before these fields existed) just leave the gap empty.
  $('weather-hours').innerHTML = (w.hours || []).map((h) => {
    const i = weatherIcon(h.code, h.isDay);
    const rain = h.rain >= 10 ? `${h.rain}%` : '';
    return `<div class="hr"><span class="muted">${h.time}</span><span class="wx ${i.tone}">${i.svg}</span><span>${h.temp}°</span><span class="pop">${rain}</span></div>`;
  }).join('');
  $('weather-stats').innerHTML = w.now.feels == null ? '' : [
    stat(feelsIcon, 'Feels like', `${w.now.feels}°`),
    stat(windIcon, `Wind ${compass(w.now.windFrom)}`, `${w.now.wind} <small>mph</small>`),
    w.sun ? stat(w.sun.kind === 'rise' ? sunriseIcon : sunsetIcon, w.sun.kind === 'rise' ? 'Sunrise' : 'Sunset', w.sun.time) : '',
  ].join('');
});

const stat = (icon, label, value) => `<div class="stat"><span class="muted">${icon} ${label}</span><b>${value}</b></div>`;
const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

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

// A timed event that started on an earlier day shows when it ends ("Until 10:00"), or "All day"
// if it carries on past this day.
function timeLabel(e, day) {
  if (e.allDay) return 'All day';
  const s = new Date(e.start);
  if (+s >= +day) return hhmm(s);
  const end = new Date(e.end);
  return +end < +addDays(day, 1) ? `Until ${hhmm(end)}` : 'All day';
}

function eventRow(e, now, isToday, day) {
  const s = new Date(e.start);
  const past = isToday && !e.allDay && Date.parse(e.end) < +now;
  const soon = isToday && !e.allDay && +s > +now ? ` · ${relative(+s - +now)}` : '';
  return `<div class="ev${past ? ' past' : ''}"><span class="t">${timeLabel(e, day)}</span>` +
    `<span class="b" style="border-color:${esc(e.colour || '#B4B2A9')}">${esc(e.title)}<small>${esc(e.calendar)}${soon}</small></span></div>`;
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const mondayOnOrBefore = (d) => addDays(d, -((d.getDay() + 6) % 7));

// Weeks (Monday first) covering the month that contains `first`.
function monthWeeks(first) {
  const weeks = [];
  let d = mondayOnOrBefore(first);
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  while (+d < +next) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    d = addDays(d, 7);
  }
  return weeks;
}

// Small month overview at the top of the column: a dot per calendar with something on that day.
function miniMonth(today) {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  let html = `<div class="mini-month"><div class="mm-title">${monthFmt.format(first)}</div><div class="mm-grid">`;
  html += ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="mm-dow">${d}</span>`).join('');
  for (const week of monthWeeks(first)) {
    for (const d of week) {
      if (d.getMonth() !== first.getMonth()) { html += '<span class="mm-day out"></span>'; continue; }
      const colours = [...new Set(eventsOn(d).map((e) => e.colour || '#B4B2A9'))].slice(0, 3);
      const cls = +d === +today ? ' today' : +d < +today ? ' past' : '';
      html += `<span class="mm-day${cls}">${d.getDate()}<i>${colours.map((c) => `<b style="background:${esc(c)}"></b>`).join('')}</i></span>`;
    }
  }
  return `${html}</div></div>`;
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
  let html = miniMonth(today);
  const todays = eventsOn(today);
  html += '<p class="label">Today</p>';
  let lineDone = false;
  for (const e of todays) {
    if (!lineDone && !e.allDay && Date.parse(e.start) > +now) {
      html += '<div class="nowline"><span>Now</span><i></i></div>';
      lineDone = true;
    }
    html += eventRow(e, now, true, today);
  }
  if (!todays.length) html += '<p class="muted">Nothing on</p>';
  else if (!lineDone) html += '<div class="nowline"><span>Now</span><i></i></div>';
  const tomorrow = eventsOn(addDays(today, 1));
  html += '<p class="label gap">Tomorrow</p>';
  html += tomorrow.length ? tomorrow.map((e) => eventRow(e, now, false, addDays(today, 1))).join('') : '<p class="muted">Nothing on</p>';
  // The three days after that, in a smaller style; days with nothing on are left out.
  for (let i = 2; i < 5; i++) {
    const day = addDays(today, i);
    const evs = eventsOn(day);
    if (!evs.length) continue;
    html += `<div class="later"><p class="label gap">${dayFmt.format(day)}</p>${evs.map((e) => eventRow(e, now, false, day)).join('')}</div>`;
  }
  if (calError) html += '<p class="stale">Not updated recently</p>';
  el.innerHTML = html;
  if (fsOpen === 'cal') renderMonthView();
}

// ---------- Full-screen views: month calendar and league table ----------
// Opened by tapping the calendar column or a team card; closed with the X, or by themselves
// after two minutes.

let fsOpen = null;
let fsMonth = 0; // 0 = this month, 1 = next (the server sends both)
let fsTimer = null;

function openFs(what) {
  fsOpen = what;
  fsMonth = 0;
  renderFs();
  $('fs').hidden = false;
  clearTimeout(fsTimer);
  fsTimer = setTimeout(closeFs, 2 * 60e3);
}
function closeFs() {
  fsOpen = null;
  clearTimeout(fsTimer);
  $('fs').hidden = true;
  $('fs').innerHTML = '';
}
function renderFs() {
  if (fsOpen === 'cal') renderMonthView();
  else if (fsOpen && fsOpen.startsWith('table:')) renderTableView(fsOpen.slice(6));
}

function renderMonthView() {
  if (!calData || !calData.configured) { $('fs').innerHTML = '<button class="fs-close" data-fs-close aria-label="Close">×</button><p class="muted">No calendar yet</p>'; return; }
  const today = addDays(new Date(), 0);
  const first = new Date(today.getFullYear(), today.getMonth() + fsMonth, 1);
  let html = `<div class="fs-head"><button class="fs-nav" data-cal-nav="-1" ${fsMonth === 0 ? 'disabled' : ''} aria-label="Previous month">‹</button>
    <h2>${monthFmt.format(first)}</h2>
    <button class="fs-nav" data-cal-nav="1" ${fsMonth === 1 ? 'disabled' : ''} aria-label="Next month">›</button>
    <button class="fs-close" data-fs-close aria-label="Close">×</button></div>`;
  html += '<div class="mv-grid">';
  html += ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `<span class="mv-dow">${d}</span>`).join('');
  for (const week of monthWeeks(first)) {
    for (const d of week) {
      const out = d.getMonth() !== first.getMonth();
      const evs = out ? [] : eventsOn(d);
      const cls = `${out ? ' out' : ''}${+d === +today ? ' today' : ''}${!out && +d < +today ? ' past' : ''}`;
      html += `<div class="mv-day${cls}"><span class="mv-num">${out ? '' : d.getDate()}</span>`;
      html += evs.slice(0, 3).map((e) => `<span class="mv-ev" style="border-color:${esc(e.colour || '#B4B2A9')}">${e.allDay || +new Date(e.start) < +d ? '' : `<em>${hhmm(new Date(e.start))}</em> `}${esc(e.title)}</span>`).join('');
      if (evs.length > 3) html += `<span class="mv-more">+${evs.length - 3} more</span>`;
      html += '</div>';
    }
  }
  $('fs').innerHTML = `${html}</div>`;
}

function renderTableView(key) {
  const t = tables && tables[key];
  const me = espnIdFor(key);
  const style = (TEAM_STYLE[key] || {}).style || 'solid';
  let html = `<div class="fs-head"><h2>${esc(t ? t.league : 'League table')}</h2><button class="fs-close" data-fs-close aria-label="Close">×</button></div>`;
  if (!t) { $('fs').innerHTML = `${html}<p class="muted">Table not available yet</p>`; return; }
  html += `<table class="lt"><thead><tr><th>#</th><th class="tn">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>`;
  html += t.rows.map((r) => `<tr class="${r.id === me ? `me kit-${style}` : ''}"><td>${r.rank}</td><td class="tn">${esc(r.name)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.gd > 0 ? '+' : ''}${r.gd}</td><td><b>${r.pts}</b></td></tr>`).join('');
  $('fs').innerHTML = `${html}</tbody></table>`;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest) return;
  const nav = e.target.closest('[data-cal-nav]');
  if (nav) { fsMonth = Math.max(0, Math.min(1, fsMonth + Number(nav.dataset.calNav))); renderMonthView(); return; }
  if (e.target.closest('[data-fs-close]')) { closeFs(); return; }
  if (fsOpen) return;
  const opener = e.target.closest('[data-fs-open]');
  if (opener) openFs(opener.dataset.fsOpen);
});

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

// League table rows around the team: up to five above and five below. fitSnippets() then trims
// rows furthest from the team until the card no longer overflows, so it fills whatever space
// the card has.
function tableSnippet(key) {
  const t = tables && tables[key];
  if (!t) return '';
  const me = espnIdFor(key);
  const i = t.rows.findIndex((r) => r.id === me);
  if (i < 0) return '';
  const start = Math.max(0, Math.min(i - 5, t.rows.length - 11));
  const rows = t.rows.slice(start, start + 11);
  return `<div class="snip">${rows.map((r, j) => `<div class="snip-row${r.id === me ? ' me' : ''}" data-d="${start + j - i}"><span>${r.rank}</span><span class="tn">${esc(r.short)}</span><span>${r.played}</span><span>${r.gd > 0 ? '+' : ''}${r.gd}</span><b>${r.pts}</b></div>`).join('')}</div>`;
}

function fitSnippets() {
  for (const card of document.querySelectorAll('.team')) {
    const snip = card.querySelector('.snip');
    if (!snip) continue;
    let guard = 12;
    while (card.scrollHeight > card.clientHeight + 1 && guard-- > 0) {
      const rows = [...snip.querySelectorAll('.snip-row:not(.me)')];
      if (!rows.length) break;
      // Drop the row furthest from the team; on a tie, drop the one below.
      rows.sort((a, b) => Math.abs(b.dataset.d) - Math.abs(a.dataset.d) || b.dataset.d - a.dataset.d);
      rows[0].remove();
    }
  }
}

function teamCard(t) {
  const st = TEAM_STYLE[t.key] || { short: t.name.slice(0, 3).toUpperCase(), style: 'solid' };
  const p = pickFixture(t);
  const stripe = st.style === 'halves' ? '<div class="stripe"><i></i><i></i></div>' : '';
  const cls = `team kit-${st.style}${p && p.kind === 'live' ? ' live' : ''}" data-fs-open="table:${t.key}`;
  if (!p) return `<div class="${cls}">${stripe}<div class="pad"><p class="label">${esc(t.name)}</p><p class="muted">No fixtures found</p></div>${tableSnippet(t.key)}</div>`;
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
    </div>${tableSnippet(t.key)}</div>`;
  }
  const badge = p.kind === 'live'
    ? `<span class="badge">${f.statusShort === 'HT' ? 'Half time' : f.elapsed ? `Live ${f.elapsed}'` : 'In progress'}</span>`
    : `<span class="badge quiet">Full time ${resultLetter(t, f)}</span>`;
  const progress = p.kind === 'live' && f.elapsed ? `<div class="bar"><i style="width:${Math.min(100, Math.round((f.elapsed || 0) / 90 * 100))}%"></i></div>` : '';
  return `<div class="${cls}">${stripe}<div class="pad">
    <div class="head"><p class="label">${esc(f.league)}</p>${badge}</div>
    <div class="row score">${crest(f.home, f.home.id === t.id ? st.short : '')}<span>${esc(f.home.name)}</span><b>${f.home.goals == null ? '' : f.home.goals}</b></div>
    <div class="row score">${crest(f.away, f.away.id === t.id ? st.short : '')}<span>${esc(f.away.name)}</span><b>${f.away.goals == null ? '' : f.away.goals}</b></div>
    ${progress}
  </div>${tableSnippet(t.key)}</div>`;
}

function renderFootball(d, err) {
  const el = $('teams');
  if (!d) { el.innerHTML = `<div class="team kit-solid"><div class="pad"><p class="label">Football</p><p class="sub">${err ? 'Unavailable, retrying' : 'Loading…'}</p></div></div>`; return; }
  el.innerHTML = d.teams.map(teamCard).join('');
  fitSnippets();
}

// Fetched on the frame (see football.js); the server's cached copy is the fallback.
let football = null;
async function footballLoop() {
  let err = null;
  try {
    football = await loadFootball();
  } catch (e) {
    err = e;
    try { const r = await fetch('/api/football', { cache: 'no-store' }); if (r.ok) { football = await r.json(); err = null; } } catch (e2) { /* keep last */ }
  }
  renderFootball(football, err);
  // Every minute while a match is on or about to start, otherwise every 15 minutes.
  const busy = football && football.teams.some((t) => t.next && (t.next.status === 'live' || Math.abs(Date.parse(t.next.kickoff) - Date.now()) < 15 * 60e3));
  setTimeout(footballLoop, err && !football ? 60e3 : busy ? 60e3 : 15 * 60e3);
}
footballLoop();

// League tables: hourly from ESPN (cached on the frame), then redraw the cards.
let tables = null;
async function tablesLoop() {
  try { tables = await loadTables(); } catch (err) { /* keep last */ }
  if (football) renderFootball(football, null);
  if (fsOpen && fsOpen.startsWith('table:')) renderFs();
  setTimeout(tablesLoop, 30 * 60e3);
}
tablesLoop();

// ---------- Spotify (hidden until connected and playing) ----------

let spotifyTimer = null;
let pausedSince = 0;
async function spotifyLoop() {
  clearTimeout(spotifyTimer);
  let wait = 30e3;
  try {
    const r = await fetch('/api/spotify', { cache: 'no-store' });
    const s = r.ok ? await r.json() : null;
    if (s && s.item) {
      if (s.isPlaying) pausedSince = 0; else if (!pausedSince) pausedSince = Date.now();
    }
    // Show while playing, and for 15 minutes after pausing so it can be resumed from the frame.
    const show = !!(s && s.item && (s.isPlaying || Date.now() - pausedSince < 15 * 60e3));
    renderPlayer(show ? s : null);
    // Every 5 s while playing (progress bar), every 10 s otherwise so new music shows up quickly.
    wait = s && s.isPlaying ? 5e3 : 10e3;
  } catch (err) {
    wait = 60e3;
  }
  spotifyTimer = setTimeout(spotifyLoop, wait);
}

let npOpen = false;
let lastSpotify = null;

const controls = (s, big) => `<div class="controls${big ? ' big' : ''}"><button data-a="previous" aria-label="Previous">${playIcons.prev}</button><button class="main" data-a="${s.isPlaying ? 'pause' : 'play'}" aria-label="${s.isPlaying ? 'Pause' : 'Play'}">${s.isPlaying ? playIcons.pause : playIcons.play}</button><button data-a="next" aria-label="Next">${playIcons.next}</button></div>`;
const fmtTime = (ms) => { const t = Math.round((ms || 0) / 1000); return `${Math.floor(t / 60)}:${pad(t % 60)}`; };

function renderPlayer(s) {
  lastSpotify = s;
  const el = $('player');
  el.hidden = !s;
  $('screen').classList.toggle('with-player', !!s);
  if (!s) { el.innerHTML = ''; closeNowPlaying(); return; }
  const pct = s.duration ? Math.round(s.progress / s.duration * 100) : 0;
  el.innerHTML = `${s.item.art ? `<img class="art" data-open="np" src="${esc(s.item.art)}" alt="">` : '<div class="art" data-open="np"></div>'}
    <div class="track" data-open="np"><b>${esc(s.item.title)}</b><span>${esc(s.item.artist)}${s.item.album ? ` · ${esc(s.item.album)}` : ''}</span><div class="bar"><i style="width:${pct}%"></i></div></div>
    ${controls(s, false)}
    ${s.device ? `<div class="device">${playIcons.speaker} ${esc(s.device)}</div>` : ''}`;
  if (npOpen) renderNowPlaying(s);
}

// Full-screen now playing: opened by tapping the art or title, closed with the X or by tapping
// outside the controls. It closes by itself after 10 minutes so the dashboard comes back.
let npTimer = null;
function renderNowPlaying(s) {
  const pct = s.duration ? Math.round(s.progress / s.duration * 100) : 0;
  const art = s.item.artLarge || s.item.art;
  $('np').innerHTML = `<button class="np-close" data-close="np" aria-label="Close">×</button>
    ${art ? `<img class="np-art" src="${esc(art)}" alt="">` : '<div class="np-art"></div>'}
    <div class="np-side">
      <div class="np-title">${esc(s.item.title)}</div>
      <div class="np-artist">${esc(s.item.artist)}</div>
      ${s.item.album ? `<div class="np-album">${esc(s.item.album)}</div>` : ''}
      <div class="np-time"><span>${fmtTime(s.progress)}</span><div class="bar"><i style="width:${pct}%"></i></div><span>${fmtTime(s.duration)}</span></div>
      ${controls(s, true)}
      ${s.device ? `<div class="device">${playIcons.speaker} ${esc(s.device)}</div>` : ''}
    </div>`;
}
function openNowPlaying() {
  if (!lastSpotify) return;
  npOpen = true;
  renderNowPlaying(lastSpotify);
  $('np').hidden = false;
  clearTimeout(npTimer);
  npTimer = setTimeout(closeNowPlaying, 10 * 60e3);
}
function closeNowPlaying() {
  npOpen = false;
  clearTimeout(npTimer);
  $('np').hidden = true;
  $('np').innerHTML = '';
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-open="np"]')) { openNowPlaying(); return; }
  const btn = e.target.closest('button[data-a]');
  if (btn) {
    btn.classList.add('busy');
    try { await fetch(`/api/spotify/${btn.dataset.a}`, { method: 'POST' }); } catch (err) { /* refresh shows the real state */ }
    setTimeout(spotifyLoop, 600); // give Spotify a moment to apply it
    return;
  }
  if (npOpen && (e.target.closest('[data-close="np"]') || e.target === $('np'))) closeNowPlaying();
});
spotifyLoop();

// Reload when a new build is served, so the frame never keeps running old code. Vite gives each
// build's script a new hashed name, so compare it with the one this page loaded.
const myScript = (document.querySelector('script[type="module"][src]') || {}).src || '';
setInterval(async () => {
  try {
    const html = await (await fetch('/', { cache: 'no-store' })).text();
    const m = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);
    if (m && myScript && new URL(m[1], location.href).href !== myScript) location.reload();
  } catch (err) { /* offline: try again next time */ }
}, 60e3);

tick();

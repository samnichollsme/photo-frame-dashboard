// Serves the built dashboard from ./dist and a small JSON API for it. The frame only ever talks to
// this server: third-party HTTPS fails on Android 6, and keys must not reach the page.
import ICAL from 'ical.js';
import { LOCATION, TEAMS, TIMEZONE } from './config.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// In-memory cache per Worker instance. Good enough for one frame; a restart just refetches.
const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    if (hit) return hit.value; // keep showing the last good data
    throw err;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      switch (url.pathname) {
        case '/api/weather': return json(await weather());
        case '/api/football': return json(await football(env));
        case '/api/calendar': return json(await calendar(env));
        case '/api/spotify': return json({ configured: false });
        case '/api/logo': return logo(url);
      }
      if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    } catch (err) {
      return json({ error: String(err && err.message || err) }, 502);
    }
    const res = await env.ASSETS.fetch(request);
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      // The frame can't clear its cache: always revalidate the page, let hashed assets cache.
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'no-cache');
      return out;
    }
    return res;
  },
};

// ---------- Weather (Open-Meteo, no key) ----------

async function weather() {
  return cached('weather', 15 * 60e3, async () => {
    const q = new URLSearchParams({
      latitude: LOCATION.latitude,
      longitude: LOCATION.longitude,
      current: 'temperature_2m,weather_code,is_day',
      hourly: 'precipitation_probability,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min',
      timezone: TIMEZONE,
      forecast_days: '4',
    });
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
    if (!r.ok) throw new Error(`open-meteo ${r.status}`);
    const d = await r.json();

    // First hour in the next 12 with a 50%+ chance of rain. Hourly times are local ("2026-10-15T16:00").
    const nowHour = d.current.time.slice(0, 13);
    const start = d.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour);
    let rainFrom = null;
    for (let i = Math.max(start, 0); i < start + 12 && i < d.hourly.time.length; i++) {
      if (d.hourly.precipitation_probability[i] >= 50) { rainFrom = d.hourly.time[i].slice(11, 16); break; }
    }

    return {
      updated: Date.now(),
      now: {
        temp: Math.round(d.current.temperature_2m),
        code: d.current.weather_code,
        isDay: d.current.is_day === 1,
      },
      today: { max: Math.round(d.daily.temperature_2m_max[0]), min: Math.round(d.daily.temperature_2m_min[0]) },
      rainFrom,
      days: d.daily.time.slice(1).map((date, i) => ({
        date,
        code: d.daily.weather_code[i + 1],
        max: Math.round(d.daily.temperature_2m_max[i + 1]),
        min: Math.round(d.daily.temperature_2m_min[i + 1]),
      })),
    };
  });
}

// ---------- Football (TheSportsDB) ----------
// The free key covers both clubs' next and last fixtures. Live scores during a match are a
// Premium feature there, so mid-match the card may lag until the result is in.

const LIVE = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'PEN', 'LIVE', 'INT', 'SUSP'];
const DONE = ['FT', 'AET', 'AP', 'Match Finished'];

async function sportsDb(env, path) {
  const r = await fetch(`https://www.thesportsdb.com/api/v1/json/${env.SPORTSDB_KEY || '123'}/${path}`);
  if (!r.ok) throw new Error(`thesportsdb ${r.status}`);
  return r.json();
}

const goals = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function fixtureView(e) {
  if (!e) return null;
  const status = e.strStatus || 'NS';
  // strTimestamp is UTC without a zone; add one so the frame shows local time.
  const kickoff = e.strTimestamp ? `${e.strTimestamp.replace(/\+00:00$/, '')}Z` : `${e.dateEvent}T${e.strTime || '00:00:00'}Z`;
  return {
    id: e.idEvent,
    kickoff,
    status: LIVE.includes(status) ? 'live' : DONE.includes(status) ? 'done' : 'scheduled',
    statusShort: status,
    elapsed: e.strProgress ? parseInt(e.strProgress, 10) || null : null,
    league: e.strLeague,
    home: { id: e.idHomeTeam, name: e.strHomeTeam, logo: e.strHomeTeamBadge, goals: goals(e.intHomeScore) },
    away: { id: e.idAwayTeam, name: e.strAwayTeam, logo: e.strAwayTeamBadge, goals: goals(e.intAwayScore) },
  };
}

async function football(env) {
  const teams = await Promise.all(TEAMS.map(async (team) => {
    // Next and last fixture, refreshed every couple of hours (2 requests per team).
    const base = await cached(`fixtures:${team.id}`, 2 * 3600e3, async () => {
      const n = await sportsDb(env, `eventsnext.php?id=${team.id}`);
      const l = await sportsDb(env, `eventslast.php?id=${team.id}`);
      return { next: fixtureView((n.events || [])[0]), last: fixtureView((l.results || [])[0]) };
    });
    let { next, last } = base;
    // From 10 minutes before kick-off to 2.5 hours after, check that fixture every 2 minutes.
    if (next) {
      const ko = Date.parse(next.kickoff);
      if (Date.now() > ko - 10 * 60e3 && Date.now() < ko + 150 * 60e3) {
        const live = await cached(`live:${next.id}`, 2 * 60e3, async () => {
          const d = await sportsDb(env, `lookupevent.php?id=${next.id}`);
          return fixtureView((d.events || [])[0]);
        });
        if (live && live.status === 'done') { last = live; next = null; } else if (live) next = live;
      }
      // After the match window, fetch next/last again so the result replaces the fixture.
      if (Date.now() >= ko + 150 * 60e3) cache.delete(`fixtures:${team.id}`);
    }
    return { key: team.key, name: team.name, id: String(team.id), next, last };
  }));
  return { configured: true, updated: Date.now(), teams };
}

// Team crests come from TheSportsDB's image host over HTTPS; pass them through so the frame
// doesn't need to trust that certificate. The /small suffix gives a 250px version.
async function logo(url) {
  const u = url.searchParams.get('u') || '';
  if (!/^https:\/\/(r2|www)\.thesportsdb\.com\/images\/media\/team\/badge\/[\w-]+\.png$/.test(u)) return json({ error: 'bad logo url' }, 400);
  const r = await fetch(`${u}/small`, { cf: { cacheTtl: 7 * 86400 } });
  return new Response(r.body, {
    status: r.status,
    headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' },
  });
}

// ---------- Calendar (iCloud public links) ----------

async function calendar(env) {
  if (!env.CALENDARS) return { configured: false };
  const sources = JSON.parse(env.CALENDARS);
  return cached('calendar', 10 * 60e3, async () => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // server-local midnight
    from.setTime(from.getTime() - 864e5); // a day of slack either side for time-zone differences
    const to = new Date(from.getTime() + 4 * 864e5);
    const events = [];
    for (const src of sources) {
      const r = await fetch(src.url.replace(/^webcal:/, 'https:'));
      if (!r.ok) throw new Error(`calendar ${src.name}: ${r.status}`);
      const comp = new ICAL.Component(ICAL.parse(await r.text()));
      for (const v of comp.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(v);
      // Moved or edited instances of a repeating event come as separate VEVENTs with a
      // RECURRENCE-ID; attach them to their series so getOccurrenceDetails uses them.
      const all = comp.getAllSubcomponents('vevent').map((ve) => new ICAL.Event(ve));
      const series = new Map(all.filter((e) => !e.isRecurrenceException()).map((e) => [e.uid, e]));
      for (const e of all) {
        if (e.isRecurrenceException() && series.has(e.uid)) series.get(e.uid).relateException(e);
      }
      for (const ev of series.values()) {
        const push = (start, end) => {
          const s = start.toJSDate();
          if (s > to || end.toJSDate() < from) return;
          events.push({
            title: ev.summary || '(no title)',
            calendar: src.name,
            colour: src.colour,
            allDay: start.isDate,
            start: start.isDate ? start.toString() : s.toISOString(),
            end: end.isDate ? end.toString() : end.toJSDate().toISOString(),
          });
        };
        if (ev.isRecurring()) {
          const it = ev.iterator();
          for (let next = it.next(), n = 0; next && n < 1000; next = it.next(), n++) {
            if (next.toJSDate() > to) break;
            const o = ev.getOccurrenceDetails(next);
            push(o.startDate, o.endDate);
          }
        } else {
          push(ev.startDate, ev.endDate || ev.startDate);
        }
      }
    }
    events.sort((a, b) => (a.start < b.start ? -1 : 1));
    return { configured: true, updated: Date.now(), events };
  });
}

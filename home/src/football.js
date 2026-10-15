// Football data fetched by the frame itself, from two free public APIs that allow browser requests:
// - TheSportsDB (free key) for next and last fixtures, cups included. Its shared free key is
//   refused from Cloudflare's servers but works from a home connection.
// - ESPN's public scoreboards for live scores during a match (league games, the FA Cup from the
//   first round proper, League Cup and European games; not FA Cup qualifying or the FA Trophy).
// Neither needs a key, so nothing secret reaches the page. If both fail, the server's cached copy
// (/api/football) is used.

const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

export const TEAMS = [
  { key: 'lfc', name: 'Liverpool', id: '133602', espn: '364', table: 'eng.1', tableName: 'Premier League' },
  { key: 'khfc', name: 'Kidderminster Harriers', id: '134448', espn: '319', table: 'eng.5', tableName: 'National League' },
];

const ESPN_LEAGUES = [
  [/premier league/i, 'eng.1'],
  [/national league/i, 'eng.5'],
  [/fa cup/i, 'eng.fa'],
  [/(efl|league|carabao) cup/i, 'eng.league_cup'],
  [/champions league/i, 'uefa.champions'],
  [/europa league/i, 'uefa.europa'],
  [/conference league/i, 'uefa.europa.conf'],
];

const LIVE = ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'PEN', 'LIVE', 'INT', 'SUSP'];
const DONE = ['FT', 'AET', 'AP', 'Match Finished'];
const goals = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const pad = (n) => (n < 10 ? '0' : '') + n;

function fixtureView(e) {
  if (!e) return null;
  const status = e.strStatus || 'NS';
  const kickoff = e.strTimestamp ? `${e.strTimestamp.replace(/\+00:00$/, '')}Z` : `${e.dateEvent}T${e.strTime || '00:00:00'}Z`;
  return {
    id: e.idEvent,
    kickoff,
    status: LIVE.includes(status) ? 'live' : DONE.includes(status) ? 'done' : 'scheduled',
    statusShort: status,
    elapsed: null,
    league: e.strLeague,
    home: { id: e.idHomeTeam, name: e.strHomeTeam, logo: e.strHomeTeamBadge, goals: goals(e.intHomeScore) },
    away: { id: e.idAwayTeam, name: e.strAwayTeam, logo: e.strAwayTeamBadge, goals: goals(e.intAwayScore) },
  };
}

// localStorage can throw or be empty (private mode, cleared data); treat it as a nice-to-have.
function stash(key, value) { try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), value })); } catch (err) { /* ignore */ } }
function unstash(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (err) { return null; } }

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// Next and last fixture per team, refreshed every 2 hours, or straight away once a match is over.
async function fixtures(team) {
  const key = `fixtures:${team.id}`;
  const saved = unstash(key);
  const over = saved && saved.value.next && Date.now() > Date.parse(saved.value.next.kickoff) + 150 * 60e3;
  if (saved && !over && Date.now() - saved.at < 2 * 3600e3) return saved.value;
  try {
    const n = await getJSON(`${TSDB}/eventsnext.php?id=${team.id}`);
    const l = await getJSON(`${TSDB}/eventslast.php?id=${team.id}`);
    const value = { next: fixtureView((n.events || [])[0]), last: fixtureView((l.results || [])[0]) };
    stash(key, value);
    return value;
  } catch (err) {
    if (saved) return saved.value;
    throw err;
  }
}

// Overlay ESPN's live score onto a fixture, if ESPN has the match. Returns null if not found.
export async function espnLive(team, f) {
  const slug = (ESPN_LEAGUES.find(([re]) => re.test(f.league || '')) || [])[1];
  if (!slug) return null;
  const d = new Date(f.kickoff);
  const day = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const board = await getJSON(`${ESPN}/${slug}/scoreboard?dates=${day}`);
  const ev = (board.events || []).find((e) => e.competitions[0].competitors.some((c) => c.team.id === team.espn));
  if (!ev) return null;
  const comp = ev.competitions[0];
  const side = (where) => comp.competitors.find((c) => c.homeAway === where);
  const state = ev.status.type.state; // pre, in, post
  const detail = ev.status.type.shortDetail || '';
  const clock = parseInt(ev.status.displayClock, 10);
  return {
    ...f,
    status: state === 'in' ? 'live' : state === 'post' ? 'done' : 'scheduled',
    statusShort: /^HT$|half/i.test(detail) ? 'HT' : state === 'post' ? 'FT' : f.statusShort,
    elapsed: state === 'in' && clock ? clock : null,
    home: { ...f.home, goals: state === 'pre' ? null : Number(side('home').score) },
    away: { ...f.away, goals: state === 'pre' ? null : Number(side('away').score) },
  };
}

// Same shape as the server's /api/football, so the cards render either.
export async function loadFootball() {
  const teams = await Promise.all(TEAMS.map(async (team) => {
    let { next, last } = await fixtures(team);
    if (next) {
      const ko = Date.parse(next.kickoff);
      if (Date.now() > ko - 10 * 60e3 && Date.now() < ko + 150 * 60e3) {
        const live = await espnLive(team, next).catch(() => null);
        if (live && live.status === 'done') { last = live; next = null; } else if (live) next = live;
        else if (Date.now() > ko) next = { ...next, status: 'live', statusShort: 'LIVE', elapsed: null, noScore: true };
      }
    }
    return { key: team.key, name: team.name, id: team.id, next, last };
  }));
  return { configured: true, updated: Date.now(), teams };
}

// League tables from ESPN's public standings, refreshed hourly. Returns { teamKey: { league, rows } }
// where each row is { rank, id, name, short, played, won, drawn, lost, gd, pts }.
const ESPN_STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer';
export async function loadTables() {
  const out = {};
  await Promise.all(TEAMS.map(async (team) => {
    const key = `table:${team.table}`;
    const saved = unstash(key);
    if (saved && Date.now() - saved.at < 3600e3) { out[team.key] = saved.value; return; }
    try {
      const d = await getJSON(`${ESPN_STANDINGS}/${team.table}/standings`);
      const group = (d.children || [d])[0];
      const rows = group.standings.entries.map((e) => {
        const st = {};
        for (const x of e.stats) st[x.name] = x.value;
        return {
          rank: st.rank, id: e.team.id, name: e.team.displayName, short: e.team.shortDisplayName || e.team.displayName,
          played: st.gamesPlayed, won: st.wins, drawn: st.ties, lost: st.losses,
          gd: st.pointDifferential, pts: st.points,
        };
      }).sort((a, b) => a.rank - b.rank);
      const value = { league: team.tableName, rows };
      stash(key, value);
      out[team.key] = value;
    } catch (err) {
      if (saved) out[team.key] = saved.value;
    }
  }));
  return out;
}

export const espnIdFor = (key) => (TEAMS.find((t) => t.key === key) || {}).espn;

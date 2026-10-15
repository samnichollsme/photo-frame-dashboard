// Settings the page needs. Nothing secret goes here: anyone on the network can read it.

// Bins alternate weekly. Give one known collection date and which bin went out that day; every
// other week is worked out from it. Bank holiday moves are not handled.
export const BINS = {
  knownDate: '2026-10-16', // a collection day (YYYY-MM-DD): Fridays
  knownBin: 'black',       // the bin collected on knownDate: 'green' or 'black'
  outFromHour: 18,         // "Out tonight" from 18:00 the day before
  collectedByHour: 9,      // "Out now" until 09:00 on collection day
};

// Team colours. Kidderminster plays in red and white halves; Liverpool in solid red.
export const TEAM_STYLE = {
  lfc: { short: 'LFC', style: 'solid' },
  khfc: { short: 'KH', style: 'halves' },
};

// Black out the screen between these hours (24-hour clock). The kiosk switches the backlight off
// on its own schedule: am start ... --ei night_from 22 --ei night_to 7 (keep the two the same).
export const NIGHT = { from: 22, to: 7 };

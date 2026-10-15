// Settings that aren't secret. Secrets (calendar links, tokens) live in .dev.vars / Worker secrets.

export const TIMEZONE = 'Europe/London';

// Kidderminster.
export const LOCATION = { latitude: 52.388, longitude: -2.249 };

// TheSportsDB team IDs (from searchteams.php).
export const TEAMS = [
  { key: 'lfc', name: 'Liverpool', id: 133602 },
  { key: 'khfc', name: 'Kidderminster Harriers', id: 134448 },
];

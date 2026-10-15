// Small inline SVG icons (no icon fonts or CDNs on the frame).
const svg = (body, cls = '') =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
const CLOUD = '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/>';
const PART = '<path d="M8 3.5v1M3.5 8h1M4.8 4.8l.7.7M11.2 4.8l-.7.7"/><path d="M5.6 10.4A3 3 0 1 1 10.7 7"/><path d="M9 19h8a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 11.5 3.8 3.8 0 0 0 9 19z"/>';
const RAIN = '<path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>';
const SNOW = '<path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="M8 19h.01M12 19h.01M16 19h.01M10 22h.01M14 22h.01"/>';
const STORM = '<path d="M7 15h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 6.5 4.3 4.3 0 0 0 7 15z"/><path d="M12 15l-2 4h4l-2 4"/>';
const FOG = '<path d="M4 10h16M4 14h16M6 18h12M7 6h10"/>';

// WMO weather codes used by Open-Meteo.
export function weatherIcon(code, isDay = true) {
  if (code === 0 || code === 1) return { svg: svg(isDay ? SUN : MOON), tone: isDay ? 'sun' : 'cloud', label: 'Clear' };
  if (code === 2) return { svg: svg(PART), tone: 'sun', label: 'Partly cloudy' };
  if (code === 3) return { svg: svg(CLOUD), tone: 'cloud', label: 'Cloudy' };
  if (code === 45 || code === 48) return { svg: svg(FOG), tone: 'cloud', label: 'Fog' };
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return { svg: svg(SNOW), tone: 'cold', label: 'Snow' };
  if (code >= 95) return { svg: svg(STORM), tone: 'rain', label: 'Thunder' };
  if (code >= 51) return { svg: svg(RAIN), tone: 'rain', label: 'Rain' };
  return { svg: svg(CLOUD), tone: 'cloud', label: 'Cloudy' };
}

export const binIcon = svg('<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>');
export const umbrellaIcon = svg('<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v7a2 2 0 0 0 4 0"/>', 'sm');
export const playIcons = {
  prev: svg('<path d="M19 20L9 12l10-8v16zM5 19V5"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  next: svg('<path d="M5 4l10 8-10 8V4zM19 5v14"/>'),
  speaker: svg('<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>', 'sm'),
};

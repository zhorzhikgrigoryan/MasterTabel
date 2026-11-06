// Tiny HTML templating with automatic escaping.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? render(vals[i]) : ''); });
  return raw(out);
}

const ICONS = {
  today: '<path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="8.5"/>',
  timesheet: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5v10M14.5 9.5v10"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.4c1.6.6 2.7 2.2 3 4.6"/>',
  payroll: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9v.01M17.5 15v.01"/>',
  analytics: '<path d="M4 19.5h16"/><rect x="5.5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="6" width="3" height="11" rx="1"/><rect x="15.5" y="9" width="3" height="8" rx="1"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6"/>',
};
export const icon = (name) => raw(`<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`);

export function layout({ L, lang, title, active, body, flash, bare = false }) {
  const nav = [
    ['today', '/', L.nav_today, L.nav_today], ['timesheet', '/timesheet', L.nav_timesheet, L.nav_timesheet],
    ['people', '/employees', L.nav_people, L.nav_people_s], ['payroll', '/payroll', L.nav_payroll, L.nav_payroll_s],
    ['analytics', '/analytics', L.nav_analytics, L.nav_analytics_s],
    ['settings', '/settings', L.nav_settings, L.nav_settings],
  ];
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F4F6F1">
<title>${esc(title)} · MasterTabel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Armenian:wght@400;500;600;700&family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/style.css?v=9">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1F3A93"/><path d="M8 11h16M8 16h16M8 21h10M13 7v18M19 7v18" stroke="#F4F6F1" stroke-width="2"/></svg>')}">
</head>
<body class="${bare ? 'bare' : ''}">
${bare ? '' : `<header class="top">
  <a class="brand" href="/"><span class="mark" aria-hidden="true"></span>MasterTabel</a>
  <nav class="nav" aria-label="Main">
    ${nav.map(([k, href, label, short]) => `<a href="${href}" aria-label="${esc(label)}" class="nav-${k}${active === k ? ' on' : ''}"${active === k ? ' aria-current="page"' : ''}>${icon(k)}<span class="lbl-l" aria-hidden="true">${esc(label)}</span><span class="lbl-s" aria-hidden="true">${esc(short)}</span></a>`).join('')}
  </nav>
  <a class="gear${active === 'settings' ? ' on' : ''}" href="/settings" aria-label="${esc(L.nav_settings)}">${icon('settings')}</a>
</header>`}
<main class="wrap">
${flash ? `<p class="flash ${flash.type}" role="status">${esc(flash.text)}</p>` : ''}
${render(body)}
</main>
<script src="/static/app.js?v=2" defer></script>
</body>
</html>`;
}

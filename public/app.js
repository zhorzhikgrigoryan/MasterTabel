// Small enhancements: confirmations, copy link, login polling.
document.addEventListener('click', (ev) => {
  const c = ev.target.closest('[data-confirm]');
  if (c && !window.confirm(c.dataset.confirm)) { ev.preventDefault(); return; }
  const copy = ev.target.closest('[data-copy]');
  if (copy) {
    const input = document.querySelector(copy.dataset.copy);
    const done = () => { const t = copy.textContent; copy.textContent = copy.dataset.copied; setTimeout(() => { copy.textContent = t; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, () => { input.select(); document.execCommand('copy'); done(); });
    else { input.select(); document.execCommand('copy'); done(); }
  }
});

const loginBtn = document.querySelector('[data-login]');
if (loginBtn) {
  const token = loginBtn.dataset.login;
  const wait = document.querySelector('[data-login-wait]');
  const expired = document.querySelector('[data-login-expired]');
  let timer = null;
  const poll = async () => {
    try {
      const r = await fetch(`/auth/poll?t=${encodeURIComponent(token)}`, { credentials: 'same-origin' });
      const j = await r.json();
      if (j.ok) { window.location.href = '/'; return; }
      if (j.expired) { clearInterval(timer); wait.hidden = true; expired.hidden = false; }
    } catch (e) { /* keep trying */ }
  };
  loginBtn.addEventListener('click', () => { wait.hidden = false; if (!timer) timer = setInterval(poll, 2000); });
  // Also poll quietly in case the owner opened the link on another device.
  timer = setInterval(poll, 3000);
}

// Chart tooltips: any element with data-tip shows it on hover, or on tap on touch screens.
(() => {
  if (!document.querySelector('[data-tip]')) return;
  const tip = document.createElement('div'); tip.id = 'tip'; tip.hidden = true; tip.setAttribute('role', 'status');
  document.body.appendChild(tip);
  const place = (x, y) => {
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; place(x, y); };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });
})();

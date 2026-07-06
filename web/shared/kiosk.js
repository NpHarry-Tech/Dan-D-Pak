// Kiosk hardening for customer-facing screens (iPad self-order).
// Customers can ONLY use the on-screen buttons we provide: no text selection,
// no context menu / long-press callout, no pinch or double-tap zoom, no image
// drag, no pull-to-refresh. Inputs/textareas (e.g. food notes) stay usable, and
// anything marked [data-allow-select] is exempt.
(function () {
  const mark = () => document.body && document.body.classList.add('kiosk');
  document.documentElement.classList.add('kiosk');
  mark();
  document.addEventListener('DOMContentLoaded', mark);

  const editable = (t) => t && t.closest && t.closest('input,textarea,[contenteditable="true"],[data-allow-select]');

  document.addEventListener('contextmenu', (e) => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener('selectstart', (e) => { if (!editable(e.target)) e.preventDefault(); });
  document.addEventListener('dragstart', (e) => e.preventDefault());

  // Safari pinch-zoom gesture events
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

  // Double-tap-to-zoom guard
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320 && !editable(e.target)) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  // Multi-finger pinch on move
  document.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // Hardware keyboard zoom shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault();
  });
})();

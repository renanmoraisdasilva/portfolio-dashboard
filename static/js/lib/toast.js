/**
 * Lightweight toast notification.
 * Requires .toast, .toast.success, .toast.error CSS classes.
 */

export function showToast(text, kind = 'success', timeout = 4000) {
  const t = document.createElement('div');
  t.className = 'toast ' + (kind === 'error' ? 'error' : 'success');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.addEventListener('transitionend', () => t.remove()); }, timeout - 200);
  setTimeout(() => { if (t.parentNode) t.remove(); }, timeout + 200);
}

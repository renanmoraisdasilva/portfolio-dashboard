/**
 * Lightweight fetch wrapper for server API calls.
 */

export async function request(url, method = 'GET', body = undefined) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    if (!resp.ok) { console.warn(`API ${method} ${url} → ${resp.status}`); return null; }
    if (resp.status === 204) return true;
    return await resp.json();
  } catch (err) { console.warn(`API ${method} ${url} error`, err); return null; }
}

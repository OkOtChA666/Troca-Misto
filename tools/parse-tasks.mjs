// Reads the rendered "regulação / tempo real" page and returns every agent with the tasks of the day.
// Pure function (no network), so it can be tested on a saved copy of the page.
const dec = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const hhmm = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? String(m[1]).padStart(2, '0') + ':' + m[2] : null; };
const fromPct = (left, width) => {                 // timeline is a 24h axis
  const f = (p) => { const mins = Math.round((parseFloat(p) / 100) * 1440); return String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); };
  return [f(left), f(parseFloat(left) + parseFloat(width))];
};

export function parseRegulation(html) {
  // 1) agents (staff number + name), in page order
  const agents = new Map();
  const headRe = /<font class="trigInfo">\[(\d+)\]<\/font>\s*<font class="nameInfo">([^<]*)<\/font>\s*<font class="firstNameInfo">([^<]*)<\/font>/g;
  let m;
  while ((m = headRe.exec(html))) {
    if (!agents.has(m[1])) agents.set(m[1], { id: m[1], name: (dec(m[2]).trim() + ' ' + dec(m[3]).trim()).trim(), tasks: [] });
  }
  // 2) tasks: every div with class "metier-N tache…"
  let date = null, taskCount = 0, orphan = 0;
  const divRe = /<div\b([^>]*\bclass="metier-(\d+) tache[^"]*"[^>]*)><font>([^<]*)<\/font>/g;
  while ((m = divRe.exec(html))) {
    const attrs = m[1];
    const get = (n) => { const r = new RegExp('\\b' + n + '="([^"]*)"').exec(attrs); return r ? dec(r[1]) : null; };
    const link = get('data-indexlien') || '';
    const lm = /^(\d+)-(\d{4}-\d{2}-\d{2})\s+(.*)$/.exec(link);
    if (!lm) { orphan++; continue; }
    const [, agentId, day, rest] = lm;
    date = date || day;
    const times = rest.match(/\b\d{1,2}:\d{2}\b/g) || [];
    let start = null, end = null;
    if (times.length >= 2) { start = hhmm(times[times.length - 2]); end = hhmm(times[times.length - 1]); }
    else {
      const sty = get('style') || '';
      const l = /left:\s*([\d.]+)%/.exec(sty), w = /width:\s*([\d.]+)%/.exec(sty);
      if (l && w) [start, end] = fromPct(l[1], w[1]);
    }
    const label = dec(m[3]).trim();
    const a = agents.get(agentId);
    if (!a) { orphan++; continue; }
    a.tasks.push({ label, start, end, post: m[2], changed: /\bis-edit\b/.test(attrs) || label.startsWith('<') });
    taskCount++;
  }
  agents.forEach((a) => a.tasks.sort((x, y) => String(x.start).localeCompare(String(y.start))));
  return { date, agents: [...agents.values()], taskCount, orphan };
}

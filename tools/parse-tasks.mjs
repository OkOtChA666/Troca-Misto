// Reads the rendered "regulação / tempo real" page and returns every agent with the tasks of the day.
// Pure function (no network), so it can be tested on a saved copy of the page.
const dec = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&');
const hhmm = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t); return m ? String(m[1]).padStart(2, '0') + ':' + m[2] : null; };
const fromPct = (left, width) => {                 // timeline is a 24h axis
  const f = (p) => { const mins = Math.round((parseFloat(p) / 100) * 1440 / 5) * 5; return String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0'); };
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
    // e.g. EW_9643_17:50:00_15:50_17:10  or, for a turnaround, U2_8539_3426_20:35:00_18:05_19:35 (arrives as 8539, departs as 3426)
    const fm = /^([A-Z0-9]{2,3})_([0-9]{1,4}[A-Z]?)(?:_([0-9]{1,4}[A-Z]?))?_(\d{1,2}:\d{2}):\d{2}_/.exec(rest);
    const fkey = fm ? fm[1] + fm[2] + (fm[3] ? '/' + fm[3] : '') + '@' + hhmm(fm[4]) : '';
    const fparts = fm ? { car: fm[1], n1: fm[2], n2: fm[3] || '', tm: hhmm(fm[4]) } : null;
    a.tasks.push({ label, start, end, post: m[2], changed: /\bis-edit\b/.test(attrs) || label.startsWith('<'), fkey, fparts });
    taskCount++;
  }
  agents.forEach((a) => a.tasks.sort((x, y) => String(x.start).localeCompare(String(y.start))));
  return { date, agents: [...agents.values()], taskCount, orphan };
}

// Reads today's tasks from planete-online and saves them to the TROCA-MISTO database (data/tasks).
// Prints only counts and status. If anything goes wrong it keeps the previous copy untouched.
import { fetchTasks } from './planete-fetch.mjs';


const PROJECT = 'troca-misto';
const API_KEY = 'AIzaSyDVJE3FwFC7mYuygtvZXPAzf6xYWgkLTMM'; // the same public web key the app itself uses
const URL = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/data/tasks?key=' + API_KEY;

// Firestore REST value encoding
export const sv = (s) => ({ stringValue: String(s) });
export const iv = (n) => ({ integerValue: String(Math.round(n)) });
export function buildDoc(parsed, now = Date.now()) {
  const a = {};
  parsed.agents.forEach((ag) => {
    a[ag.id] = sv(JSON.stringify({ n: ag.name, t: ag.tasks.map(t => [t.label, t.start, t.end, t.post, t.changed ? 1 : 0]) }));
  });
  return {
    fields: {
      date: sv(parsed.date || ''),
      updatedAt: iv(now),
      updatedAtIso: sv(new Date(now).toISOString()),
      agentCount: iv(parsed.agents.length),
      taskCount: iv(parsed.taskCount),
      a: { mapValue: { fields: a } },
    },
  };
}

async function main() {
  const USER = process.env.PLANETE_USER;
  const PASS = process.env.PLANETE_PASS;
  if (!USER || !PASS) { console.log('STOP: secrets PLANETE_USER / PLANETE_PASS are missing'); process.exit(1); }
  let parsed;
  try {
    parsed = await fetchTasks({ user: USER, pass: PASS, log: (m) => console.log('   ' + m) });
  } catch (e) {
    console.log('SKIPPED: could not read the platform — ' + String(e && e.message ? e.message : e).split('\n')[0].slice(0, 200));
    return; // keep the last good copy; the app shows its age
  }
  if (!parsed.agents || parsed.agents.length < 20 || !parsed.taskCount || !parsed.date) {
    console.log('SKIPPED: the page looked incomplete (agents=' + (parsed.agents || []).length + ', tasks=' + parsed.taskCount + ') — keeping the previous copy');
    return;
  }
  const body = JSON.stringify(buildDoc(parsed));
  const res = await fetch(URL, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Referer: 'https://trocamisto.pt/', Origin: 'https://trocamisto.pt' },
    body,
  });
  if (!res.ok) {
    const t = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
    console.log('SKIPPED: saving failed with HTTP ' + res.status + ' — ' + t);
    return;
  }
  console.log('SAVED: date=' + parsed.date + ' agents=' + parsed.agents.length + ' tasks=' + parsed.taskCount + ' size=' + Math.round(body.length / 1024) + 'KB');
}
if (process.argv[1] && /planete-sync\.mjs$/.test(process.argv[1])) main().then(() => process.exit(0));

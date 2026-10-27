// Fetches Knesset 26 results from the Central Elections Committee and writes data.json
// in the shape the dashboard renders. Plain script, no AI. Usage: node update.mjs <outDir>
// Cheap when nothing changed: reads only the national page and stops if its "נכון ל-" time is the same.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2] || 'site';
const NATIONAL_URL = 'https://votes26.bechirot.gov.il/nationalresults?lang=he';
const CITIES_CSV = 'https://media26.bechirot.gov.il/files/expc.csv';
const BALLOTS_CSV = 'https://media26.bechirot.gov.il/files/expb.csv';
const STOP_AFTER = Date.parse('2026-11-05T00:00:00+02:00');
const UA = 'nisai-elections-dashboard (github.com/Noam13-w)';

const SHORT = { 'מחל': 'הליכוד', 'ט': 'הציונות הדתית', 'דרך': 'ישר! (איזנקוט)', 'ב': 'עוצמה יהודית', 'אמת': 'הדמוקרטים',
  'רק': 'ביחד (בנט)', 'שס': 'ש"ס', 'די': 'המילואימניקים', 'ל': 'ישראל ביתנו', 'ך': 'עמך ישראל', 'ג': 'יהדות התורה',
  'ני': 'נעם', 'עם': 'רע"ם', 'זך': 'הציבור החרדי', 'י': 'ישראל תחילה', 'בקר': 'אורות השחר', 'ודם': 'הרשימה המשותפת',
  'ד': 'השותפות לכולם', 'בי': 'צומת בית ישראל', 'כן': 'כחול לבן' };

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function get(url, { binary = false } = {}) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'he' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
        throw new Error(`HTTP ${res.status} server=${res.headers.get('server')} body=${body}`);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return { buf, type: res.headers.get('content-type') || '' };
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
  throw new Error(`${url}: ${lastErr.message}`);
}

const num = s => Number(String(s).replace(/[^\d.-]/g, '')) || 0;
const text = html => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function decode(buf) {
  let s = buf.toString('utf8');
  if (s.includes('�')) s = new TextDecoder('windows-1255').decode(buf);
  return s.replace(/^﻿/, '');
}

function parseNational(html) {
  const plain = text(html);
  const asOf = (plain.match(/תוצאות נכון ל-?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2})/) || [])[1];
  const stat = label => { const m = plain.match(new RegExp(label + '[^\\d]{0,20}([\\d,]+)')); return m ? num(m[1]) : null; };
  const national = { eligible: stat('מספר בעלי זכות בחירה'), votes: stat('קולות עד עתה'), ballots: stat('קלפיות עד עתה'),
    valid: stat('קולות כשרים עד עתה'), invalid: stat('קולות פסולים עד עתה') };
  const lists = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/gi) || []).map(text);
    if (cells.length < 4 || !/%/.test(cells[2])) continue;
    const [full, l, pct, votes] = cells;
    lists.push({ l, full, short: SHORT[l] || full, pct: num(pct), votes: num(votes) });
  }
  if (!asOf || national.valid == null || !lists.length) throw new Error(`national page parse failed (asOf=${asOf}, lists=${lists.length})`);
  return { asOf, national, lists };
}

function parseCsv(s) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

const findCol = (hdr, ...names) => hdr.findIndex(h => names.some(n => h.trim() === n)) ;

async function parseCities(letters) {
  const { buf } = await get(CITIES_CSV);
  const csv = decode(buf);
  const rows = parseCsv(csv);
  const hdr = rows[0].map(h => h.trim());
  log('expc.csv', buf.length, 'bytes,', rows.length - 1, 'rows, header:', JSON.stringify(hdr));
  const c = { name: findCol(hdr, 'שם ישוב', 'שם יישוב'), id: findCol(hdr, 'סמל ישוב', 'סמל יישוב'),
    eligible: findCol(hdr, 'בזב'), votes: findCol(hdr, 'מצביעים'), invalid: findCol(hdr, 'פסולים'), valid: findCol(hdr, 'כשרים') };
  if (Object.values(c).some(i => i < 0)) throw new Error('expc.csv columns not recognised: ' + JSON.stringify(c));
  const partyCols = hdr.map((h, i) => [h, i]).filter(([h]) => letters.has(h));
  if (!partyCols.length) throw new Error('expc.csv has no list-letter columns');

  let ballots = {};
  try {
    const b = parseCsv(decode((await get(BALLOTS_CSV)).buf));
    const bh = b[0].map(h => h.trim()); const bi = findCol(bh, 'סמל ישוב', 'סמל יישוב');
    log('expb.csv', b.length - 1, 'rows, header:', JSON.stringify(bh.slice(0, 10)));
    if (bi >= 0) for (const r of b.slice(1)) { const k = num(r[bi]); ballots[k] = (ballots[k] || 0) + 1; }
  } catch (e) { log('expb.csv unavailable:', e.message); ballots = null; }

  const cities = [];
  for (const r of rows.slice(1)) {
    const id = num(r[c.id]), name = (r[c.name] || '').trim();
    const valid = num(r[c.valid]);
    if (!name || !id || /מעטפות/.test(name)) continue;
    if (!num(r[c.votes])) continue;
    const parties = {};
    for (const [l, i] of partyCols) { const v = num(r[i]); if (v) parties[l] = v; }
    cities.push({ name, id, eligible: num(r[c.eligible]), votes: num(r[c.votes]), ballots: ballots ? (ballots[id] || 0) : null,
      valid, invalid: num(r[c.invalid]), parties });
  }
  return cities;
}

async function main() {
  if (Date.now() > STOP_AFTER) { log('past STOP_AFTER, nothing to do'); return; }
  await mkdir(OUT, { recursive: true });
  const outFile = join(OUT, 'data.json');
  let prev = null;
  try { prev = JSON.parse(await readFile(outFile, 'utf8')); } catch {}

  const now = new Date().toISOString();
  const status = { ok: true, notes: [] };
  const { buf } = await get(NATIONAL_URL);
  const nat = parseNational(buf.toString('utf8'));
  log('national', nat.asOf, JSON.stringify(nat.national), nat.lists.length, 'lists');
  if (prev && prev.asOf === nat.asOf) { log('committee time unchanged, nothing to fetch'); return; }

  let cities = prev?.cities || [];
  let citiesAsOf = prev?.citiesAsOf || null;
  try {
    cities = await parseCities(new Set(nat.lists.map(x => x.l)));
    citiesAsOf = nat.asOf;
    const sum = cities.reduce((a, x) => a + x.valid, 0);
    log('cities', cities.length, 'valid sum', sum, 'national valid', nat.national.valid);
  } catch (e) {
    status.ok = false; status.notes.push('localities: ' + e.message);
    log('localities not updated:', e.message);
  }

  const data = { ...nat, cities, citiesAsOf };
  const same = prev && JSON.stringify({ ...prev, updatedAt: undefined }) === JSON.stringify({ ...data });
  data.updatedAt = same ? prev.updatedAt : now;
  await writeFile(outFile, JSON.stringify(data));
  await writeFile(join(OUT, 'status.json'), JSON.stringify(status));
  log(same ? 'no change in results' : 'results changed', '| status ok:', status.ok);
}

main().catch(async e => {
  log('FAILED:', e.message);
  try { await mkdir(OUT, { recursive: true }); await writeFile(join(OUT, 'status.json'), JSON.stringify({ ok: false, notes: [e.message] })); } catch {}
  process.exitCode = 1;
});

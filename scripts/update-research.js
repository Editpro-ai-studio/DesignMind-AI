// Refreshes data/research/<country>.json with sourced trends.
// Runs on GitHub Actions (free). Usage: node scripts/update-research.js [slug|all]
// Every kept trend must point to a page this script actually opened, and dates come from that page.
const fs = require('node:fs');
const path = require('node:path');
const { search, readPage } = require('../lib/websearch');
const { complete } = require('../lib/llm');
const { seasonInfo } = require('../lib/season');

const ROOT = path.join(__dirname, '..');
const COUNTRIES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'countries.json'), 'utf8'));
const CATS = ['prints','dress_styles','fabrics','colors','silhouettes','embroidery','printing_techniques','casual','formal','luxury','modest','streetwear','seasonal','emerging'];
const STATUSES = ['observed','recent','emerging','forecast','historical'];
const AGES = ['0-2','3-7','8-12','13-17','18-25','26-40','41-60','60+'];
const MIN_KEEP = 8;

const EXTRA = {
  pakistan: ['Pakistan winter collection khaddar karandi', 'Pakistani lawn collection', 'Pakistan bridal wedding wear trends'],
  turkiye: ['Türkiye tesettür modest fashion trends', 'Turkish fashion trends'],
  india: ['India festive wedding wear trends', 'Lakmé Fashion Week trends'],
  uae: ['abaya trends Dubai', 'Dubai fashion trends'],
  'saudi-arabia': ['Saudi abaya fashion trends', 'Saudi fashion trends'],
  global: ['fashion week trends roundup', 'colour of the year fashion', 'textile innovation trends'],
};

function queries(slug, name, s) {
  const y = s.date.slice(0, 4);
  const place = slug === 'global' ? '' : `${name} `;
  return [
    `${place}fashion trends ${s.currentLong}`,
    `${place}textile print trends ${y}`,
    `${place}${s.nextLong} fashion trends forecast`,
    `${place}colour trends ${s.climate.toLowerCase()} ${y}`,
    ...(EXTRA[slug] || []).map(q => `${q} ${y}`),
  ];
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const parseD = s => { const m = String(s || '').match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/); return m ? new Date(+m[1], (+m[2] || 1) - 1, +m[3] || 1) : null; };

async function gather(slug, name, s) {
  const seen = new Map();
  for (const q of queries(slug, name, s)) {
    try { for (const r of await search(q)) if (!seen.has(r.url) && seen.size < 24) seen.set(r.url, r); }
    catch (e) { console.warn(`  search failed (${q}): ${e.message}`); }
    await sleep(1500);
  }
  const pages = [];
  const urls = [...seen.values()];
  for (let i = 0; i < urls.length; i += 4) {
    const batch = await Promise.allSettled(urls.slice(i, i + 4).map(r => readPage(r.url, 3000)));
    batch.forEach((b, j) => {
      if (b.status !== 'fulfilled' || b.value.text.length < 400) return;
      const v = b.value; const hint = urls[i + j].published;
      const pub = v.published || (hint && !isNaN(Date.parse(hint)) ? new Date(hint).toISOString().slice(0, 10) : null);
      pages.push({ ...v, published: pub });
    });
    if (pages.length >= 14) break;
  }
  return pages;
}

function prompt(name, s, pages) {
  return `Today is ${s.date}. You are a fashion and textile trend researcher for ${name}. In stores now: ${s.currentLong}. Next season: ${s.nextLong}.
Below are web pages (numbered). Extract CURRENT fashion and textile trends that these pages actually describe. Do not use outside knowledge, do not invent trends, brands, dates or statistics.
Return JSON only:
{"season_context":{"current_fashion_season":"..","local_season_notes":"<=60 words in your own words","source_ids":[n]},
 "trends":[{"source_id":n,"category":"${CATS.join('|')}","status":"observed|recent|emerging|forecast","name":"..","summary":"<=45 words, your own words, no quotes","season":"..","gender":"female|male|unisex|kids","ages":["${AGES.join('","')}"],"confidence":"high|medium|low"}]}
Rules: 10-25 trends across many categories. A prediction for a coming season is "forecast", never "observed". Use only pages relevant to ${name === 'Global' ? 'worldwide fashion' : name}. Each trend needs the source_id of the page that supports it.

${pages.map((p, i) => `[${i}] ${p.title}\nURL: ${p.url}\nPublished: ${p.published || 'unknown'}\n${p.text}`).join('\n\n')}`;
}

function validate(raw, slug, name, pages, today) {
  const iso = today.toISOString().slice(0, 10);
  const out = [];
  for (const t of raw.trends || []) {
    const p = pages[t.source_id];
    if (!p || !t.name) continue;
    const pub = parseD(p.published);
    if (pub && pub > today) continue;
    let status = STATUSES.includes(t.status) ? t.status : 'recent';
    if (status !== 'forecast' && pub && (today - pub) / (864e5 * 30.44) > 12) status = 'historical';
    out.push({
      country: slug, countryName: name,
      category: CATS.includes(t.category) ? t.category : 'emerging', status,
      name: String(t.name).slice(0, 120),
      summary: String(t.summary || '').split(/\s+/).slice(0, 50).join(' '),
      season: String(t.season || ''),
      gender: ['female','male','unisex','kids'].includes(t.gender) ? t.gender : 'unisex',
      ages: (t.ages || []).filter(a => AGES.includes(a)),
      source: p.title.split(/\s[|–-]\s/).pop().slice(0, 80) || new URL(p.url).hostname,
      source_url: p.url,
      published: p.published || 'unknown',
      observed: iso, verified: iso,
      confidence: p.published ? (['high','medium','low'].includes(t.confidence) ? t.confidence : 'medium') : 'low',
      method: 'auto-research',
    });
  }
  return out;
}

async function run(slug, name, today) {
  const s = seasonInfo(today);
  console.log(`\n== ${name}`);
  const pages = await gather(slug, name, s);
  console.log(`  read ${pages.length} pages`);
  if (pages.length < 3) { console.log('  too few readable pages; keeping existing data'); return { slug, kept: 0 }; }
  const text = await complete(prompt(name, s, pages));
  const raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const fresh = validate(raw, slug, name, pages, today);
  const file = path.join(ROOT, 'data', 'research', `${slug}.json`);
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { trends: [] };
  // Replace when the new run is substantial; otherwise add the new records to what was there.
  let trends = fresh.length >= MIN_KEEP ? fresh : [...fresh, ...old.trends.filter(t => !fresh.some(f => f.source_url === t.source_url && f.name === t.name))];
  // Age everything (old records too) against today's date.
  trends = trends.map(t => { const d = parseD(t.published); return t.status !== 'forecast' && d && (today - d) / (864e5 * 30.44) > 12 ? { ...t, status: 'historical' } : t; });
  const sc = raw.season_context || {};
  const scSources = (sc.source_ids || []).map(i => pages[i]).filter(Boolean).map(p => ({ title: p.title, url: p.url, published: p.published || 'unknown' }));
  const iso = today.toISOString().slice(0, 10);
  fs.writeFileSync(file, JSON.stringify({
    country: name, slug, researched_on: fresh.length ? iso : old.researched_on, method: fresh.length >= MIN_KEEP ? 'auto' : (old.method || 'snapshot'),
    season_context: sc.local_season_notes ? { hemisphere: 'northern', current_fashion_season: sc.current_fashion_season || s.currentLong, local_season_notes: sc.local_season_notes, upcoming_season: s.nextLong, sources: scSources } : old.season_context,
    trends,
  }, null, 1));
  console.log(`  kept ${fresh.length} new trends (${trends.length} in file)`);
  return { slug, kept: fresh.length };
}

(async () => {
  const arg = (process.argv[2] || 'all').toLowerCase();
  const list = arg === 'all' ? COUNTRIES : COUNTRIES.filter(c => c[0] === arg);
  if (!list.length) { console.error(`Unknown market "${arg}". Use one of: all, ${COUNTRIES.map(c => c[0]).join(', ')}`); process.exit(1); }
  const today = new Date();
  const results = [];
  for (const [slug, name] of list) {
    try { results.push(await run(slug, name, today)); }
    catch (e) { console.error(`  ${name} failed: ${e.message}`); results.push({ slug, kept: 0, error: e.message }); }
    await sleep(8000); // stay inside free-tier rate limits
  }
  console.log('\nSummary:', results.map(r => `${r.slug}:${r.kept}${r.error ? '!' : ''}`).join(' '));
  if (results.every(r => !r.kept)) process.exitCode = 1;
})();

// Builds in-app brand catalogues. Runs on GitHub Actions (free).
// For each brand in data/brands.json: checks the site, and if it publishes a public product feed
// (Shopify stores do, at /products.json), saves product title, price, link, date and image links,
// grouped into Kids / Women / Men / Home. Images are linked from the brand's own servers, not copied.
// Usage: node scripts/update-brands.js [market|brand-id|all]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'brands.json'), 'utf8'));
const OUT = path.join(ROOT, 'data', 'brands');
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (compatible; DesignMindCatalogue/1.0; personal design research; +https://github.com)';
const LIMITS = { kids: 300, women: 160, men: 100, home: 60, other: 60 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, json = true) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: json ? 'application/json' : 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  if (!json) return { text: await res.text(), url: res.url };
  const type = res.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error('not json');
  return { data: await res.json(), url: res.url };
}

// Minimal robots.txt check for the "*" group.
async function robotsAllows(origin, pathname) {
  try {
    const { text } = await get(`${origin}/robots.txt`, false);
    let applies = false; const dis = [], allow = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
      const [k, ...v] = line.split(':'); const val = v.join(':').trim(); const key = k.toLowerCase();
      if (key === 'user-agent') applies = val === '*';
      else if (applies && key === 'disallow' && val) dis.push(val);
      else if (applies && key === 'allow' && val) allow.push(val);
    }
    const match = rule => { const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')); return re.test(pathname); };
    const d = dis.filter(match).sort((a, b) => b.length - a.length)[0];
    const a = allow.filter(match).sort((a, b) => b.length - a.length)[0];
    return !d || (a && a.length >= d.length);
  } catch { return true; }
}

const RX = {
  kids: /\b(kids?|boys?|girls?|baby|babies|infants?|toddlers?|juniors?|teens?|tweens?|child|children|newborn|bachay|bachon|kidswear|childrenswear|enfant|bambin[oi]|ni[nñ]os?|kinder|çocuk|bebek)\b/i,
  men: /\b(men|mens|man|male|gents|menswear|homme|uomo|hombre|herren|erkek)\b/i,
  women: /\b(women|womens|woman|ladies|female|womenswear|femme|donna|mujer|damen|kad[iı]n|unstitched|stitched|pret|lawn|kurti|abaya)\b/i,
  home: /\b(home|bedding|bed ?sheets?|cushions?|curtains?|towels?|decor|living)\b/i,
};
const subOf = s => /\b(girls?|enfant fille|niñas?)\b/i.test(s) ? 'girls' : /\b(boys?|niños?)\b/i.test(s) ? 'boys' : /\b(baby|babies|infants?|newborn|toddlers?|bebek)\b/i.test(s) ? 'baby' : '';
function classify(text, focus) {
  if (RX.kids.test(text)) return 'kids';
  if (RX.home.test(text) && focus.includes('home')) return 'home';
  if (RX.men.test(text)) return 'men';
  if (RX.women.test(text)) return 'women';
  return focus.length === 1 ? focus[0] : 'other';
}

function slim(p, origin, segment, sub) {
  const imgs = (p.images || []).map(i => i.src).filter(Boolean).slice(0, 4);
  const prices = (p.variants || []).map(v => parseFloat(v.price)).filter(n => !isNaN(n));
  const compare = (p.variants || []).map(v => parseFloat(v.compare_at_price)).filter(n => !isNaN(n) && n > 0);
  return {
    id: p.id, title: p.title, url: `${origin}/products/${p.handle}`,
    images: imgs, price: prices.length ? Math.min(...prices) : null, compare: compare.length ? Math.max(...compare) : null,
    type: p.product_type || '', tags: (Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',')).map(t => t.trim()).filter(Boolean).slice(0, 12),
    added: (p.published_at || p.created_at || '').slice(0, 10), segment, sub,
  };
}

async function shopifyCatalogue(brand) {
  const origin = new URL(brand.site).origin;
  // Detect a public product feed.
  let probe;
  try { probe = await get(`${origin}/products.json?limit=1`); } catch (e) { return { platform: 'website', reason: e.status ? `no public feed (HTTP ${e.status})` : 'no public feed' }; }
  const realOrigin = new URL(probe.url).origin;
  if (!Array.isArray(probe.data.products)) return { platform: 'website', reason: 'no public feed' };
  if (!(await robotsAllows(realOrigin, '/products.json'))) return { platform: 'website', reason: 'site asks not to be read automatically (robots.txt)' };

  const products = new Map();
  const add = (p, segHint, subHint) => {
    if (products.has(p.id)) return;
    const text = `${segHint} ${p.title} ${p.product_type} ${(Array.isArray(p.tags) ? p.tags.join(' ') : p.tags) || ''}`;
    const segment = segHint && RX.kids.test(segHint) ? 'kids' : classify(text, brand.focus);
    const sub = segment === 'kids' ? (subOf(subHint || '') || subOf(text)) : '';
    products.set(p.id, slim(p, realOrigin, segment, sub));
  };

  // 1) Kids collections first, so kids designs are complete.
  let collections = [];
  try { collections = (await get(`${realOrigin}/collections.json?limit=250`)).data.collections || []; } catch {}
  const kidsCols = collections.filter(c => RX.kids.test(`${c.handle} ${c.title}`)).slice(0, 12);
  for (const c of kidsCols) {
    for (let page = 1; page <= 4; page++) {
      try {
        const { data } = await get(`${realOrigin}/collections/${encodeURIComponent(c.handle)}/products.json?limit=250&page=${page}`);
        (data.products || []).forEach(p => add(p, `kids ${c.title}`, `${c.handle} ${c.title}`));
        if (!data.products || data.products.length < 250) break;
      } catch { break; }
      await sleep(1200);
    }
    await sleep(800);
  }
  // 2) Latest products across the store.
  for (let page = 1; page <= 6; page++) {
    try {
      const { data } = await get(`${realOrigin}/products.json?limit=250&page=${page}`);
      (data.products || []).forEach(p => add(p, '', ''));
      if (!data.products || data.products.length < 250) break;
    } catch { break; }
    await sleep(1200);
  }

  const all = [...products.values()].sort((a, b) => String(b.added).localeCompare(String(a.added)));
  const bySeg = {};
  for (const p of all) { (bySeg[p.segment] ||= []); if (bySeg[p.segment].length < (LIMITS[p.segment] || 60)) bySeg[p.segment].push(p); }
  return { platform: 'shopify', origin: realOrigin, products: Object.values(bySeg).flat(), kidsCollections: kidsCols.map(c => c.title) };
}

async function checkReachable(site) {
  try { const r = await fetch(site, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) }); return r.status < 500; } catch { return false; }
}

(async () => {
  const arg = (process.argv[2] || 'all').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const index = {};
  const prevIndexFile = path.join(OUT, 'index.json');
  const prev = fs.existsSync(prevIndexFile) ? JSON.parse(fs.readFileSync(prevIndexFile, 'utf8')) : {};
  const summary = [];
  for (const [market, brands] of Object.entries(REG.markets)) {
    for (const b of brands) {
      const selected = arg === 'all' || arg === market || arg === b.id;
      if (!selected) { if (prev[b.id]) index[b.id] = prev[b.id]; continue; }
      process.stdout.write(`${market} / ${b.name} … `);
      let entry;
      try {
        const cat = await shopifyCatalogue(b);
        if (cat.platform === 'shopify' && cat.products.length) {
          fs.writeFileSync(path.join(OUT, `${b.id}.json`), JSON.stringify({ brand: b.name, market, site: cat.origin, updated: today, products: cat.products }));
          const counts = {}; cat.products.forEach(p => counts[p.segment] = (counts[p.segment] || 0) + 1);
          entry = { status: 'catalogue', checked: today, counts, kidsCollections: cat.kidsCollections };
          console.log(`catalogue: ${JSON.stringify(counts)}`);
        } else {
          const ok = await checkReachable(b.site);
          entry = { status: ok ? 'website' : 'unreachable', checked: today, reason: cat.reason || '' };
          console.log(entry.status, entry.reason);
        }
      } catch (e) {
        entry = { status: 'error', checked: today, reason: e.message };
        console.log('error', e.message);
      }
      index[b.id] = entry;
      summary.push(`${b.id}:${entry.status}`);
      await sleep(2000);
    }
  }
  fs.writeFileSync(prevIndexFile, JSON.stringify(index, null, 1));
  console.log('\nSummary:', summary.join(' '));
})();

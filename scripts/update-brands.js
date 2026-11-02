// Builds in-app brand catalogues. Runs on GitHub Actions (free).
// For each brand in data/brands.json: checks the site, and if it publishes a public product feed
// (Shopify stores do, at /products.json), saves product title, price, link, date and image links,
// grouped into Kids / Women / Men / Home. Images are linked from the brand's own servers, not copied.
// Usage: node scripts/update-brands.js [market|brand-id|all]
const fs = require('node:fs');
const { search } = require('../lib/websearch');
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

/* ---------- WooCommerce public Store API ---------- */
async function wooCatalogue(brand) {
  const origin = new URL(brand.site).origin;
  let first;
  try { first = await get(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=1&orderby=date&order=desc`); } catch { return null; }
  if (!Array.isArray(first.data) || !first.data.length) return null;
  const realOrigin = new URL(first.url).origin;
  if (!(await robotsAllows(realOrigin, '/wp-json/wc/store/v1/products'))) return { platform: 'website', reason: 'site asks not to be read automatically (robots.txt)' };
  const raw = [...first.data];
  for (let page = 2; page <= 8 && raw.length >= (page - 1) * 100; page++) {
    try { const { data } = await get(`${realOrigin}/wp-json/wc/store/v1/products?per_page=100&page=${page}&orderby=date&order=desc`); if (!Array.isArray(data) || !data.length) break; raw.push(...data); } catch { break; }
    await sleep(1200);
  }
  const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const products = raw.map(p => {
    const cats = (p.categories || []).map(c => c.name).join(' ');
    const text = `${cats} ${p.name} ${(p.tags || []).map(t => t.name).join(' ')}`;
    const segment = classify(text, brand.focus);
    const minor = Number(p.prices?.currency_minor_unit ?? 2);
    const price = p.prices?.price ? Number(p.prices.price) / 10 ** minor : null;
    const reg = p.prices?.regular_price ? Number(p.prices.regular_price) / 10 ** minor : null;
    return {
      id: p.id, title: strip(p.name), url: p.permalink,
      images: (p.images || []).map(i => i.src).filter(Boolean).slice(0, 4),
      price, compare: reg && price && reg > price ? reg : null,
      type: (p.categories || [])[0]?.name || '', tags: (p.tags || []).map(t => t.name).slice(0, 12),
      added: '', segment, sub: segment === 'kids' ? subOf(text) : '',
    };
  });
  return { platform: 'woocommerce', origin: realOrigin, products: capSegments(products), kidsCollections: [] };
}

/* ---------- Any store: product sitemap + product pages (JSON-LD / Open Graph) ---------- */
const decodeXml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
async function sitemapUrls(origin) {
  const seeds = new Set([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/product-sitemap.xml`]);
  try { const { text } = await get(`${origin}/robots.txt`, false); for (const m of text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) seeds.add(m[1].trim()); } catch {}
  const productUrls = new Map(); const queue = [...seeds]; const seen = new Set(); let fetched = 0;
  while (queue.length && fetched < 14 && productUrls.size < 3000) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    let xml; try { xml = (await get(sm, false)).text; fetched++; } catch { continue; }
    if (/<sitemapindex/i.test(xml)) {
      const subs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decodeXml(m[1]));
      subs.sort((a, b) => (/product/i.test(b) - /product/i.test(a)));
      queue.push(...subs.filter(u => /product|catalog|item|goods|shop/i.test(u)).slice(0, 10));
      if (!subs.some(u => /product|catalog|item|goods|shop/i.test(u))) queue.push(...subs.slice(0, 4));
      continue;
    }
    for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
      const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i) || [])[1]; if (!loc) continue;
      const u = decodeXml(loc);
      const looksProduct = /\/(products?|p|item|shop|dp)\/|[-_/]p\d{3,}|\.html$/i.test(new URL(u).pathname) || /product/i.test(sm);
      if (!looksProduct) continue;
      const lastmod = (m[1].match(/<lastmod>\s*([^<\s]+)/i) || [])[1] || '';
      const img = (m[1].match(/<image:loc>\s*([^<\s]+)/i) || [])[1];
      productUrls.set(u, { lastmod: lastmod.slice(0, 10), image: img ? decodeXml(img) : null });
    }
    await sleep(600);
  }
  return productUrls;
}
function parseProductPage(html, url) {
  const meta = n => decodeXml((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${n}["']`, 'i')) || [])[1] || '');
  let prod = null, crumbs = '';
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const items = [].concat(j['@graph'] || j);
    for (const it of items) {
      const t = [].concat(it['@type'] || []);
      if (t.includes('Product') && !prod) prod = it;
      if (t.includes('BreadcrumbList')) crumbs = (it.itemListElement || []).map(e => e.name || e.item?.name || '').join(' ');
    }
  }
  const ogType = meta('og:type');
  if (!prod && !/product/i.test(ogType)) return null;
  const title = (prod?.name || meta('og:title') || '').trim();
  let images = prod ? [].concat(prod.image || []).map(i => typeof i === 'string' ? i : i?.url).filter(Boolean) : [];
  if (!images.length && meta('og:image')) images = [meta('og:image')];
  const offer = prod ? [].concat(prod.offers || [])[0] : null;
  const price = parseFloat(offer?.price ?? offer?.lowPrice ?? meta('product:price:amount') ?? meta('og:price:amount'));
  if (!title || !images.length) return null;
  return { title, images: images.map(i => new URL(i, url).toString()).slice(0, 4), price: isNaN(price) ? null : price, crumbs, category: prod?.category || '' };
}
async function sitemapCatalogue(brand) {
  const origin = (await fetch(brand.site, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) }).then(r => new URL(r.url).origin).catch(() => null));
  if (!origin) return null;
  const urls = await sitemapUrls(origin);
  if (!urls.size) return null;
  const list = [...urls.entries()].filter(([u]) => { try { return true; } catch { return false; } });
  // Kids pages first (by URL), then newest by lastmod.
  list.sort((a, b) => (RX.kids.test(b[0]) - RX.kids.test(a[0])) || String(b[1].lastmod).localeCompare(String(a[1].lastmod)));
  const pick = []; for (const [u, m] of list) { if (pick.length >= 260) break; if (await robotsAllows(origin, new URL(u).pathname)) pick.push([u, m]); else if (!pick.length) return { platform: 'website', reason: 'site asks not to be read automatically (robots.txt)' }; }
  const products = [];
  for (let i = 0; i < pick.length; i += 4) {
    const res = await Promise.allSettled(pick.slice(i, i + 4).map(async ([u, m]) => {
      const { text } = await get(u, false); const p = parseProductPage(text, u); if (!p) return null;
      const all = `${u} ${p.crumbs} ${p.category} ${p.title}`; const segment = classify(all, brand.focus);
      return { id: u, title: p.title, url: u, images: p.images.length ? p.images : (m.image ? [m.image] : []), price: p.price, compare: null, type: String(p.category || '').split('>').pop().trim(), tags: [], added: m.lastmod, segment, sub: segment === 'kids' ? subOf(all) : '' };
    }));
    res.forEach(r => { if (r.status === 'fulfilled' && r.value) products.push(r.value); });
    if (i >= 40 && !products.length) break; // pages aren't product pages we can read
    await sleep(900);
  }
  if (!products.length) return null;
  return { platform: 'sitemap', origin, products: capSegments(products), kidsCollections: [] };
}
function capSegments(products) {
  const by = {}; for (const p of products) { (by[p.segment] ||= []); if (by[p.segment].length < (LIMITS[p.segment] || 60)) by[p.segment].push(p); }
  return Object.values(by).flat();
}

// If a listed address doesn't respond, look up the brand's real site with a free web search.
const SKIP_HOSTS = /(facebook|instagram|twitter|x\.com|youtube|tiktok|pinterest|linkedin|wikipedia|daraz|amazon|ebay|alibaba|google|propakistani|dawn|tribune|brandsofpakistan|bagallery|sasta|olx|shopify\.com|maps\.)/i;
async function discoverSite(brand, market) {
  const where = market === 'global' ? '' : (COUNTRY_NAMES[market] || '');
  let results = [];
  try { results = await search(`${brand.name} ${where} official online store clothing`); } catch { return null; }
  const tokens = brand.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !['the', 'and', 'by', 'studio', 'fabrics', 'textiles', 'clothing'].includes(t));
  for (const r of results) {
    let u; try { u = new URL(r.url); } catch { continue; }
    if (SKIP_HOSTS.test(u.hostname)) continue;
    const host = u.hostname.replace(/^www\./, '').replace(/[^a-z0-9]/g, '');
    if (tokens.length && !tokens.some(t => host.includes(t.replace(/[^a-z0-9]/g, '')))) continue;
    if (await checkReachable(u.origin)) return u.origin;
  }
  return null;
}
const COUNTRY_NAMES = { pakistan: 'Pakistan', turkiye: 'Turkey', 'united-kingdom': 'UK', 'united-states': 'USA', italy: 'Italy', france: 'France', japan: 'Japan', 'south-korea': 'Korea', india: 'India', uae: 'UAE', 'saudi-arabia': 'Saudi Arabia', china: 'China', spain: 'Spain', germany: 'Germany' };

async function checkReachable(site) {
  try { const r = await fetch(site, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) }); return r.status < 500; } catch { return false; }
}

// Optional: add a brand from the workflow form (ADD_BRAND_URL, ADD_BRAND_NAME, ADD_BRAND_MARKET, ADD_BRAND_FOCUS).
function addBrandFromEnv() {
  const url = (process.env.ADD_BRAND_URL || '').trim();
  if (!url) return null;
  let u; try { u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`); } catch { console.error('ADD_BRAND_URL is not a valid web address'); process.exit(1); }
  const market = (process.env.ADD_BRAND_MARKET || 'pakistan').toLowerCase().trim();
  if (!REG.markets[market]) { console.error(`Unknown market "${market}"`); process.exit(1); }
  const name = (process.env.ADD_BRAND_NAME || u.hostname.replace(/^www\.|^pk\./, '').split('.')[0]).trim();
  const id = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || u.hostname.replace(/\W+/g, '-');
  const focus = (process.env.ADD_BRAND_FOCUS || 'kids').split(/[ ,]+/).filter(f => ['women', 'men', 'kids', 'home'].includes(f));
  const all = Object.values(REG.markets).flat();
  if (!all.some(b => b.id === id)) {
    REG.markets[market].push({ id, name, site: u.origin, focus: focus.length ? focus : ['kids'] });
    fs.writeFileSync(path.join(ROOT, 'data', 'brands.json'), JSON.stringify(REG, null, 1));
    console.log(`Added brand ${name} (${id}) to ${market}`);
  }
  return id;
}

// When running on GitHub Actions, commit and push what has been read so far.
function saveToGitHub(message) {
  if (process.env.GITHUB_ACTIONS !== 'true') return;
  const { execSync } = require('node:child_process');
  const sh = c => execSync(c, { cwd: ROOT, stdio: 'pipe' }).toString();
  try {
    sh('git config user.name >/dev/null || git config user.name "designmind-catalogue-bot"');
    sh('git config user.email >/dev/null || git config user.email "actions@users.noreply.github.com"');
    sh('git add data/brands data/brands.json');
    if (!sh('git diff --cached --name-only').trim()) return;
    sh(`git commit -m "${message.replace(/"/g, '')}"`);
    for (let i = 0; i < 3; i++) {
      try { sh('git pull --rebase --autostash -X theirs'); sh('git push'); console.log(`  saved to GitHub: ${message}`); return; }
      catch (e) { console.warn('  push failed, retrying:', e.message.split('\n')[0]); }
    }
  } catch (e) { console.warn('  could not save to GitHub now:', e.message.split('\n')[0]); }
}

(async () => {
  const added = addBrandFromEnv();
  const arg = (added || process.argv[2] || 'all').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const index = {};
  const prevIndexFile = path.join(OUT, 'index.json');
  const prev = fs.existsSync(prevIndexFile) ? JSON.parse(fs.readFileSync(prevIndexFile, 'utf8')) : {};
  const summary = [];
  let regChanged = false;
  const jobs = [];
  for (const [market, brands] of Object.entries(REG.markets)) for (const b of brands) {
    const selected = arg === 'all' || arg === market || arg === b.id || (arg === 'rest' && market !== 'pakistan');
    if (!selected) { if (prev[b.id]) index[b.id] = prev[b.id]; } else jobs.push([market, b]);
  }
  const done = new Set();
  async function one(market, b) {
    if (done.has(b.id)) return; done.add(b.id); // a brand listed in two markets is read once
    const log = [];
    let entry;
    try {
      if (!(await checkReachable(b.site))) {
        const found = await discoverSite(b, market);
        if (found && new URL(found).origin !== new URL(b.site).origin) { log.push(`address corrected to ${found}`); b.site = found; regChanged = true; }
      }
      let cat = await shopifyCatalogue(b);
      if (!(cat.products && cat.products.length) && !/robots/.test(cat.reason || '')) cat = (await wooCatalogue(b)) || cat;
      if (!(cat.products && cat.products.length) && !/robots/.test(cat.reason || '')) cat = (await sitemapCatalogue(b)) || cat;
      if (cat.products && cat.products.length) {
        fs.writeFileSync(path.join(OUT, `${b.id}.json`), JSON.stringify({ brand: b.name, market, site: cat.origin, updated: today, products: cat.products }));
        const counts = {}; cat.products.forEach(p => counts[p.segment] = (counts[p.segment] || 0) + 1);
        entry = { status: 'catalogue', checked: today, counts, via: cat.platform, kidsCollections: cat.kidsCollections };
        log.push(`catalogue via ${cat.platform}: ${JSON.stringify(counts)}`);
      } else {
        const ok = await checkReachable(b.site);
        entry = { status: ok ? 'website' : 'unreachable', checked: today, reason: cat.reason && /robots/.test(cat.reason) ? cat.reason : (ok ? 'site blocks automatic reading or has no readable product list' : 'site did not respond') };
        log.push(`${entry.status}: ${entry.reason}`);
      }
    } catch (e) {
      entry = { status: 'error', checked: today, reason: e.message };
      log.push('error ' + e.message);
    }
    // Keep last week's designs if this run could not read a brand that worked before.
    if (entry.status !== 'catalogue' && prev[b.id] && prev[b.id].status === 'catalogue' && fs.existsSync(path.join(OUT, `${b.id}.json`))) {
      entry = { ...prev[b.id], stale: true, lastError: entry.reason };
      log.push('(kept previous catalogue)');
    }
    index[b.id] = entry;
    summary.push(`${b.id}:${entry.status}`);
    fs.writeFileSync(prevIndexFile, JSON.stringify({ ...prev, ...index }, null, 1));
    console.log(`${market} / ${b.name}: ${log.join(' ')}`);
  }
  // One market at a time (4 brands in parallel), saving to GitHub after each market,
  // so designs show up in the app market by market instead of only at the very end.
  const POOL = 4;
  const markets = [...new Set(jobs.map(j => j[0]))];
  for (const m of markets) {
    const list = jobs.filter(j => j[0] === m);
    let next = 0;
    await Promise.all(Array.from({ length: POOL }, async () => { while (next < list.length) { const [mm, b] = list[next++]; await one(mm, b); await sleep(1500); } }));
    fs.writeFileSync(prevIndexFile, JSON.stringify({ ...prev, ...index }, null, 1));
    if (regChanged) fs.writeFileSync(path.join(ROOT, 'data', 'brands.json'), JSON.stringify(REG, null, 1));
    saveToGitHub(`Brand catalogues: ${m}`);
  }
  fs.writeFileSync(prevIndexFile, JSON.stringify({ ...prev, ...index }, null, 1));
  if (regChanged) fs.writeFileSync(path.join(ROOT, 'data', 'brands.json'), JSON.stringify(REG, null, 1));
  const n = k => summary.filter(x => x.endsWith(':' + k)).length;
  console.log(`\nSummary: ${n('catalogue')} with designs in the app, ${n('website')} website only, ${n('unreachable')} not reached, ${n('error')} errors`);
  console.log(summary.join(' '));
})();

// Free web search + page reading for live research. No paid API.
//   SEARCH_PROVIDER=duckduckgo (default, no key) | tavily (TAVILY_API_KEY, free tier) | searxng (SEARXNG_URL)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function get(url, timeoutMs = 12000) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en;q=0.9' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml/.test(type)) throw new Error('not html');
  return { html: (await res.text()).slice(0, 1_500_000), finalUrl: res.url };
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const stripTags = s => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

async function duckduckgo(query) {
  const { html } = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    let href = decode(m[1]);
    const u = href.match(/[?&]uddg=([^&]+)/);
    if (u) href = decodeURIComponent(u[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js/.test(href)) continue;
    out.push({ url: href, title: stripTags(m[2]) });
  }
  return out;
}

async function searxng(query) {
  const base = (process.env.SEARXNG_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('SEARXNG_URL is not set');
  const res = await fetch(`${base}/search?format=json&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(12000) });
  const j = await res.json();
  return (j.results || []).slice(0, 8).map(r => ({ url: r.url, title: r.title, published: r.publishedDate || null }));
}

async function tavily(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error('TAVILY_API_KEY is not set');
  const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query, max_results: 8, topic: 'general' }), signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.detail?.error || j.error || `Tavily ${res.status}`);
  return (j.results || []).map(r => ({ url: r.url, title: r.title, published: r.published_date || null }));
}

// Uses the chosen provider; if Tavily has a key it is used as a fallback when DuckDuckGo returns nothing.
async function search(query) {
  const p = (process.env.SEARCH_PROVIDER || (process.env.TAVILY_API_KEY ? 'tavily' : 'duckduckgo')).toLowerCase();
  if (p === 'searxng') return searxng(query);
  if (p === 'tavily') return tavily(query);
  let r = [];
  try { r = await duckduckgo(query); } catch (e) { console.warn('DuckDuckGo failed:', e.message); }
  if (!r.length && process.env.TAVILY_API_KEY) r = await tavily(query);
  return r;
}

// Read a page: title, publication date from metadata (if any) and main text.
async function readPage(url, maxChars = 5000) {
  const { html, finalUrl } = await get(url);
  const meta = n => (html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${n}["']`, 'i')) || [])[1];
  let published = meta('article:published_time') || meta('datePublished') || meta('date') || meta('pubdate') || meta('og:updated_time');
  if (!published) { const ld = html.match(/"datePublished"\s*:\s*"([^"]+)"/); if (ld) published = ld[1]; }
  const iso = published && !isNaN(Date.parse(published)) ? new Date(published).toISOString().slice(0, 10) : null;
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ');
  const main = (body.match(/<article[\s\S]*?<\/article>/i) || body.match(/<main[\s\S]*?<\/main>/i) || [body])[0];
  return { url: finalUrl || url, title, published: iso, text: stripTags(main).slice(0, maxChars) };
}

module.exports = { search, readPage };

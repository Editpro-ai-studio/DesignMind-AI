// DesignMind AI — static (GitHub Pages) runtime.
// Provides the same db / sample / user / downloads interface the app uses on claude.ai,
// backed by JSON files in this repo, the browser's own storage, and a free AI provider
// the user configures in Settings. No server and no Node.js on the user's computer.
(function () {
  'use strict';
  const SETTINGS_KEY = 'dm.settings';
  const loadSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } };
  const saveSettings = s => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };

  /* ---------- Read-only research data from the repo ---------- */
  const cache = {};
  const getJSON = p => cache[p] || (cache[p] = fetch(p, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('Missing ' + p); return r.json(); }).catch(e => { delete cache[p]; throw e; }));
  const country = slug => getJSON(`data/research/${encodeURIComponent(slug)}.json`).catch(() => null);

  /* ---------- Private user data in IndexedDB ---------- */
  const idb = new Promise(res => {
    try {
      const rq = indexedDB.open('designmind', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('docs');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
  const mem = new Map();
  async function tx(mode, fn) {
    const db = await idb;
    if (!db) return fn(null);
    return new Promise((ok, bad) => { const t = db.transaction('docs', mode); const s = t.objectStore('docs'); const r = fn(s); t.oncomplete = () => ok(r && 'result' in r ? r.result : undefined); t.onerror = () => bad(t.error); });
  }
  const kv = {
    get: k => tx('readonly', s => s ? s.get(k) : { result: mem.get(k) }),
    set: (k, v) => tx('readwrite', s => s ? s.put(v, k) : mem.set(k, v)),
    del: k => tx('readwrite', s => s ? s.delete(k) : mem.delete(k)),
    async all(prefix) {
      const db = await idb;
      if (!db) return [...mem].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ k, v }));
      return new Promise((ok, bad) => {
        const out = []; const t = db.transaction('docs', 'readonly');
        const c = t.objectStore('docs').openCursor(IDBKeyRange.bound(prefix, prefix + '￿'));
        c.onsuccess = () => { const cur = c.result; if (cur) { out.push({ k: cur.key, v: cur.value }); cur.continue(); } else ok(out); };
        c.onerror = () => bad(c.error);
      });
    },
  };

  const snap = (id, data) => ({ id, exists: data !== undefined && data !== null, data: () => data || undefined });
  const isUser = p => p.startsWith('data/users/');
  const readOnly = () => Promise.reject(Object.assign(new Error('Research data is read-only in the app. It is updated by the GitHub research workflow.'), { code: 'not_granted' }));

  function doc(path) {
    const parts = path.split('/'); const id = parts[parts.length - 1]; const coll = parts.slice(0, -1).join('/');
    return {
      id, path,
      async get() {
        if (isUser(path)) return snap(id, await kv.get(path));
        if (coll === 'countries') { const c = await country(id); if (!c) return snap(id, null); const { trends, ...rest } = c; return snap(id, { ...rest, count: (trends || []).length }); }
        if (coll === 'fabrics') { const f = (await getJSON('data/fabrics.json')).find(x => x.id === id); return snap(id, f); }
        return snap(id, null);
      },
      set: data => isUser(path) ? kv.set(path, JSON.parse(JSON.stringify(data))) : readOnly(),
      async update(data) { const cur = (await this.get()).data() || {}; return this.set({ ...cur, ...data }); },
      delete: () => isUser(path) ? kv.del(path) : readOnly(),
    };
  }

  function query(coll, where = [], orderBy = null, lim = 1000) {
    const q = {
      where: (f, op, v) => query(coll, [...where, [f, op, v]], orderBy, lim),
      orderBy: (f, d) => query(coll, where, [f, d || 'asc'], lim),
      limit: n => query(coll, where, orderBy, n),
      async get() {
        let rows = [];
        if (isUser(coll)) rows = (await kv.all(coll + '/')).filter(r => r.k.split('/').length === coll.split('/').length + 1).map(r => ({ id: r.k.split('/').pop(), data: r.v }));
        else if (coll === 'fabrics') rows = (await getJSON('data/fabrics.json')).map((f, i) => ({ id: f.id, data: { ...f, order: i } }));
        else if (coll === 'trends') {
          const w = where.find(x => x[0] === 'country' && x[1] === '==');
          const slugs = w ? [w[2]] : (await getJSON('data/countries.json')).map(c => c[0]);
          for (const s of slugs) { const c = await country(s); (c?.trends || []).forEach((t, i) => rows.push({ id: `${s}-${String(i).padStart(3, '0')}`, data: t })); }
        } else if (coll === 'countries') {
          for (const [s] of await getJSON('data/countries.json')) { const c = await country(s); if (c) { const { trends, ...rest } = c; rows.push({ id: s, data: rest }); } }
        }
        for (const [f, op, v] of where) rows = rows.filter(r => { const x = r.data?.[f]; return op === '==' ? x === v : op === '!=' ? x !== v : op === '<' ? x < v : op === '<=' ? x <= v : op === '>' ? x > v : op === '>=' ? x >= v : true; });
        if (orderBy) rows.sort((a, b) => { const x = a.data?.[orderBy[0]], y = b.data?.[orderBy[0]]; return (x > y ? 1 : x < y ? -1 : 0) * (orderBy[1] === 'desc' ? -1 : 1); });
        rows = rows.slice(0, lim);
        const docs = rows.map(r => snap(r.id, r.data));
        return { docs, size: docs.length, empty: !docs.length };
      },
      onSnapshot(next, err) { q.get().then(next, err); return () => {}; },
    };
    return q;
  }
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const db = {
    doc,
    collection: c => Object.assign(query(c), { path: c, doc: id => doc(`${c}/${id || newId()}`), async add(data) { const d = doc(`${c}/${newId()}`); await d.set(data); return d; } }),
  };

  /* ---------- AI in the browser (free providers, user's own key kept in this browser) ---------- */
  const PRESETS = {
    gemini: { label: 'Google Gemini (free key)', model: '' },
    groq: { label: 'Groq (free key)', base: 'https://api.groq.com/openai/v1', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    openrouter: { label: 'OpenRouter (free models)', base: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-27b-it:free' },
    ollama: { label: 'Ollama on this computer (offline)', base: 'http://localhost:11434', model: 'gemma3:4b' },
    off: { label: 'Off (no AI)' },
  };
  const blobToB64 = b => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(b); });
  const fail = (message, code = 'upstream_error') => Object.assign(new Error(message), { code });

  // Pick a current Gemini "flash" model: the one Google suggests in its error, else the newest stable flash model this key can use.
  async function pickGeminiModel(key, errorText, avoid) {
    const suggested = (String(errorText).match(/models\/(gemini-[\w.-]+)/g) || []).map(x => x.replace('models/', '')).filter(m => m !== avoid);
    let names = [];
    try {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
      const j = await r.json();
      names = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''));
    } catch {}
    if (suggested.length && (!names.length || names.includes(suggested[0]))) return suggested[0];
    const score = n => { const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0); return v * 10 - (/preview|exp/.test(n) ? 3 : 0) - (/lite/.test(n) ? 1 : 0); };
    const flash = names.filter(n => /flash/.test(n) && !/image|tts|audio|live|thinking|embedding|8b/.test(n) && n !== avoid).sort((a, b) => score(b) - score(a));
    return flash[0] || suggested[0] || null;
  }

  // Busy / overloaded / temporary errors: worth waiting and retrying, or switching model.
  const BUSY_RX = /high demand|overloaded|try again later|temporar|unavailable|spikes in demand|resource.?exhausted|rate.?limit|quota|deadline|internal error|backend error/i;
  const RETIRED_RX = /no longer available|not found|is not supported|deprecated|retired|update your code/i;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const say = msg => { try { document.dispatchEvent(new CustomEvent('dm-ai-status', { detail: msg })); } catch {} };
  let geminiNames = null;
  async function geminiCandidates(key, first) {
    if (!geminiNames) {
      try {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
        const j = await r.json();
        const score = n => { const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0); return v * 10 - (/preview|exp/.test(n) ? 3 : 0) - (/lite/.test(n) ? 1 : 0); };
        geminiNames = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''))
          .filter(n => /flash/.test(n) && !/image|tts|audio|live|thinking|embedding|8b|native/.test(n)).sort((a, b) => score(b) - score(a));
      } catch { geminiNames = []; }
    }
    const list = [first, ...geminiNames, 'gemini-flash-latest', 'gemini-flash-lite-latest'].filter(Boolean);
    return [...new Set(list)].slice(0, 6);
  }

  async function callGemini(s, prompt, images) {
    if (!s.key) throw fail('Add your free Gemini API key in Settings.', 'not_configured');
    const call = m => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': s.key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [...images.map(i => ({ inline_data: { mime_type: i.media_type, data: i.data } })), { text: prompt }] }] }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(120000) : undefined,
    }).then(async r => ({ r, j: await r.json().catch(() => ({})) }), () => ({ r: { ok: false, status: 0 }, j: { error: { message: 'network unavailable' } } }));
    const preferred = s.model || await pickGeminiModel(s.key, '');
    const models = await geminiCandidates(s.key, preferred);
    let lastMsg = '', busyCount = 0;
    for (let mi = 0; mi < models.length; mi++) {
      const m = models[mi];
      const tries = mi === 0 ? 3 : 2; // the chosen model gets a little more patience
      for (let t = 0; t < tries; t++) {
        const { r, j } = await call(m);
        if (r.ok) {
          const text = (j.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
          if (!text && j.promptFeedback?.blockReason) throw fail('Gemini declined this request (' + j.promptFeedback.blockReason + '). Try rewording the brief.');
          if (m !== preferred && mi > 0 && RETIRED_RX.test(lastMsg)) saveSettings({ ...loadSettings(), model: m });
          return { text, model: m, truncated: j.candidates?.[0]?.finishReason === 'MAX_TOKENS' };
        }
        const msg = j.error?.message || `Gemini error ${r.status}`; lastMsg = msg;
        if (r.status === 400 && /api key|API_KEY/i.test(msg)) throw fail('Your Gemini key is not valid. Copy it again from aistudio.google.com/apikey and paste it in Settings.', 'not_configured');
        if (r.status === 403) throw fail('This Gemini key is not allowed to use the API (' + msg + '). Make a new key at aistudio.google.com/apikey.', 'not_configured');
        if (RETIRED_RX.test(msg) && r.status !== 429 && r.status !== 503) break; // model gone: next model
        const busy = r.status === 0 || r.status === 429 || r.status >= 500 || BUSY_RX.test(msg);
        if (!busy) throw fail(msg);
        busyCount++;
        // A 429 quota limit is per model, so switch straight away; a 503 "high demand" usually clears in seconds.
        if (r.status === 429 || t === tries - 1) { if (mi < models.length - 1) say(`Gemini is busy, switching to ${models[mi + 1]}…`); break; }
        const wait = [2500, 6000, 12000][t];
        say(`Gemini is busy (high demand). Retrying in ${Math.round(wait / 1000)} s…`);
        await sleep(wait);
      }
    }
    throw fail(busyCount ? 'Google Gemini is overloaded right now (high demand). The app tried several Gemini models. Wait 1–2 minutes and press the button again, or add a free Groq backup key in Settings → Backup AI so the app switches automatically next time.' : lastMsg, busyCount ? 'busy' : 'upstream_error');
  }

  async function callOpenAI(base, key, model, prompt, images, label) {
    if (!key) throw fail('Add your API key in Settings.', 'not_configured');
    const content = images.length ? [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image_url', image_url: { url: `data:${i.media_type};base64,${i.data}` } }))] : prompt;
    let last = '';
    for (let t = 0; t < 3; t++) {
      let res, j;
      try {
        res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
        });
        j = await res.json().catch(() => ({}));
      } catch { res = { ok: false, status: 0 }; j = {}; }
      if (res.ok) return { text: j.choices?.[0]?.message?.content || '', model, truncated: j.choices?.[0]?.finish_reason === 'length' };
      last = j.error?.message || `${label} error ${res.status}`;
      if (!(res.status === 0 || res.status === 429 || res.status >= 500 || BUSY_RX.test(last))) throw fail(last);
      if (t < 2) { say(`${label} is busy. Retrying…`); await sleep([3000, 8000][t]); }
    }
    throw fail(`${label} is busy right now (${last}). Wait a minute and try again.`, 'busy');
  }

  async function callAI(prompt, images) {
    const s = loadSettings(); const p = s.provider || 'gemini'; const pre = PRESETS[p] || {};
    const model = s.model || pre.model;
    if (p === 'off') throw fail('AI is switched off. Open Settings and add a free Gemini key to use AI features.', 'not_configured');
    const backup = async (err) => {
      const bp = s.backupProvider, bpre = PRESETS[bp];
      if (!bp || !bpre || !bpre.base || !s.backupKey || bp === p) throw err;
      say(`${pre.label ? pre.label.replace(/ \(.*/, '') : 'AI'} is busy, using backup ${bpre.label.replace(/ \(.*/, '')}…`);
      // Text-only models on some free tiers; drop images rather than fail.
      try { return await callOpenAI(bpre.base, s.backupKey, s.backupModel || bpre.model, prompt, images, bpre.label.replace(/ \(.*/, '')); }
      catch (e2) { if (images.length) return await callOpenAI(bpre.base, s.backupKey, s.backupModel || bpre.model, prompt + '\n\n(The reference image could not be sent to the backup AI; work from the written brief.)', [], bpre.label.replace(/ \(.*/, '')); throw e2; }
    };
    try {
      if (p === 'gemini') {
        try { return await callGemini(s, prompt, images); }
        catch (e) { if (e.code === 'busy' || e.code === 'upstream_error') return await backup(e); throw e; }
      }
      if (p === 'ollama') {
        const res = await fetch(`${(s.base || pre.base).replace(/\/$/, '')}/api/chat`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model, stream: false, options: { num_ctx: 16384 }, messages: [{ role: 'user', content: prompt, ...(images.length ? { images: images.map(i => i.data) } : {}) }] }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw fail(j.error || `Ollama error ${res.status}`);
        return { text: j.message?.content || '', model };
      }
      // OpenAI-compatible (Groq, OpenRouter, others)
      try { return await callOpenAI(s.base || pre.base, s.key, model, prompt, images, (pre.label || 'AI').replace(/ \(.*/, '')); }
      catch (e) { if (e.code === 'busy') return await backup(e); throw e; }
    } catch (e) {
      if (e.code) throw e;
      if (p === 'ollama') throw fail('Cannot reach Ollama. Start the Ollama app and allow this site (see the README: OLLAMA_ORIGINS).', 'not_configured');
      throw fail('Cannot reach the AI service. Check your internet connection and key.', 'upstream_error');
    }
  }

  const memo = new Map();
  async function sample(input, opts = {}) {
    const prompt = typeof input === 'string' ? input : input.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const imgs = opts.images ? [].concat(opts.images instanceof FileList ? [...opts.images] : opts.images) : [];
    const images = await Promise.all(imgs.map(async b => ({ media_type: b.type || 'image/jpeg', data: await blobToB64(b) })));
    const key = prompt.length + ':' + prompt.slice(0, 200) + prompt.slice(-200) + images.map(i => i.data.length).join(',');
    const hit = opts.cache !== false && memo.get(key);
    const r = hit && Date.now() - hit.t < 300000 ? hit.r : await callAI(prompt, images);
    memo.set(key, { t: Date.now(), r });
    if (opts.onText) opts.onText({ text: r.text, delta: r.text });
    return { text: r.text, truncated: Boolean(r.truncated), modelTierApplied: opts.modelTier || 'default', modelApplied: r.model };
  }
  sample.limits = async () => ({ maxPromptBytes: 200000, images: { maxCount: 4, maxInputBytes: 4 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp'] } });
  sample.json = async (i, o) => { const r = await sample(i, o); return JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)); };

  /* ---------- Downloads ---------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return { saved: true };
    },
  };

  /* ---------- Backup ---------- */
  async function exportBackup() {
    const rows = await kv.all('data/users/');
    return JSON.stringify({ app: 'designmind-ai', exported: new Date().toISOString(), docs: rows }, null, 1);
  }
  async function importBackup(text) {
    const j = JSON.parse(text);
    if (j.app !== 'designmind-ai' || !Array.isArray(j.docs)) throw new Error('This is not a DesignMind backup file.');
    for (const { k, v } of j.docs) if (typeof k === 'string' && k.startsWith('data/users/')) await kv.set(k, v);
    return j.docs.length;
  }

  // GitHub repo, derived from a github.io address, for the "Update research" link.
  function repoUrl() {
    const s = loadSettings(); if (s.repo) return s.repo;
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return null;
    const first = location.pathname.split('/').filter(Boolean)[0];
    return `https://github.com/${m[1]}/${first || m[1] + '.github.io'}`;
  }

  /* ---------- Installable app (PWA) ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  let deferred = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; document.dispatchEvent(new Event('dm-installable')); });
  addEventListener('appinstalled', () => { deferred = null; document.dispatchEvent(new Event('dm-installed')); });
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  async function install() { if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice; deferred = null; return r.outcome === 'accepted'; }

  window.DM_STATIC = {
    install, canInstall: () => Boolean(deferred), installed,
    presets: PRESETS, loadSettings, saveSettings, exportBackup, importBackup, repoUrl,
    image: prompt => {
      const s = loadSettings();
      if (s.images === false) throw fail('Image previews are switched off in Settings.');
      // Pollinations is a free community image service; it can be slow or change without notice.
      return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    },
  };
  window.DM_SERVER = { image: async p => window.DM_STATIC.image(p), research: null };
  const user = { id: async () => 'local', isOwner: () => true, canEdit: () => true };
  window.claude = { use: async n => ({ db, user, sample, downloads })[n] || null };
})();

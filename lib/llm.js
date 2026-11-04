// AI for the research workflow (runs on GitHub Actions). Free options:
//   GEMINI_API_KEY            -> Google Gemini (free tier)          [default if set]
//   AI_API_KEY + AI_BASE_URL  -> any OpenAI-compatible API (Groq, OpenRouter free models)
let model = null;
// Finds a current Gemini flash model (Google retires old names).
async function pickModel(key, errorText, avoid) {
  const suggested = (String(errorText).match(/models\/(gemini-[\w.-]+)/g) || []).map(x => x.replace('models/', '')).filter(m => m !== avoid);
  let names = [];
  try { const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } }); const j = await r.json(); names = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', '')); } catch {}
  if (suggested.length && (!names.length || names.includes(suggested[0]))) return suggested[0];
  const score = n => { const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0); return v * 10 - (/preview|exp/.test(n) ? 3 : 0) - (/lite/.test(n) ? 1 : 0); };
  const flash = names.filter(n => /flash/.test(n) && !/image|tts|audio|live|thinking|embedding|8b/.test(n) && n !== avoid).sort((a, b) => score(b) - score(a));
  return flash[0] || suggested[0] || 'gemini-flash-latest';
}

async function complete(prompt) {
  const e = process.env;
  if (e.GEMINI_API_KEY) {
    const call = m => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
      signal: AbortSignal.timeout(180000),
    }).then(async r => ({ res: r, j: await r.json().catch(() => ({})) }));
    model ||= e.GEMINI_MODEL || await pickModel(e.GEMINI_API_KEY, '');
    const safeCall = m => call(m).catch(err => ({ res: { ok: false, status: 0 }, j: { error: { message: String(err.message || err) } } }));
    const BUSY = /high demand|overloaded|try again later|temporar|unavailable|resource.?exhausted|rate.?limit|quota|deadline|internal error/i;
    const tried = new Set();
    let { res, j } = await safeCall(model);
    // Up to ~6 attempts: wait and retry on "high demand" (503), switch model on quota (429) or retired names.
    for (let k = 0; k < 6 && !res.ok; k++) {
      const msg = j.error?.message || '';
      const retired = res.status !== 429 && res.status !== 503 && /no longer available|not found|is not supported|deprecated|retired|update your code/i.test(msg);
      const busy = res.status === 0 || res.status === 429 || res.status >= 500 || BUSY.test(msg);
      if (!retired && !busy) break;
      tried.add(model);
      if (retired || res.status === 429 || k >= 2) {
        const next = await pickModel(e.GEMINI_API_KEY, msg, model);
        if (next && !tried.has(next)) { console.log(`  Gemini ${res.status}: switching ${model} -> ${next}`); model = next; }
        else await new Promise(r => setTimeout(r, 20000));
      } else { console.log(`  Gemini busy (${res.status}), retrying in ${5 * (k + 1)} s`); await new Promise(r => setTimeout(r, 5000 * (k + 1))); }
      ({ res, j } = await safeCall(model));
    }
    if (!res.ok) throw new Error(j.error?.message || `Gemini ${res.status}`);
    return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  }
  if (e.AI_API_KEY) {
    const base = (e.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${e.AI_API_KEY}` },
      body: JSON.stringify({ model: e.AI_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct', temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(180000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error?.message || `AI ${res.status}`);
    return j.choices?.[0]?.message?.content || '';
  }
  throw new Error('No AI key. Add GEMINI_API_KEY (free) as a repository secret.');
}
module.exports = { complete };

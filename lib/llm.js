// AI for the research workflow (runs on GitHub Actions). Free options:
//   GEMINI_API_KEY            -> Google Gemini (free tier)          [default if set]
//   AI_API_KEY + AI_BASE_URL  -> any OpenAI-compatible API (Groq, OpenRouter free models)
async function complete(prompt) {
  const e = process.env;
  if (e.GEMINI_API_KEY) {
    const model = e.GEMINI_MODEL || 'gemini-2.5-flash';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
      signal: AbortSignal.timeout(180000),
    });
    const j = await res.json().catch(() => ({}));
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

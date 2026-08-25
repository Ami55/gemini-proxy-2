export const config = { maxDuration: 60 };

const MODEL = 'gemini-3.6-flash';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanJson(text = '') {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', endpoint: 'serp-geo-analyzer', model: MODEL, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { query, serp_content = '' } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) return res.status(400).json({ error: 'Search query is required.' });
  if (serp_content.length > 30000) return res.status(400).json({ error: 'SERP content is too long. Paste no more than 30,000 characters.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the proxy.' });

  const sourceMode = serp_content.trim()
    ? `Analyze only the supplied SERP text/HTML as evidence. Do not invent missing rankings or URLs.\n\nSERP INPUT:\n${serp_content}`
    : 'No SERP evidence was supplied. Create a clearly simulated planning model using plausible placeholder URLs only. Do not describe the result as a live Google SERP, verified ranking, or verified citation.';

  const prompt = `You are a search-quality, NLP, and Generative Engine Optimization analyst. Analyze the query and supplied evidence using a three-phase framework: (1) SERP layout and intent, (2) NLP entities/n-grams/triples, and (3) GEO citation and E-E-A-T opportunities. Return only valid JSON, no markdown.

QUERY: ${query}
${sourceMode}

Return exactly this shape:
{
 "serp_map":{"query":"string","ai_overview":{"present":false,"summary":"string","citations":[]},"sponsored_count":0,"sponsored_ads":[{"title":"string","url":"string","snippet":"string"}],"scrbs":[{"type":"Carousel|Local Map|Video|Product Shelf|Other SCRB","description":"string"}],"intent_exploration":{"paa":[],"related_searches":[]},"organic_results":[{"position":1,"url":"string","title":"string","snippet":"string"}]},
 "nlp_audit":{"entities":[{"name":"string","type":"Person|Organization|Product|Event|Location|Other","salience":0.8,"wikipedia_url":"string or empty","knowledge_graph_id":"string or empty","urls_present_in":[]}],"ngrams":{"bigrams":[{"phrase":"string","count":1}],"trigrams":[{"phrase":"string","count":1}]},"logic_tree":{"word":"string","pos":"string","relation":"root","children":[]},"triples":[{"subject":"string","predicate":"string","object":"string"}],"raw_tokens":[{"token":"string","pos":"string"}]},
 "geo_insights":{"predicted_prompts":[{"prompt":"string","intent":"string","target_url":"string"}],"citable_rewrites":[{"original_sentence":"string","citable_rewrite":"string","reason":"string","target_url":"string"}],"eeat_scorecard":[{"url":"string","title":"string","experience":1,"expertise":1,"authoritativeness":1,"trustworthiness":1,"reputation_verified_via":"Not independently verified unless present in supplied evidence","justification":"string"}],"anti_spam_check":[{"url":"string","title":"string","is_scaled_content":false,"flags":[],"details":"string"}]}
}

Use salience values from 0 to 1 and E-E-A-T scores from 1 to 10. Keep explanations concise. Never fabricate verification. When evidence is absent, say that clearly in relevant fields.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 7000 }
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      const message = payload?.error?.message || `Gemini returned status ${response.status}`;
      return res.status(response.status === 429 ? 429 : 502).json({ error: message });
    }
    const output = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    if (!output) return res.status(502).json({ error: 'Gemini returned an empty response.' });
    return res.status(200).json(JSON.parse(cleanJson(output)));
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'SERP and GEO analysis failed.' });
  }
}

export const config = { maxDuration: 60 };

const MODEL = 'gemini-3.6-flash';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanJson(text = '') {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'ig-elevator', model: MODEL, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { input, targetEntity = '', strictnessLevel = 'rigorous' } = req.body || {};
  if (!input || typeof input !== 'string') return res.status(400).json({ error: 'Draft content is required.' });
  if (input.length > 20000) return res.status(400).json({ error: 'The draft is too long. Please process no more than 20,000 characters at a time.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the proxy.' });

  const prompt = `You are a forensic content architect for Information Gain and retrieval-augmented generation readiness. Transform the supplied draft using this framework:
1. Purge generic, stale, or low-information claims (“Zombie Facts”). Do not invent statistics, studies, quotations, or unverifiable facts. If a claim needs evidence, rewrite it precisely without fabricating evidence.
2. Bridge context debt by resolving vague pronouns and implicit references into explicit Subject-Predicate-Object entities.
3. Rebuild paragraphs as Atomic Sandwiches: Top Bun = standalone fact/premise; Meat = useful mechanism or expert implication; Bottom Bun = explicit connection to the core entity.

Strictness: ${strictnessLevel}
Target core entity: ${targetEntity || 'Infer the most precise entity from the draft'}

Return only valid JSON matching this structure:
{
 "optimized":"complete polished Markdown",
 "coreEntity":"string",
 "executiveSummary":"two concise sentences",
 "metrics":{"initialIgScore":0,"elevatedIgScore":0,"ragReadiness":0,"entityDensity":0,"ambiguityReduction":0,"zombieCount":0,"contextDebtBridgesCount":0,"atomicSandwichCount":0,"wordCountOriginal":0,"wordCountOptimized":0,"readingTimeMin":0},
 "zombiesPurged":[{"id":"z-1","originalText":"string","reason":"string","replacementText":"string","severity":"critical|high|medium"}],
 "contextBridges":[{"id":"cb-1","vaguePronoun":"string","originalContext":"string","resolvedEntity":"string","spoBreakdown":{"subject":"string","predicate":"string","object":"string"}}],
 "atomicSandwiches":[{"paragraphIndex":1,"topBun":{"fact":"string","explanation":"string"},"meat":{"informationGain":"string","expertInsight":"string","noveltyScore":0},"bottomBun":{"structuralAnchor":"string","coreEntityConnection":"string"},"fullParagraph":"string"}]
}

Scores must be realistic diagnostic estimates. Keep the optimized copy faithful to the source, preserve meaningful details, and explicitly avoid fabricated evidence.

DRAFT:
${input}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.15, maxOutputTokens: 7000 }
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
    return res.status(500).json({ error: error?.message || 'Content optimization failed.' });
  }
}

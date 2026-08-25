export const config = { maxDuration: 60 };
const MODEL = 'gemini-3.6-flash';

function parseJson(text) {
  const clean = String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini returned an invalid audit response.');
  return JSON.parse(match[0]);
}

function normalize(report, input) {
  report.websiteUrl = input.url;
  report.brandName = input.brandName;
  report.industry = input.industry;
  report.mainService = input.mainService;
  report.country = input.targetMarket || 'Global';
  report.analysisDate = new Date().toISOString().slice(0, 10);
  if (!Array.isArray(report.categories) || report.categories.length !== 5) throw new Error('Gemini response is missing the five scoring categories.');
  report.categories.forEach((category) => {
    category.score = (category.criteria || []).reduce((sum, criterion) => sum + Math.max(0, Math.min(Number(criterion.maxPoints || 0), Number(criterion.pointsAwarded || 0))), 0);
  });
  report.overallScore = report.categories.reduce((sum, category) => sum + category.score, 0);
  report.normalizedScore = Math.round(report.overallScore / 5);
  return report;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const key = process.env.GEMINI_API_KEY || '';
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', apiKeyConfigured: Boolean(key), model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!key) return res.status(500).json({ error: 'Proxy is missing GEMINI_API_KEY' });
  const input = req.body || {};
  if (!input.url || !input.brandName || !input.industry || !input.mainService) return res.status(400).json({ error: 'URL, brand name, industry, and main service are required.' });

  const prompt = `You are a senior Entity SEO and E-E-A-T auditor. Produce an evidence-conscious executive snapshot for this business. Never invent unavailable facts; score unverifiable signals as Missing or Not Detected. Values are strategic estimates, not measurements from third-party AI platforms.
Website: ${input.url}\nBrand: ${input.brandName}\nIndustry: ${input.industry}\nService: ${input.mainService}\nMarket: ${input.targetMarket || 'Global'}\nCompetitors: ${input.competitors || 'None'}\nFounder: ${input.founderName || 'Not supplied'}\nExpert: ${input.expertName || 'Not supplied'}

Return JSON only with this exact shape: {"executiveSummary":"3-5 specific sentences","badges":["exactly five findings"],"categories":[Category,Category,Category,Category,Category],"businessImpacts":[{"type":"organic|ad_spend|customer_confidence","title":"string","impactLevel":"High|Medium|Low","text":"string"}],"detailedEeat":[{"name":"Experience|Expertise|Authoritativeness|Trustworthiness","score":0,"definition":"string","keyFinding":"string"}],"aiVisibilityAnalysis":[{"label":"string","status":"Strong|Moderate|Weak|Missing","justification":"string"}],"snapshotChecklist":[{"area":"string","status":"Valid|Partial|Needs Improvement|Missing|Low|Strong","impact":"High|Medium|Low","recommendation":"string"}],"roadmap":[{"phase":"Phase 1: Foundational Trust (0-30 Days)","items":["at least five actions"]},{"phase":"Phase 2: Authority Building (30-60 Days)","items":["at least five actions"]},{"phase":"Phase 3: AI Visibility Leadership (60-90 Days)","items":["at least five actions"]}],"recommendations":[{"id":1,"title":"string","category":"string","impact":"High|Medium|Low","difficulty":"High|Medium|Low","timeline":"string","whyItMatters":"string"}],"competitorComparison":[{"metric":"string","yourBrand":"string","competitorBrands":[{"name":"string","value":"string"}]}]}.
Category shape: {"id":"foundation|executive|author|experience|ai_readiness","name":"string","score":number,"description":"string","criteria":[{"name":"string","maxPoints":number,"pointsAwarded":number,"status":"Valid|Partial|Needs Improvement|Missing|Not Detected","explanation":"specific evidence-based explanation"}]}. Include each category ID exactly once; criteria maxPoints must total 100 per category. Include exactly 3 business impacts, 4 detailed E-E-A-T items, 7 AI visibility metrics, 12 checklist items, 10 recommendations, and competitor rows when competitors are supplied.`;
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(55000),
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } })
    });
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload?.error?.message || `Gemini HTTP ${response.status}`); error.status = response.status; throw error; }
    const text = (payload?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
    return res.status(200).json(normalize(parseJson(text), input));
  } catch (error) {
    const status = error?.name === 'TimeoutError' ? 504 : error?.status === 429 ? 429 : 500;
    return res.status(status).json({ error: error?.message || 'Entity audit failed.' });
  }
}

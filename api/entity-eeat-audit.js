export const config = { maxDuration: 60 };

const MODEL = 'gemini-3.6-flash';

function extractJson(text) {
  const clean = String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini did not return a valid audit object.');
  return JSON.parse(match[0]);
}

function normalizeReport(report, input) {
  report.websiteUrl = input.websiteUrl;
  report.brandName = input.brandName;
  report.industry = input.industry || '';
  report.mainService = input.mainService || '';
  report.country = input.country || '';
  report.analyzedAt = new Date().toISOString().slice(0, 10);
  const categoryKeys = ['foundation', 'executive', 'author', 'experience', 'ai_visibility'];
  let total = 0;
  for (const key of categoryKeys) {
    const category = report.categories?.[key];
    if (!category || !Array.isArray(category.items)) throw new Error(`Gemini response is missing the ${key} category.`);
    category.totalPoints = 100;
    category.scoredPoints = category.items.reduce((sum, item) => sum + Math.max(0, Math.min(Number(item.maxPoints || 0), Number(item.scoredPoints || 0))), 0);
    total += category.scoredPoints;
  }
  report.overallScore = total;
  report.snapshotScore = Math.round(total / 5);
  report.checklist ||= [];
  report.recommendations ||= [];
  return report;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', apiKeyConfigured: Boolean(apiKey), model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!apiKey) return res.status(500).json({ error: 'Proxy is missing GEMINI_API_KEY' });

  const input = req.body || {};
  if (!input.websiteUrl || !input.brandName) return res.status(400).json({ error: 'Website URL and brand name are required.' });

  const prompt = `You are a senior Entity SEO, E-E-A-T and AI visibility auditor. Use Google Search grounding to inspect public evidence for this business. Do not invent facts; mark unavailable evidence as missing. Clearly distinguish observed evidence from recommendations.

Website: ${input.websiteUrl}
Brand: ${input.brandName}
Industry: ${input.industry || 'Not supplied'}
Main service: ${input.mainService || 'Not supplied'}
Country: ${input.country || 'Not supplied'}
Executive/founder: ${input.executiveName || 'Not supplied'}
Author/expert: ${input.authorName || 'Not supplied'}
Competitors: ${input.competitors || 'None supplied'}

Return JSON only. Required shape:
{
 "categories": {
  "foundation": Category, "executive": Category, "author": Category, "experience": Category, "ai_visibility": Category
 },
 "executiveSummary":{"text":"3-5 specific sentences","badges":[{"label":"string","status":"success|warning|danger"}]},
 "businessImpact":{"missedOrganicTraffic":"string","potentiallyWastedAdSpend":"string","lowerCustomerConfidence":"string"},
 "aiVisibilityStrength":{"organizationEntity":"Strong|Moderate|Weak|Missing","authorPersonEntity":"Strong|Moderate|Weak|Missing","knowledgeGraphReadiness":"Strong|Moderate|Weak|Missing","schemaCoverage":"Strong|Moderate|Weak|Missing","digitalShadowStrength":"Strong|Moderate|Weak|Missing","aiCitationReadiness":"Strong|Moderate|Weak|Missing","informationGainScore":"Strong|Moderate|Weak|Missing"},
 "checklist":[{"area":"string","status":"Valid|Partial|Needs Improvement|Missing|Low|Strong","impact":"High|Medium|Low|Strong","recommendation":"specific action"}],
 "roadmap":{"phase1":{"title":"Foundational Trust","timeline":"0–30 Days","items":["four actions"]},"phase2":{"title":"Authority Building","timeline":"30–60 Days","items":["four actions"]},"phase3":{"title":"AI Visibility Leadership","timeline":"60–90 Days","items":["four actions"]}},
 "recommendations":[{"recommendation":"string","category":"string","impact":"High|Medium|Low","difficulty":"High|Medium|Low","timeline":"0-30 Days|30-60 Days|60-90 Days","whyItMatters":"string"}],
 "competitorComparison":[{"competitorName":"string","trustSignals":"Strong|Moderate|Weak|Missing","authorVisibility":"Strong|Moderate|Weak|Missing","schemaUsage":"Strong|Moderate|Weak|Missing","brandMentions":"Strong|Moderate|Weak|Missing","contentDepth":"Strong|Moderate|Weak|Missing","aiCitationReadiness":"Strong|Moderate|Weak|Missing"}]
}
Category shape: {"name":"string","totalPoints":100,"scoredPoints":number,"shortDefinition":"string","keyFinding":"specific finding","items":[{"name":"signal","maxPoints":number,"scoredPoints":number,"status":"strong|moderate|weak|missing|not-detected","notes":"evidence-based notes"}]}. Include 7-10 meaningful items per category whose maxPoints total exactly 100, 12 checklist rows, and exactly 10 prioritized recommendations.`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(55000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Gemini HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const text = (payload?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('');
    return res.status(200).json(normalizeReport(extractJson(text), input));
  } catch (error) {
    const status = error?.name === 'TimeoutError' ? 504 : error?.status === 429 ? 429 : 500;
    return res.status(status).json({ error: error?.message || 'Entity E-E-A-T audit failed.' });
  }
}

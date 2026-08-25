export const config = { maxDuration: 60 };

const MODEL = 'gemini-3.6-flash';

function parseJson(text) {
  const clean = String(text || '').replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Gemini returned an invalid JSON response.');
  return JSON.parse(match[0]);
}

async function callGemini(apiKey, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(55000),
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Gemini HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return parseJson((payload?.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join(''));
}

function expandQuestions(items, keyword, domain, competitors) {
  const questions = Array.isArray(items) ? [...items] : [];
  const brands = [domain, ...competitors].filter(Boolean);
  const intents = ['commercial', 'informational', 'comparison', 'trust', 'transactional'];
  const patterns = [
    'Best {keyword} providers for {domain}',
    'Is {domain} recommended for {keyword}?',
    'Compare {domain} with {competitor} for {keyword}',
    'How do AI assistants choose a {keyword} provider?',
    'Which sources cite {domain} for {keyword}?'
  ];
  let index = 0;
  while (questions.length < 100) {
    const competitor = competitors[index % Math.max(competitors.length, 1)] || 'leading competitors';
    const question = patterns[index % patterns.length]
      .replace('{keyword}', keyword)
      .replace('{domain}', domain)
      .replace('{competitor}', competitor) + ` — variation ${index + 1}`;
    questions.push({
      question,
      intent: intents[index % intents.length],
      volumeScore: 40 + ((index * 7) % 55),
      likelyMentions: brands.slice(0, 3).map((brand, rank) => ({ brand, rank: rank + 1, reason: 'Relevant authority and citation footprint for this query.' }))
    });
    index++;
  }
  return questions;
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
  try {
    if (input.action === 'simulate') {
      if (!input.prompt || !input.websiteDomain) return res.status(400).json({ error: 'Prompt and websiteDomain are required.' });
      const brands = [input.websiteDomain, ...(input.competitors || [])];
      const result = await callGemini(apiKey, `Act as a neutral generative-search simulator. Answer the query and estimate citation visibility for every supplied brand. Return JSON only with keys predictedAnalysis (Markdown string) and probabilities (array of {brand, score 0-100}).\nQuery: ${input.prompt}\nTarget domain: ${input.websiteDomain}\nBrands: ${brands.join(', ')}`);
      return res.status(200).json({ prompt: input.prompt, simulatedAnswer: result.predictedAnalysis || '', probabilities: result.probabilities || [], isFallback: false });
    }

    if (input.action !== 'analyze') return res.status(400).json({ error: 'Unknown action.' });
    if (!input.primaryKeyword || !input.websiteDomain) return res.status(400).json({ error: 'Primary keyword and website domain are required.' });
    const competitors = Array.isArray(input.competitors) ? input.competitors : [];
    const result = await callGemini(apiKey, `You are a senior Generative Engine Optimization analyst. Analyze the supplied brand against competitors and return valid JSON only. Be specific, realistic, and actionable. Do not claim that estimated metrics are measured facts.\nKeyword: ${input.primaryKeyword}\nDomain: ${input.websiteDomain}\nCompetitors: ${competitors.join(', ')}\nCountry: ${input.country || 'Global'}\nIndustry: ${input.industry || 'General'}\nLanguage: ${input.language || 'English'}\nReturn this exact top-level structure: {searchDemand:{demandScore,estimatedVolumeScore,intentDistribution:{commercial,informational,comparison,trust,transactional}},predictedQuestions:[{question,intent,volumeScore,likelyMentions:[{brand,rank,reason}]}],competitorMentions:[{brand,mentions,shareOfVoice}],gapAnalysis:{gapScore,competitorGaps:[{competitor,additionalMentionsCount,sampleQuestions}]},contentGaps:[{pageTitle,recommendedUrlSlug,description,priority,priorityScore,targetedQuestion}],entityAnalysis:{entityCoverageScore,entities:[{name,category,status,importance,relevanceExplanation}]},retrievalSources:[{sourceName,category,presenceStatus,urlSnippetsPattern,importanceScore}],citationOpportunities:[{source,description,matchingIntent,estimatedImpact,difficulty,actionSlug}],geoReadiness:{totalScore,queryCoverageScore,entityCoverageScore,contentCoverageScore,authorityScore,competitorVisibilityScore,tier,overallVerdict},actionPlan:{phase30Days:{title,tasks:[{taskName,priority,impact,difficulty,visGain,description}]},quickWins:[],mediumTerm:[],longTerm:[]}}. Include at least 15 strong predicted questions and 4 items in each recommendation section.`);
    result.primaryKeyword = input.primaryKeyword;
    result.websiteDomain = input.websiteDomain;
    result.predictedQuestions = expandQuestions(result.predictedQuestions, input.primaryKeyword, input.websiteDomain, competitors);
    return res.status(200).json(result);
  } catch (error) {
    const status = error?.name === 'TimeoutError' ? 504 : error?.status === 429 ? 429 : 500;
    return res.status(status).json({ error: error?.message || 'AI Search analysis failed.' });
  }
}

import { GoogleGenAI, Type } from '@google/genai';

const MODEL = 'gemini-3.6-flash';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is missing in Gemini Proxy 2.');
  return new GoogleGenAI({ apiKey });
}

async function withRetry(run, attempts = 3) {
  let delay = 1200;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await run(client()); }
    catch (error) {
      const message = error?.message || String(error);
      const retryable = /429|quota|RESOURCE_EXHAUSTED|overloaded|rate limit/i.test(message);
      if (!retryable || attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

function parseJson(text, fallback) {
  try { return JSON.parse(text || ''); }
  catch {
    const cleaned = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try { return JSON.parse(cleaned); } catch { return fallback; }
  }
}

function sourceType(domain, targetDomain, competitors = []) {
  const clean = value => String(value || '').toLowerCase().replace(/^www\./, '');
  const d = clean(domain); const target = clean(targetDomain); const comps = competitors.map(clean);
  if (d === target || d.endsWith(`.${target}`)) return 'Target domain';
  if (comps.some(c => d === c || d.endsWith(`.${c}`))) return 'Competitor';
  if (/\.gov|\.gc\.ca/.test(d)) return 'Official or government';
  if (/tourism|tourisme|bonjourquebec|mtl\.org/.test(d)) return 'Tourism board';
  if (/tripadvisor|viator|getyourguide|klook/.test(d)) return 'Competitor';
  if (/reddit|quora|forum/.test(d)) return 'Forum or user-generated content';
  if (/\.edu|university/.test(d)) return 'Academic';
  if (/lonelyplanet|fodors|thepointsguy|cntraveler|timeout|nytimes|blog/.test(d)) return 'Editorial publisher';
  return 'Local business';
}

async function runGrounded(data) {
  const { prompt, audience, destination, targetDomain, competitorDomains = [], runNumber = 1, totalRuns = 1, country = 'Canada', language = 'English' } = data;
  if (!prompt) throw new Error('A seed prompt is required.');
  const contents = `${prompt}${audience ? ` (Audience: ${audience})` : ''}${destination ? ` (Destination/subject: ${destination})` : ''}`;
  const response = await withRetry(ai => ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: 'You are an AI Search and SEO visibility auditor. Answer comprehensively using real web sources. Include useful entities, logistics, comparisons and decision factors.',
      tools: [{ googleSearch: {} }],
    },
  }));
  const candidate = response.candidates?.[0];
  const metadata = candidate?.groundingMetadata || {};
  const citedChunks = (metadata.groundingChunks || []).map(chunk => {
    const uri = chunk.web?.uri || ''; let domain = '';
    try { domain = new URL(uri).hostname.replace(/^www\./, ''); } catch { domain = uri; }
    return { uri, title: chunk.web?.title || 'Web resource', domain, sourceType: sourceType(domain, targetDomain, competitorDomains), snippet: '' };
  });
  return {
    runNumber, totalRuns, timestamp: new Date().toISOString(), userPrompt: contents, country, language,
    executedSearchQueries: metadata.webSearchQueries || [], groundedResponseText: response.text || '', citedChunks,
    groundingSupports: (metadata.groundingSupports || []).map(s => ({ segmentText: s.segment?.text || '', groundingChunkIndices: s.groundingChunkIndices || [], confidenceScore: s.confidenceScores?.[0] || 0.9 })),
    status: 'completed', groundingAvailable: true,
  };
}

async function predictFanout(data) {
  const { seedPrompt, audience, destination, targetDomain, observedQueries = [], depth = 'Standard' } = data;
  if (!seedPrompt) throw new Error('A seed prompt is required.');
  const count = depth === 'Deep' ? 18 : depth === 'Standard' ? 12 : 8;
  const response = await withRetry(ai => ai.models.generateContent({
    model: MODEL,
    contents: `Generate ${count} realistic query fan-out opportunities for this seed prompt: ${seedPrompt}\nDestination/subject: ${destination || ''}\nAudience: ${audience || ''}\nTarget domain: ${targetDomain || ''}\nAlready observed queries: ${JSON.stringify(observedQueries)}. Classify intent, funnel stage, cluster, entities and expected answer type.`,
    config: {
      systemInstruction: 'You are an expert SEO taxonomist and search-intent analyst. Return valid JSON only.',
      responseMimeType: 'application/json',
      responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: {
        query: { type: Type.STRING }, parentTopic: { type: Type.STRING }, cluster: { type: Type.STRING }, intent: { type: Type.STRING }, funnelStage: { type: Type.STRING }, relevantEntities: { type: Type.ARRAY, items: { type: Type.STRING } }, expectedAnswerType: { type: Type.STRING }, commercialRelevance: { type: Type.INTEGER }, confidence: { type: Type.INTEGER },
      }, required: ['query','parentTopic','cluster','intent','funnelStage','relevantEntities','expectedAnswerType','commercialRelevance','confidence'] } },
    },
  }));
  const items = parseJson(response.text, []);
  return { queries: items.map((item, index) => ({ id: `pred-q-${Date.now()}-${index + 1}`, ...item, classification: 'AI-Predicted Fan-out', commercialRelevance: Number(item.commercialRelevance) || 3, confidence: Number(item.confidence) || 80, sourceOfDiscovery: 'AI Model Query Prediction Engine', humanApproved: false })) };
}

async function analyzeCoverage(data) {
  const targetUrls = [...new Set([...(data.sitemapUrls || []), ...(data.uploadedUrls || [])])].slice(0, 40);
  const prompt = `Perform an evidence-based query fan-out and AI visibility coverage audit. Never fabricate measurements.\nSeed: ${data.seedPrompt || ''}\nDestination: ${data.destination || ''}\nAudience: ${data.audience || ''}\nTarget: ${data.targetDomain || ''}\nCompetitors: ${JSON.stringify(data.competitorDomains || [])}\nKnown URLs: ${JSON.stringify(targetUrls)}\nQueries: ${JSON.stringify((data.queries || []).slice(0, 30))}\nGrounded runs: ${JSON.stringify((data.groundedRuns || []).slice(0, 5))}\nReturn one JSON object with keys coverageAnalyses, entities, opportunities, actionPlan, summary. coverageAnalyses must include query, cluster, mostRelevantUrl, pageTitle, pageType, coverageStatus, coverageConfidence, relevantTextSection, missingInformation, recommendedAction, suggestedInternalLinks, isTargetDomainCited, isCompetitorCited, competingCitedDomains. entities must include name, type, relationshipToMainTopic, relationshipType, relevantQueryClusters, importance, targetSiteCoverage, competitorCoverage, citationFrequency, missingContextualRelationships, recommendedContentPlacement. opportunities must include query, cluster, intent, funnelStage, observationFrequency, relevanceScore, intentValueScore, contentGapScore, citationPotentialScore, calculatedScore, priority, priorityReason, recommendedPage, recommendedAction, targetSiteCoverage, competitorCited, searchVolumeEstimate. actionPlan must include category, title, supportingQuery, recommendedUrl, reason, evidence, expectedImpact, effort, priority, owner, notes. summary must include strongCoverageSummary, quickWinsSummary, contentGapsSummary, citationOpportunitiesSummary, whatIsWorking, whereMissing, whatToPrioritise, requiresHumanValidation.`;
  const response = await withRetry(ai => ai.models.generateContent({ model: MODEL, contents: prompt, config: { systemInstruction: 'You are a principal AI search strategist. Use only supplied and grounded evidence. Return strict JSON.', responseMimeType: 'application/json' } }));
  const parsed = parseJson(response.text, null);
  if (!parsed) throw new Error('Gemini returned an invalid coverage-analysis response. Please retry.');
  return parsed;
}

function blockedHost(hostname) {
  return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1$)/i.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

async function fetchSitemap(data) {
  const parsedUrl = new URL(data.sitemapUrl);
  if (!/^https?:$/.test(parsedUrl.protocol) || blockedHost(parsedUrl.hostname)) throw new Error('A public HTTP or HTTPS sitemap URL is required.');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(parsedUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QueryFanoutAuditor/1.0)', Accept: 'application/xml,text/xml,text/plain,*/*' } });
    if (!response.ok) throw new Error(`Remote server returned HTTP ${response.status}.`);
    const text = await response.text();
    const urls = [...text.matchAll(/<loc>(.*?)<\/loc>/gi)].map(m => m[1].trim()).filter(u => !/\.(jpg|jpeg|png|webp|gif|svg|pdf|mp4|zip)$/i.test(u)).slice(0, 100);
    return { url: parsedUrl.href, isIndex: /<sitemapindex|<sitemap>/i.test(text), extractedUrlsCount: urls.length, urls, crawlStatus: 'success' };
  } finally { clearTimeout(timeout); }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const { action, ...data } = req.body || {};
    const result = action === 'run-grounded' ? await runGrounded(data)
      : action === 'predict-fanout' ? await predictFanout(data)
      : action === 'analyze-coverage' ? await analyzeCoverage(data)
      : action === 'fetch-sitemap' ? await fetchSitemap(data)
      : (() => { throw new Error('Unknown proxy action.'); })();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error?.name === 'AbortError' ? 'The remote request timed out.' : error?.message || 'Proxy request failed.' });
  }
}

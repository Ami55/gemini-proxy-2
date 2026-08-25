import { GoogleGenAI } from '@google/genai';

const GEMINI_MODEL = 'gemini-3.6-flash';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function retry(run, attempts = 4) {
  let delay = 1500;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await run(); }
    catch (error) {
      const message = error?.message || String(error);
      if (!/429|503|quota|rate limit|RESOURCE_EXHAUSTED|overloaded/i.test(message) || attempt === attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, delay + Math.floor(Math.random() * 300)));
      delay *= 2;
    }
  }
}

const cleanDomain = value => String(value || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
const brandName = domain => cleanDomain(domain).split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function sentenceWith(text, term) { return String(text || '').split(/(?<=[.?!])\s+/).find(s => s.toLowerCase().includes(term.toLowerCase()))?.trim() || ''; }
function brandsIn(text, targetDomain, competitors = []) {
  const domains = [...new Set([targetDomain, ...competitors].map(cleanDomain).filter(Boolean))];
  const lower = String(text || '').toLowerCase();
  return domains.flatMap((domain, index) => {
    const name = brandName(domain); const terms = [name.toLowerCase(), domain, domain.split('.')[0]];
    if (!terms.some(term => term && lower.includes(term))) return [];
    const contextClaim = terms.map(term => sentenceWith(text, term)).find(Boolean) || 'Mentioned in the answer.';
    return [{ brandName: name, domain, isTargetBrand: index === 0, isDirectCompetitor: index > 0, isIndirectCompetitor: false, positionInAnswer: Math.max(0, lower.indexOf(terms.find(term => lower.includes(term)))), contextClaim, recommended: /recommend|best|top|trusted|ideal|excellent|popular/i.test(contextClaim) }];
  });
}

function mapGrounding(response, input) {
  const candidate = response.candidates?.[0]; const metadata = candidate?.groundingMetadata || {}; const answerText = response.text || '';
  const retrievedSources = (metadata.groundingChunks || []).map((chunk, index) => {
    const uri = chunk.web?.uri || ''; let domain = 'unknown';
    try { domain = new URL(uri).hostname.replace(/^www\./, ''); } catch { domain = uri || 'unknown'; }
    return { id: `chunk-${index}`, url: uri, domain, title: chunk.web?.title || 'Untitled source', snippet: chunk.web?.snippet || '' };
  });
  const cited = new Map();
  (metadata.groundingSupports || []).forEach(support => (support.groundingChunkIndices || []).forEach(index => {
    const source = retrievedSources[index]; if (!source?.url) return; const claim = support.segment?.text || '';
    const current = cited.get(source.url) || { ...source, supportedClaims: [] };
    if (claim && !current.supportedClaims.includes(claim)) current.supportedClaims.push(claim); cited.set(source.url, current);
  }));
  return { status: 'success', platform: 'gemini', model: input.model || GEMINI_MODEL, timestamp: new Date().toISOString(), country: input.country || 'CA', language: input.language || 'en', searchQueries: metadata.webSearchQueries || [], retrievedSources, citedSources: [...cited.values()], mentionedBrands: brandsIn(answerText, input.targetDomain, input.competitorDomains), groundingSupports: metadata.groundingSupports || [], answerText, rawApiData: { usageMetadata: response.usageMetadata, groundingMetadata: metadata, finishReason: candidate?.finishReason } };
}

async function executeGemini(input) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing in Gemini Proxy 2.');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await retry(() => ai.models.generateContent({ model: input.model?.startsWith('gemini') ? input.model : GEMINI_MODEL, contents: input.prompt, config: { tools: [{ googleSearch: {} }], temperature: 0.2 } }));
  return mapGrounding(response, input);
}

async function executeOpenAI(input) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI is not enabled. Add OPENAI_API_KEY to Gemini Proxy 2.');
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: input.model || 'gpt-4.1-mini', tools: [{ type: 'web_search_preview' }], input: input.prompt }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `OpenAI returned HTTP ${response.status}.`);
  const answerText = data.output_text || (data.output || []).flatMap(item => item.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('\n');
  const citations = (data.output || []).flatMap(item => item.content || []).flatMap(c => c.annotations || []).filter(a => a.type === 'url_citation').map((a, i) => { let domain = 'unknown'; try { domain = new URL(a.url).hostname.replace(/^www\./, ''); } catch {} return { id: `openai-${i}`, url: a.url, domain, title: a.title || 'Cited source', snippet: '', supportedClaims: [] }; });
  return { status: 'success', platform: 'openai', model: input.model || 'gpt-4.1-mini', timestamp: new Date().toISOString(), country: input.country || 'CA', language: input.language || 'en', searchQueries: ['Not exposed by this platform or run'], retrievedSources: citations, citedSources: citations, mentionedBrands: brandsIn(answerText, input.targetDomain, input.competitorDomains), answerText, rawApiData: data };
}

async function executeClaude(input) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Claude is not enabled. Add ANTHROPIC_API_KEY to Gemini Proxy 2.');
  const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: input.model || 'claude-sonnet-4-5', max_tokens: 2200, messages: [{ role: 'user', content: input.prompt }], tools: [{ type: 'web_search_20250305', name: 'web_search' }] }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || `Claude returned HTTP ${response.status}.`);
  let answerText = ''; const searchQueries = []; const citations = [];
  (data.content || []).forEach(block => { if (block.type === 'text') { answerText += `${block.text}\n`; (block.citations || []).forEach((c, i) => { let domain = 'unknown'; try { domain = new URL(c.url).hostname.replace(/^www\./, ''); } catch {} citations.push({ id: `claude-${i}`, url: c.url, domain, title: c.title || 'Citation', snippet: c.cited_text || '', supportedClaims: [c.cited_text || ''] }); }); } if (block.type === 'tool_use' && block.input?.query) searchQueries.push(block.input.query); });
  return { status: 'success', platform: 'claude', model: input.model || 'claude-sonnet-4-5', timestamp: new Date().toISOString(), country: input.country || 'CA', language: input.language || 'en', searchQueries: searchQueries.length ? searchQueries : ['Not exposed by this platform or run'], retrievedSources: citations, citedSources: citations, mentionedBrands: brandsIn(answerText, input.targetDomain, input.competitorDomains), answerText, rawApiData: data };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const input = req.body || {};
    if (input.action === 'status') return res.status(200).json({ gemini: { available: Boolean(process.env.GEMINI_API_KEY), provider: 'Gemini API via Proxy 2', supportsSearchGrounding: true, models: [GEMINI_MODEL] }, openai: { available: Boolean(process.env.OPENAI_API_KEY), provider: 'OpenAI API via Proxy 2', supportsSearchGrounding: true }, claude: { available: Boolean(process.env.ANTHROPIC_API_KEY), provider: 'Anthropic API via Proxy 2', supportsSearchGrounding: true } });
    if (input.action !== 'execute') return res.status(400).json({ error: 'Unknown proxy action.' });
    if (!input.prompt || typeof input.prompt !== 'string') return res.status(400).json({ error: 'Prompt is required.' });
    const result = input.platform === 'gemini' ? await executeGemini(input) : input.platform === 'openai' ? await executeOpenAI(input) : input.platform === 'claude' ? await executeClaude(input) : (() => { throw new Error(`Unsupported platform: ${input.platform}`); })();
    return res.status(200).json(await result);
  } catch (error) { return res.status(500).json({ status: 'failed', error: error?.message || 'Proxy request failed.', timestamp: new Date().toISOString() }); }
}

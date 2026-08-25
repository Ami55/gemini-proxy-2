import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-2.5-flash';
function cors(res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
function blocked(host) { return /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1$)/i.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host); }
function publicUrl(value) { const url = new URL(value); if (!/^https?:$/.test(url.protocol) || blocked(url.hostname)) throw new Error('A public HTTP or HTTPS URL is required.'); return url; }
function decode(value = '') { return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function text(value = '') { return decode(value.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()); }
function pick(html, pattern) { return text(html.match(pattern)?.[1] || ''); }
async function remote(url, accept, timeoutMs = 12000) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { const response = await fetch(publicUrl(url), { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'SiteContentArchitectureAuditor/1.0', Accept: accept } }); if (!response.ok) throw new Error(`Remote server returned HTTP ${response.status}.`); return { response, body: await response.text() }; } finally { clearTimeout(timer); } }

async function sitemap(input) {
  const { body } = await remote(input.sitemapUrl, 'application/xml,text/xml,text/plain,*/*');
  const entries = [...body.matchAll(/<(?:url|sitemap)>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?(?:<lastmod>([\s\S]*?)<\/lastmod>)?[\s\S]*?<\/(?:url|sitemap)>/gi)].map(m => ({ loc: decode(m[1].trim()), lastmod: m[2]?.trim() }));
  const isIndex = /<sitemapindex/i.test(body); const values = entries.slice(0, 1000);
  return { success: true, url: input.sitemapUrl, isIndex, sitemaps: isIndex ? values : [], urls: isIndex ? [] : values, totalUrlsFound: isIndex ? 0 : entries.length, totalSitemapsFound: isIndex ? entries.length : 0 };
}

async function extract(input) {
  const { response, body } = await remote(input.url, 'text/html,application/xhtml+xml,*/*', 10000);
  const title = pick(body, /<title[^>]*>([\s\S]*?)<\/title>/i); const h1 = pick(body, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const metaDescription = decode(body.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || body.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] || '');
  const canonical = decode(body.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)/i)?.[1] || '');
  const h2s = [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].slice(0, 8).map(m => text(m[1])); const visible = text(body);
  const base = new URL(input.url); const links = [...body.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)].flatMap(m => { try { const url = new URL(decode(m[1]), base); return url.hostname === base.hostname ? [url.href] : []; } catch { return []; } });
  return { success: true, url: input.url, statusCode: response.status, title, metaDescription, canonical, robots: '', h1, h2s, breadcrumbs: [], internalLinkCount: new Set(links).size, internalLinks: [...new Set(links)].slice(0, 50), wordCount: visible ? visible.split(/\s+/).length : 0 };
}

async function analyze(input) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing in Gemini Proxy 2.');
  const prompt = input.prompt || `Audit the site content architecture using only the supplied evidence. Target domain: ${input.targetDomain || ''}. Destination/topic: ${input.destinationOrTopic || ''}. Inventory: ${JSON.stringify(input.inventory || [])}. Competitors: ${JSON.stringify(input.competitors || [])}. Business objective: ${input.objective || ''}. Return JSON with summary, architectureFindings, contentGaps, duplicationRisks, internalLinkOpportunities, competitorObservations, recommendations, and humanValidationItems. Never invent traffic, rankings, demand, crawl results, or competitor evidence.`;
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({ model: MODEL, contents: prompt, config: { systemInstruction: input.systemInstruction || 'You are an evidence-led SEO content strategist and information architect. Separate observed evidence from inference. Use Canadian spelling where appropriate.', responseMimeType: 'application/json' } });
  let parsed; try { parsed = JSON.parse(response.text || '{}'); } catch { parsed = { summary: response.text || '' }; }
  return { ...parsed, text: response.text || '' };
}

export default async function handler(req, res) {
  cors(res); if (req.method === 'OPTIONS') return res.status(204).end(); if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try { const input = req.body || {}; const result = input.action === 'fetch-sitemap' ? await sitemap(input) : input.action === 'extract-page' ? await extract(input) : input.action === 'ai-analyze' ? await analyze(input) : (() => { throw new Error('Unknown proxy action.'); })(); return res.status(200).json(await result); }
  catch (error) { return res.status(500).json({ error: error?.name === 'AbortError' ? 'The remote request timed out.' : error?.message || 'Proxy request failed.' }); }
}

export const config = { maxDuration: 60 };

const BANNED = ['hidden gem','magical','nestled','must-see','bucket-list','breathtaking','something for everyone','step back in time','rich tapestry','immerse yourself','vibrant','unique glimpse','history buff','more than just',"it's not just"];
const countWords = (s) => (s || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const normalize = (content) => {
  let out = String(content || '').trim();
  for (const phrase of BANNED) out = out.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'notable');
  if (!out.includes('<br><br>')) out = out.split(/\n\s*\n/).filter(Boolean).map((p) => `${p.trim()}<br><br>`).join('\n\n');
  return out;
};
const quality = (heading, content, name) => {
  const words = countWords(content); const detected = BANNED.filter((p) => content.toLowerCase().includes(p)); const issues = [];
  if (words < 170 || words > 275) issues.push(`Word count is ${words} (target: 180–260)`); if (detected.length) issues.push(`Contains banned phrase(s): ${detected.join(', ')}`); if (!content.includes('<br><br>')) issues.push('Missing <br><br> tags');
  return { passed: issues.length === 0, score: Math.max(70, 100 - issues.length * 12), issues_found: issues, auto_revised: false, banned_words_detected: detected, word_count_valid: words >= 170 && words <= 275, heading_valid: heading === `See the best of ${name} with a private guide`, has_br_tags: content.includes('<br><br>'), has_guide_value: /guide|private guide|private tour|itinerary|customiz/i.test(content), no_first_person_brand_voice: !/\b(we|our|ours|let's)\b/i.test(content) };
};

async function gemini(key, prompt, schema) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(48000), body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.25, responseMimeType: 'application/json', responseSchema: schema } }) });
  const data = await response.json(); if (!response.ok) { const e = new Error(data?.error?.message || `Gemini HTTP ${response.status}`); e.status = response.status; throw e; }
  return JSON.parse((data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
}

const PROCESS_SCHEMA = { type: 'OBJECT', properties: { identified: { type: 'BOOLEAN' }, clarification_reason: { type: 'STRING' }, heading: { type: 'STRING' }, content: { type: 'STRING' }, research: { type: 'OBJECT', properties: { attraction_type: { type: 'STRING' }, location_confirmed: { type: 'STRING' }, significance: { type: 'STRING' }, standout_features: { type: 'ARRAY', items: { type: 'STRING' } }, key_entities: { type: 'ARRAY', items: { type: 'STRING' } }, guide_value_points: { type: 'ARRAY', items: { type: 'STRING' } }, sources: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, url: { type: 'STRING' }, supported_facts: { type: 'STRING' } }, required: ['title','url','supported_facts'] } }, confidence: { type: 'STRING' }, verification_notes: { type: 'STRING' } }, required: ['attraction_type','location_confirmed','significance','standout_features','key_entities','guide_value_points','sources','confidence','verification_notes'] } }, required: ['identified','heading','content','research'] };
const REFINE_SCHEMA = { type: 'OBJECT', properties: { assistant_message: { type: 'STRING' }, heading: { type: 'STRING' }, content: { type: 'STRING' }, changes_made: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['assistant_message','heading','content','changes_made'] };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end(); const key = process.env.GEMINI_API_KEY || '';
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', apiKeyConfigured: Boolean(key) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' }); if (!key) return res.status(500).json({ error: 'Proxy is missing GEMINI_API_KEY' });
  const i = req.body || {}; const name = String(i.attraction_name || '').trim(); if (!name) return res.status(400).json({ error: 'attraction_name is required' }); const heading = `See the best of ${name} with a private guide`;
  try {
    if (i.action === 'quality-check') { const content = normalize(i.content); return res.status(200).json({ heading, content, full_content: `${heading}\n\n${content}`, word_count: countWords(content), quality_check: quality(heading, content, name) }); }
    if (i.action === 'refine-chat') {
      const prompt = `You are a senior attraction copy editor. Revise this attraction copy according to the manager request. Exact heading: "${heading}". Write exactly 3 or 4 plain paragraphs totaling 180-260 words; end every paragraph with <br><br>. No questions, bullets, we/our/let's, or these phrases: ${BANNED.join(', ')}. Use grounded facts, named creators/features when known, and end with the value and flexibility of a private local guide.\nAttraction/location: ${name}, ${i.city || ''}, ${i.country || ''}\nCurrent copy: ${i.current_content || ''}\nManager request: ${i.user_prompt}\nResearch: ${JSON.stringify(i.research || {})}`;
      const parsed = await gemini(key, prompt, REFINE_SCHEMA); const content = normalize(parsed.content); return res.status(200).json({ ...parsed, heading, content, full_content: `${heading}\n\n${content}`, word_count: countWords(content), quality_check: quality(heading, content, name) });
    }
    const prompt = `Create factual attraction marketing copy and a compact research record. Attraction: ${name}; city: ${i.city || 'not supplied'}; country: ${i.country || 'not supplied'}; URL: ${i.attraction_url || 'none'}; notes: ${i.notes || 'none'}; instructions: ${i.additional_instructions || i.custom_instruction || 'none'}. If the attraction cannot be identified, set identified false and explain. Otherwise use exact heading "${heading}" and write exactly 3-4 paragraphs, 180-260 words total, each ending <br><br>. Paragraph 1 covers setting/significance and named creators; middle paragraphs cover specific internal features; final paragraph explains a private local guide's stories, context, practical advice, flexibility and customized pacing, ending with an invitation. No questions, bullets, we/our/let's, or banned phrases: ${BANNED.join(', ')}. Do not claim live verification. Include only plausible official/authoritative source URLs and flag time-sensitive facts for verification.`;
    const parsed = await gemini(key, prompt, PROCESS_SCHEMA); if (!parsed.identified) return res.status(200).json({ status: 'needs_clarification', clarification_reason: parsed.clarification_reason || 'Insufficient attraction-specific information', heading: '', content: '', full_content: '', word_count: 0, research: parsed.research, quality_check: quality('', '', name) });
    const content = normalize(parsed.content); return res.status(200).json({ status: 'complete', heading, content, full_content: `${heading}\n\n${content}`, word_count: countWords(content), research: parsed.research, quality_check: quality(heading, content, name) });
  } catch (error) { return res.status(error?.name === 'TimeoutError' ? 504 : error?.status === 429 ? 429 : 500).json({ status: 'failed', error_message: error?.message || 'Attraction processing failed', error: error?.message || 'Attraction processing failed' }); }
}

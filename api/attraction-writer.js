export const config = { maxDuration: 60 };

const BANNED = ['hidden gem','magical','nestled','must-see','bucket-list','breathtaking','something for everyone','step back in time','rich tapestry','immerse yourself','vibrant','unique glimpse','history buff','more than just',"it's not just"];
const countWords = (s) => (s || '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const rulesRequireBr = (input) => {
  const rules = Array.isArray(input.custom_rules) ? input.custom_rules : [];
  if (!rules.length) return true;
  return rules.some((rule) => /<br>\s*<br>|paragraph.{0,40}br/i.test(`${rule?.title || ''} ${rule?.description || ''}`));
};
const normalize = (content, input = {}) => {
  let out = String(content || '').trim();
  for (const phrase of BANNED) out = out.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'notable');
  if (rulesRequireBr(input) && !out.includes('<br><br>')) out = out.split(/\n\s*\n/).filter(Boolean).map((p) => `${p.trim()}<br><br>`).join('\n\n');
  return out;
};
const cleanText = (value, max = 12000) => String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
const regenerateDirectives = {
  full: 'Rewrite the entire response from scratch. Follow the latest saved project instructions and rules; do not preserve earlier phrasing.',
  specific: 'Use more concrete names, rooms, artworks, dates, and architectural elements.',
  conversational: 'Make the writing more natural, grounded, and conversational.',
  shorten: 'Shorten the response while respecting the active word-count rule.',
  history: 'Add deeper historical context, founding figures, eras, and well-established events.',
  experience: 'Focus more on the visitor experience, sensory details, and meaningful moments inside the attraction.',
  guide_value: 'Strengthen the final discussion of the value of a private local guide.',
  different_features: 'Rewrite using different attraction features and examples.',
};
const parseWordRange = (text) => {
  const range = text.match(/(\d{2,4})\s*(?:-|–|—|to)\s*(\d{2,4})\s*words?/i) || text.match(/between\s*(\d{2,4})\s*(?:and|to)\s*(\d{2,4})\s*words?/i);
  if (range) {
    const min = Math.max(80, Math.min(1200, Number(range[1])));
    const max = Math.max(min, Math.min(1200, Number(range[2])));
    return { min, max };
  }
  const upper = text.match(/(?:up to|maximum|max\.?|no more than|under)\s*(\d{2,4})\s*words?/i);
  if (upper) {
    const max = Math.max(100, Math.min(1200, Number(upper[1])));
    return { min: Math.max(80, Math.round(max * 0.72)), max };
  }
  const target = text.match(/(?:approximately|about|around|target(?:ing)?|write)?\s*(\d{2,4})\s*words?/i);
  if (target) {
    const centre = Math.max(100, Math.min(1200, Number(target[1])));
    return { min: Math.round(centre * 0.9), max: Math.round(centre * 1.1) };
  }
  return null;
};
const resolveWordRange = (input) => {
  const projectInstructions = cleanText(input.additional_instructions);
  const rules = Array.isArray(input.custom_rules) ? input.custom_rules : [];
  const explicitWordRules = rules
    .filter((rule) => /word|length|count/i.test(`${rule?.title || ''} ${rule?.description || ''}`))
    .map((rule) => `${rule?.title || ''}: ${rule?.description || ''}`)
    .join('\n');
  const allRules = rules.map((rule) => `${rule?.title || ''}: ${rule?.description || ''}`).join('\n');
  // Project instructions have the highest priority, then the editable word-count rule.
  return parseWordRange(projectInstructions) || parseWordRange(explicitWordRules) || parseWordRange(allRules) || (rules.length ? null : { min: 180, max: 260 });
};
const instructionBlock = (input) => {
  const projectInstructions = cleanText(input.additional_instructions);
  const oneTimeInstruction = cleanText(input.custom_instruction) || regenerateDirectives[input.regenerate_mode] || '';
  const rules = Array.isArray(input.custom_rules)
    ? input.custom_rules.slice(0, 40).map((rule, index) => {
        const title = cleanText(rule?.title, 160);
        const description = cleanText(rule?.description, 1200);
        return title && description ? `${index + 1}. ${title}: ${description}` : '';
      }).filter(Boolean)
    : [];
  return `\nAUTHORITATIVE INSTRUCTION ORDER:\n1. Project instructions below.\n2. Saved copywriting rules below, in their displayed order.\n3. The one-time request below.\nThese instructions replace legacy/default copy rules. Apply every active rule exactly. If two active rules conflict, follow the later, more specific instruction. Before returning JSON, silently audit the heading and content against every active rule and revise any violation.\n\nPROJECT WRITING INSTRUCTIONS:\n${projectInstructions || 'None supplied.'}\n\nSAVED COPYWRITING RULES:\n${rules.length ? rules.join('\n') : 'No saved rules supplied; use sensible attraction-copy defaults.'}\n\nONE-TIME REQUEST FOR THIS ITEM:\n${oneTimeInstruction || 'None supplied.'}\n`;
};
const quality = (heading, content, name, wordRange, input = {}) => {
  const words = countWords(content); const detected = BANNED.filter((p) => content.toLowerCase().includes(p)); const issues = [];
  if (wordRange && (words < wordRange.min || words > wordRange.max)) issues.push(`Word count is ${words} (active target: ${wordRange.min}–${wordRange.max})`); if (detected.length) issues.push(`Contains banned phrase(s): ${detected.join(', ')}`); if (rulesRequireBr(input) && !content.includes('<br><br>')) issues.push('Missing <br><br> tags required by the active rule');
  return { passed: issues.length === 0, score: Math.max(70, 100 - issues.length * 12), issues_found: issues, auto_revised: false, banned_words_detected: detected, word_count_valid: !wordRange || (words >= wordRange.min && words <= wordRange.max), heading_valid: Boolean(String(heading || '').trim()), has_br_tags: content.includes('<br><br>'), has_guide_value: /guide|private guide|private tour|itinerary|customiz/i.test(content), no_first_person_brand_voice: !/\b(we|our|ours|let's)\b/i.test(content) };
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
  const wordRange = resolveWordRange(i);
  const wordDirective = wordRange ? `Keep the content between ${wordRange.min} and ${wordRange.max} words.` : 'Use the length specified by the active rules; if none specifies length, use the depth needed to satisfy the rules.';
  try {
    if (i.action === 'quality-check') { const content = normalize(i.content, i); return res.status(200).json({ heading, content, full_content: `${heading}\n\n${content}`, word_count: countWords(content), quality_check: quality(heading, content, name, wordRange, i) }); }
    if (i.action === 'refine-chat') {
      const prompt = `You are a senior factual attraction copy editor. Revise the complete heading and content. ${wordDirective} The active project instructions and saved rules below are authoritative and replace all legacy formatting, tone, entity, paragraph, heading, and guide-value assumptions. Preserve factual accuracy and do not invent verification.${instructionBlock(i)}\nAttraction/location: ${name}, ${i.city || ''}, ${i.country || ''}\nCurrent heading: ${i.current_heading || heading}\nCurrent copy: ${i.current_content || ''}\nManager request: ${i.user_prompt}\nResearch: ${JSON.stringify(i.research || {})}`;
      const parsed = await gemini(key, prompt, REFINE_SCHEMA); const finalHeading = cleanText(parsed.heading, 500) || heading; const content = normalize(parsed.content, i); return res.status(200).json({ ...parsed, heading: finalHeading, content, full_content: `${finalHeading}\n\n${content}`, word_count: countWords(content), quality_check: quality(finalHeading, content, name, wordRange, i) });
    }
    const prompt = `Create factual attraction copy and a compact research record. Attraction: ${name}; city: ${i.city || 'not supplied'}; country: ${i.country || 'not supplied'}; URL: ${i.attraction_url || 'none'}; notes: ${i.notes || 'none'}. ${wordDirective}${instructionBlock(i)}The returned heading and content must follow every active saved rule, including any edited rules for heading format, entities, structure, tone, audience, paragraphs, length, and guide value. Do not reintroduce deleted or superseded legacy rules. If the attraction cannot be identified, set identified false and explain. Do not claim live verification. Include only plausible official/authoritative source URLs and flag time-sensitive facts for verification.`;
    const parsed = await gemini(key, prompt, PROCESS_SCHEMA); if (!parsed.identified) return res.status(200).json({ status: 'needs_clarification', clarification_reason: parsed.clarification_reason || 'Insufficient attraction-specific information', heading: '', content: '', full_content: '', word_count: 0, research: parsed.research, quality_check: quality('', '', name, wordRange, i) });
    const finalHeading = cleanText(parsed.heading, 500) || heading; const content = normalize(parsed.content, i); return res.status(200).json({ status: 'complete', heading: finalHeading, content, full_content: `${finalHeading}\n\n${content}`, word_count: countWords(content), research: parsed.research, quality_check: quality(finalHeading, content, name, wordRange, i) });
  } catch (error) { return res.status(error?.name === 'TimeoutError' ? 504 : error?.status === 429 ? 429 : 500).json({ status: 'failed', error_message: error?.message || 'Attraction processing failed', error: error?.message || 'Attraction processing failed' }); }
}

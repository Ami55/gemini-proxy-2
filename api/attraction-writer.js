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

async function gemini(key, prompt, schema, timeout = 32000) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout), body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: schema } }) });
  const data = await response.json(); if (!response.ok) { const e = new Error(data?.error?.message || `Gemini HTTP ${response.status}`); e.status = response.status; throw e; }
  return JSON.parse((data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
}

const RULE_AUDIT = { type: 'ARRAY', items: { type: 'OBJECT', properties: { rule_title: { type: 'STRING' }, passed: { type: 'BOOLEAN' }, evidence: { type: 'STRING' } }, required: ['rule_title','passed','evidence'] } };
const STRING_ARRAY = { type: 'ARRAY', items: { type: 'STRING' } };
const CORE_ENTITIES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    place: { type: 'STRING' }, type: { type: 'STRING' }, key_periods: STRING_ARRAY,
    people: STRING_ARRAY, defining_features: STRING_ARRAY,
    religious_identity: { type: 'STRING' }, nearby_landmarks: STRING_ARRAY,
  },
  required: ['place','type','key_periods','people','defining_features','religious_identity','nearby_landmarks'],
};
const INFORMATION_GUIDE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    introduction_and_significance: { type: 'STRING' }, history: { type: 'STRING' },
    main_features: { type: 'STRING' }, what_to_look_for: { type: 'STRING' },
    stories_and_lesser_known_details: { type: 'STRING' }, planning_the_visit: { type: 'STRING' },
    combining_with_nearby_places: { type: 'STRING' }, value_of_a_private_guide: { type: 'STRING' },
  },
  required: ['introduction_and_significance','history','main_features','what_to_look_for','stories_and_lesser_known_details','planning_the_visit','combining_with_nearby_places','value_of_a_private_guide'],
};
const RESEARCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    attraction_type: { type: 'STRING' }, location_confirmed: { type: 'STRING' }, significance: { type: 'STRING' },
    core_entities: CORE_ENTITIES_SCHEMA, information_guide: INFORMATION_GUIDE_SCHEMA,
    standout_features: STRING_ARRAY, key_entities: STRING_ARRAY, guide_value_points: STRING_ARRAY,
    sources: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, url: { type: 'STRING' }, supported_facts: { type: 'STRING' } }, required: ['title','url','supported_facts'] } },
    confidence: { type: 'STRING' }, verification_notes: { type: 'STRING' },
  },
  required: ['attraction_type','location_confirmed','significance','core_entities','information_guide','standout_features','key_entities','guide_value_points','sources','confidence','verification_notes'],
};
const PROCESS_SCHEMA = { type: 'OBJECT', properties: { identified: { type: 'BOOLEAN' }, clarification_reason: { type: 'STRING' }, heading: { type: 'STRING' }, content: { type: 'STRING' }, rule_compliance: RULE_AUDIT, research: RESEARCH_SCHEMA }, required: ['identified','heading','content','rule_compliance','research'] };
const REFINE_SCHEMA = { type: 'OBJECT', properties: { assistant_message: { type: 'STRING' }, heading: { type: 'STRING' }, content: { type: 'STRING' }, changes_made: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['assistant_message','heading','content','changes_made'] };
const ENFORCE_SCHEMA = { type: 'OBJECT', properties: { heading: { type: 'STRING' }, content: { type: 'STRING' }, rule_compliance: RULE_AUDIT }, required: ['heading','content','rule_compliance'] };
const PROXY_VERSION = 'attraction-knowledge-brief-v6';
const activeRules = (input) => (Array.isArray(input.custom_rules) ? input.custom_rules : []).filter((rule) => cleanText(rule?.title) && cleanText(rule?.description)).map((rule) => ({ title: cleanText(rule.title, 160), description: cleanText(rule.description, 1200) }));
const rulesFingerprint = (input) => {
  const text = JSON.stringify({ instructions: cleanText(input.additional_instructions), rules: activeRules(input) });
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `rules-${(hash >>> 0).toString(16)}`;
};
const needsRevision = (parsed, input, wordRange) => {
  const words = countWords(parsed?.content || '');
  const wordFailure = Boolean(wordRange && (words < wordRange.min || words > wordRange.max));
  const audit = Array.isArray(parsed?.rule_compliance) ? parsed.rule_compliance : [];
  const semanticFailure = activeRules(input).length > 0 && (audit.length < activeRules(input).length || audit.some((rule) => !rule.passed));
  return wordFailure || semanticFailure;
};
async function enforceRules(key, parsed, input, name, wordDirective, wordRange) {
  if (!needsRevision(parsed, input, wordRange)) return { ...parsed, auto_revised: false };
  const prompt = `Rewrite this complete attraction heading and copy so it passes EVERY currently active rule. The active rules supersede all older/default rules. ${wordDirective}${instructionBlock(input)}\nReturn a rule_compliance entry for every saved rule, in the same order. Do not mark a rule passed unless the final text demonstrates it. Preserve only factual details already present in the draft or research.\nAttraction: ${name}\nResearch: ${JSON.stringify(parsed.research || input.existing_research || {})}\nDraft heading: ${parsed.heading || ''}\nDraft content: ${parsed.content || ''}`;
  try {
    const revised = await gemini(key, prompt, ENFORCE_SCHEMA, 22000);
    return { ...parsed, ...revised, auto_revised: true };
  } catch {
    return { ...parsed, auto_revised: false };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end(); const key = process.env.GEMINI_API_KEY || '';
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', apiKeyConfigured: Boolean(key), proxyVersion: PROXY_VERSION, dynamicRules: true });
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
    const prompt = `Create factual attraction copy and a detailed attraction knowledge brief. Attraction: ${name}; city: ${i.city || 'not supplied'}; country: ${i.country || 'not supplied'}; URL: ${i.attraction_url || 'none'}; notes: ${i.notes || 'none'}. ${wordDirective}${instructionBlock(i)}The returned heading and content must follow every active saved rule, including any edited rules for heading format, entities, structure, tone, audience, paragraphs, length, and guide value. Do not reintroduce deleted or superseded legacy rules. Separately complete every field in research.core_entities and research.information_guide. Cover the place, type, periods, people, defining features, religious identity where relevant, nearby landmarks, significance, history, main features, visible details to look for, verified stories or clearly labelled legends, stable visit-planning guidance, nearby combinations, and private-guide value. Do not use exact opening hours, ticket prices, temporary rules, or unsupported accessibility claims. If the attraction cannot be identified, set identified false and explain. Do not claim live verification. Include only plausible official/authoritative source URLs and flag time-sensitive facts for verification.`;
    const parsed = await gemini(key, prompt, PROCESS_SCHEMA); if (!parsed.identified) return res.status(200).json({ status: 'needs_clarification', clarification_reason: parsed.clarification_reason || 'Insufficient attraction-specific information', heading: '', content: '', full_content: '', word_count: 0, research: parsed.research, quality_check: quality('', '', name, wordRange, i), proxy_version: PROXY_VERSION, rules_fingerprint: rulesFingerprint(i), applied_rules: activeRules(i), active_word_range: wordRange });
    const enforced = await enforceRules(key, parsed, i, name, wordDirective, wordRange);
    const finalHeading = cleanText(enforced.heading, 500) || heading; const content = normalize(enforced.content, i); const checked = quality(finalHeading, content, name, wordRange, i); checked.auto_revised = Boolean(enforced.auto_revised);
    const failedRules = (Array.isArray(enforced.rule_compliance) ? enforced.rule_compliance : []).filter((rule) => !rule.passed);
    if (failedRules.length) {
      checked.issues_found.push(`Active rule(s) still need attention: ${failedRules.map((rule) => rule.rule_title).join(', ')}`);
      checked.passed = false;
      checked.score = Math.max(50, checked.score - failedRules.length * 8);
    }
    return res.status(200).json({ status: 'complete', heading: finalHeading, content, full_content: `${finalHeading}\n\n${content}`, word_count: countWords(content), research: enforced.research, quality_check: checked, rule_compliance: enforced.rule_compliance || [], proxy_version: PROXY_VERSION, rules_fingerprint: rulesFingerprint(i), applied_rules: activeRules(i), active_word_range: wordRange });
  } catch (error) { return res.status(error?.name === 'TimeoutError' ? 504 : error?.status === 429 ? 429 : 500).json({ status: 'failed', error_message: error?.message || 'Attraction processing failed', error: error?.message || 'Attraction processing failed' }); }
}

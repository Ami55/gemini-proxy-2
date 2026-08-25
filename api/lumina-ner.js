export const config = { maxDuration: 60 };

const MODEL = 'gemini-3.6-flash';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanJson(text = '') {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'ok', endpoint: 'lumina-ner', model: MODEL, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Text is required.' });
  if (text.length > 20000) return res.status(400).json({ error: 'Text is too long. Analyze no more than 20,000 characters at a time.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the proxy.' });

  const prompt = `Act as a Named Entity Recognition and sentiment-analysis engine. Preserve the exact original punctuation and spacing. Identify PERSON, ORGANIZATION, LOCATION, CONSUMER_GOOD, EVENT, NUMBER, PRICE, and OTHER entities. Choose the most specific supported type. Estimate salience from 0 to 1, optional entity sentiment from -1 to 1, overall sentiment from -1 to 1, and non-negative emotional magnitude.

Return only valid JSON shaped exactly like this:
{
 "annotated_text":"Original text with every recognized span wrapped as <entity type=\"PERSON\" id=\"1\">Name</entity>",
 "entities":[{"id":1,"text":"Name","type":"PERSON|ORGANIZATION|LOCATION|CONSUMER_GOOD|EVENT|NUMBER|PRICE|OTHER","salience":0.5,"sentiment":0}],
 "overall_sentiment":{"score":0,"magnitude":0}
}

Every tag id must match exactly one entities item. Do not add facts or rewrite the source text outside entity tags.

TEXT:
${text}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.05, maxOutputTokens: 6000 } })
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
    return res.status(500).json({ error: error?.message || 'NER analysis failed.' });
  }
}

export const config = { maxDuration: 60 };

const MODEL = "gemini-3.6-flash";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function cleanJson(text = "") {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", endpoint: "ai-visibility-auditor", model: MODEL, apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { domain, brandName, competitors = "", industry = "", country = "" } = req.body || {};
  if (!domain || typeof domain !== "string") return res.status(400).json({ error: "Domain URL is required." });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the proxy." });

  const brand = brandName || domain.replace(/https?:\/\/(www\.)?/i, "").split(".")[0];
  const prompt = `You are a rigorous AI Visibility and Generative Engine Optimization auditor. Analyze publicly discoverable web signals for this target. Never claim access to private indexes or that you directly queried ChatGPT, Claude, or Perplexity. Clearly distinguish observed evidence from inference. Return only valid JSON, without markdown.

TARGET
Domain: ${domain}
Brand: ${brand}
Industry: ${industry || "Not specified"}
Country: ${country || "Global"}
Competitors: ${competitors || "None specified"}

Return exactly this JSON structure. All scores are integers from 0 to 100:
{
 "domain":"string","brandName":"string","industry":"string","country":"string","scannedAt":"ISO date","overallScore":0,"grade":"A|B|C|D|F",
 "topStrengths":["5 items"],"topWeaknesses":["5 items"],"biggestOpportunities":["at least 3 items"],
 "visibilityPlatforms":{
  "chatgpt":{"name":"ChatGPT","score":0,"rating":"Strong|Moderate|Weak|Not Detected","explanation":"string","reasons":["at least 3"]},
  "gemini":{"name":"Gemini","score":0,"rating":"Strong|Moderate|Weak|Not Detected","explanation":"string","reasons":["at least 3"]},
  "claude":{"name":"Claude","score":0,"rating":"Strong|Moderate|Weak|Not Detected","explanation":"string","reasons":["at least 3"]},
  "perplexity":{"name":"Perplexity","score":0,"rating":"Strong|Moderate|Weak|Not Detected","explanation":"string","reasons":["at least 3"]},
  "googleAiOverviews":{"name":"Google AI Overviews","score":0,"rating":"Strong|Moderate|Weak|Not Detected","explanation":"string","reasons":["at least 3"]}
 },
 "entityScore":0,"entityStrengths":[],"entityMissing":[],"entityImprovements":[],
 "entitySignals":{
  "organizationSchema":{"name":"Organization Schema","status":"Detected|Partial|Missing","importance":"High|Medium|Low","description":"string"},
  "personSchema":{"name":"Person Schema","status":"Detected|Partial|Missing","importance":"High|Medium|Low","description":"string"},
  "sameAsLinks":{"name":"SameAs Links","status":"Detected|Partial|Missing","importance":"High|Medium|Low","description":"string"},
  "brandConsistency":{"name":"Brand Consistency","status":"Detected|Partial|Missing","importance":"High|Medium|Low","description":"string"},
  "wikidataPresence":{"name":"Wikidata Presence","status":"Detected|Partial|Missing","importance":"High|Medium|Low","description":"string"},
  "wikipediaPresence":{"name":"Wikipedia Presence","status":"Detected|Partial|Missing","importance":"High|Medium|Low","description":"string"},
  "knowledgeGraph":{"name":"Knowledge Graph","status":"Detected|Partial|Missing","importance":"High|Medium|Low","description":"string"}
 },
 "contentScore":0,"contentAnalysis":{
  "servicePages":{"name":"Service Pages","status":"Optimized|Needs Work|Absent","description":"string"},
  "categoryPages":{"name":"Category Pages","status":"Optimized|Needs Work|Absent","description":"string"},
  "aboutPage":{"name":"About Page","status":"Optimized|Needs Work|Absent","description":"string"},
  "faqContent":{"name":"FAQ Content","status":"Optimized|Needs Work|Absent","description":"string"},
  "authorPages":{"name":"Author Pages","status":"Optimized|Needs Work|Absent","description":"string"},
  "supportingContent":{"name":"Supporting Content","status":"Optimized|Needs Work|Absent","description":"string"}
 },
 "topicsCovered":[],"topicsMissing":[],"contentGaps":[],
 "authorityScore":0,"reviewSignals":[],"brandMentions":[],"industryCitations":[],"newsMentions":[],"socialSignals":[],"trustSignalsFound":[],"trustSignalsMissing":[],"mentionSources":[],
 "retrievalScore":0,"retrievalDetails":{"semanticHtml":"string","structuredData":"string","pageHierarchy":"string","internalLinking":"string","crawlability":"string","contentClarity":"string","informationArchitecture":"string"},
 "retrievalStrengths":[],"retrievalRecommendations":[],
 "technicalScore":0,"technicalDetails":{"implemented":[],"missing":[],"errors":[],"warnings":[]},
 "competitors":[{"name":"string","domain":"string","visibilityScore":0,"entityScore":0,"authorityScore":0,"contentScore":0}],
 "advantages":[],"disadvantages":[],"missedOpportunities":[],
 "roadmap":[{"id":"rm-1","title":"string","description":"string","priority":"High|Medium|Low","impact":"High|Medium|Low","difficulty":"Easy|Medium|Hard","estimatedGain":0,"module":"string"}],
 "trendData":[{"month":"Jan","current":0,"optimized":0},{"month":"Feb","current":0,"optimized":0},{"month":"Mar","current":0,"optimized":0},{"month":"Apr","current":0,"optimized":0},{"month":"May","current":0,"optimized":0},{"month":"Jun","current":0,"optimized":0}],
 "opportunityMatrix":[{"name":"string","difficulty":1,"impact":1,"priority":"High|Medium|Low"}]
}

Evaluate entity clarity, structured data, content citability, authority/trust, AI crawler access, retrieval readiness, and competitor gaps. Provide at least 6 actionable roadmap items. Difficulty and impact in opportunityMatrix must be 1-10.`;

  try {
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 12000 }
      })
    });
    const payload = await geminiResponse.json();
    if (!geminiResponse.ok) {
      const message = payload?.error?.message || `Gemini returned status ${geminiResponse.status}`;
      return res.status(geminiResponse.status === 429 ? 429 : 502).json({ error: message });
    }
    const output = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    if (!output) return res.status(502).json({ error: "Gemini returned an empty response." });
    return res.status(200).json({ report: JSON.parse(cleanJson(output)), isMock: false, hasKey: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || "Audit failed." });
  }
}

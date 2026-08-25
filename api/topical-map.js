import { GoogleGenAI } from '@google/genai';

export const config = { maxDuration: 60 };

const SYSTEM_INSTRUCTION = `You are a senior SEO strategist specializing in semantic SEO, website architecture, content gaps, keyword clustering, and topical maps.

Analyze only the business and domains supplied by the user. Preserve existing URL paths exactly when identifying existing pages. Create clean, lowercase, hyphenated URL slugs for recommended new pages. Never invent search volume, keyword difficulty, CPC, rankings, traffic, or verified crawl facts. Mark uncertain conclusions for review. Return JSON only.`;

function cleanDomain(value = '') {
  const trimmed = String(value).trim();
  if (!trimmed) return 'https://www.example.com';
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/\/$/, '') : `https://${trimmed.replace(/\/$/, '')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(result, project) {
  const domain = cleanDomain(project.websiteDomain);
  const keywords = asArray(result.keywords).map((item, index) => ({
    id: item.id || `kw_${index + 1}`,
    keyword: item.keyword || '',
    coreTopic: item.coreTopic || 'Core topic',
    subtopic: item.subtopic || 'General',
    mainEntity: item.mainEntity || project.projectName || 'Business',
    searchIntent: item.searchIntent || 'Informational',
    journeyStage: item.journeyStage || 'Awareness',
    pageType: item.pageType || 'Supporting Guide',
    businessRelevance: item.businessRelevance || 'Relevant',
    commercialValue: item.commercialValue || 'Medium',
    queryPattern: item.queryPattern || 'Other',
    source: item.source || 'business_model',
    searchVolume: 'Data unavailable',
    keywordDifficulty: 'Data unavailable',
    cpc: 'Data unavailable',
    ...item,
    searchVolume: 'Data unavailable',
    keywordDifficulty: 'Data unavailable',
    cpc: 'Data unavailable'
  }));

  const existingPages = asArray(result.existingPages).map((page, index) => ({
    id: page.id || `page_${index + 1}`,
    url: page.url || `${domain}/`,
    title: page.title || 'Website page',
    h1: page.h1 || page.title || 'Website page',
    metaDescription: page.metaDescription || 'Needs review',
    canonicalUrl: page.canonicalUrl || page.url || `${domain}/`,
    pageType: page.pageType || 'Landing page',
    mainTopic: page.mainTopic || 'Core topic',
    likelySearchIntent: page.likelySearchIntent || 'Mixed',
    mainEntities: asArray(page.mainEntities),
    parentSection: page.parentSection || 'Root',
    indexability: page.indexability || 'Indexable',
    httpStatus: Number(page.httpStatus) || 200,
    source: page.source || 'crawl'
  }));

  return {
    project: { ...project, websiteDomain: domain },
    businessProfile: result.businessProfile || {
      coreBusinessEntity: project.projectName || 'Business',
      mainProductsServices: [], primaryAudience: project.targetAudience || '', customerProblems: [],
      customerJourney: { awareness: [], consideration: [], decision: [], retention: [] },
      commercialTopics: [], informationalTopics: [], locationRelatedTopics: [], outsideScopeTopics: []
    },
    existingPages,
    competitors: asArray(result.competitors),
    keywords,
    clusters: asArray(result.clusters),
    mappings: asArray(result.mappings),
    gaps: asArray(result.gaps),
    topicalMap: asArray(result.topicalMap),
    updatedAt: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const project = req.body?.input || req.body?.project || req.body;
    if (!project?.websiteDomain || !project?.businessDescription) {
      return res.status(400).json({ error: 'websiteDomain and businessDescription are required.' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in gemini-proxy-2.' });
    }

    const domain = cleanDomain(project.websiteDomain);
    const prompt = `Create a compact but actionable topical-map and content-gap analysis for this project:\n${JSON.stringify({ ...project, websiteDomain: domain })}\n\nReturn one JSON object with these top-level keys: businessProfile, existingPages, competitors, keywords, clusters, mappings, gaps, topicalMap.\n\nRequirements:\n- businessProfile: coreBusinessEntity, mainProductsServices[], primaryAudience, customerProblems[], customerJourney{awareness[],consideration[],decision[],retention[]}, commercialTopics[], informationalTopics[], locationRelatedTopics[], outsideScopeTopics[].\n- existingPages: 6-10 objects with id,url,title,h1,metaDescription,canonicalUrl,pageType,mainTopic,likelySearchIntent,mainEntities[],parentSection,indexability,httpStatus,source. Preserve supplied/current domain and plausible existing slugs; label uncertain inventory in text rather than claiming a verified crawl.\n- competitors: one object per supplied competitor with domain,importantSections[],discoveredPagesCount,samplePages[],repeatedTopicPatterns[],commercialPageTypes[],informationalPageTypes[],locationCategoryStructures[],extractedTopics[],uniqueTopics[]. Use 0 for discoveredPagesCount when unverified.\n- keywords: 20-30 objects with id,keyword,coreTopic,subtopic,mainEntity,searchIntent,journeyStage,pageType,businessRelevance,commercialValue,location,queryPattern,source,competitorSource. Do not include numeric SEO metrics.\n- clusters: 6-10 objects with id,clusterName,primaryKeyword,secondaryKeywords[],coreTopic,subtopic,searchIntent,recommendedPageType,journeyStage,businessRelevance,reasonForGrouping,confidence.\n- mappings: one per cluster with id,clusterId,clusterName,primaryKeyword,secondaryKeywords[],existingPageId,existingUrl,existingPageTitle,mappingStrength,matchExplanation,recommendedAction,confidence,competingPages[].\n- gaps: 5-8 objects with id,gapName,topic,keywordClusterId,clusterName,primaryKeyword,competitorsCovering[],competitorExampleUrls[],userClosestExistingPageUrl,userClosestExistingPageTitle,gapType,businessRelevance,recommendedPageType,suggestedAction,priority,evidence,confidence,isDismissed.\n- topicalMap: 8-12 objects with id,pageName,pageRole,parentTopic,primaryKeyword,secondaryKeywords[],searchIntent,recommendedPageType,status,isExisting,existingUrl,suggestedUrl,competitorsCovering[],priority,recommendedAction,clusterId,childPageIds[],internalLinks[],notes.\n- Each internalLinks item needs sourcePageId,targetPageId,targetPageName,targetUrl,linkRelationship,suggestedAnchorText[],reasonForLink.\n- suggestedUrl must be a full URL on ${domain}, retain relevant existing slugs, and use clean lowercase hyphenated slugs for new pages.\n- Allowed labels must match the application: SearchIntent = Informational|Commercial investigation|Transactional|Navigational|Local|Mixed; JourneyStage = Awareness|Consideration|Decision|Retention; confidence = High|Medium|Needs review; priority = High|Medium|Low.\nReturn JSON only.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const generation = ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        temperature: 0.35,
        maxOutputTokens: 12000
      }
    });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini analysis timed out. Please retry.')), 50000));
    const response = await Promise.race([generation, timeout]);
    const text = response?.text?.trim();
    if (!text) throw new Error('Gemini returned an empty analysis.');

    const parsed = JSON.parse(text);
    return res.status(200).json(normalize(parsed, project));
  } catch (error) {
    console.error('Topical map proxy error:', error);
    return res.status(500).json({ error: error?.message || 'Topical map analysis failed.' });
  }
}

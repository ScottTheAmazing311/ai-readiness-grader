import * as cheerio from 'cheerio';
import { crawlSite, type CrawlResult } from './cloudflare-crawl';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
export interface CheckResult {
  name: string;
  category: string;
  passed: boolean;
  score: number;
  maxPoints: number;
  detail: string;
  techDetail: string;
}

export interface CategoryScore {
  name: string;
  score: number;
  maxPoints: number;
  percentage: number;
  checks: CheckResult[];
}

export interface ScanResult {
  url: string;
  domain: string;
  overallScore: number;
  grade: string;
  gradeLabel: string;
  categories: {
    discoverability: CategoryScore;
    contentClarity: CategoryScore;
    structuredData: CategoryScore;
    technicalAccessibility: CategoryScore;
    advancedSignals: CategoryScore;
  };
  totalChecks: number;
  passedChecks: number;
  scanDurationMs: number;
  pagesScanned: number;
  errors: string[];
  crawlEnhanced: boolean;
  crawlPagesUsed: number;
}

interface FetchedResource {
  content: string | null;
  status: number | null;
  headers: Record<string, string>;
  error: string | null;
}

interface ParsedPage {
  url: string;
  html: string;
  $: cheerio.CheerioAPI;
  title: string;
  metaDescription: string;
  headings: { tag: string; text: string }[];
  bodyText: string;
  navLinks: { text: string; href: string }[];
  jsonLd: any[];
  textToHtmlRatio: number;
  hasMain: boolean;
  hasArticle: boolean;
  hasNav: boolean;
  hasSection: boolean;
  hasViewport: boolean;
  htmlSize: number;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  canonical: string;
  contactPhone: string | null;
  contactAddress: string | null;
}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_RESPONSE_BYTES = 1_000_000;

// ═══════════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════════
async function fetchResource(url: string, timeoutMs = 8000, extraHeaders: Record<string, string> = {}): Promise<FetchedResource> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders,
      },
      redirect: 'follow',
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const reader = response.body?.getReader();
    if (!reader) return { content: null, status: response.status, headers, error: 'No response body' };

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        chunks.push(value.slice(0, MAX_RESPONSE_BYTES - (totalBytes - value.byteLength)));
        reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    return { content: decoder.decode(Buffer.concat(chunks)), status: response.status, headers, error: null };
  } catch (err: any) {
    return { content: null, status: null, headers: {}, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

function parsePage(html: string, url: string): ParsedPage {
  const $ = cheerio.load(html);
  const htmlSize = html.length;

  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

  const headings: { tag: string; text: string }[] = [];
  $('h1, h2, h3, h4, h5, h6').each((i, el) => {
    if (headings.length >= 40) return false;
    const tag = (el as any).tagName || $(el).prop('tagName')?.toLowerCase() || '';
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text) headings.push({ tag: tag.toLowerCase(), text });
  });

  // JSON-LD
  const jsonLd: any[] = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const raw = $(el).html();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          jsonLd.push(...parsed);
        } else {
          jsonLd.push(parsed);
        }
      }
    } catch { /* skip */ }
  });

  // Semantic HTML checks
  const hasMain = $('main').length > 0;
  const hasArticle = $('article').length > 0;
  const hasNav = $('nav').length > 0;
  const hasSection = $('section').length > 0;
  const hasViewport = !!$('meta[name="viewport"][content*="width"]').attr('content');

  // OG tags
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
  const ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || '';
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim() || '';
  const canonical = $('link[rel="canonical"]').attr('href')?.trim() || '';

  // Nav links
  const navLinks: { text: string; href: string }[] = [];
  $('a[href]').each((i, el) => {
    if (navLinks.length >= 40) return false;
    const href = $(el).attr('href');
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (!href || !text) return;
    try {
      const resolved = new URL(href, url).toString();
      navLinks.push({ text, href: resolved });
    } catch { /* skip */ }
  });

  // Body text for content analysis
  const $bodyClone = cheerio.load(html);
  $bodyClone('script, style, nav, footer, header, noscript, iframe, svg').remove();
  const bodyText = $bodyClone('body').text().replace(/\s+/g, ' ').trim();

  // Text to HTML ratio
  const textLen = bodyText.length;
  const textToHtmlRatio = htmlSize > 0 ? (textLen / htmlSize) * 100 : 0;

  // Contact info extraction
  const phoneRegex = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const phoneMatch = bodyText.match(phoneRegex) || html.match(phoneRegex);
  const contactPhone = phoneMatch ? phoneMatch[0] : null;

  const addressRegex = /\d+\s+[\w\s]+(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|suite|ste|floor|fl)[\s.,]+[\w\s]+,?\s*[A-Z]{2}\s*\d{5}/i;
  const addressMatch = bodyText.match(addressRegex);
  const contactAddress = addressMatch ? addressMatch[0] : null;

  return {
    url, html, $, title, metaDescription, headings, bodyText, navLinks, jsonLd,
    textToHtmlRatio, hasMain, hasArticle, hasNav, hasSection, hasViewport,
    htmlSize, ogTitle, ogDescription, ogImage, canonical, contactPhone, contactAddress
  };
}

// ═══════════════════════════════════════════════════════════
// SUBPAGE DISCOVERY
// ═══════════════════════════════════════════════════════════
const PA_KEYWORDS = [
  'personal-injury', 'car-accident', 'truck-accident', 'motorcycle-accident',
  'slip-and-fall', 'wrongful-death', 'medical-malpractice', 'brain-injury',
  'practice-area', 'practice_area', 'areas-of-practice',
];
const ATTORNEY_KEYWORDS = ['attorney', 'lawyer', 'team', 'about', 'our-firm', 'professionals', 'people'];

function discoverSubpages(homepage: ParsedPage, baseUrl: string): { practiceArea: string[]; attorney: string[] } {
  const base = new URL(baseUrl);
  const practiceArea: string[] = [];
  const attorney: string[] = [];
  const seen = new Set<string>();

  for (const link of homepage.navLinks) {
    try {
      const linkUrl = new URL(link.href);
      if (linkUrl.hostname !== base.hostname) continue;
      if (linkUrl.pathname === '/' || linkUrl.pathname === '') continue;
      if (linkUrl.pathname.match(/\.(pdf|jpg|png|gif|svg|css|js|zip)$/i)) continue;

      const normalized = linkUrl.origin + linkUrl.pathname.replace(/\/$/, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const pathLower = linkUrl.pathname.toLowerCase() + ' ' + link.text.toLowerCase();

      const isPa = PA_KEYWORDS.some(k => pathLower.includes(k));
      const isAtty = ATTORNEY_KEYWORDS.some(k => pathLower.includes(k));

      if (isPa && practiceArea.length < 3) practiceArea.push(normalized);
      else if (isAtty && attorney.length < 1) attorney.push(normalized);
    } catch { /* skip */ }
  }

  // Fallback: try common paths
  if (practiceArea.length === 0) {
    practiceArea.push(base.origin + '/practice-areas');
  }
  if (attorney.length === 0) {
    attorney.push(base.origin + '/attorneys');
    attorney.push(base.origin + '/about');
  }

  return { practiceArea, attorney };
}

// ═══════════════════════════════════════════════════════════
// SCORING ENGINE
// ═══════════════════════════════════════════════════════════
function gradeFromScore(score: number): { grade: string; label: string } {
  if (score >= 85) return { grade: 'A+', label: 'AI-Ready Leader' };
  if (score >= 70) return { grade: 'A', label: 'Strong Foundation' };
  if (score >= 55) return { grade: 'B', label: 'Needs Improvement' };
  if (score >= 35) return { grade: 'C', label: 'Significant Gaps' };
  return { grade: 'F', label: 'Invisible to AI' };
}

// ═══════════════════════════════════════════════════════════
// CHECK FUNCTIONS
// ═══════════════════════════════════════════════════════════

// ── 1. AI Discoverability (30 points) ──
function checkRobotsTxt(robotsTxt: FetchedResource): CheckResult {
  const maxPoints = 10;
  if (!robotsTxt.content || robotsTxt.status !== 200) {
    return {
      name: 'robots.txt AI Policy', category: 'discoverability', passed: false,
      score: 6, maxPoints,
      detail: 'No robots.txt found. AI crawlers have no explicit guidance for your site.',
      techDetail: 'Create a robots.txt file at your domain root. Ensure GPTBot, ClaudeBot, and PerplexityBot are not disallowed.'
    };
  }

  const content = robotsTxt.content.toLowerCase();
  const aiAgents = ['gptbot', 'claudebot', 'perplexitybot', 'bytespider', 'chatgpt-user', 'anthropic-ai'];
  const blocked: string[] = [];

  for (const agent of aiAgents) {
    const agentSection = content.match(new RegExp(`user-agent:\\s*${agent}[\\s\\S]*?(?=user-agent:|$)`, 'i'));
    if (agentSection && agentSection[0].includes('disallow: /')) {
      blocked.push(agent);
    }
  }

  // Check for blanket disallow
  const blanketBlock = content.match(/user-agent:\s*\*[\s\S]*?(?=user-agent:|$)/i);
  const hasBlanketDisallow = blanketBlock && blanketBlock[0].includes('disallow: /') && !blanketBlock[0].match(/disallow:\s*\/\s*$/m);

  if (blocked.length > 0) {
    return {
      name: 'robots.txt AI Policy', category: 'discoverability', passed: false,
      score: 2, maxPoints,
      detail: `Your robots.txt blocks ${blocked.join(', ')}. These AI systems cannot crawl your site.`,
      techDetail: `Remove or modify Disallow rules for: ${blocked.join(', ')}. AI bots need access to index your content.`
    };
  }

  if (hasBlanketDisallow) {
    return {
      name: 'robots.txt AI Policy', category: 'discoverability', passed: false,
      score: 3, maxPoints,
      detail: 'Your robots.txt has a blanket disallow that may block AI crawlers.',
      techDetail: 'Your wildcard User-agent: * rule may block AI bots. Add explicit Allow rules for GPTBot and ClaudeBot.'
    };
  }

  return {
    name: 'robots.txt AI Policy', category: 'discoverability', passed: true,
    score: maxPoints, maxPoints,
    detail: 'AI crawlers are allowed to access your site. No blocking rules detected.',
    techDetail: 'robots.txt is properly configured for AI crawler access.'
  };
}

function checkSitemap(sitemapResource: FetchedResource, robotsTxt: FetchedResource): CheckResult {
  const maxPoints = 5;

  // Check if sitemap is referenced in robots.txt
  let sitemapUrl = '';
  if (robotsTxt.content) {
    const match = robotsTxt.content.match(/sitemap:\s*(.+)/i);
    if (match) sitemapUrl = match[1].trim();
  }

  if (sitemapResource.content && sitemapResource.status === 200) {
    const hasUrls = sitemapResource.content.includes('<url>') || sitemapResource.content.includes('<loc>');
    if (hasUrls) {
      return {
        name: 'XML Sitemap', category: 'discoverability', passed: true,
        score: maxPoints, maxPoints,
        detail: 'Valid XML sitemap found with page URLs. AI crawlers can discover all your content.',
        techDetail: 'Sitemap is accessible and contains URL entries.'
      };
    }
  }

  if (sitemapUrl) {
    return {
      name: 'XML Sitemap', category: 'discoverability', passed: false,
      score: 2, maxPoints,
      detail: 'Sitemap is referenced in robots.txt but could not be loaded or parsed.',
      techDetail: `Sitemap URL in robots.txt: ${sitemapUrl} — verify it returns valid XML.`
    };
  }

  return {
    name: 'XML Sitemap', category: 'discoverability', passed: false,
    score: 0, maxPoints,
    detail: 'No XML sitemap found. AI crawlers may miss important pages on your site.',
    techDetail: 'Create a sitemap.xml at your domain root and reference it in robots.txt.'
  };
}

function checkMetaDescription(page: ParsedPage): CheckResult {
  const maxPoints = 5;
  if (page.metaDescription && page.metaDescription.length > 50) {
    return {
      name: 'Meta Descriptions', category: 'discoverability', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Homepage has a substantive meta description that helps AI understand your firm.',
      techDetail: `Meta description: "${page.metaDescription.slice(0, 100)}..."`
    };
  }
  if (page.metaDescription && page.metaDescription.length > 0) {
    return {
      name: 'Meta Descriptions', category: 'discoverability', passed: false,
      score: 2, maxPoints,
      detail: 'Meta description exists but is too short to be useful for AI summarization.',
      techDetail: `Current meta description is only ${page.metaDescription.length} characters. Aim for 120-160 characters.`
    };
  }
  return {
    name: 'Meta Descriptions', category: 'discoverability', passed: false,
    score: 0, maxPoints,
    detail: 'No meta description found. AI systems have no summary to work with when describing your firm.',
    techDetail: 'Add a <meta name="description"> tag to your homepage with 120-160 characters describing your firm.'
  };
}

function checkOpenGraph(page: ParsedPage): CheckResult {
  const maxPoints = 4;
  const hasTitle = !!page.ogTitle;
  const hasDesc = !!page.ogDescription;
  const hasImage = !!page.ogImage;
  const count = [hasTitle, hasDesc, hasImage].filter(Boolean).length;

  if (count >= 2) {
    return {
      name: 'OpenGraph Tags', category: 'discoverability', passed: true,
      score: maxPoints, maxPoints,
      detail: 'OpenGraph tags present — AI and social platforms can represent your firm accurately.',
      techDetail: `Found: ${[hasTitle && 'og:title', hasDesc && 'og:description', hasImage && 'og:image'].filter(Boolean).join(', ')}`
    };
  }
  if (count === 1) {
    return {
      name: 'OpenGraph Tags', category: 'discoverability', passed: false,
      score: 2, maxPoints,
      detail: 'Partial OpenGraph tags found. Missing tags reduce how well AI represents your firm.',
      techDetail: `Missing: ${[!hasTitle && 'og:title', !hasDesc && 'og:description', !hasImage && 'og:image'].filter(Boolean).join(', ')}`
    };
  }
  return {
    name: 'OpenGraph Tags', category: 'discoverability', passed: false,
    score: 0, maxPoints,
    detail: 'No OpenGraph tags found. AI and social platforms cannot properly preview your firm.',
    techDetail: 'Add og:title, og:description, and og:image meta tags to your homepage.'
  };
}

function checkCanonical(page: ParsedPage): CheckResult {
  const maxPoints = 4;
  if (page.canonical) {
    return {
      name: 'Canonical URLs', category: 'discoverability', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Canonical URL set — prevents AI from seeing duplicate content.',
      techDetail: `Canonical: ${page.canonical}`
    };
  }
  return {
    name: 'Canonical URLs', category: 'discoverability', passed: false,
    score: 0, maxPoints,
    detail: 'No canonical URL found. AI may treat duplicate pages as separate content, diluting your authority.',
    techDetail: 'Add <link rel="canonical" href="..."> to each page pointing to the preferred URL.'
  };
}

function checkHeadingHierarchy(page: ParsedPage): CheckResult {
  const maxPoints = 4;
  const h1s = page.headings.filter(h => h.tag === 'h1');
  const h2s = page.headings.filter(h => h.tag === 'h2');
  const h3s = page.headings.filter(h => h.tag === 'h3');

  if (h1s.length === 1 && h2s.length >= 1) {
    const hasH3 = h3s.length > 0;
    return {
      name: 'Heading Hierarchy', category: 'discoverability', passed: true,
      score: hasH3 ? maxPoints : maxPoints - 1, maxPoints,
      detail: 'Clean heading structure. AI can parse your content hierarchy effectively.',
      techDetail: `Found: ${h1s.length} h1, ${h2s.length} h2, ${h3s.length} h3 — ${hasH3 ? 'proper nesting' : 'add h3s for deeper structure'}`
    };
  }
  if (h1s.length > 1) {
    return {
      name: 'Heading Hierarchy', category: 'discoverability', passed: false,
      score: 1, maxPoints,
      detail: `Multiple h1 tags (${h1s.length}) found. AI gets confused about what your page is primarily about.`,
      techDetail: 'Use exactly one h1 per page. Demote extra h1s to h2 or h3.'
    };
  }
  if (h1s.length === 0) {
    return {
      name: 'Heading Hierarchy', category: 'discoverability', passed: false,
      score: 0, maxPoints,
      detail: 'No h1 tag found. AI cannot determine the primary topic of your page.',
      techDetail: 'Add a single h1 tag that clearly states your firm name and primary practice area.'
    };
  }
  return {
    name: 'Heading Hierarchy', category: 'discoverability', passed: false,
    score: 2, maxPoints,
    detail: 'Heading structure is incomplete. AI may struggle to outline your content.',
    techDetail: `Found: ${h1s.length} h1, ${h2s.length} h2 — add h2/h3 subheadings for better structure.`
  };
}

// ── 2. Content Clarity for AI (25 points) ──
function checkFirmIdentity(page: ParsedPage): CheckResult {
  const maxPoints = 8;
  const text = (page.bodyText + ' ' + page.title + ' ' + page.metaDescription).toLowerCase();
  const first500 = text.slice(0, 2000).toLowerCase();

  const hasLawFirmType = /(?:law\s*firm|attorney|lawyer|legal|counsel)/i.test(first500);
  const hasLocation = /(?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)?),?\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)/i.test(text);
  const hasPracticeArea = /(?:personal\s*injury|car\s*accident|truck|medical\s*malpractice|wrongful\s*death|slip\s*and\s*fall|workers?\s*comp|criminal\s*defense|family\s*law|immigration|corporate|real\s*estate|employment|bankruptcy|estate\s*planning|intellectual\s*property)/i.test(text);

  const signals = [hasLawFirmType, hasLocation, hasPracticeArea].filter(Boolean).length;

  if (signals === 3) {
    return {
      name: 'Firm Identity Clarity', category: 'contentClarity', passed: true,
      score: maxPoints, maxPoints,
      detail: 'AI can clearly identify who you are, where you are, and what you do.',
      techDetail: 'Firm type, location, and practice area(s) are identifiable in page text.'
    };
  }
  if (signals === 2) {
    return {
      name: 'Firm Identity Clarity', category: 'contentClarity', passed: false,
      score: 4, maxPoints,
      detail: 'AI can partially identify your firm but is missing key information.',
      techDetail: `Found: ${[hasLawFirmType && 'firm type', hasLocation && 'location', hasPracticeArea && 'practice area'].filter(Boolean).join(', ')}. Missing: ${[!hasLawFirmType && 'firm type', !hasLocation && 'location', !hasPracticeArea && 'practice area'].filter(Boolean).join(', ')}`
    };
  }
  return {
    name: 'Firm Identity Clarity', category: 'contentClarity', passed: false,
    score: signals * 2, maxPoints,
    detail: 'AI cannot reliably describe your firm. Key identity signals are missing from your text content.',
    techDetail: 'Ensure your firm name, city/state, and primary practice area appear in the first 500 words of your homepage.'
  };
}

function checkAttorneyProfiles(pages: ParsedPage[]): CheckResult {
  const maxPoints = 6;
  const allText = pages.map(p => p.bodyText).join(' ');
  const hasAttorneyPage = pages.some(p =>
    /attorney|lawyer|team|about|people/i.test(p.url) && p.bodyText.length > 200
  );

  const namePatterns = allText.match(/(?:attorney|esq|j\.d\.|partner|associate|of counsel)/gi);
  const hasCredentials = namePatterns && namePatterns.length >= 1;

  if (hasAttorneyPage && hasCredentials) {
    return {
      name: 'Attorney Profiles', category: 'contentClarity', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Attorney profiles found with credentials. AI can identify your legal team.',
      techDetail: 'Attorney/team page detected with name and credential mentions.'
    };
  }
  if (hasAttorneyPage || hasCredentials) {
    return {
      name: 'Attorney Profiles', category: 'contentClarity', passed: false,
      score: 3, maxPoints,
      detail: 'Some attorney information found, but profiles lack depth for AI to fully describe your team.',
      techDetail: 'Add detailed attorney bios with names, titles, credentials, and practice focus.'
    };
  }
  return {
    name: 'Attorney Profiles', category: 'contentClarity', passed: false,
    score: 0, maxPoints,
    detail: 'No attorney profiles found. When AI is asked about your lawyers, it has nothing to reference.',
    techDetail: 'Create individual attorney pages with name, credentials, practice areas, and bio in crawlable text.'
  };
}

function checkPracticeAreaPages(pages: ParsedPage[]): CheckResult {
  const maxPoints = 6;
  const practicePages = pages.filter(p =>
    /practice|service|area|injury|accident|law\b/i.test(p.url) &&
    p.bodyText.length > 400
  );

  if (practicePages.length >= 3) {
    return {
      name: 'Practice Area Pages', category: 'contentClarity', passed: true,
      score: maxPoints, maxPoints,
      detail: `${practicePages.length} substantive practice area pages found. AI can accurately categorize your services.`,
      techDetail: `Practice area pages: ${practicePages.map(p => p.url).join(', ')}`
    };
  }
  if (practicePages.length >= 1) {
    return {
      name: 'Practice Area Pages', category: 'contentClarity', passed: false,
      score: 3, maxPoints,
      detail: `Only ${practicePages.length} practice area page(s) with enough content. AI needs more to fully understand your services.`,
      techDetail: 'Create dedicated pages with 200+ words for each practice area. Each should have unique, substantive content.'
    };
  }
  return {
    name: 'Practice Area Pages', category: 'contentClarity', passed: false,
    score: 0, maxPoints,
    detail: 'No substantive practice area pages found. AI cannot determine what legal services you offer.',
    techDetail: 'Create individual pages for each practice area with at least 200 words of unique content per page.'
  };
}

function checkContactInfo(page: ParsedPage): CheckResult {
  const maxPoints = 3;
  const hasPhone = !!page.contactPhone;
  const hasAddress = !!page.contactAddress;

  if (hasPhone && hasAddress) {
    return {
      name: 'Contact Info in Text', category: 'contentClarity', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Phone and address found in crawlable text. AI can direct potential clients to you.',
      techDetail: `Phone: ${page.contactPhone}, Address detected in HTML text.`
    };
  }
  if (hasPhone || hasAddress) {
    return {
      name: 'Contact Info in Text', category: 'contentClarity', passed: false,
      score: 2, maxPoints,
      detail: `${hasPhone ? 'Phone' : 'Address'} found but ${hasPhone ? 'address' : 'phone'} is missing from crawlable text.`,
      techDetail: 'Ensure both phone number and street address appear as text in HTML, not just images or JavaScript-rendered content.'
    };
  }
  return {
    name: 'Contact Info in Text', category: 'contentClarity', passed: false,
    score: 0, maxPoints,
    detail: 'No contact info found in text. AI cannot tell people how to reach your firm.',
    techDetail: 'Add phone number and street address as plain text in your HTML — not only in images or dynamically loaded content.'
  };
}

function checkServiceArea(page: ParsedPage): CheckResult {
  const maxPoints = 3;
  const text = page.bodyText.toLowerCase();
  const stateRegex = /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new\s*hampshire|new\s*jersey|new\s*mexico|new\s*york|north\s*carolina|north\s*dakota|ohio|oklahoma|oregon|pennsylvania|rhode\s*island|south\s*carolina|south\s*dakota|tennessee|texas|utah|vermont|virginia|washington|west\s*virginia|wisconsin|wyoming)\b/i;
  const cityAreaRegex = /(?:serving|located\s+in|based\s+in|offices?\s+in|throughout|across)\s+[\w\s,]+/i;

  const hasState = stateRegex.test(text);
  const hasCityArea = cityAreaRegex.test(text);

  if (hasState && hasCityArea) {
    return {
      name: 'Service Area Definition', category: 'contentClarity', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Geographic service area clearly stated. AI knows where you practice.',
      techDetail: 'State and city/region references found in content.'
    };
  }
  if (hasState || hasCityArea) {
    return {
      name: 'Service Area Definition', category: 'contentClarity', passed: false,
      score: 2, maxPoints,
      detail: 'Some geographic info found, but service area definition is incomplete.',
      techDetail: 'Explicitly state your city, state, and service region (e.g., "Serving the greater Dallas-Fort Worth area").'
    };
  }
  return {
    name: 'Service Area Definition', category: 'contentClarity', passed: false,
    score: 0, maxPoints,
    detail: 'No geographic service area found. When AI is asked for a lawyer "near me," it can\'t include you.',
    techDetail: 'Add clear geographic references: city, state, and service region in your page content.'
  };
}

// ── 3. Structured Data & Schema (25 points) ──
function checkLegalSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 10;
  const allJsonLd = pages.flatMap(p => p.jsonLd);

  const legalTypes = ['Attorney', 'LegalService', 'LocalBusiness', 'LawFirm', 'ProfessionalService', 'Organization'];
  const found = allJsonLd.filter(item => {
    const type = item?.['@type'];
    if (Array.isArray(type)) return type.some((t: string) => legalTypes.includes(t));
    return legalTypes.includes(type);
  });

  if (found.length > 0) {
    const types = found.map(f => Array.isArray(f['@type']) ? f['@type'].join(', ') : f['@type']);
    return {
      name: 'Legal Business Schema', category: 'structuredData', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Legal business schema found. AI can accurately classify your firm.',
      techDetail: `Schema types found: ${[...new Set(types)].join(', ')}`
    };
  }

  // Check for any schema at all
  if (allJsonLd.length > 0) {
    return {
      name: 'Legal Business Schema', category: 'structuredData', passed: false,
      score: 3, maxPoints,
      detail: 'Some structured data found but no legal-specific schema. AI may misclassify your business.',
      techDetail: 'Add JSON-LD with @type of Attorney, LegalService, or LocalBusiness including name, address, and practice areas.'
    };
  }

  return {
    name: 'Legal Business Schema', category: 'structuredData', passed: false,
    score: 0, maxPoints,
    detail: 'No structured data at all. AI has to guess what your business is — and it often guesses wrong.',
    techDetail: 'Add a JSON-LD block with @type: "Attorney" or "LegalService" including name, URL, address, and areaServed.'
  };
}

function checkOrganizationSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 4;
  const allJsonLd = pages.flatMap(p => p.jsonLd);
  const org = allJsonLd.find(item => {
    const type = item?.['@type'];
    return type === 'Organization' || type === 'LocalBusiness' || type === 'LegalService' || type === 'Attorney';
  });

  if (org && org.name && org.url) {
    const hasLogo = !!org.logo;
    return {
      name: 'Organization Schema', category: 'structuredData', passed: true,
      score: hasLogo ? maxPoints : maxPoints - 1, maxPoints,
      detail: `Organization schema with name and URL${hasLogo ? ' and logo' : ''}. AI knows your official identity.`,
      techDetail: `Organization: ${org.name} — ${org.url}${hasLogo ? ' (logo included)' : ' (add logo for full credit)'}`
    };
  }
  return {
    name: 'Organization Schema', category: 'structuredData', passed: false,
    score: 0, maxPoints,
    detail: 'No Organization schema found. AI cannot confirm your official firm name, URL, or logo.',
    techDetail: 'Add JSON-LD Organization schema with name, url, and logo properties.'
  };
}

function checkFaqSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 4;
  const allJsonLd = pages.flatMap(p => p.jsonLd);
  const faq = allJsonLd.find(item => item?.['@type'] === 'FAQPage');

  if (faq && faq.mainEntity && faq.mainEntity.length >= 2) {
    return {
      name: 'FAQ Schema', category: 'structuredData', passed: true,
      score: maxPoints, maxPoints,
      detail: `FAQ schema found with ${faq.mainEntity.length} questions. AI can answer common questions about your firm directly.`,
      techDetail: `FAQPage schema with ${faq.mainEntity.length} Q&A pairs detected.`
    };
  }
  if (faq) {
    return {
      name: 'FAQ Schema', category: 'structuredData', passed: false,
      score: 2, maxPoints,
      detail: 'FAQ schema found but needs more Q&A pairs to be useful.',
      techDetail: 'Add at least 2 Q&A pairs to your FAQPage schema for AI to reference.'
    };
  }
  return {
    name: 'FAQ Schema', category: 'structuredData', passed: false,
    score: 0, maxPoints,
    detail: 'No FAQ schema. When someone asks AI a question about your practice area, you miss the chance to be the source.',
    techDetail: 'Add FAQPage JSON-LD schema with common questions about your practice areas and services.'
  };
}

function checkReviewSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 3;
  const allJsonLd = pages.flatMap(p => p.jsonLd);

  const hasReview = allJsonLd.some(item =>
    item?.['@type'] === 'AggregateRating' ||
    item?.['@type'] === 'Review' ||
    item?.aggregateRating ||
    item?.review
  );

  if (hasReview) {
    return {
      name: 'Review/Rating Schema', category: 'structuredData', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Review or rating schema found. AI can cite your reputation when recommending firms.',
      techDetail: 'AggregateRating or Review schema detected in structured data.'
    };
  }
  return {
    name: 'Review/Rating Schema', category: 'structuredData', passed: false,
    score: 0, maxPoints,
    detail: 'No review schema. AI has no structured reputation data to factor into recommendations.',
    techDetail: 'Add AggregateRating schema with your Google/Avvo rating and review count.'
  };
}

function checkBreadcrumbSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 3;
  const allJsonLd = pages.flatMap(p => p.jsonLd);
  const breadcrumb = allJsonLd.find(item => item?.['@type'] === 'BreadcrumbList');

  if (breadcrumb && breadcrumb.itemListElement && breadcrumb.itemListElement.length >= 2) {
    return {
      name: 'Breadcrumb Schema', category: 'structuredData', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Breadcrumb schema found. AI understands your site hierarchy.',
      techDetail: `BreadcrumbList with ${breadcrumb.itemListElement.length} levels.`
    };
  }
  return {
    name: 'Breadcrumb Schema', category: 'structuredData', passed: false,
    score: 0, maxPoints,
    detail: 'No breadcrumb schema. AI cannot map your site structure or page relationships.',
    techDetail: 'Add BreadcrumbList JSON-LD to practice area and service pages with at least 2 levels.'
  };
}

function checkArticleSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 3;
  const allJsonLd = pages.flatMap(p => p.jsonLd);
  const hasArticle = allJsonLd.some(item =>
    item?.['@type'] === 'Article' || item?.['@type'] === 'WebPage' || item?.['@type'] === 'BlogPosting'
  );

  if (hasArticle) {
    return {
      name: 'Article/WebPage Schema', category: 'structuredData', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Article or WebPage schema found. AI can identify and cite your content properly.',
      techDetail: 'Article, WebPage, or BlogPosting schema detected.'
    };
  }
  return {
    name: 'Article/WebPage Schema', category: 'structuredData', passed: false,
    score: 0, maxPoints,
    detail: 'No article or page schema. AI cannot distinguish your editorial content from navigation.',
    techDetail: 'Add Article or WebPage schema to blog posts and content pages with headline, datePublished, and author.'
  };
}

// ── 4. Technical Accessibility (10 points) ──
function checkSemanticHtml(page: ParsedPage): CheckResult {
  const maxPoints = 3;
  const count = [page.hasMain, page.hasArticle, page.hasNav, page.hasSection].filter(Boolean).length;

  if (count >= 2) {
    return {
      name: 'Semantic HTML', category: 'technicalAccessibility', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Good semantic HTML structure. AI can efficiently parse your content sections.',
      techDetail: `Found: ${[page.hasMain && '<main>', page.hasArticle && '<article>', page.hasNav && '<nav>', page.hasSection && '<section>'].filter(Boolean).join(', ')}`
    };
  }
  if (count === 1) {
    return {
      name: 'Semantic HTML', category: 'technicalAccessibility', passed: false,
      score: 1, maxPoints,
      detail: 'Minimal semantic HTML. AI has to work harder to find your main content.',
      techDetail: 'Add <main>, <article>, and <section> elements to help AI identify content areas.'
    };
  }
  return {
    name: 'Semantic HTML', category: 'technicalAccessibility', passed: false,
    score: 0, maxPoints,
    detail: 'No semantic HTML elements. AI cannot distinguish your content from your navigation and ads.',
    techDetail: 'Wrap main content in <main>, use <article> for posts, <section> for content blocks, <nav> for navigation.'
  };
}

function checkTokenEfficiency(page: ParsedPage): CheckResult {
  const maxPoints = 3;
  const ratio = page.textToHtmlRatio;

  if (ratio > 15) {
    return {
      name: 'Token Efficiency', category: 'technicalAccessibility', passed: true,
      score: maxPoints, maxPoints,
      detail: `Text-to-HTML ratio of ${ratio.toFixed(1)}%. AI can efficiently extract your content.`,
      techDetail: `Ratio: ${ratio.toFixed(1)}% — clean, content-rich markup.`
    };
  }
  if (ratio > 10) {
    return {
      name: 'Token Efficiency', category: 'technicalAccessibility', passed: true,
      score: 2, maxPoints,
      detail: `Text-to-HTML ratio of ${ratio.toFixed(1)}%. Acceptable but could be leaner.`,
      techDetail: `Ratio: ${ratio.toFixed(1)}% — some bloat in markup but within acceptable range.`
    };
  }
  return {
    name: 'Token Efficiency', category: 'technicalAccessibility', passed: false,
    score: ratio > 5 ? 1 : 0, maxPoints,
    detail: `Text-to-HTML ratio of only ${ratio.toFixed(1)}%. AI wastes tokens wading through code to find your content.`,
    techDetail: `Ratio: ${ratio.toFixed(1)}% — heavy markup bloat. Target >10%. Reduce inline styles, scripts, and unused code.`
  };
}

function checkPageLoad(resource: FetchedResource, page: ParsedPage): CheckResult {
  const maxPoints = 2;
  const responded = resource.status === 200;
  const sizeOk = page.htmlSize < 2_000_000;

  if (responded && sizeOk) {
    return {
      name: 'Page Load & Size', category: 'technicalAccessibility', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Page loads successfully and HTML size is reasonable for AI consumption.',
      techDetail: `HTTP 200, HTML size: ${(page.htmlSize / 1024).toFixed(0)}KB`
    };
  }
  return {
    name: 'Page Load & Size', category: 'technicalAccessibility', passed: false,
    score: responded ? 1 : 0, maxPoints,
    detail: responded ? 'Page loads but HTML is excessively large for AI parsing.' : 'Page failed to load properly.',
    techDetail: `Status: ${resource.status || 'failed'}, Size: ${(page.htmlSize / 1024).toFixed(0)}KB`
  };
}

function checkMobileViewport(page: ParsedPage): CheckResult {
  const maxPoints = 2;
  if (page.hasViewport) {
    return {
      name: 'Mobile Viewport', category: 'technicalAccessibility', passed: true,
      score: maxPoints, maxPoints,
      detail: 'Mobile viewport configured. AI considers mobile-friendly sites more authoritative.',
      techDetail: 'Meta viewport with width=device-width detected.'
    };
  }
  return {
    name: 'Mobile Viewport', category: 'technicalAccessibility', passed: false,
    score: 0, maxPoints,
    detail: 'No mobile viewport set. This signals poor site quality to AI ranking systems.',
    techDetail: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> to your <head>.'
  };
}

// ── 5. Advanced AI Signals (10 points) ──
function checkLlmsTxt(llmsTxt: FetchedResource): CheckResult {
  const maxPoints = 2;
  if (llmsTxt.content && llmsTxt.status === 200 && llmsTxt.content.trim().length > 10) {
    return {
      name: 'llms.txt', category: 'advancedSignals', passed: true,
      score: maxPoints, maxPoints,
      detail: 'llms.txt found! You\'re ahead of 99% of law firms. AI agents know exactly how to interact with your site.',
      techDetail: `llms.txt present with ${llmsTxt.content.trim().length} characters of content.`
    };
  }
  return {
    name: 'llms.txt', category: 'advancedSignals', passed: false,
    score: 0, maxPoints,
    detail: 'No llms.txt found. This emerging standard tells AI exactly what your site offers — having it puts you way ahead.',
    techDetail: 'Create /llms.txt describing your firm, services, and how AI should represent you. See llmstxt.org for format.'
  };
}

function checkMarkdownNegotiation(markdownResource: FetchedResource): CheckResult {
  const maxPoints = 2;
  if (markdownResource.content && markdownResource.status === 200) {
    const contentType = markdownResource.headers['content-type'] || '';
    if (contentType.includes('text/markdown') || contentType.includes('text/plain')) {
      return {
        name: 'Markdown Content Negotiation', category: 'advancedSignals', passed: true,
        score: maxPoints, maxPoints,
        detail: 'Site serves markdown when requested — AI can consume your content in its native format.',
        techDetail: `Returns Content-Type: ${contentType} when Accept: text/markdown is sent.`
      };
    }
  }
  return {
    name: 'Markdown Content Negotiation', category: 'advancedSignals', passed: false,
    score: 0, maxPoints,
    detail: 'No markdown content negotiation. This cutting-edge feature lets AI read your content more efficiently.',
    techDetail: 'Configure your server to return markdown when the Accept: text/markdown header is present.'
  };
}

function checkContentSignalHeader(homepageResource: FetchedResource): CheckResult {
  const maxPoints = 1;
  const headers = homepageResource.headers;
  const hasContentSignal = !!headers['content-signal'] || !!headers['x-robots-tag'];

  if (hasContentSignal) {
    return {
      name: 'AI Permission Headers', category: 'advancedSignals', passed: true,
      score: maxPoints, maxPoints,
      detail: 'AI-related HTTP headers found. Your server communicates directly with AI crawlers.',
      techDetail: `Headers: ${headers['content-signal'] ? 'Content-Signal' : 'X-Robots-Tag'} present.`
    };
  }
  return {
    name: 'AI Permission Headers', category: 'advancedSignals', passed: false,
    score: 0, maxPoints,
    detail: 'No AI-specific HTTP headers. These headers let AI systems know your content usage preferences.',
    techDetail: 'Add Content-Signal or X-Robots-Tag headers to communicate AI content usage permissions.'
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN SCAN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════
export async function scanWebsite(inputUrl: string): Promise<ScanResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  // Normalize URL
  let url = inputUrl;
  if (!url.startsWith('http')) url = 'https://' + url;
  const origin = new URL(url).origin;
  const domain = new URL(url).hostname;

  // ── Parallel fetch: homepage, robots.txt, sitemap, llms.txt, markdown, crawl ──
  const [homepageRes, robotsRes, sitemapRes, llmsRes, markdownRes, crawlOutcome] = await Promise.all([
    fetchResource(url),
    fetchResource(origin + '/robots.txt', 5000),
    fetchResource(origin + '/sitemap.xml', 5000),
    fetchResource(origin + '/llms.txt', 5000),
    fetchResource(url, 5000, { 'Accept': 'text/markdown' }),
    Promise.race([
      crawlSite({ url, limit: 30, maxDepth: 2, formats: ['html'], maxAge: 3600 }),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 90000)),
    ]).catch(() => null),
  ]);

  const crawlResult: CrawlResult | null = crawlOutcome ?? null;
  let usedCrawl = false;

  // Process ALL crawl pages first (they use real browser rendering)
  const allPages: ParsedPage[] = [];
  const seenUrls = new Set<string>();

  if (crawlResult) {
    for (const crawlPage of crawlResult.pages) {
      if (crawlPage.status !== 'completed' || !crawlPage.html) continue;
      try {
        const pageUrl = new URL(crawlPage.url);
        if (pageUrl.hostname.replace(/^www\./, '') !== domain.replace(/^www\./, '')) continue;
        const normalized = pageUrl.origin + pageUrl.pathname.replace(/\/$/, '');
        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);
        seenUrls.add(crawlPage.url);
        const parsed = parsePage(crawlPage.html, crawlPage.url);
        allPages.push(parsed);
        usedCrawl = true;
      } catch { /* skip */ }
    }
  }

  // Get homepage — prefer crawl version, fall back to direct fetch
  let homepage = allPages.find(p => {
    try { const path = new URL(p.url).pathname; return path === '/' || path === ''; } catch { return false; }
  }) ?? null;

  if (!homepage && homepageRes.content) {
    homepage = parsePage(homepageRes.content, url);
    const normalized = new URL(url).origin + new URL(url).pathname.replace(/\/$/, '');
    if (!seenUrls.has(normalized)) {
      allPages.unshift(homepage);
      seenUrls.add(normalized);
      seenUrls.add(url);
    }
  }

  if (!homepage) {
    errors.push('Could not fetch homepage');
  }

  // ── Discover and fetch subpages (only if crawl had few pages) ──
  if (homepage && allPages.length < 10) {
    const subpageUrls = discoverSubpages(homepage, url);
    const allSubUrls = [...subpageUrls.practiceArea, ...subpageUrls.attorney]
      .filter(u => !seenUrls.has(u) && !seenUrls.has(u.replace(/\/$/, '')))
      .slice(0, 4);

    const subResults = await Promise.allSettled(
      allSubUrls.map(async (subUrl) => {
        const res = await fetchResource(subUrl, 6000);
        if (res.content && res.status === 200) {
          return parsePage(res.content, subUrl);
        }
        return null;
      })
    );

    for (const result of subResults) {
      if (result.status === 'fulfilled' && result.value) {
        const normalized = new URL(result.value.url).origin + new URL(result.value.url).pathname.replace(/\/$/, '');
        if (!seenUrls.has(normalized)) {
          allPages.push(result.value);
          seenUrls.add(normalized);
          seenUrls.add(result.value.url);
        }
      }
    }
  }

  // ── Run all checks ──
  const checks: CheckResult[] = [];

  if (homepage) {
    // 1. Discoverability
    checks.push(checkRobotsTxt(robotsRes));
    checks.push(checkSitemap(sitemapRes, robotsRes));
    checks.push(checkMetaDescription(homepage));
    checks.push(checkOpenGraph(homepage));
    checks.push(checkCanonical(homepage));
    checks.push(checkHeadingHierarchy(homepage));

    // 2. Content Clarity
    checks.push(checkFirmIdentity(homepage));
    checks.push(checkAttorneyProfiles(allPages));
    checks.push(checkPracticeAreaPages(allPages));
    checks.push(checkContactInfo(homepage));
    checks.push(checkServiceArea(homepage));

    // 3. Structured Data
    checks.push(checkLegalSchema(allPages));
    checks.push(checkOrganizationSchema(allPages));
    checks.push(checkFaqSchema(allPages));
    checks.push(checkReviewSchema(allPages));
    checks.push(checkBreadcrumbSchema(allPages));
    checks.push(checkArticleSchema(allPages));

    // 4. Technical
    checks.push(checkSemanticHtml(homepage));
    checks.push(checkTokenEfficiency(homepage));
    checks.push(checkPageLoad(homepageRes, homepage));
    checks.push(checkMobileViewport(homepage));

    // 5. Advanced
    checks.push(checkLlmsTxt(llmsRes));
    checks.push(checkMarkdownNegotiation(markdownRes));
    checks.push(checkContentSignalHeader(homepageRes));
  }

  // ── Aggregate scores ──
  const categoryMap: Record<string, CheckResult[]> = {
    discoverability: [],
    contentClarity: [],
    structuredData: [],
    technicalAccessibility: [],
    advancedSignals: [],
  };

  for (const check of checks) {
    categoryMap[check.category]?.push(check);
  }

  function buildCategory(key: string, name: string): CategoryScore {
    const catChecks = categoryMap[key] || [];
    const score = catChecks.reduce((sum, c) => sum + c.score, 0);
    const maxPoints = catChecks.reduce((sum, c) => sum + c.maxPoints, 0);
    const percentage = maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0;
    return { name, score, maxPoints, percentage, checks: catChecks };
  }

  const categories = {
    discoverability: buildCategory('discoverability', 'AI Discoverability'),
    contentClarity: buildCategory('contentClarity', 'Content Clarity for AI'),
    structuredData: buildCategory('structuredData', 'Structured Data & Schema'),
    technicalAccessibility: buildCategory('technicalAccessibility', 'Technical Accessibility'),
    advancedSignals: buildCategory('advancedSignals', 'Advanced AI Signals'),
  };

  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const totalMax = checks.reduce((sum, c) => sum + c.maxPoints, 0);
  const overallScore = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;

  const { grade, label: gradeLabel } = gradeFromScore(overallScore);

  return {
    url,
    domain,
    overallScore,
    grade,
    gradeLabel,
    categories,
    totalChecks: checks.length,
    passedChecks: checks.filter(c => c.passed).length,
    scanDurationMs: Date.now() - startTime,
    pagesScanned: allPages.length,
    errors,
    crawlEnhanced: usedCrawl,
    crawlPagesUsed: usedCrawl ? allPages.length : 0,
  };
}

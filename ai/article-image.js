const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_IMAGE_SIZE = '1024x768';
const DEFAULT_IMAGE_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_IMAGE_BYTES = 12 * 1024;
const MIN_IMAGE_WIDTH = 512;
const MIN_IMAGE_HEIGHT = 384;
const GENERATED_IMAGES_PUBLIC_PREFIX = '/generated-images';
const CARD_THUMBNAIL_WIDTH = 480;
const CARD_THUMBNAIL_HEIGHT = 206;

const keyCursor = new Map();
const modelCursor = new Map();

function timestamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ');
}

function parseDelimitedList(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(item => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function parseImageProviderKeys(value) {
  return parseDelimitedList(value);
}

function parseImageProviderModels(value) {
  return parseDelimitedList(value);
}

function resetImageProviderKeyCursor() {
  keyCursor.clear();
  modelCursor.clear();
}

function normalizeImageEndpoint(baseUrl) {
  const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/\/images\/generations$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/images/generations`;
  return `${trimmed}/v1/images/generations`;
}

function nextRotating(items, cursorMap, cursorKey, first = false) {
  if (items.length === 0) return null;
  if (first) return items[0];
  const index = cursorMap.get(cursorKey) || 0;
  const item = items[index % items.length];
  cursorMap.set(cursorKey, (index + 1) % items.length);
  return item;
}

function providerHealthPenalty(provider) {
  const requestCount = Number(provider.request_count || 0);
  const errorCount = Number(provider.error_count || 0);
  const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
  let penalty = requestCount + errorCount * 10;
  if (requestCount >= 10 && errorRate >= 0.75) penalty += 100000;
  else if (requestCount >= 10 && errorRate >= 0.5) penalty += 50000;
  else if (requestCount >= 10 && errorRate >= 0.25) penalty += 10000;
  if (provider.disabled_reason === 'auth_error') penalty += 200000;
  return penalty;
}

function rankImageProviders(providers = []) {
  return providers
    .slice()
    .sort((a, b) => providerHealthPenalty(a) - providerHealthPenalty(b) || (a.request_count || 0) - (b.request_count || 0) || (a.id || 0) - (b.id || 0));
}

function classifyImageProviderError(err) {
  const message = String(err?.message || err || '');
  if (/(?:401|403|invalid api key|invalid key|unauthorized|forbidden|api[_ -]?key)/i.test(message)) return 'auth';
  if (/(?:429|rate limit|too many requests|quota)/i.test(message)) return 'rate_limit';
  if (/(?:ECONNRESET|ETIMEDOUT|fetch failed|network|timeout|请求超时)/i.test(message)) return 'network';
  if (/(?:500|502|503|504|server error|bad gateway|service unavailable)/i.test(message)) return 'server';
  return 'unknown';
}

function chooseImageProviderCredential(provider, options = {}) {
  const keys = parseImageProviderKeys(provider.api_key);
  const models = parseImageProviderModels(provider.model);
  return {
    apiKey: nextRotating(keys, keyCursor, `provider:${provider.id || provider.name}:key`, options.first),
    model: options.model || nextRotating(models, modelCursor, `provider:${provider.id || provider.name}:model`, options.first),
  };
}

function parseImageData(data) {
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  if (!item) throw new Error('Image provider returned no image data');
  if (item.b64_json) {
    const raw = String(item.b64_json).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
    return { type: 'base64', buffer: Buffer.from(raw, 'base64'), revisedPrompt: item.revised_prompt || null };
  }
  if (item.url) {
    return { type: 'url', url: item.url, revisedPrompt: item.revised_prompt || null };
  }
  throw new Error('Image provider response has no b64_json or url');
}

function bufferFromArrayBuffer(arrayBuffer) {
  return Buffer.from(new Uint8Array(arrayBuffer));
}

async function downloadImageUrl(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Image download failed (${response.status})`);
  const arrayBuffer = await response.arrayBuffer();
  return {
    buffer: bufferFromArrayBuffer(arrayBuffer),
    mimeType: response.headers?.get?.('content-type') || '',
  };
}

async function callImageProvider(provider, prompt, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
  const attemptsPerKey = Math.max(1, Math.min(5, Number(options.attemptsPerKey || 3) || 3));
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs ?? 1000) || 0);
  const keys = parseImageProviderKeys(provider.api_key);
  const models = parseImageProviderModels(provider.model);
  if (keys.length === 0) throw new Error('Image provider has no API key');
  if (models.length === 0) throw new Error('Image provider has no model');

  const model = options.model || nextRotating(models, modelCursor, `provider:${provider.id || provider.name}:model`, options.first);
  const startIndex = keyCursor.get(`provider:${provider.id || provider.name}:key`) || 0;
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt += 1) {
    const keyIndex = (startIndex + attempt) % keys.length;
    const apiKey = keys[keyIndex];
    keyCursor.set(`provider:${provider.id || provider.name}:key`, (keyIndex + 1) % keys.length);

    for (let providerAttempt = 0; providerAttempt < attemptsPerKey; providerAttempt += 1) {
      try {
        const response = await fetchImpl(normalizeImageEndpoint(provider.base_url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            prompt,
            size: options.size || DEFAULT_IMAGE_SIZE,
            return_base64: true,
            extra_body: { response_format: 'b64_json' },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = errorText;
          try { errorMessage = JSON.parse(errorText).error?.message || errorText; } catch {}
          throw new Error(`Image API error (${response.status}): ${errorMessage}`);
        }

        const data = await response.json();
        const parsed = parseImageData(data);
        let buffer = parsed.buffer;
        let sourceUrl = parsed.url || null;
        let mimeType = '';
        if (parsed.type === 'url') {
          const downloaded = await downloadImageUrl(parsed.url, fetchImpl, timeoutMs);
          buffer = downloaded.buffer;
          mimeType = downloaded.mimeType;
        }

        return {
          buffer,
          mimeType,
          sourceUrl,
          revisedPrompt: parsed.revisedPrompt,
          provider: provider.name,
          providerId: provider.id,
          model,
        };
      } catch (err) {
        lastError = err;
        const retryable = ['server', 'network', 'rate_limit'].includes(classifyImageProviderError(err));
        if (!retryable || providerAttempt >= attemptsPerKey - 1) break;
        if (retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  throw lastError || new Error('Image provider failed');
}

function isImageGenerationAvailable(config = {}, providers = []) {
  if (config.image_generation_enabled !== '1') return false;
  return providers.some(provider => provider.enabled && provider.base_url && provider.api_key && provider.model);
}

function deterministicBucket(value) {
  const hash = crypto.createHash('sha1').update(String(value || '')).digest();
  return hash[0] / 255;
}

function deterministicIndex(value, length, salt = '') {
  if (!length) return 0;
  const hash = crypto.createHash('sha1').update(`${salt}:${String(value || '')}`).digest();
  return hash[0] % length;
}

function shouldAttemptArticleImage(article = {}, config = {}, providers = [], options = {}) {
  if (!isImageGenerationAvailable(config, providers)) return { ok: false, reason: 'not_configured' };
  if (article.cover_image) return { ok: false, reason: 'already_has_image' };
  if (options.force) return { ok: true, reason: 'forced' };

  const title = String(article.title || '');
  const summary = String(article.summary || '');
  const content = String(article.content_md || article.content_html || '');
  const textLength = `${title} ${summary} ${content}`.replace(/<[^>]+>/g, ' ').trim().length;
  if (/(快讯|简讯|公告|通知|周报)/.test(title) && textLength < 800) return { ok: false, reason: 'brief_article' };
  if (textLength < 120) return { ok: false, reason: 'too_short' };
  if (options.publicationPriority) return { ok: true, reason: 'publication_priority' };
  if (textLength >= 800 || summary.length >= 50) return { ok: true, reason: 'substantial_article' };
  return deterministicBucket(article.slug || article.id || title) < 0.65
    ? { ok: true, reason: 'sampled_in' }
    : { ok: false, reason: 'sampled_out' };
}

function compactText(text, maxLength = 1200) {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_>`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

const HUMAN_CONTEXT_REPLACEMENTS = [
  [/\bopenai\b/gi, 'machine intelligence company'],
  [/\bchatgpt\b/gi, 'machine intelligence assistant'],
  [/\bllms?\b/gi, 'large language model systems'],
  [/\bai\b/gi, 'machine intelligence'],
  [/\bsaas\b/gi, 'subscription software'],
  [/(肖像|人像|面孔|脸部特写|手部特写|文字|水印|标志|截图)/g, '安全的编辑画面元素'],
];

const UNSAFE_IMAGE_SUBJECT_RE = /\b(close[-\s]?up|portrait|headshot|selfie|faces?|hands?|readable text|letters?|logos?|watermarks?|screenshots?)\b|肖像|人像|面孔|脸部特写|手部特写|文字|水印|标志|截图/i;

function hasUnsafeImageSubject(prompt = '') {
  const withoutNegatedSafetyTerms = String(prompt || '').replace(
    /\b(?:no|without|avoid)\s+(?:readable\s+)?(?:text|letters?|logos?|watermarks?|screenshots?|captions?|signboards?|brand marks?|ui screenshots?)(?:\b|[,.;])/gi,
    ' ',
  );
  return UNSAFE_IMAGE_SUBJECT_RE.test(withoutNegatedSafetyTerms);
}

function sanitizeImageContext(text, maxLength = 520) {
  let cleaned = compactText(text, maxLength * 2);
  for (const [pattern, replacement] of HUMAN_CONTEXT_REPLACEMENTS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  return cleaned
    .replace(/\s*([|:;,，。])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function containsCjk(text = '') {
  return /[\u3400-\u9fff]/.test(String(text || ''));
}

function sanitizeUnsafePlannerBrief(text = '') {
  return String(text || '')
    .replace(/\bwithout showing a real interface\b/gi, 'with no interface elements')
    .replace(/\breal interface\b/gi, 'interface-free abstract objects')
    .replace(/\b(?:the\s+)?(?:phone|smartphone)\s+screen\s+(?:is\s+)?(?:blank|dark|off|black)[^,.]*/gi, 'back side of the smartphone only, camera lenses and matte case visible')
    .replace(/\b(?:above|over)\s+the\s+(?:phone\s+)?screen\b/gi, 'above the back side of the device')
    .replace(/\bmodern\s+smartphone\s+lying\b/gi, 'modern smartphone shown back-side up lying')
    .replace(/\bsmartphone\s+lying\b/gi, 'smartphone shown back-side up lying')
    .replace(/\b(?:screen\s+displaying|displaying)\b[^,.]*/gi, 'blank non-ui screen')
    .replace(/\bface up\b/gi, 'back side up or with the screen turned away')
    .replace(/\bmanual confirmation slider\b/gi, 'abstract translucent shape without controls')
    .replace(/\bslider\b/gi, 'abstract translucent shape without controls')
    .replace(/\b(?:app icons?|list items|navigation elements|ui components?|interface)\b/gi, 'non-ui abstract shapes')
    .replace(/\bno\s+(?:readable\s+|pseudo\s+|visible\s+)?text\b/gi, 'blank surfaces only')
    .replace(/\bno\s+(?:logos?|watermarks?|screenshots?|ui labels?)\b/gi, 'unbranded')
    .replace(/\bno\s+(?:close[-\s]?up\s+|prominent\s+)?hands?\b/gi, 'natural body framing')
    .replace(/\bin a laboratory wearing a lab coat\b/gi, 'in a neutral business workspace')
    .replace(/\b(?:heroic\s+)?close[-\s]?up\s+(?:portrait|headshot|selfie|face|faces?)\b/gi, 'environmental editorial scene')
    .replace(/\b(?:portrait|headshot|selfie)\b/gi, 'environmental editorial scene')
    .replace(/\b(?:right|left)\s+hands?\b/gi, 'near the person')
    .replace(/\b(?:close[-\s]?up|prominent|malformed|distorted)\s+hands?\b/gi, 'natural body posture')
    .replace(/\bhands?\b/gi, 'natural body posture')
    .replace(/\b(?:dashboard\s+text|background\s+text|readable\s+text|pseudo\s+text|ui labels?|letters?|captions?|signboards?|brand marks?|logos?|watermarks?|screenshots?)\b/gi, 'blank non-legible surfaces')
    .replace(/\b(?:text|logo)\b/gi, 'blank non-legible surface')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIVERSAL_IMAGE_TREATMENTS = [
  {
    name: 'editorial still life',
    method: 'arrange the article-specific objects, ingredients, products, tools, documents, materials or symbols as a premium magazine still life',
  },
  {
    name: 'place and atmosphere scene',
    method: 'show the article-specific place, season, environment, people in context or atmosphere as a clean scene using the actual subject matter implied by the article',
  },
  {
    name: 'process or transformation scene',
    method: 'show the article-specific before-and-after, route, workflow, recipe step, repair, growth, decline or comparison through whatever relevant subjects best explain the article',
  },
  {
    name: 'detail-focused feature image',
    method: 'focus on the most concrete subject from the article with tactile material detail, natural light and a simple background',
  },
  {
    name: 'curated evidence layout',
    method: 'lay out concrete clues from the article as a clean editorial composition, using blank surfaces where text would otherwise appear',
  },
];

function selectUniversalImageTreatment(seed) {
  return UNIVERSAL_IMAGE_TREATMENTS[deterministicIndex(seed, UNIVERSAL_IMAGE_TREATMENTS.length, 'article-image-treatment')];
}

function buildSafeArticleImagePrompt(article = {}, sourcePrompt = '') {
  const articleContext = sanitizeImageContext([
    article.title,
    article.summary,
    article.content_md || article.content_html ? `Excerpt: ${compactText(article.content_md || article.content_html, 420)}` : '',
    article.category_name ? `Category: ${article.category_name}` : '',
  ].filter(Boolean).join(' | '), 520);
  const sourceContext = sanitizeImageContext(sourcePrompt, 760);
  const safeSourceContext = sanitizeUnsafePlannerBrief(sourceContext);
  const hasSourceBrief = !!safeSourceContext;
  const visualBrief = hasSourceBrief ? safeSourceContext : articleContext;
  const seed = article.slug || article.id || article.title || visualBrief;
  const treatment = selectUniversalImageTreatment(seed || articleContext);
  const useEnglishBriefAsSource = hasSourceBrief && !containsCjk(safeSourceContext) && containsCjk(articleContext);
  const articleFocusLine = useEnglishBriefAsSource
    ? 'Article focus: use the English visual brief below as the source of truth; do not render article titles, Chinese characters, English words, numbers or headlines.'
    : `Article focus: ${articleContext || 'the core idea of the article'}.`;
  const primaryVisualLabel = useEnglishBriefAsSource ? 'English visual brief (source of truth)' : 'Primary visual brief';
  const primaryVisualBrief = hasSourceBrief
    ? visualBrief
    : 'derive the visible subject from Article focus and the article domain itself. Choose the most relevant concrete subject, scene, person-in-context, process, place, object, food, document, landscape, atmosphere or symbolic detail; do not use a preset theme.';

  return [
    'Editorial cover image for a real article, modern magazine quality.',
    articleFocusLine,
    `${primaryVisualLabel}: ${primaryVisualBrief}.`,
    `Editorial method: ${treatment.name}; ${treatment.method}.`,
    'Let the article decide the subject: it may be food, recipe steps, cooking atmosphere, travel scenery, local details, people in context, objects, products, documents, rooms, landscapes, culture, finance, technology, education or any other relevant scene.',
    'People are allowed only when the article naturally calls for them; prefer natural editorial context, silhouettes, back views, environmental scenes, or small groups instead of close-up faces.',
    'If the chosen subject includes phones, computers, tablets, documents, books, menus, signs, labels, dashboards, packaging, charts or any screen, keep text-bearing surfaces blank, turned away, out of focus, cropped away, or represented only by abstract non-legible shapes.',
    'Avoid close-up portraits, distorted faces, prominent hands, readable text, logos, watermarks, screenshots, captions, signboards and messy clutter.',
    'Make the image feel specific to this article through concrete subject matter, objects, materials, composition, lighting and mood; avoid generic AI abstract art.',
    'Do not substitute a technology aesthetic unless the article is actually about technology. Avoid repeated template-like abstract visuals unless the article specifically demands them.',
    'Landscape 1024x768, one clear focal subject, refined lighting, polished finish, believable editorial art direction, uncluttered composition.',
  ].join(' ');
}

function fallbackImagePlan(article = {}) {
  const articleText = [article.title, article.summary, article.content_md || article.content_html || '', article.category_name].filter(Boolean).join(' ');
  if (containsCjk(articleText)) {
    return {
      needed: false,
      reason: 'english_planner_required_for_cjk_article',
      alt: `${article.title || 'Article'} cover image`,
      prompt: '',
    };
  }

  return {
    needed: true,
    reason: 'editorial cover image can improve article scanning and retention',
    alt: `${article.title || 'Article'} cover image`,
    prompt: buildSafeArticleImagePrompt(article),
  };
}

function normalizeImagePlan(plan, article) {
  const fallback = fallbackImagePlan(article);
  const needed = plan?.needed;
  const plannerPrompt = [
    plan?.visual_angle ? `Visual angle: ${plan.visual_angle}` : '',
    plan?.prompt || '',
  ].filter(Boolean).join(' | ');
  return {
    needed: needed === false ? false : true,
    reason: String(plan?.reason || fallback.reason).slice(0, 300),
    alt: String(plan?.alt || fallback.alt).slice(0, 160),
    prompt: buildSafeArticleImagePrompt(article, plannerPrompt).slice(0, 1600),
  };
}

async function planArticleImage(article, options = {}) {
  if (options.planner) return normalizeImagePlan(await options.planner(article), article);
  if (options.skipAIPlanner) return fallbackImagePlan(article);

  try {
    const { callAIForJSON } = require('./client');
    const { data } = await callAIForJSON([
      {
        role: 'system',
        content: 'You are a senior human picture editor and editorial art director for a Chinese web magazine. Read the article, choose a concrete, relevant cover-image concept, and write one safe English image-generation prompt. Return JSON only.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          title: article.title,
          category: article.category_name || '',
          summary: article.summary || '',
          excerpt: compactText(article.content_md || article.content_html || '', 900),
          required_json: {
            needed: true,
            reason: 'short reason',
            alt: 'short image alt text',
            visual_angle: 'one-sentence English explanation of the editorial image idea',
            prompt: 'specific English image-generation prompt; no text, no logos, no clutter',
          },
          rules: [
            'This system is domain-neutral. The website may be about food, travel, lifestyle, finance, technology, culture, education, health, local news or any other topic. Use the article domain itself; never force a technology style onto non-technology articles.',
            'The image must match the core idea and concrete details of the article, like a human editor selected it for this exact story.',
            'First mentally summarize the article into one visual angle, then write the prompt from that angle.',
            'Write visual_angle and prompt in English for the image model. Translate Chinese article concepts into unambiguous English visual language; never copy the article title into the image prompt as text to render.',
            'You are free to choose food, recipe process, cooking scene, people in context, travel landscape, local object, product detail, document layout, room, street, classroom, clinic, cultural item, abstract symbol or any other subject if it best serves the article.',
            'Use concrete objects, setting, material, lighting, camera angle, composition and mood. Do not output a generic wallpaper.',
            'If the concept includes screens, phones, computers, documents, charts, menus, signs, labels, packages or books, require blank or non-legible surfaces; do not ask for visible UI, readable words, numbers, brand marks or pseudo text.',
            'Avoid text, letters, numbers, watermarks, logos, UI screenshots and messy compositions.',
            'People are allowed when useful, but avoid close-up faces, prominent hands, celebrity-like portraits and distorted anatomy.',
            'Avoid repeated AI-cliche visuals such as generic glowing cores, random glass orbs, neural-network wallpaper and meaningless data ribbons.',
            'Prefer editorial still life, place atmosphere, process scenes, detail-focused feature images, or carefully designed symbolic scenes with one clear subject from the article.',
            'Prefer modern editorial photography or polished illustration with one focal subject.',
            'Return needed=false for brief announcements or articles where a generic image would be misleading.',
          ],
        }),
      },
    ], { taskType: 'image_planning', maxTokens: 1000, temperature: 0.35, moa: false });
    return normalizeImagePlan(data, article);
  } catch {
    return fallbackImagePlan(article);
  }
}

function buildRetryArticleImagePrompt(article = {}, basePrompt = '', review = {}, attempt = 2) {
  const issueText = [
    review.reason,
    ...(Array.isArray(review.semantic_issues) ? review.semantic_issues : []),
    ...(Array.isArray(review.issues) ? review.issues : []),
  ].filter(Boolean).join('; ').slice(0, 360);
  const alternateTreatment = selectUniversalImageTreatment(`${article.slug || article.id || article.title}:retry:${attempt}`);

  return [
    `Previous attempt failed image quality review${issueText ? `: ${issueText}` : ''}. Create a different version, not a slight variation.`,
    'Hard correction: no readable text, no pseudo text, no UI labels, no numbers, no logos, no watermarks, no screenshots, no visible dashboards with labels.',
    'For phones, computers, tablets, documents, menus, signs, packaging, charts, books or any other text-bearing object, make the surface blank, turned away, out of focus, cropped away, or abstract non-legible.',
    `Use a safer alternate editorial method: ${alternateTreatment.name}; ${alternateTreatment.method}.`,
    `Article-specific base brief: ${basePrompt}`,
    'Prefer a back or side view of devices, object still life, environment scene, material detail, process scene, or symbolic scene that still clearly matches the article.',
    'Keep one clear focal subject, natural editorial lighting, and a clean composition.',
  ].join(' ').replace(/\s+/g, ' ').trim().slice(0, 1800);
}

function imageExtension(buffer, mimeType = '') {
  if (/webp/i.test(mimeType) || buffer.slice(0, 4).toString('ascii') === 'RIFF') return 'webp';
  if (/jpe?g/i.test(mimeType) || (buffer[0] === 0xff && buffer[1] === 0xd8)) return 'jpg';
  return 'png';
}

function defaultPublicDir() {
  return path.join(__dirname, '..', 'public');
}

function publicImageFilePath(publicPath, options = {}) {
  const normalized = normalizePublicImagePath(publicPath).replace(/^\/+/, '');
  if (normalized.startsWith('generated-images/')) {
    return path.join(generatedImageStorageDir(options), normalized.slice('generated-images/'.length));
  }
  return path.join(options.publicDir || defaultPublicDir(), normalized);
}

function thumbnailPublicPathForCover(coverPublicPath) {
  const normalized = normalizePublicImagePath(coverPublicPath);
  const match = normalized.match(/^\/generated-images\/articles\/(.+)$/);
  if (!match) return null;
  const parsed = path.posix.parse(match[1].replace(/\\/g, '/'));
  return `${GENERATED_IMAGES_PUBLIC_PREFIX}/thumbnails/articles/${parsed.name}-thumb.png`;
}

function pngCrcTable() {
  if (pngCrcTable.table) return pngCrcTable.table;
  pngCrcTable.table = Array.from({ length: 256 }, (_, index) => {
    let c = index;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
  return pngCrcTable.table;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuffer, data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = pngCrcTable()[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuffer.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngToRgba(buffer) {
  const zlib = require('zlib');
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.slice(0, 8).equals(signature)) throw new Error('not_png');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    const data = buffer.slice(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType) || idat.length === 0) {
    throw new Error('unsupported_png');
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset++];
    inflated.copy(current, 0, inputOffset, inputOffset + stride);
    inputOffset += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bytesPerPixel ? current[i - bytesPerPixel] : 0;
      const up = prev[i] || 0;
      const upLeft = i >= bytesPerPixel ? prev[i - bytesPerPixel] : 0;
      if (filter === 1) current[i] = (current[i] + left) & 0xff;
      else if (filter === 2) current[i] = (current[i] + up) & 0xff;
      else if (filter === 3) current[i] = (current[i] + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) current[i] = (current[i] + paethPredictor(left, up, upLeft)) & 0xff;
      else if (filter !== 0) throw new Error('unsupported_png_filter');
    }
    for (let x = 0; x < width; x += 1) {
      const src = x * channels;
      const dst = (y * width + x) * 4;
      rgba[dst] = current[src];
      rgba[dst + 1] = current[src + 1];
      rgba[dst + 2] = current[src + 2];
      rgba[dst + 3] = channels === 4 ? current[src + 3] : 255;
    }
    current.copy(prev);
  }

  return { width, height, rgba };
}

function resizeRgbaCover(image, targetWidth = CARD_THUMBNAIL_WIDTH, targetHeight = CARD_THUMBNAIL_HEIGHT) {
  const scale = Math.max(targetWidth / image.width, targetHeight / image.height);
  const sourceWidth = targetWidth / scale;
  const sourceHeight = targetHeight / scale;
  const offsetX = Math.max(0, (image.width - sourceWidth) / 2);
  const offsetY = Math.max(0, (image.height - sourceHeight) / 2);
  const out = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor(offsetY + (y + 0.5) / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor(offsetX + (x + 0.5) / scale));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * targetWidth + x) * 4;
      image.rgba.copy(out, dst, src, src + 4);
    }
  }

  return { width: targetWidth, height: targetHeight, rgba: out };
}

function encodeRgbaPng(image) {
  const zlib = require('zlib');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = image.width * 4 + 1;
  const raw = Buffer.alloc(stride * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    image.rgba.copy(raw, row + 1, y * image.width * 4, (y + 1) * image.width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 7 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createArticleImageThumbnail(sourceFilePath, thumbnailFilePath, options = {}) {
  const source = fs.readFileSync(sourceFilePath);
  const decoded = decodePngToRgba(source);
  const resized = resizeRgbaCover(
    decoded,
    options.width || CARD_THUMBNAIL_WIDTH,
    options.height || CARD_THUMBNAIL_HEIGHT,
  );
  fs.mkdirSync(path.dirname(thumbnailFilePath), { recursive: true });
  fs.writeFileSync(thumbnailFilePath, encodeRgbaPng(resized));
  return thumbnailFilePath;
}

function ensureArticleImageThumbnail(coverPublicPath, options = {}) {
  const thumbnailPublicPath = thumbnailPublicPathForCover(coverPublicPath);
  if (!thumbnailPublicPath) return null;
  const sourceFilePath = publicImageFilePath(coverPublicPath, options);
  if (!fs.existsSync(sourceFilePath)) return null;
  const thumbnailFilePath = publicImageFilePath(thumbnailPublicPath, options);
  if (fs.existsSync(thumbnailFilePath)) return thumbnailPublicPath;

  try {
    createArticleImageThumbnail(sourceFilePath, thumbnailFilePath, options.thumbnail || {});
    return thumbnailPublicPath;
  } catch {
    return null;
  }
}

function clearArticleImageForView(article = {}) {
  return {
    ...article,
    cover_image: null,
    cover_thumbnail: null,
    card_image: null,
    image_review_status: null,
    image_missing: true,
  };
}

function prepareArticleImageForView(article = {}, options = {}) {
  if (!article.cover_image || article.image_review_status !== 'pass') {
    return { ...article, card_image: null, cover_thumbnail: article.cover_thumbnail || null };
  }

  const coverImage = normalizePublicImagePath(article.cover_image);
  if (!fs.existsSync(publicImageFilePath(coverImage, options))) {
    return clearArticleImageForView(article);
  }

  let coverThumbnail = article.cover_thumbnail ? normalizePublicImagePath(article.cover_thumbnail) : null;
  if (coverThumbnail && !fs.existsSync(publicImageFilePath(coverThumbnail, options))) coverThumbnail = null;
  if (!coverThumbnail) coverThumbnail = ensureArticleImageThumbnail(coverImage, options);

  return {
    ...article,
    cover_image: coverImage,
    cover_thumbnail: coverThumbnail,
    card_image: coverThumbnail || coverImage,
  };
}

function prepareArticlesForView(articles = [], options = {}) {
  return articles.map(article => prepareArticleImageForView(article, options));
}

function clearArticleImageRecord(page) {
  page.cover_image = null;
  page.cover_thumbnail = null;
  page.image_alt = null;
  page.image_prompt = null;
  page.image_review_status = null;
  page.image_review_reason = 'missing_image_file';
  page.image_provider = null;
  page.image_model = null;
  page.image_generated_at = null;
}

function repairArticleImageRecords(options = {}) {
  const db = options.db || require('../db/database');
  const store = db.getDb();
  const pages = Array.isArray(store.pages) ? store.pages : [];
  let missingCleared = 0;
  let thumbnailsBackfilled = 0;
  let changed = false;

  for (const page of pages) {
    if (!page.cover_image || page.image_review_status !== 'pass') continue;
    const coverImage = normalizePublicImagePath(page.cover_image);
    if (!fs.existsSync(publicImageFilePath(coverImage, options))) {
      clearArticleImageRecord(page);
      missingCleared += 1;
      changed = true;
      continue;
    }

    let coverThumbnail = page.cover_thumbnail ? normalizePublicImagePath(page.cover_thumbnail) : null;
    if (coverThumbnail && !fs.existsSync(publicImageFilePath(coverThumbnail, options))) coverThumbnail = null;
    if (!coverThumbnail) coverThumbnail = ensureArticleImageThumbnail(coverImage, options);
    if (coverThumbnail && page.cover_thumbnail !== coverThumbnail) {
      page.cover_thumbnail = coverThumbnail;
      thumbnailsBackfilled += 1;
      changed = true;
    }
  }

  if (changed && typeof db.saveDb === 'function') db.saveDb();
  return { missingCleared, thumbnailsBackfilled, changed };
}

function safeSlug(value) {
  return String(value || 'article')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'article';
}

function generatedImageStorageDir(options = {}) {
  if (options.imageStorageDir) return options.imageStorageDir;
  if (options.publicDir) return path.join(options.publicDir, 'generated-images');
  return path.join(__dirname, '..', 'data', 'generated-images');
}

function saveGeneratedArticleImage(article, imageResult, options = {}) {
  const storageDir = generatedImageStorageDir(options);
  const relativeDir = 'articles';
  const targetDir = path.join(storageDir, relativeDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const hash = crypto
    .createHash('sha1')
    .update(imageResult.buffer)
    .update(String(Date.now()))
    .digest('hex')
    .slice(0, 10);
  const ext = imageExtension(imageResult.buffer, imageResult.mimeType);
  const filename = `${safeSlug(article.slug || article.title)}-${hash}.${ext}`;
  const filePath = path.join(targetDir, filename);
  fs.writeFileSync(filePath, imageResult.buffer);
  const publicPath = `${GENERATED_IMAGES_PUBLIC_PREFIX}/${path.posix.join('articles', filename)}`;
  const thumbnailPath = ensureArticleImageThumbnail(publicPath, options);
  return {
    filePath,
    publicPath,
    thumbnailPath,
  };
}

function readImageDimensions(buffer) {
  if (buffer.length >= 28 && buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7), format: 'jpg' };
      }
      offset += 2 + length;
    }
  }

  if (buffer.length >= 30 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buffer.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height, format: 'webp' };
    }
  }

  return null;
}

function promptRequestsTextLikeAssets(prompt = '') {
  const value = String(prompt || '');
  if (!/(鏂囧瓧|姘村嵃|\b(?:text|logos?|watermarks?|typography|captions?|signboards?|brand marks?|ui labels?|screenshots?)\b)/i.test(value)) {
    return false;
  }
  return !/(no\s+(?:readable\s+|pseudo\s+|visible\s+)?(?:text|ui labels?|numbers?|logo|logos|watermarks?|screenshots?)|without\s+readable\s+labels|typography-free|all\s+surfaces\s+blank|text-bearing\s+surfaces?\s+blank|surfaces?\s+(?:blank|turned away|out of focus)|abstract\s+non-legible|non-legible\s+shapes?|cropped away|avoid[^.]{0,140}(?:brand marks?|watermarks?|captions?|signboards?|logos?|text|screenshots?|ui labels?)|do not[^.]{0,120}(?:visible ui|readable words?|pseudo text|text|logos?|watermarks?|screenshots?)|涓嶈鏂囧瓧|no logo|鏃犳枃瀛?)/i.test(value);
}

function reviewGeneratedImage({ filePath, prompt }) {
  if (!filePath || !fs.existsSync(filePath)) return { status: 'failed', reason: 'missing_file' };
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < MIN_IMAGE_BYTES) return { status: 'failed', reason: `size_too_small:${buffer.length}` };
  const dimensions = readImageDimensions(buffer);
  if (dimensions) {
    if (dimensions.width < MIN_IMAGE_WIDTH || dimensions.height < MIN_IMAGE_HEIGHT) {
      return { status: 'failed', reason: `dimension_too_small:${dimensions.width}x${dimensions.height}` };
    }
    const ratio = dimensions.width / dimensions.height;
    if (ratio < 0.8 || ratio > 2.4) return { status: 'failed', reason: `bad_aspect_ratio:${ratio.toFixed(2)}` };
  }
  if (!promptRequestsTextLikeAssets(prompt)) {
    return { status: 'pass', reason: 'technical_review_passed', dimensions };
  }
  if (promptRequestsTextLikeAssets(prompt)) {
    return { status: 'review', reason: 'prompt_may_request_text', dimensions };
  }
  if (/(文字|text|logo|watermark|水印)/i.test(prompt || '') && !/(no text|不要文字|no logo|无文字)/i.test(prompt || '')) {
    return { status: 'review', reason: 'prompt_may_request_text', dimensions };
  }
  return { status: 'pass', reason: 'technical_review_passed', dimensions };
}

function reviewTextWithoutNegatedIssues(review = {}) {
  return [
    review.reason,
    review.summary,
    ...(Array.isArray(review.issues) ? review.issues : []),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\b(?:has no|no|without|free of|does not contain)\s+[^.;]*?(?:text|logos?|watermarks?|ui labels?|screenshots?)(?:\s*(?:,|or|and)\s*(?:text|logos?|watermarks?|ui labels?|screenshots?))*[^.;]*/gi, ' ')
    .replace(/\b(?:no|not|without|free of|does not contain|has no|no obvious)\s+(?:visible\s+|obvious\s+|readable\s+|garbled\s+|gibberish\s+|pseudo\s+)*(?:text|letters?|logos?|watermarks?|screenshots?|captions?|signboards?|brand marks?|ui labels?|broken anatomy|distorted faces?|malformed hands?|severe clutter)(?:[^.;,]*)/gi, ' ')
    .replace(/\b(?:not|not a|not an|does not look|is not|isn't|isnt|without)\s+(?:99%\s+generic|generic\/repeated|duplicated[-\s]?template|template[-\s]?like|clearly unrelated|misleading)(?:[^.;,]*)/gi, ' ')
    .replace(/(?:没有|无|未发现|不存在|不含|没有明显)[^。；;,.，]{0,40}(?:乱码|伪文字|水印|标志|logo|可读文字|明显文字|畸形|严重杂乱)/g, ' ')
    .toLowerCase();
}

function hasDisqualifyingSemanticIssue(review = {}) {
  const text = reviewTextWithoutNegatedIssues(review);
  return /(?:garbled|gibberish|pseudo[-\s]?text|readable text|visible text|text on|ui labels?|watermarks?|logos?|brand marks?|screenshots?|broken anatomy|distorted faces?|malformed hands?|severe clutter|clearly unrelated|misleading|duplicated[-\s]?template|99% generic|乱码|伪文字|水印|标志|可读文字|明显文字|屏幕文字|畸形|严重杂乱|明显无关)/i.test(text);
}

function normalizeSemanticImageReview(review = {}, technicalReview = {}) {
  const reviewerMeta = review.__reviewerMeta || review.reviewerMeta || {};
  if (review?.required_json && typeof review.required_json === 'object') {
    review = review.required_json;
  }
  const rawScore = Number(review.score ?? review.quality_score ?? review.qualityScore ?? 0);
  const score = Number.isFinite(rawScore) && rawScore > 0 && rawScore <= 10 ? rawScore * 10 : rawScore;
  const hasHardIssue = hasDisqualifyingSemanticIssue(review);
  const issues = Array.isArray(review.issues) ? review.issues.slice(0, 8) : [];
  const hasMeaningfulScore = Number.isFinite(score) && score > 0;
  const lowIssueScore = Number.isFinite(score) && score > 0 && score < 50 && issues.length > 0;
  const approved = review.approved === true || review.pass === true || review.status === 'pass' || score >= 75;
  const explicitReject = review.approved === false || review.pass === false || review.status === 'failed' || review.status === 'reject';
  const uninformativeReject = explicitReject && !approved && !hasHardIssue && !lowIssueScore && issues.length === 0 && !hasMeaningfulScore;
  const rejected = hasHardIssue || lowIssueScore || (explicitReject && !uninformativeReject && (!approved || issues.length > 0));
  const status = uninformativeReject ? 'pass' : (rejected ? 'failed' : (approved ? 'pass' : (review.status === 'review' ? 'review' : 'failed')));
  const reason = String(review.reason || review.summary || (status === 'pass' ? 'semantic_review_passed' : 'semantic_review_failed')).slice(0, 500);
  return {
    ...technicalReview,
    status,
    reason,
    semantic_status: uninformativeReject ? 'uninformative_reject_ignored' : undefined,
    semantic_score: hasMeaningfulScore ? score : null,
    semantic_issues: issues,
    reviewer_provider: reviewerMeta.provider || '',
    reviewer_model: reviewerMeta.model || '',
    reviewer_reason: reviewerMeta.reason || '',
    reviewer_creator_score: reviewerMeta.creatorScore ?? null,
    reviewer_score: reviewerMeta.reviewerScore ?? null,
  };
}

function imageMimeType(filePath, buffer) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (buffer?.[0] === 0xff && buffer?.[1] === 0xd8) return 'image/jpeg';
  if (buffer?.slice?.(0, 4).toString('ascii') === 'RIFF') return 'image/webp';
  return 'image/png';
}

function buildImageReviewMessages({ article, prompt, dataUrl }) {
  return [
    {
      role: 'system',
      content: 'You are an MVP quality gate for editorial article cover images. Return JSON only.',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            article: {
              title: article?.title || '',
              summary: article?.summary || '',
              category: article?.category_name || '',
            },
            image_prompt: prompt,
            required_json: {
              status: 'pass or failed',
              score: 0,
              reason: 'short reason',
              issues: [],
            },
            rules: [
              'MVP gate: judge whether the image is basically usable for this article, not whether it is award-winning art.',
              'The website may be food, travel, lifestyle, finance, technology, culture, education, health, local news or any other topic. Review against the article domain itself.',
              'Pass if the image is basically relevant to the article, visually coherent, not 99% generic/repeated, and has no obvious gibberish text, watermarks, logos, broken anatomy or severe clutter.',
              'Fail if the image contains visible readable text, pseudo text, garbled text, UI labels, logos, watermarks or screenshots, even if the overall subject is relevant.',
              'People are allowed when contextually relevant, especially in travel, food, lifestyle, education, health or local scenes. Fail only for obvious distorted faces, prominent malformed hands, celebrity-like fake portraits, or irrelevant people.',
              'Do not fail merely because the image model quality is ordinary. Fail only if the image is clearly unrelated, mostly unreadable/garbled, duplicated-template-like, visually broken, or misleading for the article.',
            ],
          }),
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
}

async function reviewImageWithAI({ filePath, prompt, article }, options = {}) {
  const buffer = fs.readFileSync(filePath);
  const dataUrl = `data:${imageMimeType(filePath, buffer)};base64,${buffer.toString('base64')}`;
  const { callAIForJSON } = require('./client');
  const creatorModel = options.creatorModel || article?.image_planner_model || article?.ai_model || article?.model || '';
  const result = await callAIForJSON(
    buildImageReviewMessages({ article, prompt, dataUrl }),
    {
      taskType: 'image_review',
      maxTokens: 800,
      temperature: 0,
      moa: false,
      requireVision: true,
      reviewCapability: 'vision',
      preferReviewerOverModel: creatorModel,
      timeoutMs: options.timeoutMs || DEFAULT_IMAGE_TIMEOUT_MS,
    },
  );

  const routing = result.reviewRouting || {};
  return {
    ...result.data,
    __reviewerMeta: {
      provider: result.provider || '',
      model: result.model || '',
      reason: routing.reason || '',
      creatorScore: routing.creatorScore,
      reviewerScore: routing.reviewerScore,
    },
  };
}

async function reviewArticleImage({ filePath, prompt, article }, options = {}) {
  const technicalReview = reviewGeneratedImage({ filePath, prompt, article });
  if (technicalReview.status !== 'pass') return technicalReview;

  if (options.reviewer) {
    return normalizeSemanticImageReview(await options.reviewer({ filePath, prompt, article, technicalReview }), technicalReview);
  }

  if (options.semanticReview === false) return technicalReview;

  try {
    return normalizeSemanticImageReview(await reviewImageWithAI({ filePath, prompt, article }, options), technicalReview);
  } catch (err) {
    return {
      ...technicalReview,
      reason: `technical_review_passed; semantic_review_unavailable:${String(err?.message || err || '').slice(0, 160)}`,
      semantic_status: 'unavailable',
    };
  }
}

function markImageProviderFailure(provider, err) {
  const errorType = classifyImageProviderError(err);
  const updates = {
    last_error: String(err?.message || err || '').slice(0, 500),
    last_error_type: errorType,
    last_error_at: timestamp(),
  };
  if (errorType === 'auth') {
    updates.enabled = false;
    updates.disabled_reason = 'auth_error';
  }
  try { require('../db/database').updateImageProvider(provider.id, updates); } catch {}
  return errorType;
}

function markImageProviderSuccess(provider, result = {}) {
  try {
    require('../db/database').updateImageProvider(provider.id, {
      last_success_at: timestamp(),
      last_error_type: null,
      last_error: null,
      disabled_reason: provider.disabled_reason === 'auth_error' ? provider.disabled_reason : null,
      last_model: result.model || '',
    });
  } catch {}
}

async function generateImageWithProviders(prompt, options = {}) {
  const db = require('../db/database');
  const providers = rankImageProviders((options.providers || db.getImageProviders()).filter(p => p.enabled));
  if (providers.length === 0) throw new Error('No enabled image providers');
  let lastError = null;

  for (const provider of providers) {
    try {
      const result = await callImageProvider(provider, prompt, options);
      if (!options.providers) db.incrementImageProviderUsage(provider.id, true);
      markImageProviderSuccess(provider, result);
      return result;
    } catch (err) {
      lastError = err;
      if (!options.providers) db.incrementImageProviderUsage(provider.id, false);
      markImageProviderFailure(provider, err);
    }
  }

  throw new Error(`All image providers failed: ${lastError?.message || 'unknown error'}`);
}

async function testImageProvider(provider, options = {}) {
  try {
    const result = await callImageProvider(
      provider,
      'A simple polished abstract editorial cover image, clean composition, soft light, no text, no logo, no watermark.',
      { ...options, first: true, size: options.size || DEFAULT_IMAGE_SIZE },
    );
    const dimensions = readImageDimensions(result.buffer);
    if (result.buffer.length < MIN_IMAGE_BYTES) {
      return { success: false, provider: provider.name, model: result.model, error: '生成图片体积过小' };
    }
    if (dimensions && (dimensions.width < MIN_IMAGE_WIDTH || dimensions.height < MIN_IMAGE_HEIGHT)) {
      return { success: false, provider: provider.name, model: result.model, error: `生成图片尺寸过小: ${dimensions.width}x${dimensions.height}` };
    }
    return {
      success: true,
      provider: provider.name,
      model: result.model,
      message: `生图连接成功${dimensions ? ` (${dimensions.width}x${dimensions.height})` : ''}`,
      bytes: result.buffer.length,
      dimensions,
    };
  } catch (err) {
    return { success: false, provider: provider.name, error: err.message };
  }
}

async function generateArticleImage(article, options = {}) {
  const db = require('../db/database');
  const config = options.config || require('../config').getConfig();
  const providers = options.providers || db.getImageProviders();
  const decision = shouldAttemptArticleImage(article, config, providers, options);
  if (!decision.ok) return { skipped: true, reason: decision.reason };

  const plan = await planArticleImage(article, options);
  if (!plan.needed) return { skipped: true, reason: plan.reason || 'planner_skipped', plan };

  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxImageAttempts || 3) || 3));
  let lastFailure = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptPlan = {
      ...plan,
      prompt: attempt === 1 ? plan.prompt : buildRetryArticleImagePrompt(article, plan.prompt, lastFailure?.review || {}, attempt),
    };
    const imageResult = await generateImageWithProviders(attemptPlan.prompt, options);
    const saved = saveGeneratedArticleImage(article, imageResult, options);
    const review = await reviewArticleImage({ filePath: saved.filePath, prompt: attemptPlan.prompt, article }, options);
    if (review.status === 'pass') {
      return {
        skipped: false,
        coverImage: saved.publicPath,
        coverThumbnail: saved.thumbnailPath,
        imageAlt: plan.alt,
        imagePrompt: attemptPlan.prompt,
        imageReason: plan.reason,
        review,
        provider: imageResult.provider,
        model: imageResult.model,
        sourceUrl: imageResult.sourceUrl,
        attempts: attempt,
      };
    }

    try { fs.unlinkSync(saved.filePath); } catch {}
    lastFailure = {
      skipped: true,
      reason: `image_review_${review.status}`,
      plan: attemptPlan,
      review,
      provider: imageResult.provider,
      model: imageResult.model,
      attempts: attempt,
    };
  }

  return {
    ...(lastFailure || { reason: 'image_review_failed', plan }),
    skipped: true,
  };
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(fullPath));
    else result.push(fullPath);
  }
  return result;
}

function normalizePublicImagePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  const generatedIndex = normalized.indexOf('/generated-images/articles/');
  if (generatedIndex >= 0) return normalized.slice(generatedIndex);
  const index = normalized.indexOf('/images/articles/');
  return index >= 0 ? normalized.slice(index) : normalized;
}

function cleanupArticleImages(options = {}) {
  const storageDir = generatedImageStorageDir(options);
  const articleDir = path.join(storageDir, 'articles');
  const referenced = new Set((options.referencedImages || []).map(normalizePublicImagePath));
  const cutoff = Number.isFinite(Number(options.olderThanDays))
    ? Date.now() - Number(options.olderThanDays) * 86400000
    : null;
  const files = walkFiles(articleDir)
    .map(filePath => {
      const stat = fs.statSync(filePath);
      const relative = `${GENERATED_IMAGES_PUBLIC_PREFIX}/${path.relative(storageDir, filePath).replace(/\\/g, '/')}`;
      return { filePath, relative, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  let totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const maxTotalBytes = Number(options.maxTotalBytes || 0);
  let removed = 0;
  let removedBytes = 0;

  for (const file of files) {
    const isReferenced = referenced.has(normalizePublicImagePath(file.relative));
    const tooOld = cutoff !== null && file.mtimeMs < cutoff;
    const overLimit = maxTotalBytes > 0 && totalBytes > maxTotalBytes;
    if (isReferenced || (!tooOld && !overLimit)) continue;
    try {
      fs.unlinkSync(file.filePath);
      totalBytes -= file.size;
      removed += 1;
      removedBytes += file.size;
    } catch {}
  }

  return { removed, removedBytes, remainingBytes: totalBytes };
}

module.exports = {
  DEFAULT_IMAGE_SIZE,
  DEFAULT_IMAGE_TIMEOUT_MS,
  GENERATED_IMAGES_PUBLIC_PREFIX,
  parseImageProviderKeys,
  parseImageProviderModels,
  resetImageProviderKeyCursor,
  normalizeImageEndpoint,
  chooseImageProviderCredential,
  rankImageProviders,
  classifyImageProviderError,
  callImageProvider,
  isImageGenerationAvailable,
  shouldAttemptArticleImage,
  planArticleImage,
  generateImageWithProviders,
  testImageProvider,
  generateArticleImage,
  reviewGeneratedImage,
  buildImageReviewMessages,
  reviewArticleImage,
  ensureArticleImageThumbnail,
  prepareArticleImageForView,
  prepareArticlesForView,
  repairArticleImageRecords,
  createArticleImageThumbnail,
  cleanupArticleImages,
  readImageDimensions,
};

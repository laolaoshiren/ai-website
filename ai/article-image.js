const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_IMAGE_SIZE = '1024x768';
const DEFAULT_IMAGE_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_IMAGE_BYTES = 12 * 1024;
const MIN_IMAGE_WIDTH = 512;
const MIN_IMAGE_HEIGHT = 384;
const GENERATED_IMAGES_PUBLIC_PREFIX = '/generated-images';

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
  const sourceIsSafe = !!sourceContext && !hasUnsafeImageSubject(sourcePrompt);
  const visualBrief = sourceIsSafe ? sourceContext : articleContext;
  const seed = article.slug || article.id || article.title || visualBrief;
  const treatment = selectUniversalImageTreatment(seed || articleContext);
  const primaryVisualBrief = sourceIsSafe
    ? visualBrief
    : 'derive the visible subject from Article focus and the article domain itself. Choose the most relevant concrete subject, scene, person-in-context, process, place, object, food, document, landscape, atmosphere or symbolic detail; do not use a preset theme.';

  return [
    'Editorial cover image for a real article, modern magazine quality.',
    `Article focus: ${articleContext || 'the core idea of the article'}.`,
    `Primary visual brief: ${primaryVisualBrief}.`,
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
        content: 'You are a senior human picture editor and editorial art director for a Chinese web magazine. Read the article, choose a concrete, relevant cover-image concept, and write one safe image-generation prompt. Return JSON only.',
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
            visual_angle: 'one-sentence explanation of the editorial image idea',
            prompt: 'specific image-generation prompt; no text, no logos, no clutter',
          },
          rules: [
            'This system is domain-neutral. The website may be about food, travel, lifestyle, finance, technology, culture, education, health, local news or any other topic. Use the article domain itself; never force a technology style onto non-technology articles.',
            'The image must match the core idea and concrete details of the article, like a human editor selected it for this exact story.',
            'First mentally summarize the article into one visual angle, then write the prompt from that angle.',
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
  return {
    filePath,
    publicPath: `${GENERATED_IMAGES_PUBLIC_PREFIX}/${path.posix.join('articles', filename)}`,
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
  if (!/(鏂囧瓧|text|logo|watermark|姘村嵃|typography|caption|signboard|brand mark)/i.test(value)) {
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
  const score = Number(review.score ?? review.quality_score ?? review.qualityScore ?? 0);
  const hasHardIssue = hasDisqualifyingSemanticIssue(review);
  const lowIssueScore = Number.isFinite(score) && score > 0 && score < 50 && Array.isArray(review.issues) && review.issues.length > 0;
  const approved = review.approved === true || review.pass === true || review.status === 'pass' || score >= 75;
  const rejected = review.approved === false || review.pass === false || review.status === 'failed' || review.status === 'reject' || hasHardIssue || lowIssueScore;
  const status = rejected ? 'failed' : (approved ? 'pass' : (review.status === 'review' ? 'review' : 'failed'));
  const reason = String(review.reason || review.summary || (status === 'pass' ? 'semantic_review_passed' : 'semantic_review_failed')).slice(0, 500);
  return {
    ...technicalReview,
    status,
    reason,
    semantic_score: Number.isFinite(score) && score > 0 ? score : null,
    semantic_issues: Array.isArray(review.issues) ? review.issues.slice(0, 8) : [],
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
  const { data } = await callAIForJSON(
    buildImageReviewMessages({ article, prompt, dataUrl }),
    { taskType: 'image_review', maxTokens: 800, temperature: 0, moa: false, requireVision: true, timeoutMs: options.timeoutMs || DEFAULT_IMAGE_TIMEOUT_MS },
  );

  return data;
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
  cleanupArticleImages,
  readImageDimensions,
};

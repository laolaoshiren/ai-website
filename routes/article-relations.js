function cleanText(value) {
  return String(value || '').trim().toLowerCase();
}

function keywordTokens(article = {}) {
  return String(article.seo_keywords || '')
    .split(/[,，、]/)
    .map(cleanText)
    .filter(Boolean);
}

function titleTokens(article = {}) {
  return Array.from(new Set(
    cleanText(article.title)
      .match(/[a-z0-9+#.-]{3,}|[\u4e00-\u9fa5]{2,}/g) || []
  ));
}

function relationScore(current, candidate) {
  let score = 0;
  const currentKeywords = keywordTokens(current);
  const candidateKeywords = keywordTokens(candidate);
  const candidateTitle = cleanText(candidate.title);
  const currentTitleTokens = titleTokens(current);
  const candidateTitleTokens = new Set(titleTokens(candidate));

  if (current.category_id && candidate.category_id === current.category_id) score += 8;

  for (const keyword of currentKeywords) {
    if (candidateKeywords.includes(keyword)) score += 8;
    else if (keyword.length >= 3 && candidateTitle.includes(keyword)) score += 6;
  }

  for (const token of currentTitleTokens) {
    if (candidateTitleTokens.has(token)) score += 2;
  }

  score += Math.min(Number(candidate.view_count || 0) / 100, 3);
  return score;
}

function buildArticleRelations(article, allArticles = [], options = {}) {
  const relatedLimit = options.relatedLimit || 3;
  const pathLimit = options.pathLimit || 4;
  const candidates = allArticles
    .filter(candidate => candidate && candidate.id !== article?.id)
    .filter(candidate => !candidate.status || candidate.status === 'published')
    .map(candidate => ({ ...candidate, _relationScore: relationScore(article || {}, candidate) }))
    .filter(candidate => candidate._relationScore > 0)
    .sort((a, b) =>
      b._relationScore - a._relationScore ||
      String(b.published_at || '').localeCompare(String(a.published_at || '')) ||
      Number(b.view_count || 0) - Number(a.view_count || 0)
    )
    .map(({ _relationScore, ...candidate }) => candidate);

  return {
    relatedArticles: candidates.slice(0, relatedLimit),
    topicPath: candidates.slice(0, pathLimit),
  };
}

module.exports = {
  buildArticleRelations,
  relationScore,
};

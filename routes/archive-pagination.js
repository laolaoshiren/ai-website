const ARCHIVE_ARTICLES_PER_PAGE = 30;

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getArchiveMonth(article) {
  const month = String(article?.published_at || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

function groupByMonth(articles) {
  const groups = new Map();

  for (const article of articles) {
    const month = getArchiveMonth(article);
    if (!month) continue;
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(article);
  }

  return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

function buildArchivePagination(articles, requestedPage, options = {}) {
  const perPage = toPositiveInteger(options.perPage, ARCHIVE_ARTICLES_PER_PAGE);
  const archiveArticles = Array.isArray(articles) ? articles.filter(getArchiveMonth) : [];
  const totalArticles = archiveArticles.length;
  const totalPages = Math.max(1, Math.ceil(totalArticles / perPage));
  const page = Math.min(toPositiveInteger(requestedPage, 1), totalPages);
  const startIndex = totalArticles > 0 ? (page - 1) * perPage : 0;
  const pageArticles = archiveArticles.slice(startIndex, startIndex + perPage);

  return {
    archive: groupByMonth(pageArticles),
    page,
    perPage,
    totalArticles,
    totalPages,
    totalMonths: groupByMonth(archiveArticles).length,
    startArticle: totalArticles > 0 ? startIndex + 1 : 0,
    endArticle: totalArticles > 0 ? startIndex + pageArticles.length : 0,
  };
}

module.exports = {
  ARCHIVE_ARTICLES_PER_PAGE,
  buildArchivePagination,
};

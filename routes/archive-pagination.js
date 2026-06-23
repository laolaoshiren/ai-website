const ARCHIVE_ARTICLES_PER_PAGE = 30;
const { buildPagination } = require('./pagination');

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
  const pagination = buildPagination({
    totalItems: totalArticles,
    requestedPage,
    perPage,
    basePath: options.basePath || '/archive',
    query: options.query,
  });
  const pageArticles = archiveArticles.slice(pagination.offset, pagination.offset + pagination.perPage);

  return {
    archive: groupByMonth(pageArticles),
    page: pagination.page,
    perPage: pagination.perPage,
    totalArticles,
    totalPages: pagination.totalPages,
    totalMonths: groupByMonth(archiveArticles).length,
    startArticle: pagination.startItem,
    endArticle: pagination.endItem,
    pagination,
  };
}

module.exports = {
  ARCHIVE_ARTICLES_PER_PAGE,
  buildArchivePagination,
};

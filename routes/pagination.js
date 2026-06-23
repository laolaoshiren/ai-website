const DEFAULT_PER_PAGE = 20;
const DEFAULT_WINDOW_SIZE = 2;

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanQuery(query) {
  const result = {};
  for (const [key, value] of Object.entries(query || {})) {
    if (key === 'page' || value === undefined || value === null || value === '') continue;
    result[key] = value;
  }
  return result;
}

function buildHref(basePath, query, page) {
  const params = new URLSearchParams(cleanQuery(query));
  params.set('page', String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : `${basePath}?page=${page}`;
}

function buildWindow(page, totalPages, windowSize) {
  const pages = new Set([1, totalPages]);
  for (let i = page - windowSize; i <= page + windowSize; i += 1) {
    if (i >= 1 && i <= totalPages) pages.add(i);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const items = [];
  let previous = 0;

  for (const current of sorted) {
    if (previous && current - previous > 1) {
      items.push({ type: 'ellipsis' });
    }
    items.push({ type: 'page', page: current });
    previous = current;
  }

  return items;
}

function buildPagination(options) {
  const totalItems = Math.max(0, toPositiveInteger(options?.totalItems, 0));
  const perPage = toPositiveInteger(options?.perPage, DEFAULT_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  const page = Math.min(toPositiveInteger(options?.requestedPage, 1), totalPages);
  const offset = totalItems > 0 ? (page - 1) * perPage : 0;
  const basePath = options?.basePath || '';
  const query = options?.query || {};
  const windowSize = toPositiveInteger(options?.windowSize, DEFAULT_WINDOW_SIZE);

  const items = buildWindow(page, totalPages, windowSize).map((item) => {
    if (item.type !== 'page') return item;
    return {
      ...item,
      href: buildHref(basePath, query, item.page),
      isCurrent: item.page === page,
    };
  });

  return {
    page,
    perPage,
    totalItems,
    totalPages,
    offset,
    startItem: totalItems > 0 ? offset + 1 : 0,
    endItem: totalItems > 0 ? Math.min(offset + perPage, totalItems) : 0,
    prevHref: page > 1 ? buildHref(basePath, query, page - 1) : null,
    nextHref: page < totalPages ? buildHref(basePath, query, page + 1) : null,
    items,
  };
}

module.exports = {
  buildPagination,
};

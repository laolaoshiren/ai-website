/**
 * 客户端分析数据采集
 * 无外部依赖，轻量级页面追踪
 */
(function() {
  'use strict';

  var startTime = Date.now();
  var maxScroll = 0;
  var pagePath = window.location.pathname;

  // 只在文章页采集详细数据
  var isArticlePage = pagePath.indexOf('/article/') === 0;
  if (!isArticlePage) return;
  var pageSlug = '';
  try {
    pageSlug = decodeURIComponent(pagePath.replace(/^\/article\//, '').replace(/^\/+/, ''));
  } catch(e) {
    pageSlug = pagePath.replace(/^\/article\//, '').replace(/^\/+/, '');
  }

  // 记录最大滚动深度
  function trackScroll() {
    var scrollPercent = Math.round(
      (window.scrollY + window.innerHeight) / document.body.scrollHeight * 100
    );
    if (scrollPercent > maxScroll) maxScroll = scrollPercent;
  }

  // 发送数据
  function send(data) {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics', new Blob([JSON.stringify(data)], { type: 'application/json' }));
      } else {
        fetch('/api/analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          keepalive: true
        }).catch(function() {});
      }
    } catch(e) {}
  }

  // 页面浏览
  send({ page_slug: pageSlug, event_type: 'pageview' });

  // 滚动追踪
  var scrollTimer = null;
  window.addEventListener('scroll', function() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(trackScroll, 200);
  }, { passive: true });

  // 停留时间和滚动深度
  window.addEventListener('beforeunload', function() {
    var duration = Math.round((Date.now() - startTime) / 1000);
    if (duration < 3) return; // 忽略快速跳出
    send({ page_slug: pageSlug, event_type: 'time_on_page', value: duration });
    send({ page_slug: pageSlug, event_type: 'scroll_depth', value: maxScroll });
  });
})();

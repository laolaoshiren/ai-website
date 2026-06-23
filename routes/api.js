/**
 * API 路由 - 分析数据接收、健康检查
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { recordAnalytics, getPageBySlug, getStats } = require('../db/database');

// 简单限流：每 IP 每分钟最多 30 次
const rateLimitMap = new Map();
setInterval(() => rateLimitMap.clear(), 60000);
function rateLimit(req, res, next) {
  const ip = req.ip;
  const count = rateLimitMap.get(ip) || 0;
  if (count >= 30) return res.status(429).json({ error: '请求过于频繁' });
  rateLimitMap.set(ip, count + 1);
  next();
}

// 接收分析数据
router.post('/analytics', rateLimit, (req, res) => {
  try {
    const { page_slug, event_type, value, referrer } = req.body;
    if (!page_slug || !event_type) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const page = getPageBySlug(page_slug);
    const ip_hash = crypto.createHash('md5').update(req.ip || 'unknown').digest('hex').slice(0, 8);

    recordAnalytics({
      page_id: page?.id || null,
      page_slug,
      event_type,
      value: value ? parseFloat(value) : null,
      referrer: referrer || req.get('referer') || null,
      user_agent: req.get('user-agent') || null,
      ip_hash,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('分析数据记录失败:', err);
    res.status(500).json({ error: '内部错误' });
  }
});

// 健康检查
router.get('/health', (req, res) => {
  const stats = getStats();
  res.json({ status: 'ok', timestamp: new Date().toISOString(), stats });
});

module.exports = router;

const path = require('path');
const { createZip, extractZip } = require('./zip-store');
const db = require('../db/database');

const BACKUP_SECTIONS = [
  { id: 'ai_providers', label: 'AI 提供商', filename: 'ai-providers.json' },
  { id: 'ads', label: '广告', filename: 'ads.json' },
  { id: 'friend_links', label: '友情链接', filename: 'friend-links.json' },
  { id: 'tavily_keys', label: 'Tavily KEY', filename: 'tavily-keys.json' },
  { id: 'site_settings', label: '网站设置', filename: 'site-settings.json' },
];

const SECTION_BY_ID = new Map(BACKUP_SECTIONS.map(section => [section.id, section]));
const SECTION_BY_FILE = new Map(BACKUP_SECTIONS.map(section => [section.filename, section]));
const SITE_SETTING_EXCLUDES = new Set(['_sessions', 'tavily_api_key']);

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeSections(input) {
  const values = Array.isArray(input) ? input : [input];
  const ids = values.map(value => String(value || '').trim()).filter(Boolean);
  return [...new Set(ids)].filter(id => SECTION_BY_ID.has(id));
}

function nowIso() {
  return new Date().toISOString();
}

function sectionPayload(sectionId) {
  const data = db.getDb();
  const exportedAt = nowIso();
  if (sectionId === 'ai_providers') {
    return {
      type: sectionId,
      exported_at: exportedAt,
      ai_providers: clone(data.ai_providers || []),
      image_providers: clone(data.image_providers || []),
    };
  }
  if (sectionId === 'ads') {
    return { type: sectionId, exported_at: exportedAt, ads: clone(data.ads || []) };
  }
  if (sectionId === 'friend_links') {
    return { type: sectionId, exported_at: exportedAt, friend_links: clone(data.friend_links || []) };
  }
  if (sectionId === 'tavily_keys') {
    const raw = String(data.settings?.tavily_api_key || '');
    const keys = raw.split(/\r?\n/).map(key => key.trim()).filter(Boolean);
    return { type: sectionId, exported_at: exportedAt, tavily_api_key: raw, keys };
  }
  if (sectionId === 'site_settings') {
    const settings = {};
    for (const [key, value] of Object.entries(data.settings || {})) {
      if (!SITE_SETTING_EXCLUDES.has(key)) settings[key] = value;
    }
    return { type: sectionId, exported_at: exportedAt, settings };
  }
  throw new Error('未知备份项');
}

function buildBackupZip(sectionIds) {
  const sections = normalizeSections(sectionIds);
  if (sections.length === 0) throw new Error('请至少选择一个备份项');

  const manifest = {
    type: 'ai-website-backup',
    version: 1,
    exported_at: nowIso(),
    sections,
  };
  const files = [
    { name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
    ...sections.map(id => {
      const section = SECTION_BY_ID.get(id);
      return { name: section.filename, data: JSON.stringify(sectionPayload(id), null, 2) };
    }),
  ];
  return createZip(files);
}

function maxId(items) {
  return (Array.isArray(items) ? items : []).reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0);
}

function restoreSection(sectionId, payload) {
  const data = db.getDb();
  if (sectionId === 'ai_providers') {
    data.ai_providers = Array.isArray(payload.ai_providers) ? clone(payload.ai_providers) : [];
    data.image_providers = Array.isArray(payload.image_providers) ? clone(payload.image_providers) : [];
    data._counters.ai_providers = Math.max(Number(data._counters.ai_providers || 0), maxId(data.ai_providers));
    data._counters.image_providers = Math.max(Number(data._counters.image_providers || 0), maxId(data.image_providers));
    return;
  }
  if (sectionId === 'ads') {
    data.ads = Array.isArray(payload.ads) ? clone(payload.ads) : [];
    data._counters.ads = Math.max(Number(data._counters.ads || 0), maxId(data.ads));
    return;
  }
  if (sectionId === 'friend_links') {
    data.friend_links = Array.isArray(payload.friend_links) ? clone(payload.friend_links) : [];
    data._counters.friend_links = Math.max(Number(data._counters.friend_links || 0), maxId(data.friend_links));
    return;
  }
  if (sectionId === 'tavily_keys') {
    const raw = payload.tavily_api_key !== undefined
      ? String(payload.tavily_api_key || '')
      : (Array.isArray(payload.keys) ? payload.keys.join('\n') : '');
    data.settings.tavily_api_key = raw;
    return;
  }
  if (sectionId === 'site_settings') {
    const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {};
    for (const [key, value] of Object.entries(settings)) {
      if (!SITE_SETTING_EXCLUDES.has(key)) data.settings[key] = String(value ?? '');
    }
    return;
  }
  throw new Error('未知还原项');
}

function parseJsonFile(file) {
  const payload = JSON.parse(file.data.toString('utf8'));
  let section = SECTION_BY_FILE.get(path.basename(file.name));
  if (!section && payload.type && SECTION_BY_ID.has(payload.type)) section = SECTION_BY_ID.get(payload.type);
  if (!section) return null;
  return { sectionId: section.id, payload };
}

function readBackupInput(filename, buffer) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.zip')) {
    return extractZip(buffer)
      .filter(file => path.basename(file.name) !== 'manifest.json')
      .map(parseJsonFile)
      .filter(Boolean);
  }
  if (lower.endsWith('.json')) {
    const parsed = parseJsonFile({ name: path.basename(filename), data: buffer });
    return parsed ? [parsed] : [];
  }
  throw new Error('只支持导入 .zip 或 .json 文件');
}

function inspectBackupInput(filename, buffer) {
  const seen = new Set();
  return readBackupInput(filename, buffer)
    .map(file => SECTION_BY_ID.get(file.sectionId))
    .filter(section => {
      if (!section || seen.has(section.id)) return false;
      seen.add(section.id);
      return true;
    })
    .map(section => ({ id: section.id, label: section.label, filename: section.filename }));
}

function restoreBackup(filename, buffer, selectedSections) {
  const selected = new Set(normalizeSections(selectedSections));
  if (selected.size === 0) throw new Error('请至少选择一个还原项');
  const files = readBackupInput(filename, buffer);
  if (files.length === 0) throw new Error('没有找到可还原的备份文件');

  const restored = [];
  for (const file of files) {
    if (!selected.has(file.sectionId)) continue;
    restoreSection(file.sectionId, file.payload);
    restored.push(file.sectionId);
  }
  if (restored.length === 0) throw new Error('导入文件中没有匹配所选还原项的数据');

  db.saveDb();
  try { require('../config').refreshConfig(); } catch {}
  return restored;
}

module.exports = {
  BACKUP_SECTIONS,
  normalizeSections,
  buildBackupZip,
  inspectBackupInput,
  readBackupInput,
  restoreBackup,
};

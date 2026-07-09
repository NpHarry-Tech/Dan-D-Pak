import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, now, uid, audit } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, '..');
const SERVER_ASSET_DIR = join(SERVER_ROOT, 'assets', 'menu-book');
const UPLOAD_BOOK_DIR = join(SERVER_ROOT, 'uploads', 'menu-books');
const MENU_BOOK_KEY = 'book_menu_config';

function readDefaultManifest() {
  const file = join(SERVER_ASSET_DIR, 'manifest.json');
  if (existsSync(file)) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch {}
  }
  return {
    title: 'Menu Bon Appetit Dan',
    pageWidth: 566.929016,
    pageHeight: 850.394043,
    pages: Array.from({ length: 28 }, (_, i) => `/assets/menu-book/${String(i + 1).padStart(2, '0')}.webp`),
  };
}

function defaultConfig() {
  const m = readDefaultManifest();
  return sanitizeConfig({
    activeBookId: 'book_default',
    books: [{
      id: 'book_default',
      title: m.title || 'Menu Bon Appetit Dan',
      pageWidth: Number(m.pageWidth) || 566.929016,
      pageHeight: Number(m.pageHeight) || 850.394043,
      pages: (m.pages || []).map((src, i) => pageObj(src, i)),
      hotspots: [],
      created_at: now(),
      updated_at: now(),
    }],
  });
}

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function safeText(v, fallback = '') {
  return String(v ?? fallback).trim();
}

function pageObj(p, i = 0) {
  if (typeof p === 'string') return { id: `p_${i + 1}`, src: p, label: `Trang ${i + 1}` };
  return {
    id: safeText(p.id, `p_${i + 1}`) || `p_${i + 1}`,
    src: safeText(p.src),
    label: safeText(p.label, `Trang ${i + 1}`) || `Trang ${i + 1}`,
  };
}

function sanitizeHotspot(h = {}, i = 0, pageCount = 1) {
  return {
    id: safeText(h.id, uid('hs_')) || `hs_${i + 1}`,
    page: Math.round(clamp(h.page, 0, Math.max(0, pageCount - 1))),
    x: clamp(h.x, 0, 100),
    y: clamp(h.y, 0, 100),
    angle: clamp(h.angle, -180, 180),
    menu_item_id: safeText(h.menu_item_id),
    label: safeText(h.label),
    enabled: h.enabled !== false,
    color: safeText(h.color, '#0891b2') || '#0891b2',
  };
}

function sanitizeBook(b = {}, i = 0) {
  const pages = (Array.isArray(b.pages) ? b.pages : []).map(pageObj).filter(p => p.src);
  const book = {
    id: safeText(b.id, uid('book_')) || `book_${i + 1}`,
    title: safeText(b.title, `Menu ${i + 1}`) || `Menu ${i + 1}`,
    pageWidth: Number(b.pageWidth) || 566.929016,
    pageHeight: Number(b.pageHeight) || 850.394043,
    pages,
    hotspots: [],
    created_at: safeText(b.created_at, now()),
    updated_at: now(),
  };
  book.hotspots = (Array.isArray(b.hotspots) ? b.hotspots : [])
    .map((h, idx) => sanitizeHotspot(h, idx, Math.max(1, pages.length)))
    .filter(h => h.menu_item_id);
  return book;
}

function sanitizeConfig(cfg = {}) {
  const books = (Array.isArray(cfg.books) ? cfg.books : []).map(sanitizeBook).filter(b => b.pages.length);
  const fallback = books.length ? books : defaultConfig().books;
  const active = fallback.some(b => b.id === cfg.activeBookId) ? cfg.activeBookId : fallback[0].id;
  // enabled: bật/tắt nhanh việc dùng menu quyển tương tác trên iPad. Mặc định bật.
  return { enabled: cfg.enabled !== false, activeBookId: active, books: fallback };
}

function readConfig(branch_id = 'br1') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`).get(branch_id, MENU_BOOK_KEY);
  if (!row?.value) return defaultConfig();
  try { return sanitizeConfig(JSON.parse(row.value)); } catch { return defaultConfig(); }
}

function writeConfig(cfg, branch_id = 'br1') {
  const clean = sanitizeConfig(cfg);
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, MENU_BOOK_KEY, JSON.stringify(clean), now());
  audit('book_menu.update', { activeBookId: clean.activeBookId, books: clean.books.length }, branch_id);
  return clean;
}

export function getBookConfig(branch_id = 'br1') {
  return readConfig(branch_id);
}

export function getPublicBookConfig(branch_id = 'br1') {
  const cfg = readConfig(branch_id);
  const book = cfg.books.find(b => b.id === cfg.activeBookId) || cfg.books[0];
  return { enabled: cfg.enabled !== false, activeBookId: book?.id || null, book };
}

export function saveBookConfig(body = {}, branch_id = 'br1') {
  return writeConfig(body, branch_id);
}

function normalizedPubhtml5Base(rawUrl) {
  const u = new URL(rawUrl);
  if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/[^/]*$/, '/') || '/';
  return u;
}

function parsePubhtml5Config(source) {
  const match = /var\s+htmlConfig\s*=\s*({[\s\S]*?});?\s*$/.exec(source.trim());
  if (!match) throw new Error('Không đọc được config PubHTML5');
  return JSON.parse(match[1]);
}

async function downloadFile(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Không tải được trang menu: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
}

export async function importPubhtml5(rawUrl, title, branch_id = 'br1') {
  const base = normalizedPubhtml5Base(rawUrl);
  const configUrl = new URL('javascript/config.js', base);
  const res = await fetch(configUrl);
  if (!res.ok) throw new Error('Không tải được PubHTML5 config');
  const htmlConfig = parsePubhtml5Config(await res.text());
  const pages = Array.isArray(htmlConfig.fliphtml5_pages) ? htmlConfig.fliphtml5_pages : [];
  if (!pages.length) throw new Error('PubHTML5 không có trang menu để import');

  const bookId = uid('book_');
  const outDir = join(UPLOAD_BOOK_DIR, bookId);
  mkdirSync(outDir, { recursive: true });
  const localPages = [];
  for (let i = 0; i < pages.length; i++) {
    const name = Array.isArray(pages[i].n) ? pages[i].n[0] : pages[i].n;
    if (!name) continue;
    const pageUrl = new URL(`files/large/${name}`, base);
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '.webp';
    const localName = `${String(i + 1).padStart(2, '0')}${ext}`;
    await downloadFile(pageUrl, join(outDir, localName));
    localPages.push({ id: `p_${i + 1}`, src: `/uploads/menu-books/${bookId}/${localName}`, label: `Trang ${i + 1}` });
  }
  if (!localPages.length) throw new Error('Không import được trang menu nào');

  const cfg = readConfig(branch_id);
  const meta = htmlConfig.meta || {};
  const book = {
    id: bookId,
    title: safeText(title, meta.title || 'Menu mới'),
    pageWidth: Number(meta.pageWidth) || 566.929016,
    pageHeight: Number(meta.pageHeight) || 850.394043,
    pages: localPages,
    hotspots: [],
    created_at: now(),
    updated_at: now(),
  };
  cfg.books.push(book);
  cfg.activeBookId = book.id;
  const clean = writeConfig(cfg, branch_id);
  audit('book_menu.import_pubhtml5', { id: book.id, title: book.title, pages: localPages.length, source: rawUrl }, branch_id);
  return clean;
}

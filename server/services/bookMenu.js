import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storagePath } from '../config/env.js';
import { db, now, uid, audit } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, '..');
const SERVER_ASSET_DIR = join(SERVER_ROOT, 'assets', 'menu-book');
const UPLOAD_BOOK_DIR = storagePath('uploads', 'menu-books');
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
      kind: 'fnb',
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
  if (typeof p === 'string') {
    return { id: `p_${i + 1}`, src: p, label: `Trang ${i + 1}`, category: '' };
  }
  return {
    id: safeText(p.id, `p_${i + 1}`) || `p_${i + 1}`,
    src: safeText(p.src),
    label: safeText(p.label, `Trang ${i + 1}`) || `Trang ${i + 1}`,
    // DANH MỤC của trang — quyển dày vài chục trang thì khách không lật hết để
    // tìm; thanh danh mục trên màn khách nhảy thẳng tới trang đầu của mục. Để
    // trống nghĩa là trang đó không thuộc mục nào và không hiện trên thanh.
    category: safeText(p.category).slice(0, 60),
  };
}

// ── HAI LOẠI QUYỂN ──────────────────────────────────────────────────────────
// 'fnb'    : menu quyển của nhà hàng — chấm điểm trỏ tới MÓN (menu_items).
// 'retail' : catalogue bán lẻ — chấm điểm trỏ tới HÀNG HOÁ (skus).
//
// Hai loại dùng CHUNG toàn bộ phần dựng trang/lật trang/chấm điểm; chỉ khác
// nguồn hàng mà chấm điểm trỏ tới, và khác nơi giỏ hàng đổ về (bàn FnB so với
// giỏ bán lẻ). Tách thành hai hệ riêng thì mọi sửa lỗi lật trang phải làm hai
// lần — nên chỉ thêm MỘT trường phân loại.
export const BOOK_KINDS = new Set(['fnb', 'retail']);

function bookKind(v) {
  const k = safeText(v, 'fnb').toLowerCase();
  return BOOK_KINDS.has(k) ? k : 'fnb';
}

function sanitizeHotspot(h = {}, i = 0, pageCount = 1, kind = 'fnb') {
  // Catalogue retail trỏ tới SKU; menu FnB trỏ tới món. Giữ CẢ HAI khoá trong
  // một chấm điểm để đổi loại quyển không mất dữ liệu đã cắm.
  const target = safeText(kind === 'retail' ? (h.sku_id || h.menu_item_id) : h.menu_item_id);
  return {
    id: safeText(h.id, uid('hs_')) || `hs_${i + 1}`,
    page: Math.round(clamp(h.page, 0, Math.max(0, pageCount - 1))),
    x: clamp(h.x, 0, 100),
    y: clamp(h.y, 0, 100),
    angle: clamp(h.angle, -180, 180),
    menu_item_id: kind === 'retail' ? '' : target,
    sku_id: kind === 'retail' ? target : safeText(h.sku_id),
    label: safeText(h.label),
    enabled: h.enabled !== false,
    color: safeText(h.color, '#0891b2') || '#0891b2',
  };
}

/** Chấm điểm này đã cắm vào hàng nào chưa (tuỳ loại quyển). */
function hotspotTarget(h, kind) {
  return kind === 'retail' ? h.sku_id : h.menu_item_id;
}

function sanitizeBook(b = {}, i = 0) {
  const pages = (Array.isArray(b.pages) ? b.pages : []).map(pageObj).filter(p => p.src);
  const kind = bookKind(b.kind);
  const book = {
    id: safeText(b.id, uid('book_')) || `book_${i + 1}`,
    kind,
    title: safeText(b.title, `Menu ${i + 1}`) || `Menu ${i + 1}`,
    pageWidth: Number(b.pageWidth) || 566.929016,
    pageHeight: Number(b.pageHeight) || 850.394043,
    pages,
    hotspots: [],
    created_at: safeText(b.created_at, now()),
    updated_at: now(),
  };
  book.hotspots = (Array.isArray(b.hotspots) ? b.hotspots : [])
    .map((h, idx) => sanitizeHotspot(h, idx, Math.max(1, pages.length), kind))
    .filter(h => hotspotTarget(h, kind));
  return book;
}

function sanitizeConfig(cfg = {}) {
  // Quyển FnB rỗng bị loại (rác từ cấu hình hỏng), nhưng quyển BÁN LẺ rỗng thì
  // GIỮ: catalogue được tạo trước rồi mới tải từng trang ảnh lên, loại nó đi thì
  // trang vừa tải lên không có quyển nào để gắn vào.
  const books = (Array.isArray(cfg.books) ? cfg.books : [])
    .map(sanitizeBook)
    .filter(b => b.pages.length || b.kind === 'retail');
  // Luôn phải còn ÍT NHẤT MỘT quyển FnB: `activeBookId` không được trỏ vào một
  // quyển bán lẻ, iPad nhà hàng sẽ mở nhầm catalogue của quầy bán lẻ.
  const fallback = books.some(b => b.kind !== 'retail')
    ? books
    : [...defaultConfig().books, ...books];
  // MỖI LOẠI QUYỂN CÓ QUYỂN ĐANG DÙNG RIÊNG. Dùng chung một `activeBookId` thì
  // bật catalogue bán lẻ là menu nhà hàng trên iPad đổi theo — hai khu vực bán
  // hàng khác nhau không được giẫm chân nhau.
  const chon = (kind, muon) => {
    const cua = fallback.filter(b => b.kind === kind);
    if (!cua.length) return null;
    return cua.some(b => b.id === muon) ? muon : cua[0].id;
  };
  return {
    enabled: cfg.enabled !== false,
    activeBookId: chon('fnb', cfg.activeBookId) || fallback[0].id,
    // Catalogue bán lẻ mặc định TẮT — cửa hàng chưa dựng catalogue thì màn khách
    // không được bật lên với một quyển trống.
    retailEnabled: cfg.retailEnabled === true,
    activeRetailBookId: chon('retail', cfg.activeRetailBookId),
    books: fallback,
  };
}

function readConfig(branch_id = 'sala') {
  const row = db.prepare(`SELECT value FROM app_settings WHERE branch_id=? AND key=?`).get(branch_id, MENU_BOOK_KEY);
  if (!row?.value) return defaultConfig();
  try { return sanitizeConfig(JSON.parse(row.value)); } catch { return defaultConfig(); }
}

function writeConfig(cfg, branch_id = 'sala') {
  const clean = sanitizeConfig(cfg);
  db.prepare(`INSERT OR REPLACE INTO app_settings (branch_id,key,value,updated_at) VALUES (?,?,?,?)`)
    .run(branch_id, MENU_BOOK_KEY, JSON.stringify(clean), now());
  audit('book_menu.update', { activeBookId: clean.activeBookId, books: clean.books.length }, branch_id);
  return clean;
}

export function getBookConfig(branch_id = 'sala') {
  return readConfig(branch_id);
}

export function getPublicBookConfig(branch_id = 'sala') {
  const cfg = readConfig(branch_id);
  const fnb = cfg.books.filter(b => b.kind !== 'retail');
  const book = fnb.find(b => b.id === cfg.activeBookId) || fnb[0] || cfg.books[0];
  return { enabled: cfg.enabled !== false, activeBookId: book?.id || null, book };
}

/** Danh mục của quyển, theo đúng thứ tự trang, kèm trang đầu của mỗi mục. */
function danhMucCuaQuyen(book) {
  const ra = [];
  const daCo = new Map();
  (book?.pages || []).forEach((p, i) => {
    const ten = safeText(p.category);
    if (!ten || daCo.has(ten)) return;
    daCo.set(ten, true);
    ra.push({ name: ten, page: i });
  });
  return ra;
}

/**
 * Catalogue BÁN LẺ cho màn khách. Tách khỏi getPublicBookConfig() để máy tính
 * tiền FnB và máy catalogue bán lẻ không bao giờ nhận nhầm quyển của nhau.
 */
export function getPublicRetailCatalogue(branch_id = 'sala') {
  const cfg = readConfig(branch_id);
  const cua = cfg.books.filter(b => b.kind === 'retail');
  const book = cua.find(b => b.id === cfg.activeRetailBookId) || cua[0] || null;
  return {
    // Thanh danh mục cho màn khách: mỗi mục kèm TRANG ĐẦU của nó để bấm là
    // nhảy thẳng tới. Dựng ở server để mọi màn khách chia mục y hệt nhau, và
    // giữ nguyên THỨ TỰ TRANG — sắp theo bảng chữ cái sẽ đảo lộn bố cục quyển
    // mà cửa hàng đã cố ý xếp.
    categories: danhMucCuaQuyen(book),
    enabled: cfg.retailEnabled === true && !!book,
    activeBookId: book?.id || null,
    book,
  };
}

export function saveBookConfig(body = {}, branch_id = 'sala') {
  return writeConfig(body, branch_id);
}

/**
 * THÊM MỘT TRANG vào quyển — ảnh gửi lên dạng base64, mỗi lần một tấm.
 *
 * VÌ SAO TỪNG TẤM: import cả thư mục bắt cửa hàng phải chuẩn bị sẵn đúng bộ ảnh
 * đúng thứ tự rồi mới làm được gì. Thực tế họ chụp/thiết kế dần từng trang và
 * muốn thấy ngay trang vừa thêm. Thêm từng tấm cũng cho phép chèn bổ sung hay
 * thay một trang hỏng mà không phải dựng lại cả quyển.
 *
 * [luuAnh] do tầng route truyền vào (dùng chung saveBase64Image của api.js) —
 * service không tự đụng vào filesystem của tầng HTTP.
 */
export function addBookPage(body = {}, branch_id = 'sala', luuAnh) {
  const cfg = readConfig(branch_id);
  const kind = bookKind(body.kind);
  let book = cfg.books.find(b => b.id === body.book_id && b.kind === kind);

  // Chưa có quyển nào thuộc loại này → tạo luôn, đừng bắt người dùng bấm thêm
  // một bước "tạo quyển" chỉ để thả được tấm ảnh đầu tiên.
  if (!book) {
    book = {
      id: uid('book_'),
      kind,
      title: safeText(body.title, kind === 'retail' ? 'Catalogue bán lẻ' : 'Menu mới'),
      pageWidth: 566.929016,
      pageHeight: 850.394043,
      pages: [],
      hotspots: [],
      created_at: now(),
      updated_at: now(),
    };
    cfg.books.push(book);
  }

  const { url } = luuAnh();
  const soTrang = book.pages.length + 1;
  book.pages.push({
    id: uid('p_'),
    src: url,
    label: safeText(body.label, `Trang ${soTrang}`) || `Trang ${soTrang}`,
    // Danh mục gán ngay lúc tải: cửa hàng thường tải cả loạt trang cùng một
    // mục ("Hạt dinh dưỡng") nên điền sẵn ở đây đỡ phải sửa lại từng trang.
    category: safeText(body.category).slice(0, 60),
  });

  // Quyển vừa có trang đầu tiên thì cho dùng luôn — thêm ảnh xong mà màn khách
  // vẫn trống vì chưa ai bấm "chọn quyển" là bẫy khó hiểu.
  if (kind === 'retail') cfg.activeRetailBookId ||= book.id;
  else cfg.activeBookId ||= book.id;

  const clean = writeConfig(cfg, branch_id);
  audit('book_menu.page_add', { book: book.id, kind, url }, branch_id);
  return { ...clean, book_id: book.id, page_url: url };
}

/** Xoá MỘT trang khỏi quyển (ảnh chụp hỏng, trang hết hạn khuyến mãi...). */
export function removeBookPage(body = {}, branch_id = 'sala') {
  const cfg = readConfig(branch_id);
  const book = cfg.books.find(b => b.id === body.book_id);
  if (!book) throw new Error('Không tìm thấy quyển menu');
  // Vị trí trang PHẢI tra trước khi xoá — sau khi xoá thì không còn gì để tra.
  const viTri = book.pages.findIndex(p => p.id === body.page_id);
  if (viTri < 0) throw new Error('Không tìm thấy trang cần xoá');
  book.pages.splice(viTri, 1);

  // Chấm điểm nằm trên trang đã xoá thì bỏ luôn, và những trang phía sau lùi
  // một bậc — nếu không, chấm điểm sẽ hiện lệch sang trang khác.
  book.hotspots = book.hotspots
    .filter(h => h.page !== viTri)
    .map(h => (h.page > viTri ? { ...h, page: h.page - 1 } : h));

  const clean = writeConfig(cfg, branch_id);
  audit('book_menu.page_remove', { book: book.id, page: body.page_id }, branch_id);
  return clean;
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

/**
 * Import quyển từ PubHTML5.
 *
 * `kind` quyết định quyển vừa tải về là MENU NHÀ HÀNG hay CATALOGUE BÁN LẺ —
 * thiếu nó thì catalogue bán lẻ import xong lại được bật lên iPad khách của
 * nhà hàng, vì `activeBookId` bị đặt sang quyển mới.
 */
export async function importPubhtml5(rawUrl, title, branch_id = 'sala', rawKind = 'fnb') {
  const kind = bookKind(rawKind);
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
    kind,
    title: safeText(title, meta.title || (kind === 'retail' ? 'Catalogue bán lẻ' : 'Menu mới')),
    pageWidth: Number(meta.pageWidth) || 566.929016,
    pageHeight: Number(meta.pageHeight) || 850.394043,
    pages: localPages,
    hotspots: [],
    created_at: now(),
    updated_at: now(),
  };
  cfg.books.push(book);
  if (kind === 'retail') cfg.activeRetailBookId = book.id;
  else cfg.activeBookId = book.id;
  const clean = writeConfig(cfg, branch_id);
  audit('book_menu.import_pubhtml5', { id: book.id, kind, title: book.title, pages: localPages.length, source: rawUrl }, branch_id);
  return clean;
}

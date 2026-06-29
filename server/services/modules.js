// ERP module registry inspired by large modular ERP suites.
// It is the single backend map for apps, dependencies, access permissions, and rollout state.
export const MODULE_GROUPS = [
  { key: 'essentials', label: 'TÃ­nh nÄƒng thiáº¿t yáº¿u', sort: 10 },
  { key: 'sales', label: 'BÃ¡n hÃ ng', sort: 20 },
  { key: 'supply', label: 'Chuá»—i cung á»©ng', sort: 30 },
  { key: 'finance', label: 'TÃ i chÃ­nh', sort: 40 },
  { key: 'productivity', label: 'NÄƒng suáº¥t', sort: 50 },
  { key: 'studio', label: 'Studio', sort: 60 },
  { key: 'settings', label: 'CÃ i Ä‘áº·t & ná»n táº£ng', sort: 70 },
  { key: 'developer', label: 'Developer & database', sort: 80 },
];

export const MODULES = [
  { key: 'ipad', label: 'iPad Self-Order', icon: 'ðŸ“±', group: 'sales', href: '', perm: 'module.ipad', status: 'active', depends: ['pos'], description: 'KhÃ¡ch tá»± gá»i mÃ³n, gá»­i báº¿p, gá»i nhÃ¢n viÃªn vÃ  yÃªu cáº§u thanh toÃ¡n.' },
  { key: 'pos', label: 'FnB POS', icon: 'ðŸ’³', group: 'sales', href: '', perm: 'module.pos', status: 'active', depends: ['inventory'], description: 'BÃ n, order, discount, thanh toÃ¡n, receipt vÃ  realtime vá»›i báº¿p.' },
  { key: 'retail', label: 'Retail POS', icon: 'ðŸ›’', group: 'sales', href: '', perm: 'module.retail', status: 'active', depends: ['inventory'], description: 'BÃ¡n hÃ ng retail, barcode, lot/date, voucher vÃ  Ä‘á»•i tráº£.' },
  { key: 'kds', label: 'KDS', icon: 'ðŸ‘¨â€ðŸ³', group: 'sales', href: '', perm: 'module.kds', status: 'active', depends: ['pos'], description: 'MÃ n hÃ¬nh báº¿p/bar, SLA vÃ  tráº¡ng thÃ¡i cháº¿ biáº¿n realtime.' },
  { key: 'online', label: 'KÃªnh online', icon: 'ðŸŒ', group: 'sales', href: '', perm: 'module.online', status: 'active', depends: ['pos'], description: 'Nháº­n Ä‘Æ¡n GrabFood/ShopeeFood/Website qua webhook vÃ  Ä‘iá»u phá»‘i fulfillment.' },
  { key: 'warehouse', label: 'Quáº£n lÃ½ kho', icon: 'ðŸ“¦', group: 'supply', href: '', perm: 'module.warehouse', status: 'active', depends: ['inventory'], description: 'Kho BCM/showroom/báº¿p Â· SKU & nguyÃªn liá»‡u Â· nháº­p/xuáº¥t Â· kiá»ƒm kho Â· lot/date Â· min stock Â· valuation.' },
  { key: 'inventory', label: 'Tá»“n kho', icon: 'ðŸ·ï¸', group: 'supply', href: '', perm: 'module.inventory', status: 'core', depends: [], description: 'SKU, nguyÃªn liá»‡u, Ä‘Æ¡n vá»‹ tÃ­nh, lot/serial, min stock vÃ  valuation ná»n.' },
  { key: 'admin', label: 'Quáº£n lÃ½', icon: 'ðŸ“Š', group: 'essentials', href: '', perm: null, status: 'active', depends: ['pos', 'retail', 'warehouse'], description: 'Dashboard, bÃ¡o cÃ¡o nhanh, thá»±c Ä‘Æ¡n, váº­n hÃ nh vÃ  cÃ i Ä‘áº·t trong ngÃ y.' },
  { key: 'settings', label: 'CÃ i Ä‘áº·t', icon: 'âš™ï¸', group: 'settings', href: '', perm: null, status: 'active', depends: [], description: 'NgÆ°á»i dÃ¹ng, phÃ¢n quyá»n, module, cáº¥u hÃ¬nh chung vÃ  nháº­t kÃ½ hoáº¡t Ä‘á»™ng.' },
  { key: 'printing', label: 'In áº¥n', icon: 'ðŸ–¨ï¸', group: 'settings', href: '', perm: 'module.printing', status: 'active', depends: ['pos'], description: 'Job in báº¿p/bar/bill, in láº¡i, cáº¥u hÃ¬nh bill vÃ  tem nhÃ£n.' },

  { key: 'crm', label: 'CRM', icon: 'ðŸ¤', group: 'sales', href: '', perm: 'module.crm', status: 'planned', depends: ['contacts'], description: 'Lead, opportunity, pipeline, Ä‘á»™i sales vÃ  dá»± bÃ¡o.' },
  { key: 'sales', label: 'BÃ¡o giÃ¡ & Ä‘Æ¡n bÃ¡n', icon: 'ðŸ§¾', group: 'sales', href: '', perm: 'module.sales', status: 'planned', depends: ['contacts', 'inventory'], description: 'BÃ¡o giÃ¡, sales order, pricelist, upsell, e-sign vÃ  invoice policy.' },
  { key: 'subscriptions', label: 'ÄÄƒng kÃ½', icon: 'ðŸ”', group: 'sales', href: '', perm: 'module.subscriptions', status: 'planned', depends: ['sales', 'invoice'], description: 'GÃ³i Ä‘á»‹nh ká»³, gia háº¡n, tá»± Ä‘á»™ng thanh toÃ¡n vÃ  bÃ¡o cÃ¡o churn.' },
  { key: 'ecommerce', label: 'eCommerce', icon: 'ðŸ›ï¸', group: 'sales', href: '', perm: 'module.ecommerce', status: 'planned', depends: ['website', 'inventory', 'payment'], description: 'Catalog online, cart, checkout, payment, delivery vÃ  tÃ i khoáº£n khÃ¡ch.' },

  { key: 'purchase', label: 'Mua hÃ ng', icon: 'ðŸ“¥', group: 'supply', href: '', perm: 'module.purchase', status: 'active', depends: ['inventory', 'contacts'], description: 'ÄÆ¡n mua hÃ ng, nháº­n hÃ ng vÃ o kho vÃ  cÃ´ng ná»£ nhÃ  cung cáº¥p.' },
  { key: 'manufacturing', label: 'Sáº£n xuáº¥t', icon: 'ðŸ­', group: 'supply', href: '', perm: 'module.manufacturing', status: 'planned', depends: ['inventory'], description: 'BoM, work center, production order, scrap, backorder vÃ  shop floor.' },
  { key: 'barcode', label: 'MÃ£ váº¡ch', icon: 'â–¥', group: 'supply', href: '', perm: 'module.barcode', status: 'planned', depends: ['inventory'], description: 'QuÃ©t kho, location barcode, lot/serial barcode vÃ  RFID.' },
  { key: 'fleet', label: 'Äá»™i xe', icon: 'ðŸšš', group: 'supply', href: '', perm: 'module.fleet', status: 'planned', depends: [], description: 'PhÆ°Æ¡ng tiá»‡n, tÃ i xáº¿, chi phÃ­, lá»‹ch báº£o trÃ¬ vÃ  giao nháº­n.' },

  { key: 'accounting', label: 'Káº¿ toÃ¡n', icon: 'ðŸ“š', group: 'finance', href: '', perm: 'module.accounting', status: 'planned', depends: ['invoice'], description: 'Sá»• cÃ¡i, há»‡ tÃ i khoáº£n, thuáº¿, journal, reconciliation vÃ  bÃ¡o cÃ¡o tÃ i chÃ­nh.' },
  { key: 'invoice', label: 'HÃ³a Ä‘Æ¡n', icon: 'ðŸ§¾', group: 'finance', href: '', perm: 'module.invoice', status: 'active', depends: ['accounting'], description: 'HÃ³a Ä‘Æ¡n Ä‘iá»‡n tá»­, tráº¡ng thÃ¡i phÃ¡t hÃ nh, tra cá»©u, há»§y vÃ  cáº¥u hÃ¬nh HÄÄT.' },
  { key: 'expenses', label: 'Chi phÃ­', icon: 'ðŸ’¸', group: 'finance', href: '', perm: 'module.expenses', status: 'active', depends: ['contacts'], description: 'Sá»• chi phÃ­ theo danh má»¥c: chi tá»« tiá»n kÃ©t hoáº·c káº¿ toÃ¡n chi trá»±c tiáº¿p, Ä‘á»‘i chiáº¿u quá»¹.' },
  { key: 'payment', label: 'Thanh toÃ¡n online', icon: 'ðŸ’±', group: 'finance', href: '', perm: 'module.payment', status: 'planned', depends: ['invoice'], description: 'Provider, QR, terminal, settlement vÃ  Ä‘á»‘i soÃ¡t.' },

  { key: 'contacts', label: 'LiÃªn há»‡', icon: 'ðŸ‘¥', group: 'essentials', href: '', perm: 'module.contacts', status: 'active', depends: [], description: 'KhÃ¡ch hÃ ng & nhÃ  cung cáº¥p dÃ¹ng chung má»™t danh báº¡: SÄT, MST, Ä‘á»‹a chá»‰, ngÆ°á»i liÃªn há»‡.' },
  { key: 'import_export', label: 'Nháº­p/xuáº¥t dá»¯ liá»‡u', icon: 'â†•ï¸', group: 'essentials', href: '', perm: 'module.import_export', status: 'planned', depends: [], description: 'Import, export, template, audit import vÃ  mapping dá»¯ liá»‡u.' },

  { key: 'project', label: 'Dá»± Ã¡n', icon: 'ðŸ“Œ', group: 'productivity', href: '', perm: 'module.project', status: 'planned', depends: ['contacts'], description: 'Task, stage, kanban, milestone, timesheet vÃ  profitability.' },
  { key: 'calendar', label: 'Lá»‹ch', icon: 'ðŸ“…', group: 'productivity', href: '', perm: 'module.calendar', status: 'planned', depends: [], description: 'Lá»‹ch háº¹n, Ä‘á»“ng bá»™ Google/Outlook vÃ  booking.' },
  { key: 'discuss', label: 'Tháº£o luáº­n', icon: 'ðŸ’¬', group: 'productivity', href: '', perm: 'module.discuss', status: 'planned', depends: [], description: 'Channel, chatter, canned response, activity vÃ  thÃ´ng bÃ¡o.' },
  // "TÃ i liá»‡u" Ä‘Ã£ gá»™p vÃ o module "CÆ¡ sá»Ÿ dá»¯ liá»‡u" (sub-tab). Giá»¯ route /documents cho iframe nhÃºng.
  { key: 'knowledge', label: 'Kiáº¿n thá»©c', icon: 'ðŸ“–', group: 'productivity', href: '', perm: 'module.knowledge', status: 'planned', depends: [], description: 'Wiki ná»™i bá»™, template, link dá»¯ liá»‡u vÃ  cá»™ng tÃ¡c.' },
  { key: 'todo', label: 'Viá»‡c cáº§n lÃ m', icon: 'âœ…', group: 'productivity', href: '', perm: 'module.todo', status: 'planned', depends: [], description: 'Checklist cÃ¡ nhÃ¢n, assignment vÃ  activity follow-up.' },

  { key: 'studio', label: 'Studio', icon: 'ðŸ§©', group: 'studio', href: '', perm: 'module.studio', status: 'planned', depends: ['settings'], description: 'Model, field, view, automation, approval rule, report PDF vÃ  export customization.' },
  { key: 'automation', label: 'Tá»± Ä‘á»™ng hÃ³a', icon: 'âš¡', group: 'studio', href: '', perm: 'module.automation', status: 'planned', depends: ['studio'], description: 'Server action, webhook, scheduled action, trigger vÃ  approval flow.' },

  { key: 'database', label: 'CÆ¡ sá»Ÿ dá»¯ liá»‡u & TÃ i liá»‡u', icon: 'ðŸ›¢ï¸', group: 'developer', href: '', perm: 'module.database', status: 'active', depends: ['settings'], description: 'Sao lÆ°u, phá»¥c há»“i, staging, dá»n dáº¹p giao dá»‹ch, kiá»ƒm tra sá»©c khá»e CSDL â€” kÃ¨m tÃ i liá»‡u hÆ°á»›ng dáº«n & sÆ¡ Ä‘á»“ há»‡ thá»‘ng.' },
  { key: 'developer', label: 'Developer', icon: 'ðŸ› ï¸', group: 'developer', href: '', perm: 'module.developer', status: 'planned', depends: ['settings'], description: 'Debug mode, technical menu, model metadata, API vÃ  tutorial ná»™i bá»™.' },
];

export const MODULE_PERMISSIONS = MODULES.filter(m => m.perm).map(m => ({
  key: m.perm,
  label: m.label,
}));

export function listModules(perms = []) {
  const set = new Set(perms || []);
  const all = set.has('*');
  const hasSettings = [...set].some(p => p === 'settings.manage' || p.startsWith('settings.') || p === 'warehouse.manage');
  return MODULES.map(m => ({
    ...m,
    visible: all
      || (m.key === 'settings' ? hasSettings : false)
      || (m.key !== 'settings' && (!m.perm || set.has(m.perm))),
  }));
}

export function visibleModules(perms = []) {
  return listModules(perms).filter(m => m.visible);
}


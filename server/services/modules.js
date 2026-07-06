// ERP module registry inspired by large modular ERP suites.
// It is the single backend map for apps, dependencies, access permissions, and rollout state.
export const MODULE_GROUPS = [
  { key: 'essentials', label: 'Tính năng thiết yếu', sort: 10 },
  { key: 'sales', label: 'Bán hàng', sort: 20 },
  { key: 'supply', label: 'Chuỗi cung ứng', sort: 30 },
  { key: 'finance', label: 'Tài chính', sort: 40 },
  { key: 'productivity', label: 'Năng suất', sort: 50 },
  { key: 'studio', label: 'Studio', sort: 60 },
  { key: 'settings', label: 'Cài đặt & nền tảng', sort: 70 },
  { key: 'developer', label: 'Developer & database', sort: 80 },
];

export const MODULES = [
  { key: 'ipad', label: 'iPad Self-Order', icon: '📱', group: 'sales', href: '/ipad?pick=1', perm: 'module.ipad', status: 'active', depends: ['pos'], description: 'Khách tự gọi món, gửi bếp, gọi nhân viên và yêu cầu thanh toán.' },
  { key: 'pos', label: 'FnB POS', icon: '💳', group: 'sales', href: '/pos', perm: 'module.pos', status: 'active', depends: ['inventory'], description: 'Bàn, order, discount, thanh toán, receipt và realtime với bếp.' },
  { key: 'retail', label: 'Retail POS', icon: '🛒', group: 'sales', href: '/retail', perm: 'module.retail', status: 'active', depends: ['inventory'], description: 'Bán hàng retail, barcode, lot/date, voucher và đổi trả.' },
  { key: 'kds', label: 'KDS', icon: '👨‍🍳', group: 'sales', href: '/kds', perm: 'module.kds', status: 'active', depends: ['pos'], description: 'Màn hình bếp/bar, SLA và trạng thái chế biến realtime.' },
  { key: 'online', label: 'Kênh online', icon: '🌐', group: 'sales', href: '/online', perm: 'module.online', status: 'active', depends: ['pos'], description: 'Nhận đơn GrabFood/ShopeeFood/Website qua webhook và điều phối fulfillment.' },
  { key: 'warehouse', label: 'Quản lý kho', icon: '📦', group: 'supply', href: '/warehouse', perm: 'module.warehouse', status: 'active', depends: ['inventory'], description: 'Kho BCM/showroom/bếp · SKU & nguyên liệu · nhập/xuất · kiểm kho · lot/date · min stock · valuation.' },
  { key: 'inventory', label: 'Tồn kho', icon: '🏷️', group: 'supply', href: '/warehouse', perm: 'module.inventory', status: 'core', depends: [], description: 'SKU, nguyên liệu, đơn vị tính, lot/serial, min stock và valuation nền.' },
  { key: 'admin', label: 'Quản lý', icon: '📊', group: 'essentials', href: '/admin?view=dashboard', perm: null, status: 'active', depends: ['pos', 'retail', 'warehouse'], description: 'Dashboard, báo cáo nhanh, thực đơn, vận hành và cài đặt trong ngày.' },
  { key: 'settings', label: 'Cài đặt', icon: '⚙️', group: 'settings', href: '/settings', perm: null, status: 'active', depends: [], description: 'Người dùng, phân quyền, module, cấu hình chung và nhật ký hoạt động.' },
  { key: 'printing', label: 'In ấn', icon: '🖨️', group: 'settings', href: '/printers', perm: 'module.printing', status: 'active', depends: ['pos'], description: 'Job in bếp/bar/bill, in lại, cấu hình bill và tem nhãn.' },

  { key: 'crm', label: 'CRM', icon: '🤝', group: 'sales', href: '', perm: 'module.crm', status: 'planned', depends: ['contacts'], description: 'Lead, opportunity, pipeline, đội sales và dự báo.' },
  { key: 'sales', label: 'Báo giá & đơn bán', icon: '🧾', group: 'sales', href: '', perm: 'module.sales', status: 'planned', depends: ['contacts', 'inventory'], description: 'Báo giá, sales order, pricelist, upsell, e-sign và invoice policy.' },
  { key: 'subscriptions', label: 'Đăng ký', icon: '🔁', group: 'sales', href: '', perm: 'module.subscriptions', status: 'planned', depends: ['sales', 'invoice'], description: 'Gói định kỳ, gia hạn, tự động thanh toán và báo cáo churn.' },
  { key: 'ecommerce', label: 'eCommerce', icon: '🛍️', group: 'sales', href: '', perm: 'module.ecommerce', status: 'planned', depends: ['website', 'inventory', 'payment'], description: 'Catalog online, cart, checkout, payment, delivery và tài khoản khách.' },

  { key: 'purchase', label: 'Mua hàng', icon: '📥', group: 'supply', href: '/purchase', perm: 'module.purchase', status: 'active', depends: ['inventory', 'contacts'], description: 'Đơn mua hàng, nhận hàng vào kho và công nợ nhà cung cấp.' },
  { key: 'manufacturing', label: 'Sản xuất', icon: '🏭', group: 'supply', href: '', perm: 'module.manufacturing', status: 'planned', depends: ['inventory'], description: 'BoM, work center, production order, scrap, backorder và shop floor.' },
  { key: 'barcode', label: 'Mã vạch', icon: '▥', group: 'supply', href: '', perm: 'module.barcode', status: 'planned', depends: ['inventory'], description: 'Quét kho, location barcode, lot/serial barcode và RFID.' },
  { key: 'fleet', label: 'Đội xe', icon: '🚚', group: 'supply', href: '', perm: 'module.fleet', status: 'planned', depends: [], description: 'Phương tiện, tài xế, chi phí, lịch bảo trì và giao nhận.' },

  { key: 'accounting', label: 'Kế toán', icon: '📚', group: 'finance', href: '/settings/operations', perm: 'module.accounting', status: 'active', depends: ['invoice'], description: 'Sổ cái, hệ tài khoản, thuế, journal, reconciliation và báo cáo tài chính.' },
  { key: 'invoice', label: 'Hóa đơn', icon: '🧾', group: 'finance', href: '/invoices', perm: 'module.invoice', status: 'active', depends: ['accounting'], description: 'Hóa đơn điện tử, trạng thái phát hành, tra cứu, hủy và cấu hình HĐĐT.' },
  { key: 'expenses', label: 'Chi phí', icon: '💸', group: 'finance', href: '/expenses', perm: 'module.expenses', status: 'active', depends: ['contacts'], description: 'Sổ chi phí theo danh mục: chi từ tiền két hoặc kế toán chi trực tiếp, đối chiếu quỹ.' },
  { key: 'payment', label: 'Thanh toán online', icon: '💱', group: 'finance', href: '', perm: 'module.payment', status: 'planned', depends: ['invoice'], description: 'Provider, QR, terminal, settlement và đối soát.' },

  { key: 'contacts', label: 'Liên hệ', icon: '👥', group: 'essentials', href: '/contacts', perm: 'module.contacts', status: 'active', depends: [], description: 'Khách hàng & nhà cung cấp dùng chung một danh bạ: SĐT, MST, địa chỉ, người liên hệ.' },
  { key: 'import_export', label: 'Nhập/xuất dữ liệu', icon: '↕️', group: 'essentials', href: '', perm: 'module.import_export', status: 'planned', depends: [], description: 'Import, export, template, audit import và mapping dữ liệu.' },

  { key: 'project', label: 'Dự án', icon: '📌', group: 'productivity', href: '', perm: 'module.project', status: 'planned', depends: ['contacts'], description: 'Task, stage, kanban, milestone, timesheet và profitability.' },
  { key: 'calendar', label: 'Lịch', icon: '📅', group: 'productivity', href: '', perm: 'module.calendar', status: 'planned', depends: [], description: 'Lịch hẹn, đồng bộ Google/Outlook và booking.' },
  { key: 'discuss', label: 'Thảo luận', icon: '💬', group: 'productivity', href: '', perm: 'module.discuss', status: 'planned', depends: [], description: 'Channel, chatter, canned response, activity và thông báo.' },
  // "Tài liệu" đã gộp vào module "Cơ sở dữ liệu" (sub-tab). Giữ route /documents cho iframe nhúng.
  { key: 'knowledge', label: 'Kiến thức', icon: '📖', group: 'productivity', href: '', perm: 'module.knowledge', status: 'planned', depends: [], description: 'Wiki nội bộ, template, link dữ liệu và cộng tác.' },
  { key: 'todo', label: 'Việc cần làm', icon: '✅', group: 'productivity', href: '', perm: 'module.todo', status: 'planned', depends: [], description: 'Checklist cá nhân, assignment và activity follow-up.' },

  { key: 'studio', label: 'Studio', icon: '🧩', group: 'studio', href: '', perm: 'module.studio', status: 'planned', depends: ['settings'], description: 'Model, field, view, automation, approval rule, report PDF và export customization.' },
  { key: 'automation', label: 'Tự động hóa', icon: '⚡', group: 'studio', href: '', perm: 'module.automation', status: 'planned', depends: ['studio'], description: 'Server action, webhook, scheduled action, trigger và approval flow.' },

  { key: 'database', label: 'Cơ sở dữ liệu & Tài liệu', icon: '🛢️', group: 'developer', href: '/database', perm: 'module.database', status: 'active', depends: ['settings'], description: 'Sao lưu, phục hồi, staging, dọn dẹp giao dịch, kiểm tra sức khỏe CSDL — kèm tài liệu hướng dẫn & sơ đồ hệ thống.' },
  { key: 'developer', label: 'Developer', icon: '🛠️', group: 'developer', href: '', perm: 'module.developer', status: 'planned', depends: ['settings'], description: 'Debug mode, technical menu, model metadata, API và tutorial nội bộ.' },
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

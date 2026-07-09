// ERP module registry inspired by large modular ERP suites.
// It is the single backend map for apps, dependencies, access permissions, and rollout state.
export const MODULE_GROUPS = [
  { key: 'essentials', label: 'Essentials', sort: 10 },
  { key: 'sales', label: 'Sales', sort: 20 },
  { key: 'supply', label: 'Supply Chain', sort: 30 },
  { key: 'finance', label: 'Finance', sort: 40 },
  { key: 'productivity', label: 'Productivity', sort: 50 },
  { key: 'studio', label: 'Studio', sort: 60 },
  { key: 'settings', label: 'Settings & Platform', sort: 70 },
  { key: 'developer', label: 'Developer & Database', sort: 80 },
];

export const MODULES = [
  { key: 'ipad', label: 'Khách tự gọi món', icon: '📱', group: 'sales', href: '/ipad?pick=1', perm: 'module.ipad', status: 'active', depends: ['pos'], description: 'Khách tự chọn món, gửi bếp, gọi nhân viên và tự thanh toán.' },
  { key: 'pos', label: 'FnB POS', icon: '💳', group: 'sales', href: '/pos', perm: 'module.pos', status: 'active', depends: ['inventory'], description: 'Table, order, discount, payment, receipt and realtime with the kitchen.' },
  { key: 'retail', label: 'Retail POS', icon: '🛒', group: 'sales', href: '/retail', perm: 'module.retail', status: 'active', depends: ['inventory'], description: 'Retail sales, barcode, lot/date, voucher and return.' },
  { key: 'kds', label: 'KDS', icon: '👨‍🍳', group: 'sales', href: '/kds', perm: 'module.kds', status: 'active', depends: ['pos'], description: 'Kitchen/bar screen, SLA and realtime cooking status.' },
  { key: 'online', label: 'Online Channel', icon: '🌐', group: 'sales', href: '/online', perm: 'module.online', status: 'active', depends: ['pos'], description: 'Receive GrabFood/ShopeeFood/Website orders via webhook and coordinate fulfillment.' },
  { key: 'warehouse', label: 'Warehouse Management', icon: '📦', group: 'supply', href: '/warehouse', perm: 'module.warehouse', status: 'active', depends: ['inventory'], description: 'BCM/showroom/kitchen inventory · SKU & raw materials · check-in/out · audit · lot/date · min stock · valuation.' },
  { key: 'inventory', label: 'Inventory', icon: '🏷️', group: 'supply', href: '/warehouse', perm: 'module.inventory', status: 'core', depends: [], description: 'SKU, raw materials, unit of measure, lot/serial, min stock and base valuation.' },
  { key: 'admin', label: 'Management', icon: '📊', group: 'essentials', href: '/admin?view=dashboard', perm: null, status: 'active', depends: ['pos', 'retail', 'warehouse'], description: 'Dashboard, quick report, menu, operation and daily settings.' },
  { key: 'settings', label: 'Settings', icon: '⚙️', group: 'settings', href: '/settings', perm: null, status: 'active', depends: [], description: 'Users, permissions, modules, general settings and activity log.' },
  { key: 'printing', label: 'Printing', icon: '🖨️', group: 'settings', href: '/printers', perm: 'module.printing', status: 'active', depends: ['pos'], description: 'Kitchen/bar/bill print jobs, reprint, bill configuration and labels.' },

  { key: 'crm', label: 'CRM', icon: '🤝', group: 'sales', href: '', perm: 'module.crm', status: 'planned', depends: ['contacts'], description: 'Lead, opportunity, pipeline, sales team and forecasting.' },
  { key: 'sales', label: 'Quotation & Sales Order', icon: '🧾', group: 'sales', href: '', perm: 'module.sales', status: 'planned', depends: ['contacts', 'inventory'], description: 'Quotation, sales order, pricelist, upsell, e-sign and invoice policy.' },
  { key: 'subscriptions', label: 'Subscription', icon: '🔁', group: 'sales', href: '', perm: 'module.subscriptions', status: 'planned', depends: ['sales', 'invoice'], description: 'Recurring package, renewal, automatic payment and churn report.' },
  { key: 'ecommerce', label: 'eCommerce', icon: '🛍️', group: 'sales', href: '', perm: 'module.ecommerce', status: 'planned', depends: ['website', 'inventory', 'payment'], description: 'Online catalog, cart, checkout, payment, delivery and customer account.' },

  { key: 'purchase', label: 'Purchase', icon: '📥', group: 'supply', href: '/purchase', perm: 'module.purchase', status: 'active', depends: ['inventory', 'contacts'], description: 'Purchase orders, receiving inventory and supplier payables.' },
  { key: 'manufacturing', label: 'Manufacturing', icon: '🏭', group: 'supply', href: '', perm: 'module.manufacturing', status: 'planned', depends: ['inventory'], description: 'BoM, work center, production order, scrap, backorder and shop floor.' },
  { key: 'barcode', label: 'Barcode', icon: '▥', group: 'supply', href: '', perm: 'module.barcode', status: 'planned', depends: ['inventory'], description: 'Inventory scanning, location barcode, lot/serial barcode and RFID.' },
  { key: 'fleet', label: 'Fleet', icon: '🚚', group: 'supply', href: '', perm: 'module.fleet', status: 'planned', depends: [], description: 'Vehicles, drivers, expenses, maintenance schedule and delivery.' },

  { key: 'accounting', label: 'Accounting', icon: '📚', group: 'finance', href: '/settings/operations', perm: 'module.accounting', status: 'active', depends: ['invoice'], description: 'General ledger, chart of accounts, tax, journal, reconciliation and financial reports.' },
  { key: 'invoice', label: 'Invoice', icon: '🧾', group: 'finance', href: '/invoices', perm: 'module.invoice', status: 'active', depends: ['accounting'], description: 'Electronic invoice, issuance status, lookup, cancellation and e-invoice configuration.' },
  { key: 'expenses', label: 'Expenses', icon: '💸', group: 'finance', href: '/expenses', perm: 'module.expenses', status: 'active', depends: ['contacts'], description: 'Expense book by category: paid from safe or accountants pay directly, fund reconciliation.' },
  { key: 'payment', label: 'Online Payment', icon: '💱', group: 'finance', href: '', perm: 'module.payment', status: 'planned', depends: ['invoice'], description: 'Provider, QR, terminal, settlement and reconciliation.' },

  { key: 'contacts', label: 'Contacts', icon: '👥', group: 'essentials', href: '/contacts', perm: 'module.contacts', status: 'active', depends: [], description: 'Customers & suppliers share a single directory: phone, tax code, address, contact person.' },
  { key: 'import_export', label: 'Import/Export Data', icon: '↕️', group: 'essentials', href: '', perm: 'module.import_export', status: 'planned', depends: [], description: 'Import, export, template, import audit and data mapping.' },

  { key: 'project', label: 'Project', icon: '📌', group: 'productivity', href: '', perm: 'module.project', status: 'planned', depends: ['contacts'], description: 'Task, stage, kanban, milestone, timesheet and profitability.' },
  { key: 'calendar', label: 'Calendar', icon: '📅', group: 'productivity', href: '', perm: 'module.calendar', status: 'planned', depends: [], description: 'Appointment calendar, Google/Outlook sync and booking.' },
  { key: 'discuss', label: 'Discussion', icon: '💬', group: 'productivity', href: '', perm: 'module.discuss', status: 'planned', depends: [], description: 'Channel, chatter, canned response, activity and notification.' },
  // "Tài liệu" đã gộp vào module "Cơ sở dữ liệu" (sub-tab). Giữ route /documents cho iframe nhúng.
  { key: 'knowledge', label: 'Knowledge', icon: '📖', group: 'productivity', href: '', perm: 'module.knowledge', status: 'planned', depends: [], description: 'Internal wiki, templates, data links and collaboration.' },
  { key: 'todo', label: 'To-Do List', icon: '✅', group: 'productivity', href: '', perm: 'module.todo', status: 'planned', depends: [], description: 'Personal checklist, assignment and activity follow-up.' },

  { key: 'studio', label: 'Studio', icon: '🧩', group: 'studio', href: '', perm: 'module.studio', status: 'planned', depends: ['settings'], description: 'Model, field, view, automation, approval rule, PDF reports and export customization.' },
  { key: 'automation', label: 'Automation', icon: '⚡', group: 'studio', href: '', perm: 'module.automation', status: 'planned', depends: ['studio'], description: 'Server action, webhook, scheduled action, trigger and approval flow.' },

  { key: 'database', label: 'Database & Documentation', icon: '🛢️', group: 'developer', href: '/database', perm: 'module.database', status: 'active', depends: ['settings'], description: 'Backup, restore, staging, clear transactions, database health check — with guidance documents & system diagrams.' },
  { key: 'developer', label: 'Developer', icon: '🛠️', group: 'developer', href: '', perm: 'module.developer', status: 'planned', depends: ['settings'], description: 'Debug mode, technical menu, model metadata, API and internal tutorials.' },
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

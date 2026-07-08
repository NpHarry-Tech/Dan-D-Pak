// Shared ERP module catalog for client-side navigation and launchers.
// Keep this in sync with server/services/modules.js when adding real screens.
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
  { key: 'ipad', label: 'iPad Self-Order', icon: '📱', group: 'sales', href: '/ipad?pick=1', perm: 'module.ipad', status: 'active' },
  { key: 'pos', label: 'FnB POS', icon: '💳', group: 'sales', href: '/pos', perm: 'module.pos', status: 'active' },
  { key: 'retail', label: 'Retail POS', icon: '🛒', group: 'sales', href: '/retail', perm: 'module.retail', status: 'active' },
  { key: 'kds', label: 'KDS', icon: '👨‍🍳', group: 'sales', href: '/kds', perm: 'module.kds', status: 'active' },
  { key: 'tablet', label: 'Tablet App (Flutter)', icon: '📱', group: 'sales', href: '/tablet', perm: 'module.tablet', status: 'active' },
  { key: 'online', label: 'Kênh online', icon: '🌐', group: 'sales', href: '/online', perm: 'module.online', status: 'active' },
  { key: 'warehouse', label: 'Kho', icon: '📦', group: 'supply', href: '/warehouse', perm: 'module.warehouse', status: 'active' },
  { key: 'inventory', label: 'Tồn kho', icon: '🏷️', group: 'supply', href: '/warehouse', perm: 'module.inventory', status: 'active' },
  { key: 'purchase', label: 'Mua hàng', icon: '📥', group: 'supply', href: '/purchase', perm: 'module.purchase', status: 'active' },
  { key: 'expenses', label: 'Chi phí', icon: '💸', group: 'finance', href: '/expenses', perm: 'module.expenses', status: 'active' },
  { key: 'contacts', label: 'Liên hệ', icon: '👥', group: 'essentials', href: '/contacts', perm: 'module.contacts', status: 'active' },
  { key: 'admin', label: 'Quản lý', icon: '📊', group: 'essentials', href: '/admin', perm: null, status: 'active' },
  { key: 'settings', label: 'Cài đặt', icon: '⚙️', group: 'settings', href: '/settings', perm: null, status: 'active' },
  { key: 'printing', label: 'In ấn', icon: '🖨️', group: 'settings', href: '/printers', perm: 'module.printing', status: 'active' },
];

export const TOPBAR_MODULES = ['ipad', 'pos', 'retail', 'online', 'kds', 'tablet', 'warehouse', 'admin'];

export const moduleByKey = (key) => MODULES.find(m => m.key === key);

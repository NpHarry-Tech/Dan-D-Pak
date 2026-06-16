// Shared ERP module catalog for client-side navigation and launchers.
// Keep this in sync with server/services/modules.js when adding real screens.
export const MODULE_GROUPS = [
  { key: 'essentials', label: 'Core Features', sort: 10 },
  { key: 'sales', label: 'Sales', sort: 20 },
  { key: 'supply', label: 'Supply Chain', sort: 30 },
  { key: 'finance', label: 'Finance', sort: 40 },
  { key: 'productivity', label: 'Productivity', sort: 50 },
  { key: 'studio', label: 'Studio', sort: 60 },
  { key: 'settings', label: 'Settings & Platform', sort: 70 },
  { key: 'developer', label: 'Developer & database', sort: 80 },
];

export const MODULES = [
  { key: 'ipad', label: 'iPad Self-Order', icon: '📱', group: 'sales', href: '/ipad', perm: 'module.ipad', status: 'active' },
  { key: 'pos', label: 'FnB POS', icon: '💳', group: 'sales', href: '/pos', perm: 'module.pos', status: 'active' },
  { key: 'retail', label: 'BCM Retail POS', icon: '🛒', group: 'sales', href: '/retail', perm: 'module.retail', status: 'active' },
  { key: 'kds', label: 'KDS', icon: '👨‍🍳', group: 'sales', href: '/kds', perm: 'module.kds', status: 'active' },
  { key: 'online', label: 'Online Channels', icon: '🌐', group: 'sales', href: '/online', perm: 'module.online', status: 'active' },
  { key: 'warehouse', label: 'Warehouse', icon: '📦', group: 'supply', href: '/warehouse', perm: 'module.warehouse', status: 'active' },
  { key: 'inventory', label: 'Inventory', icon: '🏷️', group: 'supply', href: '/warehouse', perm: 'module.inventory', status: 'active' },
  { key: 'admin', label: 'Management', icon: '📊', group: 'essentials', href: '/admin', perm: 'module.admin', status: 'active' },
  { key: 'settings', label: 'Settings', icon: '⚙️', group: 'settings', href: '/settings', perm: 'module.settings', status: 'active' },
  { key: 'printing', label: 'Printing', icon: '🖨️', group: 'settings', href: '/printers', perm: 'module.printing', status: 'active' },
];

// Header nav modules (no 'settings' here — Settings is opened from inside the Management dashboard).
export const TOPBAR_MODULES = ['ipad', 'pos', 'retail', 'online', 'kds', 'warehouse', 'admin'];

export const moduleByKey = (key) => MODULES.find(m => m.key === key);

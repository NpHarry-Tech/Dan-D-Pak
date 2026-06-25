import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const dbPath = path.join(ROOT, 'server', 'store.db');

const cleanConfig = {
  version: 1,
  updated_at: new Date().toISOString(),
  channels: {
    misa: {
      enabled: false,
      environment: 'production',
      apiBase: '',
      taxCode: '',
      companyName: '',
      username: '',
      password: '',
      appId: '',
      secretKey: '',
      autoIssue: false,
      syncInvoices: true,
      syncCustomers: true,
      note: '',
    },
    payos: {
      enabled: false,
      environment: 'production',
      clientId: '',
      apiKey: '',
      checksumKey: '',
      apiBase: 'https://api-merchant.payos.vn',
      returnUrl: '',
      cancelUrl: '',
      note: '',
    },
    vietqr: {
      enabled: false,
      environment: 'production',
      username: '',
      password: '',
      apiBase: '',
      bankCode: '',
      bankAccount: '',
      userBankName: '',
      terminalCode: '',
      subTerminalCode: '',
      serviceCode: '',
      note: '',
    },
    sepay: {
      enabled: false,
      environment: 'production',
      apiKey: '',
      accountNumber: '',
      bankCode: '',
      note: '',
    },
    casso: {
      enabled: false,
      environment: 'production',
      webhookSecret: '',
      accountNumber: '',
      note: '',
    },
    grabmerchant: {
      enabled: false,
      environment: 'production',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: true,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    shopeefood: {
      enabled: false,
      environment: 'production',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: true,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    befood: {
      enabled: false,
      environment: 'production',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: false,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    grabmart: {
      enabled: false,
      environment: 'production',
      merchantId: '',
      storeId: '',
      clientId: '',
      clientSecret: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncProducts: true,
      syncInventory: true,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
    website: {
      enabled: false,
      environment: 'production',
      publicUrl: '',
      apiKey: '',
      webhookSecret: '',
      orderMode: 'manual_confirm',
      syncOrders: true,
      syncMenu: true,
      syncInventory: false,
      autoAccept: false,
      printOnReceive: true,
      note: '',
    },
  },
};

try {
  const db = new DatabaseSync(dbPath);
  
  // Find all distinct branch_ids
  const branches = db.prepare("SELECT DISTINCT branch_id FROM app_settings").all().map(r => r.branch_id);
  if (!branches.includes('br1')) {
    branches.push('br1');
  }

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO app_settings (branch_id, key, value, updated_at)
    VALUES (?, 'integrations_config', ?, ?)
  `);

  const nowVal = Date.now();
  for (const branchId of branches) {
    console.log(`Resetting integrations_config for branch: ${branchId}`);
    stmt.run(branchId, JSON.stringify(cleanConfig), nowVal);
  }

  console.log("Database reset completed successfully!");
} catch (e) {
  console.error("Database reset failed:", e);
  process.exit(1);
}

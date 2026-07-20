const MIGRATIONS = [
  {
    version: 1,
    name: 'sync_queue_retention_indexes',
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created
          ON sync_queue(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_sync_queue_done_synced
          ON sync_queue(status, synced_at, created_at);
      `);
    },
  },
  {
    version: 2,
    name: 'haravan_connector_tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS external_orders (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          external_order_id TEXT NOT NULL,
          internal_order_id TEXT,
          external_order_code TEXT,
          sync_status TEXT NOT NULL DEFAULT 'pending',
          raw_payload TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_order
          ON external_orders(provider, external_order_id);

        CREATE TABLE IF NOT EXISTS external_customers (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          external_customer_id TEXT NOT NULL,
          internal_customer_id TEXT,
          raw_payload TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_customer
          ON external_customers(provider, external_customer_id);

        CREATE TABLE IF NOT EXISTS external_products (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          external_product_id TEXT NOT NULL,
          external_variant_id TEXT NOT NULL DEFAULT '',
          internal_product_id TEXT,
          internal_variant_id TEXT,
          sku TEXT,
          raw_payload TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_product_variant
          ON external_products(provider, external_product_id, external_variant_id);

        CREATE TABLE IF NOT EXISTS sync_logs (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          topic TEXT,
          external_id TEXT,
          status TEXT NOT NULL,
          error_message TEXT,
          raw_payload TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT,
          processed_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sync_logs_provider_created
          ON sync_logs(provider, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sync_logs_queue
          ON sync_logs(provider, status, next_retry_at, created_at);
      `);
    },
  },
  {
    version: 3,
    name: 'haravan_multi_shop',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS haravan_shops (
          id TEXT PRIMARY KEY,
          shop_domain TEXT NOT NULL UNIQUE,
          org_id TEXT,
          branch_id TEXT NOT NULL DEFAULT 'ONLINE',
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          scope TEXT,
          token_type TEXT NOT NULL DEFAULT 'Bearer',
          expires_at TEXT,
          location_id TEXT,
          api_base TEXT NOT NULL DEFAULT 'https://apis.haravan.com',
          installed_at TEXT NOT NULL,
          updated_at TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          raw_payload TEXT
        );

        CREATE TABLE IF NOT EXISTS haravan_sync_state (
          id TEXT PRIMARY KEY,
          shop_domain TEXT NOT NULL,
          resource TEXT NOT NULL,
          cursor TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE(shop_domain, resource)
        );

        ALTER TABLE external_orders ADD COLUMN shop_domain TEXT NOT NULL DEFAULT '';
        ALTER TABLE external_customers ADD COLUMN shop_domain TEXT NOT NULL DEFAULT '';
        ALTER TABLE external_products ADD COLUMN shop_domain TEXT NOT NULL DEFAULT '';
        ALTER TABLE sync_logs ADD COLUMN shop_domain TEXT NOT NULL DEFAULT '';
      `);
      db.exec(`DROP INDEX IF EXISTS uniq_external_order;`);
      db.exec(`DROP INDEX IF EXISTS uniq_external_customer;`);
      db.exec(`DROP INDEX IF EXISTS uniq_external_product_variant;`);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_order_shop
          ON external_orders(provider, shop_domain, external_order_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_customer_shop
          ON external_customers(provider, shop_domain, external_customer_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_product_variant_shop
          ON external_products(provider, shop_domain, external_product_id, external_variant_id);
        CREATE INDEX IF NOT EXISTS idx_haravan_sync_state_shop_resource
          ON haravan_sync_state(shop_domain, resource);
        CREATE INDEX IF NOT EXISTS idx_sync_logs_provider_shop_created
          ON sync_logs(provider, shop_domain, created_at DESC);
      `);
    },
  },
];

export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const seen = new Set(
    db.prepare(`SELECT version FROM schema_migrations`).all().map((r) => r.version),
  );
  const mark = db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
  );

  for (const migration of MIGRATIONS) {
    if (seen.has(migration.version)) continue;
    db.exec('BEGIN TRANSACTION;');
    try {
      migration.up(db);
      mark.run(migration.version, migration.name, new Date().toISOString());
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  }
}

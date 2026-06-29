#!/usr/bin/env node
import { performance } from 'node:perf_hooks';

const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:3110').replace(/\/+$/, '');
const BRANCH_ID = process.env.BRANCH_ID || 'br1';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const TABLET_COUNT = Number(process.env.TABLET_COUNT || 55);
const PHONE_COUNT = Number(process.env.PHONE_COUNT || 20);
const POS_COUNT = Number(process.env.POS_COUNT || 2);
const ORDER_COUNT = Number(process.env.ORDER_COUNT || 20);
const RETAIL_COUNT = Number(process.env.RETAIL_COUNT || 2);
const OFFICE_OPS = Number(process.env.OFFICE_OPS || 6);
const CONNECT_CONCURRENCY = Number(process.env.CONNECT_CONCURRENCY || 12);
const ORDER_CONCURRENCY = Number(process.env.ORDER_CONCURRENCY || 6);
const OFFICE_CONCURRENCY = Number(process.env.OFFICE_CONCURRENCY || 3);
const POS_CONFIRM_CONCURRENCY = Number(process.env.POS_CONFIRM_CONCURRENCY || 3);
const KDS_CONCURRENCY = Number(process.env.KDS_CONCURRENCY || 2);
const KDS_STEP_DELAY_MS = Number(process.env.KDS_STEP_DELAY_MS || 250);
const ORDER_BATCH_DELAY_MS = Number(process.env.ORDER_BATCH_DELAY_MS || 150);
const MAX_P95_MS = Number(process.env.MAX_P95_MS || 1000);
const WAIT_MS = Number(process.env.WAIT_MS || 25000);

const EVENT_NAMES = [
  'order:new',
  'order:pending',
  'order:customer_pending',
  'order:confirmed',
  'order:rejected',
  'order:updated',
  'order:item',
  'kds:refresh',
  'table:updated',
  'staff:call',
  'payment:done',
  'print:new',
  'print:queued',
  'inventory:updated',
  'inventory:alert',
  'expenses:updated',
  'shift:updated',
  'presence',
];

const t0 = performance.now();
const nowMs = () => performance.now();
const elapsed = () => Math.round(nowMs() - t0);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const progress = (message) => {
  if (process.env.SIM_PROGRESS !== '0') console.error(`[fleet-sim +${elapsed()}ms] ${message}`);
};

async function runLimited(items, limit, worker, delayMs = 0) {
  const results = new Array(items.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length || 1);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
      if (delayMs) await sleep(delayMs);
    }
  }));
  return results;
}

function createAsyncQueue(limit, name) {
  const queue = [];
  let active = 0;
  const maxActive = Math.max(1, limit);

  function drain() {
    while (active < maxActive && queue.length) {
      const task = queue.shift();
      active += 1;
      Promise.resolve()
        .then(task)
        .catch(err => console.error(`[${name}] ${err.message || err}`))
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  }

  return (task) => {
    queue.push(task);
    drain();
  };
}

function wsUrl(base) {
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/socket.io/';
  url.search = 'EIO=4&transport=websocket';
  return url.toString();
}

class MiniSocket {
  constructor({ name, baseUrl, branch, device, token = '' }) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.branch = branch;
    this.device = device;
    this.token = token;
    this.ws = null;
    this.connected = false;
    this.handlers = new Map();
    this.eventCounts = new Map();
  }

  on(event, handler) {
    const list = this.handlers.get(event) || [];
    list.push(handler);
    this.handlers.set(event, list);
  }

  async connect(timeoutMs = 8000) {
    const auth = { branch: this.branch, device: this.device };
    if (this.token) auth.token = this.token;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} socket connect timeout`)), timeoutMs);
      const ws = new WebSocket(wsUrl(this.baseUrl));
      this.ws = ws;

      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`${this.name} socket error`));
      };
      ws.onclose = (event) => {
        this.connected = false;
        if (!event.wasClean && event.code !== 1000) {
          const err = new Error(`${this.name} socket closed ${event.code} ${event.reason || ''}`.trim());
          if (!this.connected) {
            clearTimeout(timer);
            reject(err);
          }
        }
      };
      ws.onmessage = (event) => {
        const msg = typeof event.data === 'string'
          ? event.data
          : Buffer.from(event.data).toString('utf8');
        if (msg === '2') {
          ws.send('3');
          return;
        }
        if (msg.startsWith('0')) {
          ws.send('40' + JSON.stringify(auth));
          return;
        }
        if (msg.startsWith('40')) {
          this.connected = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        if (msg.startsWith('44')) {
          clearTimeout(timer);
          reject(new Error(`${this.name} socket rejected: ${msg.slice(2)}`));
          return;
        }
        if (!msg.startsWith('42')) return;
        let packet;
        try {
          packet = JSON.parse(msg.slice(2));
        } catch {
          return;
        }
        const [eventName, payload] = packet;
        this.eventCounts.set(eventName, (this.eventCounts.get(eventName) || 0) + 1);
        for (const handler of this.handlers.get(eventName) || []) {
          Promise.resolve(handler(payload, this)).catch(err => {
            console.error(`[${this.name}] handler ${eventName} failed:`, err.message);
          });
        }
      };
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

async function api(method, path, { token = '', body = undefined, branch = BRANCH_ID } = {}) {
  const headers = { 'content-type': 'application/json', 'x-branch-id': branch };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers['x-auth-token'] = token;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === 'object' && data ? (data.error || data.message) : text;
    const err = new Error(`HTTP ${res.status} ${method} ${path}: ${msg || res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function percentile(values, p) {
  const arr = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return null;
  const index = Math.min(arr.length - 1, Math.max(0, Math.ceil((p / 100) * arr.length) - 1));
  return Math.round(arr[index]);
}

function summaryStats(values) {
  return {
    count: values.filter(Number.isFinite).length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: percentile(values, 100),
  };
}

async function waitFor(label, predicate, timeoutMs = WAIT_MS) {
  const start = nowMs();
  while (nowMs() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

function orderIdFromPayload(payload) {
  return payload?.order?.id || payload?.order_id || null;
}

function itemIds(payload) {
  return (payload?.newItems || payload?.items || [])
    .map(item => item?.id || item?.item_id)
    .filter(Boolean);
}

async function ensureShift(token) {
  const cur = await api('GET', '/api/shifts/current', { token });
  if (cur?.shift) return cur.shift;
  const opened = await api('POST', '/api/shifts/open', {
    token,
    body: { shift_key: 'morning', opening_cash: 4000000, cash_manual: true },
  });
  return opened.shift;
}

async function ensureTables(token, needed) {
  let tables = await api('GET', '/api/tables', { token });
  if (tables.length >= needed) return tables.slice(0, needed);
  const run = Date.now().toString(36).toUpperCase();
  for (let i = tables.length; i < needed; i++) {
    await api('POST', '/api/settings/tables', {
      token,
      body: {
        zone: 'SIM',
        code: `SIM-${run}-${String(i + 1).padStart(2, '0')}`,
        seats: 4,
        security_pin: ADMIN_PIN,
      },
    });
  }
  tables = await api('GET', '/api/tables', { token });
  return tables.slice(0, needed);
}

function firstKitchenItems(menu) {
  return (menu.items || [])
    .filter(item => item && item.id && item.station !== 'retail' && item.can_order !== false && item.available !== false)
    .slice(0, 12);
}

function firstSkus(skus) {
  return (skus || [])
    .filter(sku => sku && sku.id && sku.active !== false && Number(sku.stock || 0) > 5)
    .slice(0, Math.max(RETAIL_COUNT, OFFICE_OPS, 3));
}

async function main() {
  const failures = [];
  await api('GET', '/api/ping');

  const login = await api('POST', '/api/login', {
    body: { username: ADMIN_USER, pin: ADMIN_PIN, branch_id: BRANCH_ID },
  });
  const token = login.token;
  await ensureShift(token);

  const [menu, warehouses, skus, expenseCats] = await Promise.all([
    api('GET', '/api/menu', { token }),
    api('GET', '/api/warehouses', { token }),
    api('GET', '/api/skus', { token }),
    api('GET', '/api/expenses/categories', { token }),
  ]);

  const kitchenItems = firstKitchenItems(menu);
  const retailSkus = firstSkus(skus);
  if (!kitchenItems.length) throw new Error('No orderable kitchen menu item found');
  if (!retailSkus.length) throw new Error('No stocked retail SKU found');

  const tables = await ensureTables(token, ORDER_COUNT);
  const retailWarehouse = warehouses.find(w => w.type === 'retail') || warehouses[0];

  const ordersById = new Map();
  const ordersByTable = new Map();
  const pendingConfirm = new Set();
  const kdsProcessed = new Set();
  const httpErrors = [];
  const eventTotals = Object.fromEntries(EVENT_NAMES.map(name => [name, 0]));
  const printCounts = {};
  const inventoryOps = [];
  const expenseOps = [];
  const paymentDoneAt = [];
  const enqueuePosConfirm = createAsyncQueue(POS_CONFIRM_CONCURRENCY, 'pos-confirm');
  const enqueueKdsWork = createAsyncQueue(KDS_CONCURRENCY, 'kds-work');

  const trackEvent = (eventName) => {
    if (eventName in eventTotals) eventTotals[eventName]++;
  };

  const findRecord = (payload) => {
    const oid = orderIdFromPayload(payload);
    if (oid && ordersById.has(oid)) return ordersById.get(oid);
    const tableId = payload?.order?.table_id || payload?.table_id;
    if (tableId && ordersByTable.has(tableId)) {
      const rec = ordersByTable.get(tableId);
      if (oid) {
        rec.orderId = oid;
        ordersById.set(oid, rec);
      }
      return rec;
    }
    return null;
  };

  async function confirmFromPos(payload, socket) {
    const orderId = orderIdFromPayload(payload);
    if (!orderId || pendingConfirm.has(orderId)) return;
    pendingConfirm.add(orderId);
    const rec = findRecord(payload);
    if (rec) {
      rec.pendingAt ??= nowMs();
      rec.confirmStartAt = nowMs();
      rec.confirmedBy = socket.name;
    }
    try {
      await api('POST', `/api/orders/${encodeURIComponent(orderId)}/confirm`, {
        token,
        body: { item_ids: itemIds(payload) },
      });
      if (rec) rec.confirmDoneAt = nowMs();
    } catch (err) {
      httpErrors.push(err.message);
    }
  }

  async function processKdsOrder(payload) {
    if (!payload?.confirmed) return;
    const orderId = orderIdFromPayload(payload);
    if (!orderId || kdsProcessed.has(orderId)) return;
    kdsProcessed.add(orderId);
    const rec = findRecord(payload);
    if (rec) rec.kdsAt ??= nowMs();
    for (const id of itemIds(payload)) {
      try {
        await api('POST', `/api/orders/items/${encodeURIComponent(id)}/status`, {
          token,
          body: { status: 'accepted' },
        });
        if (KDS_STEP_DELAY_MS) await sleep(KDS_STEP_DELAY_MS);
        await api('POST', `/api/orders/items/${encodeURIComponent(id)}/status`, {
          token,
          body: { status: 'preparing' },
        });
        if (KDS_STEP_DELAY_MS) await sleep(KDS_STEP_DELAY_MS);
        if (rec) rec.readyPostAt = nowMs();
        await api('POST', `/api/orders/items/${encodeURIComponent(id)}/status`, {
          token,
          body: { status: 'ready' },
        });
        if (rec) rec.readyDoneAt = nowMs();
      } catch (err) {
        httpErrors.push(err.message);
      }
    }
  }

  const sockets = [];
  const addSocket = (socket) => {
    for (const eventName of EVENT_NAMES) socket.on(eventName, () => trackEvent(eventName));
    sockets.push(socket);
    return socket;
  };

  for (let i = 0; i < POS_COUNT; i++) {
    const s = addSocket(new MiniSocket({ name: `pos-${i + 1}`, baseUrl: BASE_URL, branch: BRANCH_ID, device: 'pos', token }));
    s.on('order:pending', (payload, socket) => enqueuePosConfirm(() => confirmFromPos(payload, socket)));
    s.on('order:confirmed', (payload) => {
      const rec = findRecord(payload);
      if (rec) rec.confirmedAt ??= nowMs();
    });
    s.on('payment:done', () => paymentDoneAt.push(nowMs()));
  }

  const kds = addSocket(new MiniSocket({ name: 'kds-main', baseUrl: BASE_URL, branch: BRANCH_ID, device: 'kds', token }));
  kds.on('order:new', (payload) => {
    if (payload?.confirmed) {
      const rec = findRecord(payload);
      if (rec) rec.kdsAt ??= nowMs();
    }
    enqueueKdsWork(() => processKdsOrder(payload));
  });
  kds.on('order:item', (payload) => {
    const rec = findRecord(payload);
    if (rec && payload?.status === 'ready') rec.kdsReadyEchoAt ??= nowMs();
  });

  const printer = addSocket(new MiniSocket({ name: 'printer-monitor', baseUrl: BASE_URL, branch: BRANCH_ID, device: 'printers', token }));
  printer.on('print:new', (job) => {
    const type = job?.type || 'unknown';
    printCounts[type] = (printCounts[type] || 0) + 1;
  });

  for (let i = 0; i < TABLET_COUNT; i++) {
    const s = addSocket(new MiniSocket({ name: `tablet-${i + 1}`, baseUrl: BASE_URL, branch: BRANCH_ID, device: 'ipad' }));
    s.on('order:customer_pending', (payload) => {
      const rec = findRecord(payload);
      if (rec) rec.customerPendingAt ??= nowMs();
    });
    s.on('order:confirmed', (payload) => {
      const rec = findRecord(payload);
      if (rec) rec.tabletConfirmedAt ??= nowMs();
    });
    s.on('order:item', (payload) => {
      const rec = findRecord(payload);
      if (rec && payload?.status === 'ready') rec.tabletReadyAt ??= nowMs();
    });
  }

  for (let i = 0; i < PHONE_COUNT; i++) {
    const s = addSocket(new MiniSocket({ name: `office-phone-${i + 1}`, baseUrl: BASE_URL, branch: BRANCH_ID, device: 'warehouse', token }));
    s.on('inventory:updated', () => {
      const op = inventoryOps.find(x => !x.seenAt);
      if (op) op.seenAt = nowMs();
    });
    s.on('expenses:updated', () => {
      const op = expenseOps.find(x => !x.seenAt);
      if (op) op.seenAt = nowMs();
    });
  }

  progress(`connecting ${sockets.length} sockets with concurrency ${CONNECT_CONCURRENCY}`);
  await runLimited(sockets, CONNECT_CONCURRENCY, (s) => s.connect(), 20);
  progress(`connected ${sockets.filter(s => s.connected).length} sockets`);
  await sleep(300);

  progress(`submitting ${ORDER_COUNT} dine-in orders with concurrency ${ORDER_CONCURRENCY}`);
  const orderRun = runLimited(Array.from({ length: ORDER_COUNT }), ORDER_CONCURRENCY, async (_, i) => {
    const table = tables[i];
    const item = kitchenItems[i % kitchenItems.length];
    const rec = {
      index: i,
      tableId: table.id,
      sentAt: nowMs(),
      menuItemId: item.id,
    };
    ordersByTable.set(table.id, rec);
    try {
      const order = await api('POST', '/api/orders', {
        branch: BRANCH_ID,
        body: {
          table_id: table.id,
          channel: 'dine_in',
          items: [{ menu_item_id: item.id, qty: 1, note: `fleet-sim-${Date.now()}-${i}` }],
        },
      });
      rec.httpAt = nowMs();
      rec.orderId = order.id;
      ordersById.set(order.id, rec);
      return order;
    } catch (err) {
      rec.error = err.message;
      httpErrors.push(err.message);
      return null;
    }
  }, ORDER_BATCH_DELAY_MS);

  const retailRun = runLimited(Array.from({ length: RETAIL_COUNT }), Math.min(RETAIL_COUNT || 1, 2), async (_, i) => {
    const sku = retailSkus[i % retailSkus.length];
    try {
      return await api('POST', '/api/retail/checkout', {
        token,
        body: {
          items: [{ sku_id: sku.id, qty: 1 }],
          payments: [{ method: 'cash', amount: Number(sku.price || 0) || 100000 }],
        },
      });
    } catch (err) {
      httpErrors.push(err.message);
      return null;
    }
  });

  const officeTasks = [];
  for (let i = 0; i < OFFICE_OPS; i++) {
    const sku = retailSkus[i % retailSkus.length];
    officeTasks.push(async () => {
      const invOp = { startAt: nowMs(), itemId: sku.id };
      inventoryOps.push(invOp);
      try {
        return await api('POST', '/api/warehouse/receive', {
          token,
          body: {
            warehouse_id: retailWarehouse?.id || sku.warehouse_id,
            stock_type: 'sku',
            item_id: sku.id,
            qty: 1,
            lot_no: `SIM-${Date.now()}-${i}`,
            expiry_date: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
            unit_cost: Number(sku.cost || 0),
            supplier: 'fleet-sim',
          },
        });
      } catch (err) {
        invOp.error = err.message;
        httpErrors.push(err.message);
        return null;
      }
    });

    const cat = expenseCats[i % expenseCats.length];
    officeTasks.push(async () => {
      const expOp = { startAt: nowMs(), categoryId: cat?.id || null };
      expenseOps.push(expOp);
      try {
        return await api('POST', '/api/expenses', {
          token,
          body: {
            source: 'direct',
            method: 'bank',
            category_id: cat?.id,
            category_name: cat?.name || 'Fleet sim',
            amount: 10000 + i,
            note: `fleet-sim expense ${i}`,
          },
        });
      } catch (err) {
        expOp.error = err.message;
        httpErrors.push(err.message);
        return null;
      }
    });
  }
  const officeRun = runLimited(officeTasks, OFFICE_CONCURRENCY, task => task(), 50);

  await Promise.all([orderRun, retailRun, officeRun]);
  progress(`submitted workload, waiting for realtime completion`);

  async function waitOrFail(label, predicate) {
    try {
      await waitFor(label, predicate);
    } catch (err) {
      failures.push(err.message);
    }
  }

  await waitOrFail('all customer orders confirmed', () =>
    [...ordersByTable.values()].filter(r => !r.error && r.confirmDoneAt).length >= ORDER_COUNT
  );
  await waitOrFail('all customer orders visible on KDS', () =>
    [...ordersByTable.values()].filter(r => !r.error && r.kdsAt).length >= ORDER_COUNT
  );
  await waitOrFail('all customer tablets receive ready status', () =>
    [...ordersByTable.values()].filter(r => !r.error && r.tabletReadyAt).length >= ORDER_COUNT
  );
  await waitOrFail('office sync events', () =>
    inventoryOps.filter(o => o.seenAt).length >= OFFICE_OPS &&
    expenseOps.filter(o => o.seenAt).length >= OFFICE_OPS
  );

  const createdOrders = [...ordersByTable.values()].filter(r => r.orderId && !r.error);
  const persistedReads = await Promise.all(createdOrders.slice(0, Math.min(10, createdOrders.length)).map(r =>
    api('GET', `/api/orders/${encodeURIComponent(r.orderId)}`, { token }).catch(err => ({ error: err.message }))
  ));
  const printJobs = await api('GET', '/api/print/jobs?limit=300', { token });
  const pending = await api('GET', '/api/orders/pending-confirmation', { token });

  const latencies = {
    tabletToPosPending: createdOrders.map(r => r.pendingAt - r.sentAt),
    tabletToHttp: createdOrders.map(r => r.httpAt - r.sentAt),
    posConfirmRoundtrip: createdOrders.map(r => r.confirmDoneAt - r.confirmStartAt),
    confirmToKds: createdOrders.map(r => r.kdsAt - r.confirmStartAt),
    confirmToCustomerTablet: createdOrders.map(r => r.tabletConfirmedAt - r.confirmStartAt),
    kdsReadyToCustomerTablet: createdOrders.map(r => r.tabletReadyAt - r.readyPostAt),
    inventoryToPhones: inventoryOps.map(o => o.seenAt - o.startAt),
    expenseToPhones: expenseOps.map(o => o.seenAt - o.startAt),
  };

  const stats = Object.fromEntries(Object.entries(latencies).map(([key, values]) => [key, summaryStats(values)]));

  const expectedPrintMinimums = {
    kitchen_ticket: ORDER_COUNT,
    cup_label: ORDER_COUNT,
    runner: ORDER_COUNT,
    receipt: RETAIL_COUNT,
  };
  for (const [type, min] of Object.entries(expectedPrintMinimums)) {
    if ((printCounts[type] || 0) < min) failures.push(`print ${type} count ${printCounts[type] || 0} < ${min}`);
  }
  for (const [key, stat] of Object.entries(stats)) {
    if (stat.count && stat.p95 !== null && stat.p95 > MAX_P95_MS) {
      failures.push(`${key} p95 ${stat.p95}ms > ${MAX_P95_MS}ms`);
    }
  }
  if (httpErrors.length) failures.push(`${httpErrors.length} HTTP errors`);
  if (createdOrders.length !== ORDER_COUNT) failures.push(`created customer orders ${createdOrders.length} != ${ORDER_COUNT}`);
  if (persistedReads.some(x => x?.error || !x?.id)) failures.push('order persistence readback failed');
  if (pending.length) failures.push(`pending confirmations left: ${pending.length}`);

  const result = {
    ok: failures.length === 0,
    elapsedMs: elapsed(),
    fleet: {
      pos: POS_COUNT,
      customerTablets: TABLET_COUNT,
      officePhones: PHONE_COUNT,
      kds: 1,
      printerMonitor: 1,
      customerOrders: ORDER_COUNT,
      retailCheckouts: RETAIL_COUNT,
      officeOps: OFFICE_OPS,
      socketsConnected: sockets.filter(s => s.connected).length,
    },
    latencyMs: stats,
    eventTotals,
    printCounts,
    progress: {
      createdOrders: createdOrders.length,
      pendingSeen: createdOrders.filter(r => r.pendingAt).length,
      confirmPosted: createdOrders.filter(r => r.confirmDoneAt).length,
      kdsSeen: createdOrders.filter(r => r.kdsAt).length,
      readyEchoedToKds: createdOrders.filter(r => r.kdsReadyEchoAt).length,
      readySeenOnTablet: createdOrders.filter(r => r.tabletReadyAt).length,
      inventoryEventsSeen: inventoryOps.filter(o => o.seenAt).length,
      expenseEventsSeen: expenseOps.filter(o => o.seenAt).length,
    },
    persistedReadback: persistedReads.length,
    printJobsStored: Array.isArray(printJobs) ? printJobs.length : 0,
    pendingConfirmationsLeft: Array.isArray(pending) ? pending.length : null,
    failures,
    httpErrors: httpErrors.slice(0, 10),
  };

  console.log(JSON.stringify(result, null, 2));
  sockets.forEach(s => s.close());
  if (failures.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});

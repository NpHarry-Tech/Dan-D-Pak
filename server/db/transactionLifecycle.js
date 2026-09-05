// Track SQLite transaction/savepoint boundaries for effects that may run only
// after a durable commit. DatabaseSync and the application's single connection
// make a connection-scoped stack the correct owner; an event-loop tick is not a
// transaction boundary.

let frames = [];

function cleanSql(sql) {
  return String(sql || '').replace(/--[^\r\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
}

function savepointName(sql, rollback = false) {
  const pattern = rollback
    ? /^ROLLBACK(?:\s+TRANSACTION)?\s+TO(?:\s+SAVEPOINT)?\s+(["'`\[]?[^\s;"'`\]]+)/i
    : /^(?:SAVEPOINT|RELEASE(?:\s+SAVEPOINT)?)\s+(["'`\[]?[^\s;"'`\]]+)/i;
  const match = cleanSql(sql).match(pattern);
  return match?.[1]?.replace(/^["'`\[]|["'`\]]$/g, '').toLowerCase() || null;
}

function runCallbacks(callbacks) {
  for (const item of callbacks) {
    try { item.callback(); }
    catch (error) {
      try { item.onError?.(error); } catch { /* committed work must stay successful */ }
    }
  }
}

function release(name) {
  let index = -1;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].name === name) { index = i; break; }
  }
  if (index < 0) return;
  const callbacks = frames.slice(index).flatMap((frame) => frame.callbacks);
  frames = frames.slice(0, index);
  if (frames.length) frames[frames.length - 1].callbacks.push(...callbacks);
  else runCallbacks(callbacks);
}

function rollbackTo(name) {
  let index = -1;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].name === name) { index = i; break; }
  }
  if (index < 0) return;
  frames = frames.slice(0, index + 1);
  frames[index].callbacks = [];
}

export function transactionSqlSucceeded(sql) {
  const statement = cleanSql(sql);
  if (!statement) return;
  if (/^BEGIN(?:\s|;|$)/i.test(statement)) {
    frames = [{ name: null, callbacks: [] }];
  } else if (/^SAVEPOINT(?:\s|;|$)/i.test(statement)) {
    frames.push({ name: savepointName(statement), callbacks: [] });
  } else if (/^ROLLBACK(?:\s+TRANSACTION)?\s+TO(?:\s+SAVEPOINT)?(?:\s|$)/i.test(statement)) {
    rollbackTo(savepointName(statement, true));
  } else if (/^ROLLBACK(?:\s+TRANSACTION)?(?:\s*;)?$/i.test(statement)) {
    frames = [];
  } else if (/^RELEASE(?:\s+SAVEPOINT)?(?:\s|$)/i.test(statement)) {
    release(savepointName(statement));
  } else if (/^(?:COMMIT|END)(?:\s+TRANSACTION)?(?:\s*;)?$/i.test(statement)) {
    const callbacks = frames.flatMap((frame) => frame.callbacks);
    frames = [];
    runCallbacks(callbacks);
  }
}

export function transactionBatchSucceeded(sql) {
  for (const statement of cleanSql(sql).split(';').map((part) => part.trim()).filter(Boolean)) {
    transactionSqlSucceeded(statement);
  }
}

export function enqueueAfterCommit(callback, onError = null) {
  const item = { callback, onError };
  if (frames.length) frames[frames.length - 1].callbacks.push(item);
  else runCallbacks([item]);
}

export function trackedTransactionDepth() { return frames.length; }

export function synchronizeTransactionState(isTransaction) {
  if (!isTransaction) frames = [];
  else if (!frames.length) frames = [{ name: null, callbacks: [] }];
}

import { decryptSecret, envelopeInfo, needsReencryption, reencryptSecret } from './crypto.js';

/// Builds a redacted, deterministic migration plan. No plaintext/ciphertext is
/// returned, so dry-run output is safe to persist as evidence.
export function planSecretMigration(records) {
  return records.map((record) => {
    const value = record.value;
    const info = envelopeInfo(value);
    if (value && info.encrypted) decryptSecret(value, record.context);
    return {
      id: String(record.id),
      field: String(record.field || ''),
      state: !value ? 'empty' : !info.encrypted ? 'legacy-plaintext' :
        needsReencryption(value) ? `reencrypt-v${info.version}` : 'current',
      key_id: info.keyId || null,
    };
  });
}

/// Validates/decrypts every row before opening the write transaction. The
/// caller supplies its DB transaction boundary and row writer, making the
/// operation atomic. Re-running skips envelopes already on the active key.
export function migrateSecretRecords({ records, write, transaction, dryRun = true }) {
  const plan = planSecretMigration(records);
  if (dryRun) return { dryRun: true, changed: 0, plan };
  const changes = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (plan[i].state === 'empty' || plan[i].state === 'current') continue;
    changes.push({
      record,
      value: reencryptSecret(record.value, record.context, {
        allowPlaintext: plan[i].state === 'legacy-plaintext',
      }),
    });
  }
  const apply = () => {
    for (const change of changes) write(change.record, change.value);
  };
  (transaction || ((fn) => fn()))(apply);
  return { dryRun: false, changed: changes.length, plan };
}

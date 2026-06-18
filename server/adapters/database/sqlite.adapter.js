import { db, DB_PATH } from '../../db.js';

export function currentSqliteAdapter() {
  return {
    provider: 'sqlite',
    path: DB_PATH,
    db,
  };
}

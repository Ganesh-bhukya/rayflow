import { drizzle } from 'drizzle-orm/node-postgres';
import { getPool } from '../../config/database.js';
let _db = null;
export function getDb() {
    if (!_db) {
        const pool = getPool();
        _db = drizzle(pool);
    }
    return _db;
}
export function getPgPool() {
    return getPool();
}
//# sourceMappingURL=client.js.map
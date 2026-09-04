import { Pool } from "pg";

let _pool: Pool | null = null;

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({ connectionString });
  }

  return new Pool({
    host: String(process.env.DB_HOST ?? "localhost"),
    port: Number(process.env.DB_PORT ?? 5432),
    user: String(process.env.DB_USER ?? "postgres"),
    password: String(process.env.DB_PASSWORD ?? ""),
    database: String(process.env.DB_NAME ?? "rayflow"),
  });
}

export function getPool(): Pool {
  if (!_pool) _pool = createPool();
  return _pool;
}

export async function testDatabaseConnection() {
  console.log('DB env snapshot:', {
    DB_HOST: process.env.DB_HOST,
    DB_PORT: process.env.DB_PORT,
    DB_USER: process.env.DB_USER,
    DB_PASSWORD_type: typeof process.env.DB_PASSWORD,
    DATABASE_URL: process.env.DATABASE_URL ? '[REDACTED]' : undefined,
  });

  const pool = getPool();
  const client = await pool.connect();

  try {
    if (process.env.DATABASE_URL) {
      console.log('Attempting DB connection via DATABASE_URL');
    } else {
      console.log(`Attempting DB connection to ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432} as ${process.env.DB_USER || 'postgres'}`);
    }
    const result = await client.query("SELECT NOW()");
    console.log("PostgreSQL connected:", result.rows[0]);
  } finally {
    client.release();
  }
}
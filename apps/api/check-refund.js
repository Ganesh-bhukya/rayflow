import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const columns = await pool.query(
    `
    SELECT
      column_name,
      data_type
    FROM information_schema.columns
    WHERE table_schema = $1
      AND table_name = $2
    ORDER BY ordinal_position
    `,
    ["public", "refunds"],
  );

  console.log("\nRefunds Table Columns");
  console.log("=====================\n");

  console.table(columns.rows);

  const columnNames = columns.rows.map(
    (row) => row.column_name,
  );

  console.log("\nAvailable columns:");
  console.log(columnNames.join(", "));

  if (columnNames.includes("transaction_id")) {
    const refunds = await pool.query(
      `
      SELECT *
      FROM public.refunds
      WHERE transaction_id = $1
      ORDER BY created_at DESC
      `,
      ["a0d56b06-c096-4bd2-8a1b-9a47c6bff665"],
    );

    console.log("\nRefund Records For ₹500 Transaction");
    console.log("====================================\n");

    if (refunds.rows.length === 0) {
      console.log("No refund records found.");
    } else {
      console.table(refunds.rows);
    }
  }
} catch (error) {
  console.error("\n❌ Database diagnostic failed:");
  console.error(error);
} finally {
  await pool.end();
}
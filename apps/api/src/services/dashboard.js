import { getPgPool } from '../infrastructure/database/client.js';
export async function getDashboardMetrics() {
    const pool = getPgPool();
    const clients = await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM public.users"),
        pool.query("SELECT COUNT(*)::int AS count FROM public.merchants"),
        pool.query("SELECT COUNT(*)::int AS count FROM public.customers"),
        pool.query("SELECT COUNT(*)::int AS count FROM public.transactions"),
        pool.query(`SELECT COALESCE(SUM(amount),0)::bigint AS total FROM public.transactions WHERE created_at >= now() - interval '30 days'`),
    ]);
    return {
        users: clients[0].rows[0].count,
        merchants: clients[1].rows[0].count,
        customers: clients[2].rows[0].count,
        transactions: clients[3].rows[0].count,
        volumeLast30Days: clients[4].rows[0].total,
    };
}
export async function getRecentTransactions(limit = 20) {
    const pool = getPgPool();
    const q = `
    SELECT
      t.id,
      t.amount,
      t.currency,
      t.status,
      t.created_at as createdAt,
      po.id as order_id,
      po.merchant_id,
      po.customer_id,
      c.name as customer_name,
      m.business_name as merchant_name
    FROM public.transactions t
    LEFT JOIN public.payment_orders po ON po.id = t.order_id
    LEFT JOIN public.customers c ON c.id = po.customer_id
    LEFT JOIN public.merchants m ON m.id = po.merchant_id
    ORDER BY t.created_at DESC
    LIMIT $1
  `;
    const res = await pool.query(q, [limit]);
    return res.rows;
}
//# sourceMappingURL=dashboard.js.map
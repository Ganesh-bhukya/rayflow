import express from "express";
import {
  getDashboardMetrics,
  getRecentTransactions,
} from "../services/dashboard.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| GET /dashboard/metrics
|--------------------------------------------------------------------------
*/

router.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getDashboardMetrics();

    return res.json({
      status: "ok",
      metrics,
    });
  } catch (error) {
    console.error(
      "Failed to fetch dashboard metrics:",
      error,
    );

    return res.status(500).json({
      status: "error",
      message: "Unable to load dashboard metrics.",
    });
  }
});

/*
|--------------------------------------------------------------------------
| GET /dashboard/recent-transactions
|--------------------------------------------------------------------------
*/

router.get(
  "/recent-transactions",
  async (req, res) => {
    try {
      const limit = Number(
        req.query.limit ?? 20,
      );

      const rows =
        await getRecentTransactions(limit);

      return res.json({
        status: "ok",
        rows,
      });
    } catch (error) {
      console.error(
        "Failed to fetch recent transactions:",
        error,
      );

      return res.status(500).json({
        status: "error",
        message:
          "Unable to load recent transactions.",
      });
    }
  },
);

export default router;
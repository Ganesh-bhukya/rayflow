import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { testDatabaseConnection } from "./config/database.js";

import paymentsRouter from "./services/payments.js";
import transactionsRouter from "./routes/transactions.js";
import recoveryRouter from "./routes/recovery.js";
import customersRouter from "./routes/customers.js";
import merchantsRouter from "./routes/merchants.js";
import refundsRouter from "./routes/refunds.js";
import dashboardRouter from "./routes/dashboard.js";
import webhooksRouter from "./routes/webhooks.js";
import auditRouter from "./routes/audit.js";
import reconciliationRouter from "./routes/reconciliation.js";

const app = express();

const PORT = Number(process.env.PORT ?? 4000);

/*
 * -------------------------------------------------------
 * Middleware
 * -------------------------------------------------------
 */

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
    ],
    credentials: true,
  }),
);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
  }),
);

app.use(morgan("combined"));

/*
 * -------------------------------------------------------
 * Health
 * -------------------------------------------------------
 */

app.get("/health", (_req, res) => {
  return res.json({
    status: "ok",
    service: "rayflow-api",
  });
});

/*
 * -------------------------------------------------------
 * Database health
 * -------------------------------------------------------
 */

app.get("/health/db", async (_req, res) => {
  try {
    await testDatabaseConnection();

    return res.json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return res.status(500).json({
      status: "error",
      database: "disconnected",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/*
 * The Razorpay route must receive the raw request stream before
 * the application-wide JSON parser consumes it. The webhook router
 * applies express.raw() only to that route.
 */
app.use("/webhooks", webhooksRouter);

app.use(express.json());

app.use(
  express.urlencoded({
    extended: true,
  }),
);

/*
 * -------------------------------------------------------
 * API Routes
 * -------------------------------------------------------
 */

app.use("/payments", paymentsRouter);

app.use("/transactions", transactionsRouter);

app.use("/recovery", recoveryRouter);

app.use("/customers", customersRouter);

app.use("/merchants", merchantsRouter);

app.use("/refunds", refundsRouter);

app.use("/dashboard", dashboardRouter);

app.use("/audit-logs", auditRouter);

app.use("/reconciliation", reconciliationRouter);

/*
 * -------------------------------------------------------
 * 404 Handler
 * -------------------------------------------------------
 */

app.use((_req, res) => {
  return res.status(404).json({
    status: "error",
    error: "Route not found",
  });
});

/*
 * -------------------------------------------------------
 * Global Error Handler
 * -------------------------------------------------------
 */

app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("Unhandled API error:", error);

    if (res.headersSent) {
      return;
    }

    return res.status(500).json({
      status: "error",
      error: "Internal server error",
    });
  },
);

/*
 * -------------------------------------------------------
 * Start Server
 * -------------------------------------------------------
 */

app.listen(PORT, () => {
  console.log("");
  console.log("========================================");
  console.log("        RayFlow API Server");
  console.log("========================================");
  console.log(`API:          http://localhost:${PORT}`);
  console.log(`Health:       http://localhost:${PORT}/health`);
  console.log(`Database:     http://localhost:${PORT}/health/db`);
  console.log(`Payments:     http://localhost:${PORT}/payments`);
  console.log(`Transactions: http://localhost:${PORT}/transactions`);
  console.log(`Recovery:     http://localhost:${PORT}/recovery`);
  console.log(`Customers:    http://localhost:${PORT}/customers`);
  console.log(`Merchants:    http://localhost:${PORT}/merchants`);
  console.log(`Refunds:      http://localhost:${PORT}/refunds`);
  console.log("========================================");
  console.log("");
});

export default app;
import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/*
 * ============================================================
 * USERS
 * ============================================================
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    email: varchar("email", {
      length: 255,
    })
      .notNull()
      .unique(),

    passwordHash: varchar("password_hash", {
      length: 255,
    }).notNull(),

    firstName: varchar("first_name", {
      length: 100,
    }).notNull(),

    lastName: varchar("last_name", {
      length: 100,
    }),

    isActive: boolean("is_active")
      .notNull()
      .default(true),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIndex: index("users_email_idx").on(table.email),
  }),
);

/*
 * ============================================================
 * MERCHANTS
 * ============================================================
 */

export const merchants = pgTable(
  "merchants",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),

    businessName: varchar("business_name", {
      length: 200,
    }).notNull(),

    merchantCode: varchar("merchant_code", {
      length: 50,
    })
      .notNull()
      .unique(),

    isActive: boolean("is_active")
      .notNull()
      .default(true),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIndex: index("merchants_user_id_idx").on(
      table.userId,
    ),
  }),
);

/*
 * ============================================================
 * CUSTOMERS
 * ============================================================
 */

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),

  email: varchar("email", {
    length: 255,
  }),

  name: varchar("name", {
    length: 200,
  }),

  phone: varchar("phone", {
    length: 20,
  }),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});

/*
 * ============================================================
 * PAYMENT ORDERS
 * ============================================================
 */

export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),

    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),

    amount: integer("amount").notNull(),

    currency: varchar("currency", {
      length: 3,
    })
      .notNull()
      .default("INR"),

    status: varchar("status", {
      length: 30,
    })
      .notNull()
      .default("created"),

    idempotencyKey: varchar("idempotency_key", {
      length: 100,
    })
      .notNull()
      .unique(),
      razorpayOrderId: varchar("razorpay_order_id", {
  length: 100,
}),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    merchantIndex: index(
      "payment_orders_merchant_id_idx",
    ).on(table.merchantId),

    customerIndex: index(
      "payment_orders_customer_id_idx",
    ).on(table.customerId),

    statusIndex: index(
      "payment_orders_status_idx",
    ).on(table.status),
    razorpayOrderIndex: index(
  "payment_orders_razorpay_order_id_idx",
).on(table.razorpayOrderId),
  }),
);

/*
 * ============================================================
 * PAYMENT ATTEMPTS
 * ============================================================
 */

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => paymentOrders.id),

    paymentMethod: varchar("payment_method", {
      length: 50,
    }).notNull(),

    status: varchar("status", {
      length: 30,
    })
      .notNull()
      .default("created"),

    providerReference: varchar("provider_reference", {
      length: 100,
    }),

    failureCode: varchar("failure_code", {
      length: 100,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIndex: index(
      "payment_attempts_order_id_idx",
    ).on(table.orderId),
  }),
);

/*
 * ============================================================
 * TRANSACTIONS
 * ============================================================
 */

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    orderId: uuid("order_id")
      .notNull()
      .references(() => paymentOrders.id),

    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => paymentAttempts.id),

    amount: integer("amount").notNull(),

    currency: varchar("currency", {
      length: 3,
    })
      .notNull()
      .default("INR"),

    type: varchar("type", {
      length: 30,
    })
      .notNull()
      .default("payment"),

    status: varchar("status", {
      length: 30,
    })
      .notNull()
      .default("success"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIndex: index(
      "transactions_order_id_idx",
    ).on(table.orderId),

    attemptIndex: index(
      "transactions_attempt_id_idx",
    ).on(table.attemptId),
  }),
);

/*
 * ============================================================
 * REFUNDS
 * ============================================================
 */

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),

    amount: integer("amount").notNull(),

    status: varchar("status", {
      length: 30,
    })
      .notNull()
      .default("pending"),

    reason: varchar("reason", {
      length: 500,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    transactionIndex: index(
      "refunds_transaction_id_idx",
    ).on(table.transactionId),
  }),
);

/*
 * ============================================================
 * AUDIT LOGS
 * ============================================================
 */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id").references(() => users.id),

    action: varchar("action", {
      length: 100,
    }).notNull(),

    entityType: varchar("entity_type", {
      length: 100,
    }).notNull(),

    entityId: uuid("entity_id"),

    metadata: varchar("metadata", {
      length: 5000,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIndex: index(
      "audit_logs_user_id_idx",
    ).on(table.userId),

    entityIndex: index(
      "audit_logs_entity_idx",
    ).on(
      table.entityType,
      table.entityId,
    ),
  }),
);

/*
 * ============================================================
 * API KEYS
 * ============================================================
 */

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),

    name: varchar("name", {
      length: 100,
    })
      .notNull()
      .default("Default API Key"),

    keyHash: varchar("key_hash", {
      length: 128,
    })
      .notNull()
      .unique(),

    keyPrefix: varchar("key_prefix", {
      length: 20,
    }).notNull(),

    isActive: boolean("is_active")
      .notNull()
      .default(true),

    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    merchantIndex: index(
      "api_keys_merchant_id_idx",
    ).on(table.merchantId),

    activeIndex: index(
      "api_keys_active_idx",
    ).on(table.isActive),
  }),
);
/*
 * ============================================================
 * WEBHOOK EVENTS
 * ============================================================
 */

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    eventId: varchar("event_id", {
      length: 100,
    })
      .notNull()
      .unique(),

    eventType: varchar("event_type", {
      length: 100,
    }).notNull(),

    orderId: uuid("order_id").references(
      () => paymentOrders.id,
    ),

    transactionId: uuid("transaction_id").references(
      () => transactions.id,
    ),

    payload: varchar("payload", {
      length: 10000,
    }).notNull(),

    status: varchar("status", {
      length: 30,
    })
      .notNull()
      .default("pending"),

    attempts: integer("attempts")
      .notNull()
      .default(0),

    lastError: varchar("last_error", {
      length: 1000,
    }),

    processedAt: timestamp("processed_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orderIndex: index(
      "webhook_events_order_id_idx",
    ).on(table.orderId),

    transactionIndex: index(
      "webhook_events_transaction_id_idx",
    ).on(table.transactionId),

    statusIndex: index(
      "webhook_events_status_idx",
    ).on(table.status),
  }),
);
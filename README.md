# RayFlow

> A payment operations and recovery platform built around Razorpay.

RayFlow is a payment operations dashboard designed to help businesses monitor payments, manage refunds, track transaction states, recover failed payments, and maintain an auditable record of important payment events.

## 🚀 Overview

Payment failures, delayed refunds, inconsistent transaction states, and fragmented operational data can make payment management difficult.

RayFlow provides a centralized interface for managing the payment lifecycle:

**Payment → Verification → Transaction Tracking → Recovery → Refund → Reconciliation → Audit**

The project integrates with Razorpay APIs and webhook events to keep payment and refund states synchronized with the application database.

---

## ✨ Key Features

### 💳 Payment Management

- Payment transaction monitoring
- Payment status tracking
- Razorpay order/payment integration
- Payment verification

### 🔄 Recovery

- Failed payment visibility
- Recovery workflow
- Processing attempt tracking
- Payment state management

### 💰 Refund Management

- Refund creation and tracking
- Pending, successful and failed refund states
- Refund status updates through Razorpay webhooks
- Refund amount validation
- Protection against invalid state regressions

### 🔔 Razorpay Webhooks

RayFlow handles:

- `refund.created`
- `refund.processed`
- `refund.failed`

Webhook processing includes:

- Razorpay signature verification
- Event ID handling for idempotency
- Refund identification through Razorpay notes
- Refund amount validation
- Safe refund state transitions
- Audit logging

### 📊 Dashboard

The dashboard provides operational visibility into:

- Payments
- Transactions
- Refunds
- Recovery
- Merchants
- Customers

### 🧾 Audit Logging

Important payment and refund events are recorded for traceability and debugging.

---

## 🛠️ Tech Stack

### Frontend

- React
- TypeScript
- Vite
- CSS

### Backend

- Node.js
- Express
- TypeScript

### Database

- PostgreSQL
- Drizzle ORM

### Payment Gateway

- Razorpay

### Development

- Git
- GitHub
- PowerShell
- VS Code

---

## 📁 Project Structure

```text
rayflow/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── infrastructure/
│   │   │   ├── routes/
│   │   │   └── services/
│   │   ├── scripts/
│   │   ├── test/
│   │   └── package.json
│   │
│   └── web/
│       ├── src/
│       │   ├── pages/
│       │   ├── assets/
│       │   └── App.tsx
│       └── package.json
│
├── package.json
├── package-lock.json
└── .gitignore
```

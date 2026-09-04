# RayFlow Architecture

## 1. Overview

RayFlow is a payment operations and revenue recovery platform built around Razorpay.

The platform provides visibility across the payment lifecycle, detects failed payments, evaluates recovery opportunities, executes bounded recovery workflows, manages refunds, processes Razorpay webhooks, and maintains an auditable history of operational decisions.

The core architecture follows:

> Detect revenue at risk → determine the safest recovery action → enforce deterministic safety boundaries → execute only permitted actions → measure the outcome.

---

## 2. High-Level Architecture

```text
                         ┌─────────────────────┐
                         │      CUSTOMER       │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  Razorpay Checkout  │
                         └──────────┬──────────┘
                                    │
                              Payment / Failure
                                    │
                                    ▼

┌─────────────────────────────────────────────────────────────┐
│                         RAYFLOW                             │
│                                                             │
│  ┌────────────────┐       ┌──────────────────────┐          │
│  │   React Web UI │──────▶│     Express API      │          │
│  └────────────────┘       └──────────┬───────────┘          │
│                                      │                      │
│                    ┌─────────────────┼─────────────────┐    │
│                    ▼                 ▼                 ▼    │
│              ┌────────────┐   ┌──────────────┐   ┌────────┐│
│              │  Payments  │   │   Recovery   │   │Refunds ││
│              │   Engine   │   │    Engine    │   │ Engine ││
│              └────────────┘   └──────┬───────┘   └────────┘│
│                                      │                      │
│                                      ▼                      │
│                           ┌────────────────────┐             │
│                           │ Recovery Decision  │             │
│                           │      Engine        │             │
│                           └─────────┬──────────┘             │
│                                     │                       │
│                        ┌────────────┼────────────┐          │
│                        ▼            ▼            ▼          │
│                     RETRY       ESCALATE       STOP        │
│                        │            │            │          │
│                        └────────────┼────────────┘          │
│                                     ▼                       │
│                           ┌────────────────────┐             │
│                           │ Payment State      │             │
│                           │ Machine / Policy   │             │
│                           └─────────┬──────────┘             │
│                                     │                       │
│                                     ▼                       │
│                        ┌────────────────────────┐           │
│                        │ Audit + Events +        │           │
│                        │ Idempotency + Controls  │           │
│                        └────────────┬───────────┘           │
│                                     │                       │
└─────────────────────────────────────┼───────────────────────┘
                                      ▼
                             ┌────────────────┐
                             │   PostgreSQL   │
                             └────────────────┘
                                      ▲
                                      │
                             Razorpay Webhooks
                         refund.created / processed /
                                  failed


                                  3. Frontend Architecture

The frontend is a React application that provides the operational interface for payment management and revenue recovery.

The main areas include:

Dashboard
Payments
Razorpay Checkout
Transactions
Recovery
Customers
Refunds
Merchants

The Recovery page provides:

Failed payment visibility
Revenue at risk
Recovered revenue
Recovery rate
Failure reason analysis
AI recovery decisions
Decision confidence
Automation status
Recovery outcomes
Recent auditable decisions
Bounded recovery actions

The frontend does not directly modify payment state.

Recovery actions are sent to the backend API, where policy validation and payment state-machine validation are performed.

4. Backend and Payment Architecture

The backend is implemented using Node.js and Express.

The API is responsible for:

Payment creation
Payment attempt management
Payment state transitions
Recovery workflows
Refund management
Razorpay integration
Webhook processing
Audit logging
Database transactions

RayFlow separates a payment order from individual payment attempts.

Payment Order

A payment order represents the business-level payment and contains information such as:

Merchant
Customer
Amount
Currency
Status
Idempotency key
Razorpay order reference
Payment Attempt

A payment attempt represents an individual attempt to complete a payment.

It records:

Order ID
Payment method
Attempt status
Provider reference
Failure code
Timestamps

This model allows RayFlow to reason about payment failures and recovery attempts independently from the overall order.

5. Payment State Machine

Payment state transitions are enforced by a deterministic state machine.

Supported transitions are:

created
   │
   ├──────────────▶ failed
   │
   ▼
processing
   │
   ├──────────────▶ success
   │
   └──────────────▶ failed
                         │
                         ▼
                    processing

Allowed transitions:

created    → processing
created    → failed

processing → success
processing → failed

failed     → processing

success    → terminal

A successful payment cannot be moved back to a previous state.

The Recovery Decision Engine therefore cannot directly change payment state.

Every recovery action must pass through the deterministic state machine before execution.

This provides a safety boundary between an AI-assisted decision and financial state changes.

6. AI Recovery Decision Engine

RayFlow includes a bounded Recovery Decision Engine responsible for determining the safest recovery action for a failed payment.

The engine evaluates signals including:

Payment method
Payment amount
Currency
Failure code
Previous failed attempts
Retry policy

It produces:

action
confidence
reason
signals
automated

The possible actions are:

RETRY

Recommended for temporary or potentially recoverable failures.

Examples include:

TIMEOUT
NETWORK_ERROR
GATEWAY_TIMEOUT
PROVIDER_UNAVAILABLE
TEMPORARY_ERROR
PROCESSING_ERROR
STOP

Recommended when an immediate retry is unlikely to resolve the problem.

Examples include:

INSUFFICIENT_FUNDS
ACCOUNT_BLOCKED
ACCOUNT_CLOSED
INVALID_ACCOUNT
CARD_EXPIRED
CARD_BLOCKED
PAYMENT_NOT_ALLOWED
ESCALATE

Used when the failure cannot be safely classified or required payment information is incomplete.

Automated execution is blocked and the case can be reviewed.

7. Bounded Recovery Workflow

The recovery workflow is:

Failed Payment
      │
      ▼
Revenue at Risk
      │
      ▼
Failure Analysis
      │
      ▼
Recovery Decision Engine
      │
      ├───────────────┐
      │               │
      ▼               ▼
    RETRY       STOP / ESCALATE
      │               │
      ▼               ▼
Safety Validation   Protected /
      │               Review
      ▼
Payment State Machine
      │
      ▼
Bounded Recovery Execution
      │
      ▼
Success / Failure
      │
      ▼
Transaction + Audit Log

RayFlow currently allows a maximum of:

1 automated retry

If the retry limit has already been reached, further automated recovery is stopped.

For example:

TIMEOUT
   │
   ▼
Retry limit available
   │
   ▼
RETRY
   │
   ▼
Automated recovery allowed

While:

INSUFFICIENT_FUNDS
   │
   ▼
Non-retryable failure
   │
   ▼
STOP
   │
   ▼
Automated recovery blocked

This prevents uncontrolled retry loops and protects against unnecessary payment attempts.

8. Decision and Execution Separation

The Recovery Decision Engine only recommends an action.

It does not:

Modify the database
Change payment state
Create transactions
Execute payment operations directly

The recovery executor is responsible for:

Locking the payment order
Locking the latest payment attempt
Validating the current payment state
Evaluating the recovery policy
Applying the state-machine transition
Executing the permitted recovery workflow
Updating payment and order status
Creating the transaction record
Recording the audit trail

This separation ensures that an incorrect decision cannot bypass deterministic financial controls.

9. Recovery Measurement

RayFlow measures recovery at the revenue level.

The Recovery API provides metrics including:

Total payments
Failed payments
Successful payments
Revenue currently at risk
Successfully recovered revenue
Recovery rate
Failure reasons

The key business metric is:

How much revenue was actually recovered?

The recovery measurement flow is:

Revenue at Risk
      │
      ▼
Recovery Decision
      │
      ▼
Recovery Execution
      │
      ▼
Successful Recovery
      │
      ▼
Recovered Revenue

This allows the system to evaluate recovery performance using financial outcomes rather than simply counting recovery actions.

10. Razorpay Webhooks and Security

RayFlow processes Razorpay webhooks through:

POST /webhooks/razorpay

The webhook implementation uses:

Raw request body processing
x-razorpay-signature
x-razorpay-event-id
HMAC-SHA256 signature verification
Timing-safe signature comparison
Event idempotency
Payload validation
Refund amount validation
Audit logging

The raw request body is preserved until signature verification is complete.

The payload is parsed only after successful signature verification.

Supported refund events include:

refund.created
refund.processed
refund.failed

The processing flow is:

Razorpay
   │
   ▼
Raw Webhook Body
   │
   ▼
HMAC-SHA256 Verification
   │
   ├───────────────┐
   │               │
 Invalid          Valid
   │               │
   ▼               ▼
400 Error      Event ID Check
                   │
                   ▼
              Event Processing
                   │
                   ▼
              Database Update
                   │
                   ▼
                Audit Log

Duplicate webhook event IDs are detected so that the same event is not processed repeatedly.

11. Audit Trail and Database

PostgreSQL is the primary persistence layer.

Important entities include:

payment_orders
payment_attempts
transactions
refunds
audit_logs
webhook_events
Audit Trail

Recovery decisions are recorded using audit events such as:

recovery.decision
recovery.completed

Recovery audit metadata can include:

Order ID
Attempt ID
Transaction ID
Recovery action
Confidence
Automation status
Failure code
Previous failed attempts
Decision reason
Decision signals
Previous status
Current status
Amount
Currency
Payment method

This provides traceability from the original payment failure through the recovery decision and final outcome.

Database Integrity

Critical recovery operations use database transactions and row-level locking.

This protects against concurrent recovery requests attempting to modify the same payment simultaneously.

12. Current Implementation and Future Architecture
Currently Implemented

RayFlow currently implements:

Payment order creation
Payment attempt tracking
Payment state-machine validation
Razorpay Checkout integration
Razorpay webhook signature verification
Webhook idempotency
Refund lifecycle handling
Refund amount validation
Failed payment detection
Revenue-at-risk calculation
Recovery Decision Engine
RETRY / STOP / ESCALATE decisions
Confidence scoring
Bounded automated retry policy
Recovery execution workflow
Recovered revenue measurement
Recovery audit trail
Payment, refund, merchant, customer and transaction views
Current Recovery Execution

The current buildathon prototype uses a controlled recovery execution flow to demonstrate the complete decision-to-outcome architecture.

The important production boundary is already represented:

Decision Engine
      ↓
Recovery Policy
      ↓
Payment State Machine
      ↓
Recovery Executor
      ↓
Audit Trail

A production deployment can replace the controlled execution layer with real provider retry orchestration without changing the core safety architecture.

Future Production Extensions

Potential next-stage capabilities include:

Real provider retry execution
Queue-based recovery workers
Scheduled retry policies
Merchant-specific recovery policies
Configurable retry limits
More sophisticated failure classification
Human approval workflows
Notifications and escalation channels
Distributed tracing
Advanced observability
Horizontal API scaling
Production AI/LLM-assisted reasoning

Any future LLM integration should remain behind the same deterministic safety boundaries.

The AI layer may recommend an action, but it should not bypass:

Policy
  ↓
State Machine
  ↓
Database Transaction
  ↓
Audit Trail
13. Buildathon Recovery Architecture

RayFlow is designed around the AI Revenue Recovery problem:

Detect revenue at risk, determine the right intervention, execute a bounded recovery workflow, and measure recovered revenue.

The architecture can therefore be summarized as:

1. DETECT
   │
   ▼
Revenue at Risk

2. DECIDE
   │
   ▼
Safest Recovery Action

3. EXECUTE
   │
   ▼
Bounded Recovery Workflow

4. MEASURE
   │
   ▼
Recovered Revenue + Audit Trail

The central design principle is:

Automate the right recovery actions safely, rather than blindly retrying every failed payment.
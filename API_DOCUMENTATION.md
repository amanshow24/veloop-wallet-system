# API Documentation

## Contents

- [Authentication](#authentication)
  - [Register](#register)
  - [Login](#login)
  - [Current user](#current-user)
- [Wallet API](#wallet-api)
  - [Get wallet](#get-wallet)
  - [Get wallet summary](#get-wallet-summary)
  - [Get wallet transactions](#get-wallet-transactions)
  - [Internal/admin credit](#internaladmin-credit)
  - [Internal/admin debit](#internaladmin-debit)
- [Withdrawals](#withdrawals)
  - [Create a withdrawal](#create-a-withdrawal)
  - [List the authenticated user's withdrawals](#list-the-authenticated-users-withdrawals)
  - [Get one of the authenticated user's withdrawals](#get-one-of-the-authenticated-users-withdrawals)
  - [Admin/internal review operations](#admininternal-review-operations)
  - [Withdrawal safety and test mode](#withdrawal-safety-and-test-mode)
- [Payout configuration API](#payout-configuration-api)
  - [Get payout methods](#get-payout-methods)
  - [Get payout options](#get-payout-options)
  - [Assignment reference payout configuration](#assignment-reference-payout-configuration)
- [Testing wallet endpoints in Postman](#testing-wallet-endpoints-in-postman)
- [Health check](#health-check)
- [Testing and deployment notes](#testing-and-deployment-notes)

## Authentication

Authentication routes are rate-limited to 10 requests per IP per 15-minute
window. Requests and responses use JSON. Passwords and account role/status
must never be supplied by clients except the password used to authenticate.
The API uses `express-rate-limit`'s built-in in-memory store; Redis or an
Upstash API key is not required for one API instance. Counters are per-process,
reset when the process restarts, and are not shared across instances. Configure
`TRUST_PROXY_HOPS` for the actual trusted proxy chain so the limiter can
identify the client IP correctly.

### Register

- **Method:** `POST`
- **Path:** `/api/auth/register`
- **Authentication:** Not required
- **Request:**

```json
{
  "name": "Demo User",
  "email": "demo@example.com",
  "password": "a-strong-password"
}
```

- **Response (201):** Returns `success`, a safe user object, and a JWT token.
  The new user is always assigned the `USER` role and `ACTIVE` status. The
  backend creates exactly one wallet with zero balances in the same MongoDB
  transaction; registration therefore requires a replica-set or sharded
  MongoDB deployment.
- **Errors:** `400` invalid input or extra fields; `409` email already exists;
  `429` rate limit exceeded.

Example success response:

```json
{
  "success": true,
  "user": {
    "id": "USER_OBJECT_ID",
    "name": "Demo User",
    "email": "demo@example.com",
    "accountStatus": "ACTIVE",
    "role": "USER"
  },
  "token": "SIGNED_JWT"
}
```

### Login

- **Method:** `POST`
- **Path:** `/api/auth/login`
- **Authentication:** Not required
- **Request:**

```json
{
  "email": "demo@example.com",
  "password": "a-strong-password"
}
```

- **Response (200):** Returns `success`, a safe user object, and a JWT token.
- **Errors:** `400` invalid input; `401` invalid credentials; `403` inactive
  account; `429` rate limit exceeded. Invalid email and password use the same
  response to avoid exposing account existence.

### Current user

- **Method:** `GET`
- **Path:** `/api/auth/me`
- **Authentication:** Required; send the JWT returned by register or login in
  an `Authorization` header containing the access token.
- **Response (200):** Returns the authenticated user's safe profile.
- **Errors:** `401` missing, invalid, expired, or unknown-user token; `403`
  inactive account; `429` rate limit exceeded.

Protected identity and role are loaded from the account identified by the
verified JWT subject. A `userId` query or body field is never used to select
the current account. The `authorizeRoles(...roles)` middleware is available
for internal/admin routes.

## Wallet API

All wallet endpoints require an `Authorization` header containing the JWT
access token. The read endpoints always use the user ID from the verified
token; they reject a client-supplied `userId` rather than allowing a caller
to select another user's wallet. All responses use JSON and include a
`success` boolean.

### Get wallet

- **Method:** `GET`
- **Path:** `/api/wallet`
- **Authorization:** Active authenticated user; returns only that user's
  wallet.
- **Query:** None.
- **Response (200):**

```json
{
  "success": true,
  "wallet": {
    "id": "WALLET_OBJECT_ID",
    "ves": 25000,
    "sves": 5000,
    "gems": 100,
    "tokens": 500,
    "spins": 3,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-02-01T00:00:00.000Z"
  }
}
```

- **Errors:** `401` missing/invalid token; `403` inactive account; `404`
  authenticated user's wallet does not exist; `400` unsupported query
  parameters.

### Get wallet summary

- **Method:** `GET`
- **Path:** `/api/wallet/summary`
- **Authorization:** Active authenticated user; only that user's wallet is
  summarized.
- **Query:** None.
- **Response (200):**

```json
{
  "success": true,
  "summary": {
    "balances": {
      "ves": 25000,
      "sves": 5000,
      "gems": 100,
      "tokens": 500,
      "spins": 3
    },
    "lastUpdated": "2026-02-01T00:00:00.000Z"
  }
}
```

- **Errors:** Same as `GET /api/wallet`.

### Get wallet transactions

- **Method:** `GET`
- **Path:** `/api/wallet/transactions`
- **Authorization:** Active authenticated user; history is scoped to the JWT
  subject.
- **Query:** Optional `page` (positive integer, default `1`) and `limit`
  (positive integer, default `20`, maximum `100`). Other query parameters,
  including `userId`, are rejected.
- **Example:** `GET /api/wallet/transactions?page=1&limit=20`
- **Response (200):**

```json
{
  "success": true,
  "transactions": [
    {
      "transactionId": "TRANSACTION_ID",
      "currency": "VES",
      "type": "AD_REWARD",
      "amount": 500,
      "balanceBefore": 1000,
      "balanceAfter": 1500,
      "source": "WATCH_AD",
      "referenceId": null,
      "status": "COMPLETED",
      "description": "Ad reward",
      "metadata": {},
      "createdAt": "2026-02-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "pages": 1
  }
}
```

- **Errors:** `400` invalid or unsupported query parameter; `401` missing or
  invalid token; `403` inactive account.

### Internal/admin credit

- **Method:** `POST`
- **Path:** `/api/wallet/credit`
- **Authorization:** Active `ADMIN` or `INTERNAL` account only.
- **Request:** `targetUserId` is the wallet being administered, not the
  authenticated caller's identity. It is accepted only on this privileged
  route; reads always use the authenticated user. Never send or accept
  `balanceBefore` or `balanceAfter` from clients—the service computes those
  values from the stored wallet.

```json
{
  "targetUserId": "TARGET_USER_OBJECT_ID",
  "currency": "VES",
  "amount": 500,
  "type": "BONUS",
  "source": "ADMIN",
  "referenceId": "support-case-123",
  "description": "Approved demo bonus",
  "metadata": {
    "reason": "local test"
  }
}
```

- **Response (201):** Returns `success`, updated wallet balances, and the
  append-only ledger transaction with computed `balanceBefore` and
  `balanceAfter`.
- **Errors:** `400` invalid fields, currency, amount, or credit type; `401`
  missing/invalid token; `403` non-admin/internal caller; `404` target wallet
  missing; `409` balance integer range exceeded. Internal errors return a
  generic `500` message.

Every successful wallet credit and debit also creates a corresponding audit
record in the same MongoDB transaction as the wallet update and ledger entry.
The audit record identifies the authenticated administrator, wallet, ledger
transaction, currency, amount, source, and request IP. Internal operations
without a user actor record `SYSTEM`; audit metadata never stores payout
details.

Example success response:

```json
{
  "success": true,
  "wallet": {
    "id": "WALLET_OBJECT_ID",
    "ves": 25500,
    "sves": 5000,
    "gems": 100,
    "tokens": 500,
    "spins": 3,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-02-01T00:00:00.000Z"
  },
  "transaction": {
    "transactionId": "TRANSACTION_ID",
    "userId": "TARGET_USER_OBJECT_ID",
    "currency": "VES",
    "type": "BONUS",
    "amount": 500,
    "balanceBefore": 25000,
    "balanceAfter": 25500,
    "source": "ADMIN",
    "referenceId": "support-case-123",
    "status": "COMPLETED",
    "description": "Approved demo bonus",
    "metadata": {
      "reason": "local test"
    },
    "createdAt": "2026-02-01T00:00:00.000Z",
    "updatedAt": "2026-02-01T00:00:00.000Z"
  }
}
```

### Internal/admin debit

- **Method:** `POST`
- **Path:** `/api/wallet/debit`
- **Authorization:** Active `ADMIN` or `INTERNAL` account only.
- **Request:** Same fields and validation as credit. Supported debit examples
  include `WITHDRAWAL`, `EXCHANGE_DEBIT`, `ADMIN_DEBIT`, and `CORRECTION`.
- **Response (201):** Returns the updated wallet and append-only ledger
  transaction with server-computed balances.
- **Errors:** Same authorization and input errors as credit; `409` when the
  target wallet has insufficient funds. The wallet update and ledger insert
  are committed together in a MongoDB transaction.

The success response has the same `success`, `wallet`, and `transaction`
shape as the credit response, with the debit's resulting balances and ledger
type.

## Withdrawals

Withdrawal requests are authenticated and scoped to the JWT user. They use
immediate VEs deduction: the withdrawal, wallet update, debit ledger entry,
and audit log are committed in one MongoDB transaction. If an administrator
rejects the request, an append-only reversal credit and the status/audit
updates are committed together. A rejection cannot be applied twice.

The payout method and option must both exist in MongoDB, be active, and have
`AVAILABLE` status. Account eligibility and required payout detail fields are
checked from that configuration. Payout amounts and required wallet currency
are always loaded from the selected database option; client-supplied amounts
or balances are rejected. The opt-in assignment-reference seed enables UPI
with sample denominations and mandatory manual review. These values are not
verified live offers, and the project does not connect to a payout provider.
Do not use the assignment-reference seed in production.

### Create a withdrawal

- **Method:** `POST`
- **Path:** `/api/withdrawals` (the trailing-slash form is also accepted)
- **Authorization:** Active authenticated user.
- **Rate limit:** 5 requests per IP per 15 minutes.
- **Required header:** `Idempotency-Key`, 8-128 characters using letters,
  digits, `.`, `_`, `:`, or `-`. Reuse the same key when retrying one logical
  submission.
- **Request:** Only `method`, `optionId`, and `payoutDetails` are accepted.
  Supply the required detail keys returned by the configured method/option;
  for UPI the reference configuration uses `upiId`.

```json
{
  "method": "upi",
  "optionId": "upi_inr_10",
  "payoutDetails": {
    "upiId": "demo@upi"
  }
}
```

- **Response (201):** New pending withdrawal. The returned `currencyAmount`,
  `payoutAmount`, and `payoutCurrency` come from the database configuration.
- **Idempotent replay (200):** The same user, key, and payload return the
  original withdrawal without another deduction. Reusing the key with a
  different method, option, or payout details returns `409`.
- **Errors:** `400` invalid input/missing idempotency header; `401`
  unauthenticated; `403` inactive or ineligible account; `409` unavailable
  method/option, insufficient funds, or idempotency payload conflict; `429`
  rate limit exceeded.

Example success response:

```json
{
  "success": true,
  "replayed": false,
  "withdrawal": {
    "withdrawalId": "WITHDRAWAL_UUID",
    "userId": "AUTHENTICATED_USER_OBJECT_ID",
    "method": "upi",
    "optionId": "upi_inr_10",
    "currency": "VES",
    "currencyAmount": 2400,
    "payoutAmount": 10,
    "payoutCurrency": "INR",
    "payoutDetails": {
      "upiId": "demo@upi"
    },
    "status": "PENDING",
    "rejectionReason": null,
    "reviewNote": null,
    "transactionId": "DEBIT_LEDGER_TRANSACTION_ID",
    "requestedAt": "2026-02-01T00:00:00.000Z",
    "processedAt": null,
    "processedBy": null,
    "statusHistory": [
      {
        "status": "PENDING",
        "changedBy": "AUTHENTICATED_USER_OBJECT_ID",
        "note": null,
        "changedAt": "2026-02-01T00:00:00.000Z"
      }
    ]
  }
}
```

### List the authenticated user's withdrawals

- **Method:** `GET`
- **Path:** `/api/withdrawals` or `/api/withdrawals/`
- **Authorization:** Active authenticated user; results are always scoped to
  the JWT subject. `userId` is not accepted as a query parameter.
- **Query:** Optional `page` (positive integer, default `1`), `limit` (positive
  integer, default `20`, maximum `100`), and `status` (`PENDING`,
  `PROCESSING`, `APPROVED`, `REJECTED`, or `CANCELLED`).
- **Response (200):** `{ "success": true, "withdrawals": [], "pagination": {} }`.

### Get one of the authenticated user's withdrawals

- **Method:** `GET`
- **Path:** `/api/withdrawals/:withdrawalId`
- **Authorization:** Active authenticated user; another user's ID returns the
  same `404` as an unknown withdrawal.
- **Response (200):** `{ "success": true, "withdrawal": { ... } }`.

### Admin/internal review operations

All review operations require an active `ADMIN` or `INTERNAL` account and
are rate-limited to 30 requests per IP per 15 minutes. A transition and its
audit record are atomic. Terminal withdrawals cannot be changed.

| Method | Path | Allowed transition | Request body |
|---|---|---|---|
| `PATCH` | `/api/withdrawals/:withdrawalId/process` | `PENDING` → `PROCESSING` | `{}` or `{"reviewNote":"..."}` |
| `PATCH` | `/api/withdrawals/:withdrawalId/approve` | `PROCESSING` → `APPROVED` | `{}` or `{"reviewNote":"..."}` |
| `PATCH` | `/api/withdrawals/:withdrawalId/reject` | `PENDING`/`PROCESSING` → `REJECTED` | `{"reason":"..."}` |

Rejecting a withdrawal credits the exact originally deducted currency amount
back to the user's wallet and appends a `WITHDRAWAL_REVERSAL` ledger entry.
The original debit remains unchanged. Rejection requires a reason; the reason
and transition are included in audit/status history. `CANCELLED` is a
supported stored status but has no public cancellation endpoint.

### Withdrawal safety and test mode

MongoDB transactions require a replica set (Atlas supports this). To run the
withdrawal integration test, set `WITHDRAWAL_TEST_MONGO_URI` to an isolated
local replica-set test database and run `npm run test:withdrawal:integration`
from `backend`. Never point this destructive test at a production database.

All errors use this response shape:

```json
{
  "success": false,
  "message": "A concise error message."
}
```

Credit types include `CREDIT`, `REWARD`, `BONUS`, `REFERRAL`, `DAILY_REWARD`,
`AD_REWARD`, `GAME_REWARD`, `ADMIN_CREDIT`, and `EXCHANGE_CREDIT`. Debit types
include `DEBIT`, `WITHDRAWAL`, `EXCHANGE_DEBIT`, `ADMIN_DEBIT`, and
`CORRECTION`. Amounts must be positive safe integers.

## Payout configuration API

Payout methods and options are read from MongoDB (`PayoutMethod` and
`PayoutOption` collections). Both endpoints require an active authenticated
user. Responses include method/option availability and eligibility metadata;
the frontend must respect those states and must not hardcode payout
denominations. `active` and `availability` are both reported: a method or
option is selectable only when `active` is `true` and `availability` is
`AVAILABLE`. The backend still performs authoritative validation when a
withdrawal request is created.

### Get payout methods

- **Method:** `GET`
- **Path:** `/api/payout/methods`
- **Authentication:** Required; active account.
- **Query:** None.
- **Response (200):** Returns catalog entries stored in MongoDB, including
  their configured options. Inactive methods remain present so the UI can
  explain that a method is not currently available.

```json
{
  "success": true,
  "methods": [
    {
      "methodId": "upi",
      "name": "UPI",
      "type": "UPI",
      "active": true,
      "availability": "AVAILABLE",
      "eligibility": {
        "accountStatus": "ACTIVE",
        "configurationConfirmed": true,
        "manualReviewRequired": true
      },
      "requiredDetails": ["upiId"],
      "options": [
        {
          "optionId": "upi_inr_10_reference",
          "name": "INR 10 UPI redemption (assignment reference)",
          "currency": "VES",
          "requiredAmount": 2400,
          "payoutAmount": 10,
          "payoutCurrency": "INR",
          "active": true,
          "availability": "AVAILABLE",
          "metadata": {
            "source": "ASSIGNMENT_REFERENCE",
            "referenceOnly": true
          }
        }
      ]
    }
  ]
}
```

- **Errors:** `400` unsupported query parameters; `401` missing/invalid token;
  `403` inactive account; generic `500` for internal errors.

### Get payout options

- **Method:** `GET`
- **Path:** `/api/payout/options/`
- **Authentication:** Required; active account.
- **Query:** Optional `method`, e.g. `?method=upi`. Without it, returns
  configured options for all methods. Unknown query parameters or malformed
  method IDs are rejected.
- **Response (200):** `{ "success": true, "options": [...] }`, where each
  option includes its method ID, payout/required amounts, currencies,
  availability, eligibility, and required detail fields.
- **Errors:** `400` invalid query; `401` missing/invalid token; `403` inactive
  account; `404` valid but unknown method; generic `500` for internal errors.

The options route returns configured records, including disabled ones, so the
frontend can display their current availability. The Payout page filters by
`active` and `availability`, and shows the required VEs cost from each active
option. To show a method, the
frontend can call `GET /api/payout/methods` and render the returned catalog.
After a method is selected, it can call
`GET /api/payout/options/?method=upi` to refresh that method's options. The
React app should render the response; payout configuration and denominations
come from MongoDB.

### Assignment reference payout configuration

The assignment PDF lists these previously configured UPI reference values:

| Payout | Required balance |
|---:|---:|
| INR 10 | 2,400 VEs |
| INR 25 | 5,800 VEs |
| INR 50 | 10,000 VEs |
| INR 100 | 19,500 VEs |
| INR 150 | 28,500 VEs |
| INR 300 | 52,500 VEs |
| INR 500 | 80,500 VEs |
| INR 1,000 | 150,000 VEs |

The development/test seed makes these eight UPI options active and available
for the assignment demonstration, marks them `ASSIGNMENT_REFERENCE`, and
requires manual review. This does not claim that they are the current live
platform values and does not connect a payment service. PayPal, Amazon Gift
Card, and Google Play Gift Card remain inactive/unavailable because the
assignment does not provide their denominations or complete eligibility/detail
configuration.

The seed requires explicit opt-in and a MongoDB database name ending in `_dev`,
`_development`, or `_test`. `PAYOUT_REFERENCE_DATABASE` can pin it to an exact
database name. It is idempotent and refreshes only the four assignment method
records and eight UPI reference option records; it does not touch users,
wallets, or ledger transactions. Configuration changes create
`PAYOUT_CONFIGURATION_CHANGED` audit entries in the same database transaction.
To verify both endpoints against a dedicated
disposable database ending in `_test`, set `PAYOUT_TEST_MONGO_URI` and run
`npm run test:payout:integration`.

### Testing wallet endpoints in Postman

Import `backend/postman/VELoop-Wallet-Local.postman_collection.json`. Set
`baseUrl`, `userToken`, `adminToken`, `targetUserId`, and `otherUserId` as
collection variables. Obtain user/admin JWTs from the auth endpoints; public
registration creates only a `USER`, so an administrator must be provisioned
through trusted local database administration. The collection includes each
endpoint, missing-token checks, a cross-user read attempt, and normal-user
mutation denials. Credit and debit requests change wallet balances and create
ledger entries; run them only against a disposable development database.

### Health check

- **Method:** `GET`
- **Path:** `/api/health`
- **Authentication:** Not required
- **Purpose:** Confirms that the Express API is running.
- **Response (200):**

```json
{
  "success": true,
  "service": "veloop-wallet-backend",
  "status": "ok",
  "timestamp": "2026-11-01T00:00:00.000Z"
}
```

- **Method:** `GET`
- **Path:** `/api/ready`
- **Authentication:** Not required.
- **Purpose:** Reports whether the API can currently reach MongoDB. This is the
  deployment readiness probe; `/api/health` remains a database-independent
  liveness check.
- **Response (200):**
  `{ "success": true, "service": "veloop-wallet-backend", "status": "ready", "timestamp": "..." }`.
- **Response (503):**
  `{ "success": false, "service": "veloop-wallet-backend", "status": "unavailable", "timestamp": "..." }`.

## Testing and deployment notes

Run unit and HTTP tests from `backend/` with `npm test`; build the production
frontend from `frontend/` with `npm run build`. Database integration tests
are opt-in and must use separate disposable MongoDB replica-set databases.
They cover wallet transaction safety, concurrent debits, withdrawal
idempotency, rejected-withdrawal reversals, payout configuration, and account
isolation. Never aim an integration test or demo seed at production data.

The deployment instructions in `README.md` cover the recommended Vercel
frontend, Render backend, and MongoDB Atlas setup. Use only a dedicated
demonstration database with a replica set; wallet transactions require
transaction support. The demo UPI configuration is reference data that
requires manual review; no payment processor is connected. Deploy behind
HTTPS and keep database access restricted. Public signups start with a zero
balance; the demo seed is restricted to development/test databases and does
not transfer to a separate deployment. Withdrawal review is available only
through protected admin/internal API endpoints; there is no reviewer UI or
payment transfer integration. Use one API instance with the built-in
per-process rate-limit store, or configure a shared store before scaling out.
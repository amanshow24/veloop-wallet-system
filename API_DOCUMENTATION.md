# VELoop Wallet API

> **Demo API:** This project is not connected to VELoop production systems or
> a payment provider. Payout reference amounts are not live offers. Use
> synthetic account and payout details only.

| | |
|---|---|
| **Base path** | `/api` |
| **Transport** | JSON over HTTP; use HTTPS in hosted environments |
| **Authentication** | JWT bearer token for protected routes |
| **Wallet amounts** | Balances are nonnegative safe integers; requested mutation amounts are positive safe integers |
| **Wallet currencies** | `VES`, `SVES`, `GEMS`, `TOKENS`, `SPINS` |

## Contents

- [Endpoint index](#endpoint-index)
- [Authentication](#authentication)
- [Wallet](#wallet)
- [Payout configuration](#payout-configuration)
- [Withdrawals](#withdrawals)
- [Health and readiness](#health-and-readiness)
- [Errors and rate limits](#errors-and-rate-limits)
- [Local testing](#local-testing)

## Endpoint index

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/register` | Public | Create a `USER` account and zero-balance wallet |
| `POST` | `/api/auth/login` | Public | Authenticate and issue a token |
| `GET` | `/api/auth/me` | Active account | Return the authenticated profile |
| `GET` | `/api/wallet` | Active account | Read the caller’s balances |
| `GET` | `/api/wallet/summary` | Active account | Read balances and last-updated time |
| `GET` | `/api/wallet/transactions` | Active account | List the caller’s paginated ledger |
| `POST` | `/api/wallet/credit` | `ADMIN`, `INTERNAL` | Credit a target wallet |
| `POST` | `/api/wallet/debit` | `ADMIN`, `INTERNAL` | Debit a target wallet |
| `GET` | `/api/payout/methods` | Active account | Read payout catalog and nested options |
| `GET` | `/api/payout/options` | Active account | Read configured payout options |
| `POST` | `/api/withdrawals` | Active account | Submit an idempotent withdrawal request |
| `GET` | `/api/withdrawals` | Active account | List the caller’s withdrawal requests |
| `GET` | `/api/withdrawals/:withdrawalId` | Active account | Read one of the caller’s requests |
| `PATCH` | `/api/withdrawals/:withdrawalId/process` | `ADMIN`, `INTERNAL` | Move `PENDING` to `PROCESSING` |
| `PATCH` | `/api/withdrawals/:withdrawalId/approve` | `ADMIN`, `INTERNAL` | Move `PROCESSING` to `APPROVED` |
| `PATCH` | `/api/withdrawals/:withdrawalId/reject` | `ADMIN`, `INTERNAL` | Reject and reverse a pending/processing debit |
| `GET` | `/api/health` | Public | Liveness check |
| `GET` | `/api/ready` | Public | MongoDB readiness check |

Protected routes require:

```http
Authorization: Bearer <token>
```

Identity and role are loaded from the account represented by the verified
token. User-scoped reads do not accept a client-selected `userId`.

## Authentication

All authentication routes share a limit of 10 requests per IP per 15 minutes.
Tokens are signed by the API and expire according to `JWT_EXPIRES_IN` (default
`1h`). Suspended accounts cannot use protected routes.

### Register

`POST /api/auth/register`

```json
{
  "name": "Demo User",
  "email": "demo@example.com",
  "password": "a-strong-password"
}
```

| Field | Constraints |
|---|---|
| `name` | String, 2–80 characters after trimming |
| `email` | Valid email, maximum 254 characters |
| `password` | 8–72 UTF-8 bytes |

**201 Created**

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

Registration creates a `USER` account and one zero-balance wallet in the same
MongoDB transaction. Clients cannot select roles or account status. MongoDB
transactions require a replica set or sharded cluster.

### Login

`POST /api/auth/login`

```json
{
  "email": "demo@example.com",
  "password": "a-strong-password"
}
```

Returns the same `user` and `token` shape with **200 OK**. Invalid email and
password combinations share the same **401** response so the API does not
reveal whether an account exists. Inactive accounts receive **403**.

### Current user

`GET /api/auth/me`

Returns **200 OK** with `{ "success": true, "user": { ... } }`. The user object
contains only `id`, `name`, `email`, `accountStatus`, and `role`.

## Wallet

Wallet balances are nonnegative safe integers. Currency fields in the wallet
representation are lowercase; transaction `currency` values are uppercase.
Ledger entries are append-only.

### Read wallet

| Request | Response |
|---|---|
| `GET /api/wallet` | `200 { "success": true, "wallet": { "id", "ves", "sves", "gems", "tokens", "spins", "createdAt", "updatedAt" } }` |
| `GET /api/wallet/summary` | `200 { "success": true, "summary": { "balances": { ... }, "lastUpdated": "ISO-8601" } }` |

These endpoints take no query parameters. Wallet not found returns **404**.

### List transactions

`GET /api/wallet/transactions?page=1&limit=20`

| Query | Default | Constraints |
|---|---:|---|
| `page` | `1` | Positive integer, maximum `1,000,000` |
| `limit` | `20` | Positive integer, maximum `100` |

Other query parameters are rejected. The result is newest-first:

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
  "pagination": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```

### Privileged credit and debit

`POST /api/wallet/credit` and `POST /api/wallet/debit` require an active
`ADMIN` or `INTERNAL` account. The body must contain only the fields below;
`targetUserId` identifies the wallet being administered.

```json
{
  "targetUserId": "TARGET_USER_OBJECT_ID",
  "currency": "VES",
  "amount": 500,
  "type": "BONUS",
  "source": "ADMIN",
  "referenceId": "support-case-123",
  "description": "Approved demo bonus",
  "metadata": { "reason": "local test" }
}
```

| Field | Constraints |
|---|---|
| `targetUserId` | MongoDB ObjectId |
| `currency` | `VES`, `SVES`, `GEMS`, `TOKENS`, or `SPINS` |
| `amount` | Positive safe integer |
| `type` | Must match the operation’s permitted types |
| `source` | Non-empty string, maximum 64 characters |
| `referenceId` | Optional string, maximum 128 characters |
| `description` | Non-empty string, maximum 300 characters |
| `metadata` | Optional plain JSON object |

Credit types: `CREDIT`, `REWARD`, `BONUS`, `REFERRAL`, `DAILY_REWARD`,
`AD_REWARD`, `GAME_REWARD`, `ADMIN_CREDIT`, `EXCHANGE_CREDIT`.

Debit types: `DEBIT`, `WITHDRAWAL`, `EXCHANGE_DEBIT`, `ADMIN_DEBIT`,
`CORRECTION`.

**201 Created** returns `success`, the updated `wallet`, and the created
`transaction`. `balanceBefore` and `balanceAfter` are computed by the server;
clients must not submit them. Wallet changes, ledger insertion, and audit
record creation are committed together. Insufficient funds return **409**.

## Payout configuration

Both catalog endpoints require an active authenticated account. Payout data
comes from MongoDB; clients should render the response rather than hardcode
methods, availability, or denominations. An option is selectable only when
`active` is `true` and `availability` is `AVAILABLE`. Withdrawal submission
revalidates configuration and eligibility on the server.

### List methods

`GET /api/payout/methods`

Returns **200 OK** with `{ "success": true, "methods": [...] }`. Each method
includes its `methodId`, `name`, `type`, `active`, `availability`,
`eligibility`, `requiredDetails`, and nested `options`. Disabled methods remain
in the response so the client can show their availability state.

### List options

`GET /api/payout/options`

Optionally filter by method:

```http
GET /api/payout/options?method=upi
```

Returns **200 OK** with `{ "success": true, "options": [...] }`. A valid but
unknown method returns **404**; malformed or unexpected query fields return
**400**. Disabled options are included in the catalog.

Option records include the method/option IDs, `currency`, `requiredAmount`,
`payoutAmount`, `payoutCurrency`, availability, eligibility, required detail
fields, and metadata.

### Assignment reference data

The opt-in development seed configures the following UPI values. They are
assignment references only and require manual review; they are not verified
live rates or executable payouts.

| Sample payout | Required wallet amount |
|---:|---:|
| INR 10 | 2,400 VES |
| INR 25 | 5,800 VES |
| INR 50 | 10,000 VES |
| INR 100 | 19,500 VES |
| INR 150 | 28,500 VES |
| INR 300 | 52,500 VES |
| INR 500 | 80,500 VES |
| INR 1,000 | 150,000 VES |

The seed leaves PayPal, Amazon Gift Card, and Google Play Gift Card
unavailable. It must not be run in production.

## Withdrawals

Withdrawal amounts and wallet currency are read from the selected database
option; the request cannot set them. Creating a request atomically writes the
withdrawal, debits the wallet, appends a ledger entry, and records an audit
entry. No funds are transferred to an external provider.

### Create a withdrawal

`POST /api/withdrawals`

Limited to 5 requests per client IP per 15 minutes. Include an `Idempotency-Key`
header of 8–128 characters using letters, digits, `.`, `_`, `:`, or `-`.
Reuse the same key when retrying the same logical request.

```http
Idempotency-Key: demo-withdrawal-001
Content-Type: application/json
```

```json
{
  "method": "upi",
  "optionId": "upi_inr_10_reference",
  "payoutDetails": {
    "upiId": "demo@upi"
  }
}
```

Only `method`, `optionId`, and `payoutDetails` are accepted. Details must
contain exactly the configured required fields, with non-empty string values.
For a `upiId` field, the API validates UPI ID syntax. Use synthetic values
only; payout details are stored with the withdrawal and included in its API
representation.

| Outcome | HTTP status | Behavior |
|---|---:|---|
| New request | `201` | Creates a `PENDING` withdrawal and performs one wallet debit |
| Same user, key, and payload | `200` | Returns the original withdrawal without another debit |
| Same key with a different payload | `409` | Rejects the conflicting request |

The response contains `success`, `replayed`, and `withdrawal`. The withdrawal
includes the configured currency amounts, payout details, status, linked
transaction ID, request/review timestamps, and status history.

Other common errors: **400** invalid body/header/details; **401** missing or
invalid token; **403** inactive or ineligible account; **404** wallet missing;
**409** unavailable method/option, insufficient balance, or idempotency
conflict; **429** rate limit reached.

### List and retrieve withdrawals

| Request | Description |
|---|---|
| `GET /api/withdrawals` | List only the caller’s withdrawals |
| `GET /api/withdrawals/:withdrawalId` | Retrieve one of the caller’s withdrawals |

List query parameters:

| Query | Default | Constraints |
|---|---:|---|
| `page` | `1` | Positive integer, maximum `1,000,000` |
| `limit` | `20` | Positive integer, maximum `100` |
| `status` | — | `PENDING`, `PROCESSING`, `APPROVED`, `REJECTED`, or `CANCELLED` |

Unknown query parameters are rejected. A request belonging to another user is
reported as **404**, the same as an unknown withdrawal ID.

### Review a withdrawal

Review actions require an active `ADMIN` or `INTERNAL` account and share a
limit of 30 requests per client IP per 15 minutes.

| Request | Allowed transition | Body |
|---|---|---|
| `PATCH /api/withdrawals/:withdrawalId/process` | `PENDING` → `PROCESSING` | `{}` or `{"reviewNote":"..."}` |
| `PATCH /api/withdrawals/:withdrawalId/approve` | `PROCESSING` → `APPROVED` | `{}` or `{"reviewNote":"..."}` |
| `PATCH /api/withdrawals/:withdrawalId/reject` | `PENDING` or `PROCESSING` → `REJECTED` | `{"reason":"..."}` |

`reviewNote`, when provided, must be 3–1,000 characters. Rejection requires a
3–1,000-character `reason`. A rejection credits the original wallet amount
back through a new `WITHDRAWAL_REVERSAL` ledger entry; the original debit
remains unchanged. The status transition, reversal, and audit record commit
atomically. Invalid transitions return **409**. Approval only records the
review status; it does not transfer funds. `CANCELLED` is a stored status but
has no public cancellation endpoint.

## Health and readiness

| Request | Meaning | Success response |
|---|---|---|
| `GET /api/health` | API process is responding; does not depend on MongoDB | `200 { "success": true, "service": "veloop-wallet-backend", "status": "ok", "timestamp": "..." }` |
| `GET /api/ready` | MongoDB connection is ready | `200` with `"status": "ready"`; `503` with `"status": "unavailable"` otherwise |

Both endpoints are public. `/api/ready` is configured as the Render health
check path.

## Errors and rate limits

Application errors use this JSON shape:

```json
{
  "success": false,
  "message": "A concise error message."
}
```

| Status | Meaning |
|---:|---|
| `400` | Invalid JSON, field, query, or other request input |
| `401` | Missing, invalid, expired, or unknown-user token |
| `403` | Inactive account or insufficient role/eligibility |
| `404` | Unknown route or resource not visible to the caller |
| `409` | Conflict, duplicate account, unavailable option, insufficient funds, or invalid state transition |
| `413` | Request body exceeds the 32 KB limit |
| `429` | Rate limit reached |
| `500` | Unexpected server error; response does not expose internal details |
| `503` | Readiness probe cannot reach MongoDB |

| Route group | Limit | Window |
|---|---:|---:|
| `/api/auth/*` | 10 requests / IP | 15 minutes |
| `POST /api/withdrawals` | 5 requests / IP | 15 minutes |
| Withdrawal review actions | 30 requests / IP | 15 minutes |

Rate limiting uses the built-in in-memory store. Counters reset when the
process restarts and are not shared across instances. For proxied deployments,
configure `TRUST_PROXY_HOPS` to the actual trusted proxy chain; do not trust
arbitrary forwarded headers.

## Local testing

Run the backend unit/HTTP suite from `backend/`:

```powershell
npm test
```

Run API checks with the included collection:

1. Import [`backend/postman/VELoop-Wallet-Local.postman_collection.json`](./backend/postman/VELoop-Wallet-Local.postman_collection.json).
2. Set `baseUrl`, `userToken`, `adminToken`, `targetUserId`, and `otherUserId`.
3. Public signup creates a `USER`; obtain administrator credentials only
   through trusted local database administration.
4. Use a disposable development database. Credit/debit calls mutate balances,
   and the test suite includes cross-user access checks.

MongoDB integration test scripts are opt-in and may create or modify records.
Set the corresponding variable to a dedicated disposable replica-set URI:

| Script | URI variable |
|---|---|
| `npm run test:auth:integration` | `AUTH_TEST_MONGO_URI` |
| `npm run test:payout:integration` | `PAYOUT_TEST_MONGO_URI` |
| `npm run test:wallet:integration` | `WALLET_TEST_MONGO_URI` |
| `npm run test:withdrawal:integration` | `WITHDRAWAL_TEST_MONGO_URI` |

Never point an integration test or seed at production data.

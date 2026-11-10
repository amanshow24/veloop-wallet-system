# VELoop Rewards Wallet System

A demonstration wallet and payout application built for the VELoop backend
assignment. It includes a React frontend, an Express API, MongoDB persistence,
JWT authentication, wallet ledger operations, payout configuration, withdrawal
review flows, and audit records.

> **Demo only:** Use your own test database and credentials. Do not connect to
> VELoop production systems or treat the sample payout values as live offers.
> No payment provider is connected.

## Stack and features

- React, Vite, and React Router frontend
- Node.js, Express, and Mongoose backend
- MongoDB transactions for account/wallet creation and wallet/ledger changes
- JWT authentication, bcrypt password hashing, validation, and rate limits
- Wallet balances and history, configurable payouts, and idempotent withdrawals
- Audit logging for sensitive wallet and withdrawal changes

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for routes, payloads,
responses, and error behavior.

## Requirements

- Node.js 20 or newer and npm
- MongoDB Atlas or another MongoDB replica set/sharded cluster

Wallet and registration flows use MongoDB transactions; a standalone MongoDB
server is not sufficient.

## Run locally (Windows PowerShell)

### Backend

```powershell
cd C:\Users\AMAN\OneDrive\Desktop\veloop-wallet-system\backend
npm ci
Copy-Item .env.example .env
```

Edit `backend\.env` and set `MONGO_URI` to your own development replica-set
database. Set `JWT_SECRET` to a private random value of at least 32 characters.
Generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Start the API:

```powershell
npm run dev
```

### Frontend

In a second terminal:

```powershell
cd C:\Users\AMAN\OneDrive\Desktop\veloop-wallet-system\frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The frontend
template points to `http://localhost:5000/api`. The API listens on port 5000
by default; check liveness at `http://localhost:5000/api/health` and database
readiness at `http://localhost:5000/api/ready`.

Never commit `.env` files or put database credentials in frontend settings.

## Rate limiting

The API uses `express-rate-limit` with its built-in in-memory store; it does
not use Redis or require an Upstash API key. Limits are counted by client IP
over a 15-minute window:

| Requests | Limit |
|---|---:|
| Authentication endpoints (`/api/auth/*`) | 10 |
| Creating withdrawal requests | 5 |
| Reviewer withdrawal actions | 30 |

When a limit is reached, the API responds with HTTP `429`; wait for the
window to reset before retrying. The counters are local to the running API
process, so restarting it clears them. For local development, requests from
the same computer usually share the same IP. If the API is behind a proxy,
configure `TRUST_PROXY_HOPS` to match the trusted proxy chain so IP-based
limits use the client IP correctly; do not trust arbitrary forwarded headers.
The in-memory store is suitable for local testing or one API instance. If
running multiple instances, configure a shared store (such as Redis/Upstash)
to share counters; only then would its credentials be needed.

## Test

Run backend unit and HTTP tests:

```powershell
cd C:\Users\AMAN\OneDrive\Desktop\veloop-wallet-system\backend
npm test
```

Build the frontend:

```powershell
cd C:\Users\AMAN\OneDrive\Desktop\veloop-wallet-system\frontend
npm run build
```

MongoDB integration tests are opt-in. Run them only against the dedicated,
disposable replica-set database configured for the individual
`test:*:integration` scripts in `backend/package.json`; never point them at
production data.

## Optional demo/reference data

The demo-user seed and assignment payout-reference seed are opt-in and
restricted to development/test database names. Read the checks in
`backend/seed/` before running them. The UPI values are assignment reference
data requiring manual review; they are not verified offers and do not send
money.

Publicly registered users always start with zero balance. The demo seed
creates a separate `demo@veloop.test` account with sample balances and history;
it does not change balances for existing accounts. Seeded local data is not
copied to a separately deployed database. There is no reviewer UI or payment
provider: only authorized `ADMIN`/`INTERNAL` API users can review withdrawals,
and approval records a status change rather than transferring funds.

## Deploy the demonstration

The assignment recommends a hosted frontend, backend, and MongoDB Atlas. This
repository includes a Render Blueprint in [render.yaml](./render.yaml) and
Vercel client-side routing in [frontend/vercel.json](./frontend/vercel.json).
Deployment is optional and requires accounts and a database you control.

1. Create a dedicated MongoDB Atlas replica-set database. Configure network
   access according to the hosting provider's current guidance.
2. Deploy the backend to Render using the repository's `render.yaml` Blueprint.
   Supply `MONGO_URI` and `FRONTEND_ORIGIN` as service environment values. The
   Blueprint generates `JWT_SECRET`. Set `FRONTEND_ORIGIN` to the exact HTTPS
   origin of your frontend and use the correct trusted proxy hop count.
3. Deploy `frontend/` to Vercel. Set the project root to `frontend`, install
   with `npm ci`, build with `npm run build`, and publish `dist`. Set the
   `VITE_API_BASE_URL` build variable to
   `https://<your-render-service>.onrender.com/api`.
4. Confirm Render's `FRONTEND_ORIGIN` exactly matches the Vercel origin.
   Verify `https://<your-render-service>.onrender.com/api/ready` returns HTTP
   200, then test signup, login, wallet loading, and payouts.

Keep `MONGO_URI` and `JWT_SECRET` private in the hosting provider's settings.
`VITE_API_BASE_URL` is public configuration, not a secret. Do not seed demo
accounts or reference payout options in production. No live VELoop service or
payment provider is involved. The built-in rate limiter uses per-process
memory; run one backend instance unless you configure a shared store.

## Scaling question (assignment)

Scale based on measured transaction volume and latency, not registered-user
count alone. Preserve conditional atomic wallet updates, transactions,
idempotency indexes, and ledger reconciliation. Profile database queries and
indexes before considering sharding. For payout processing, use a transactional
outbox and retryable, idempotent workers; monitor reconciliation, withdrawal
backlog, and failures. Validate failover and concurrent behavior against a
disposable replica set before release.

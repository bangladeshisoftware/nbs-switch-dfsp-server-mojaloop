# DFSP Portal - Backend API

A dedicated backend server for **DFSP (Digital Financial Service Provider) operators** to access their own financial data within the R Switch ecosystem. Each DFSP gets a scoped, authenticated view into the shared R Switch database — seeing only their own transfers, positions, settlement records, and deposit history.

> **Architecture note:** The DFSP Portal shares the same MySQL database (`r_switch`) as the R Switch hub server. The codebase is fully separated — the portal is a lightweight read-focused API server that applies DFSP-scoped queries on the shared schema. No data is duplicated.

---

## Table of Contents

- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Environment Setup](#environment-setup)
- [Installation](#installation)
- [Authentication](#authentication)
- [Data Scoping](#data-scoping)
- [API Modules](#api-modules)
  - [Dashboard](#dashboard)
  - [Transfers](#transfers)
  - [Liquidity & Positions](#liquidity--positions)
  - [Settlement](#settlement)
  - [Users](#users)
- [API Reference](#api-reference)
- [Security](#security)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   Shared Infrastructure                   │
│                                                          │
│   R Switch Server          DFSP Portal Server            │
│   (port 4000)              (port 5000)                   │
│        │                        │                        │
│        └────────────┬───────────┘                        │
│                     │                                    │
│              MySQL: r_switch DB                          │
│     transfers · dfsp_positions · settlement_*            │
│     dfsp_deposits · position_changes · dfsp_limits       │
└──────────────────────────────────────────────────────────┘
```

The R Switch hub writes all transfer, position, and settlement data via its Kafka consumer. The DFSP Portal reads that same data, filtered by `dfsp_id` from the authenticated user's JWT — so each DFSP operator sees only their own records.

---

## Tech Stack

| Layer       | Technology                                |
| ----------- | ----------------------------------------- |
| Runtime     | Node.js                                   |
| Framework   | Express.js                                |
| Database    | MySQL (shared `r_switch` DB, mysql2 pool) |
| Auth        | JWT + OTP two-factor (email)              |
| Password    | bcryptjs                                  |
| HTTP Client | Axios (Central Ledger live position)      |
| Geo IP      | geoip-lite                                |

---

## Environment Setup

Create `.env` in the project root:

```dotenv
# Server
PORT=5000
NODE_ENV=development

# MySQL (same database as R Switch)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_db_password
DB_NAME=r_switch

# JWT
JWT_SECRET=your-dfsp-portal-secret
JWT_EXPIRES_IN=365d

# Mojaloop Services
CENTRAL_LEDGER_URL=https://your-ledger.domain.com
SETTLEMENT_URL=https://your-settlement.domain.com
ALS_URL=https://your-als.domain.com

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=your_smtp_password
SMTP_FROM=noreply@example.com

# CORS
FRONTEND_URL=https://your-dfsp-portal.domain.com

# Defaults
ALS_STRICT=true
DEFAULT_CURRENCY=BDT
```

> `JWT_SECRET` here is independent from the R Switch hub's `JWT_SECRET`. DFSP portal tokens are signed with this key and are only valid for DFSP portal endpoints.

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/bangladeshisoftware/nbs-switch-dfsp-server-mojaloop.git
cd project-directory

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Point DB_* to the same MySQL instance as R Switch

# 4. Start the server
npm start

# Development with hot reload
npm run dev
```

Server starts on `PORT` (default `5000`). Health check available at `GET /health`.

```json
{ "status": "OK", "service": "DFSP Portal API" }
```

All API routes are mounted under `/api/v1`.

---

## Authentication

DFSP Portal uses **OTP-based two-factor authentication**, identical in flow to the R Switch portal but scoped to `dfsp_users` (not switch `users`). There is also a **direct token login** path used for seamless cross-portal navigation from the R Switch admin.

### Standard Login (2-step)

**Step 1 — Submit credentials:**

```
POST /api/v1/auth/login
Body: { username, password }
```

Looks up the user in `dfsp_users` joined with `dfsps` — validates that the DFSP itself is active. Generates a 6-digit OTP with a 10-minute expiry, stores it, and sends it to the user's email. Returns a masked email hint and the DFSP name.

```json
{
  "otp_status": true,
  "email_hint": "ad****@example.com",
  "dfsp_id": "DFSP001",
  "dfsp_name": "A Bank",
  "expires_in": "10 minutes"
}
```

**Step 2 — Verify OTP:**

```
POST /api/v1/auth/verify-otp
Body: { username, otp }
```

Validates OTP and checks expiry separately (returns a clear error message if expired rather than a generic invalid). On success: clears OTP, records login with IP + geo-location in `activity_logs` (type: `dfsp`), and returns a signed JWT carrying `{ id, dfsp_id, username, role }`.

```json
{
  "token": "<jwt>",
  "user": {
    "id", "username", "email", "full_name",
    "role", "dfsp_id", "dfsp_name", "currency"
  }
}
```

### Direct Token Login

```
POST /api/v1/auth/direct-login
Body: { token }
```

Used when the R Switch admin portal links directly into a DFSP's portal. Validates the `token` field stored in `dfsp_users.token` (issued by R Switch when the DFSP was provisioned). Bypasses OTP — intended for trusted machine-to-machine or admin-initiated navigation.

### Session Info

```
GET /api/v1/auth/me
```

Returns the authenticated user's full profile including DFSP name, currency, callback URL, and short name — sourced from the `dfsp_users ⟶ dfsps` join.

---

## Data Scoping

Every authenticated request carries a JWT with `dfsp_id`. All controllers extract `req.user.dfsp_id` and apply it as a mandatory filter — a DFSP operator can never query another DFSP's data.

```js
// Example: transfers are always filtered by the caller's DFSP
WHERE (payer_fsp = ? OR payee_fsp = ?)  // values: [dfsp_id, dfsp_id]
```

Similarly, position queries, settlement records, deposit history, and limit history are all scoped by `dfsp_id` before any additional filters are applied.

---

## API Modules

### Dashboard

```
GET /api/v1/dashboard/summary
```

Returns a complete operational snapshot for the authenticated DFSP, all scoped to their `dfsp_id`:

| Field        | Description                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------- |
| `today`      | Total transfers today — committed, failed, reserved, total sent amount, total received amount |
| `yesterday`  | Total transfers and sent/received volumes for the previous day (comparison baseline)          |
| `this_month` | Month-to-date transfer count and total committed volume                                       |
| `position`   | Current position, Net Debit Cap, reserved amount, and currency from `dfsp_positions`          |
| `recent`     | Last 10 transfers (transfer ID, counterparty FSP, amount, currency, status, timestamp)        |
| `merchants`  | Total and active merchant count linked to this DFSP                                           |
| `hourly`     | Last 24 hours broken down by hour — count and committed amount per hour (for charts)          |

---

### Transfers

All transfer endpoints are filtered to records where `payer_fsp = dfsp_id` OR `payee_fsp = dfsp_id`.

#### List Transfers

```
GET /api/v1/transfers
```

| Param            | Description                                                                             |
| ---------------- | --------------------------------------------------------------------------------------- |
| `status`         | `COMMITTED`, `FAILED`, `RESERVED`, `RECEIVED`, `TIMEOUT`, or `ALL`                      |
| `direction`      | `SEND` (payer only) or `RECEIVE` (payee only) — overrides the default both-sides filter |
| `from` / `to`    | Date range (`YYYY-MM-DD`)                                                               |
| `search`         | Partial transfer ID search                                                              |
| `page` / `limit` | Pagination (default: page 1, 50 per page)                                               |

Response includes `duration_sec` — processing time in seconds from creation to completion.

#### Transfer Detail

```
GET /api/v1/transfers/:id
```

Returns full transfer record. Enforces DFSP ownership — returns `404` if the transfer exists but belongs to a different FSP.

#### Transfer Stats

```
GET /api/v1/transfers/stats
```

Returns two datasets for charting:

- **`daily`** — last 7 days: total, committed, failed, total sent, total received per day
- **`by_currency`** — committed volume grouped by currency

---

### Liquidity & Positions

#### Current Position

```
GET /api/v1/liquidity/position
```

Returns three data sources combined:

- `position` — local `dfsp_positions` record (current position, NDC, reserved amount, currency)
- `cl_accounts` — live accounts from Central Ledger (`/participants/:dfspId/accounts`). Falls back gracefully if CL is unreachable.
- `history` — last 20 position change events from `position_changes`

#### Position History

```
GET /api/v1/liquidity/positions-history
```

Full paginated history of position changes (`RESERVE`, `COMMIT`, `ROLLBACK`) for this DFSP. Filter by date range. Includes summary: total movement count and total volume moved.

#### Position Changes

```
GET /api/v1/liquidity/changes
```

Paginated position change log — same data as history but without date filters, for a quick chronological feed.

#### NDC Limit History

```
GET /api/v1/liquidity/limits
```

Last 20 NDC (Net Debit Cap) change records for this DFSP — shows limit type, currency, previous value, new value, who changed it, and when. Set by the R Switch operator; visible here for DFSP reference.

#### Deposit History

```
GET /api/v1/liquidity/deposits
```

Paginated history of funds deposited to this DFSP's SETTLEMENT account. Filter by date range. Summary: total deposit count and total volume deposited.

---

### Settlement

DFSP operators can view their own settlement participation records — both the finalization movements and the completed settlement snapshots.

#### Finalize Records

```
GET /api/v1/settlement/finalize-records
```

Physical fund movement records from each settlement finalization run, scoped to this DFSP:

| Field            | Description                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `type`           | `credit` or `debit`                                                                            |
| `action`         | `recordFundsIn`, `recordFundsOutPrepareReserve`, `recordFundsOutCommit`, `recordFundsOutAbort` |
| `status`         | `ok`, `prepare`, `commit`, `abort`, `failed`, `skipped`                                        |
| `before_amount`  | Settlement account balance before the movement                                                 |
| `after_amount`   | Settlement account balance after the movement                                                  |
| `position_value` | Net position that triggered this movement                                                      |

Filter by `type`, `window_id`, `settlement_id`, `status`, date range.

**Summary per DFSP:**

- `total_credit` — total funds received across all settlement windows
- `total_debit` — total funds paid out across all settlement windows
- `total_windows` — number of settlement windows participated in

#### Completed Settlement Records

```
GET /api/v1/settlement/completed-records
```

Post-settlement position snapshots: one record per DFSP per settlement window showing `before_position`, `after_position`, and `net_amount`. Filter by `window_id`, `settlement_id`, date range.

Summary: total windows settled, total net volume settled.

---

### Users

DFSP admins can manage their own portal users. All user operations are scoped to `dfsp_id` — a DFSP admin cannot see or modify users from another DFSP.

| Method | Endpoint                 | Role Required | Description                              |
| ------ | ------------------------ | ------------- | ---------------------------------------- |
| `GET`  | `/api/v1/auth/users`     | Any           | List all users for this DFSP             |
| `POST` | `/api/v1/auth/users`     | `ADMIN`       | Create a new DFSP portal user            |
| `PUT`  | `/api/v1/auth/users/:id` | `ADMIN`       | Update role, active status, or full name |

**Create user body:**

```json
{
  "username": "ops_user",
  "email": "ops@abank.com",
  "password": "tempPassword",
  "full_name": "Operations User",
  "role": "OPERATOR"
}
```

**Roles:** `ADMIN`, `OPERATOR`, `VIEWER`

Only `ADMIN` role can create or modify users. Attempting these actions with a lower role returns `403`.

---

## API Reference

### Auth

| Method | Endpoint                    | Auth        | Description                              |
| ------ | --------------------------- | ----------- | ---------------------------------------- |
| `POST` | `/api/v1/auth/login`        | —           | Step 1: credentials → OTP sent           |
| `POST` | `/api/v1/auth/verify-otp`   | —           | Step 2: OTP → JWT                        |
| `POST` | `/api/v1/auth/direct-login` | —           | Token-based direct login (from R Switch) |
| `GET`  | `/api/v1/auth/me`           | JWT         | Current user profile + DFSP info         |
| `GET`  | `/api/v1/auth/users`        | JWT         | List DFSP portal users                   |
| `POST` | `/api/v1/auth/users`        | JWT (ADMIN) | Create user                              |
| `PUT`  | `/api/v1/auth/users/:id`    | JWT (ADMIN) | Update user                              |

### Dashboard

| Method | Endpoint                    | Auth | Description                |
| ------ | --------------------------- | ---- | -------------------------- |
| `GET`  | `/api/v1/dashboard/summary` | JWT  | Full DFSP summary snapshot |

### Transfers

| Method | Endpoint                  | Auth | Description                               |
| ------ | ------------------------- | ---- | ----------------------------------------- |
| `GET`  | `/api/v1/transfers`       | JWT  | Filtered + paginated transfer list        |
| `GET`  | `/api/v1/transfers/:id`   | JWT  | Single transfer detail                    |
| `GET`  | `/api/v1/transfers/stats` | JWT  | 7-day daily stats + by-currency breakdown |

### Liquidity

| Method | Endpoint                              | Auth | Description                                     |
| ------ | ------------------------------------- | ---- | ----------------------------------------------- |
| `GET`  | `/api/v1/liquidity/position`          | JWT  | Current position + CL accounts + recent history |
| `GET`  | `/api/v1/liquidity/positions-history` | JWT  | Full paginated position change history          |
| `GET`  | `/api/v1/liquidity/changes`           | JWT  | Position change feed (paginated)                |
| `GET`  | `/api/v1/liquidity/limits`            | JWT  | NDC limit change history                        |
| `GET`  | `/api/v1/liquidity/deposits`          | JWT  | Deposit history                                 |

### Settlement

| Method | Endpoint                               | Auth | Description                    |
| ------ | -------------------------------------- | ---- | ------------------------------ |
| `GET`  | `/api/v1/settlement/finalize-records`  | JWT  | Physical fund movement records |
| `GET`  | `/api/v1/settlement/completed-records` | JWT  | Completed settlement snapshots |

### System

| Method | Endpoint  | Auth | Description         |
| ------ | --------- | ---- | ------------------- |
| `GET`  | `/health` | —    | Server health check |

---

## Security

- **OTP expiry enforcement** — OTP expiry is checked explicitly on `verify-otp`. An expired OTP returns a distinct error (`"OTP expired. Please login again."`) and clears the OTP from the database immediately.
- **DFSP-scoped queries** — every data query includes `dfsp_id` from the authenticated JWT as a mandatory filter. No query can return data for a DFSP other than the caller's.
- **Role enforcement** — user creation and updates require `ADMIN` role, enforced in controller logic before any DB operation.
- **CORS restriction** — `origin` is set to `FRONTEND_URL` in production, not `*`.
- **Activity logging** — every successful login writes to `activity_logs` with IP address and geo-location (type: `dfsp`), visible to R Switch admins in the hub portal.
- **Separate JWT secret** — `JWT_SECRET` is independent from the R Switch hub, so DFSP portal tokens cannot be used against hub endpoints.
- **Direct login safety** — `directLogin` validates against `dfsp_users.token` (a long-lived token issued by R Switch during DFSP provisioning), not a password. It should only be called from trusted cross-portal links.
- **bcryptjs** — all passwords hashed at salt rounds of 10.
- **Parameterized queries** — all MySQL queries use `?` placeholders throughout.

---

## License

Private - NB Switch / Bangladeshi Software LTD. All rights reserved.

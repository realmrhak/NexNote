# NexNote

> **Your notes, everywhere.** A full-stack collaborative note-taking app with teams, folders, todos, real-time co-editing, and shareable note links.

Built with **React 18 + Vite 5** (frontend) and **Node.js + Express 4 + MongoDB + Socket.io 4** (backend). Deploys in minutes to **Vercel** (frontend) and **Render** (backend).

[![Deploy Frontend to Vercel](https://img.shields.io/badge/Frontend-Vercel-black)](https://vercel.com)
[![Deploy Backend to Render](https://img.shields.io/badge/Backend-Render-blueviolet)](https://render.com)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-green)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## Table of Contents

1. [Product Requirements (PRD)](#1-product-requirements-prd)
2. [Technical Requirements (TRD)](#2-technical-requirements-trd)
3. [Security](#3-security)
4. [Performance](#4-performance)
5. [Local Development](#5-local-development)
6. [Deployment — Frontend (Vercel) + Backend (Render)](#6-deployment--frontend-vercel--backend-render)
7. [Environment Variables](#7-environment-variables)
8. [API Reference](#8-api-reference)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Product Requirements (PRD)

### 1.1 Problem Statement

People juggle a dozen different tools for notes, todos, and team collaboration — Google Keep for personal notes, Notion for team docs, Todoist for tasks. NexNote unifies all three in a single fast, dark-mode-friendly interface that works on desktop and mobile.

### 1.2 Target Users

- **Individuals** who want a fast personal note + todo app with folders and tags.
- **Small teams** (2–20 people) who need shared notes, shared todos, and real-time collaboration without paying Notion's per-seat pricing.

### 1.3 Core Features

#### Authentication & Sessions
- Email + password registration and login.
- JWT access token (15 min, **in-memory only**) + refresh token (7 days, localStorage, rotated on every refresh).
- Auto-refresh on 401 with a single-flight guard (`isRefreshing` + `refreshPromise`) so parallel requests share one refresh — prevents the refresh-loop that previously triggered 429s.
- Inactivity timeout: warning at 28 min, auto-logout at 30 min.
- Profile page: update display name, change password (with current-password verification).
- **Password fields show eye-toggle buttons (show/hide) on Login, Signup, and Profile pages.**

#### Notes
- Create, edit, delete notes (title, body, tags).
- Pin up to 10 notes to the top of the dashboard.
- Organize notes into folders (personal or per-team).
- Full-text search across title + body (MongoDB text index).
- Share a note via a public link (`/?shared=<token>`) — readable by anyone, no auth required.
- Real-time co-editing via Socket.io: when two members edit the same team note simultaneously, both see each other's changes live.

#### Folders
- Create folders in personal workspace or inside a team.
- Move notes between folders.
- Delete a folder → its notes are moved to "Uncategorized" (not deleted).
- Each folder shows a live note count.

#### Teams
- Create a team (you become the owner).
- Invite members by email — invitee receives an email with an accept link valid for 7 days.
- Members have roles: **owner**, **admin**, or **member**.
  - Owner can: delete team, invite/cancel invites, change member roles, remove members.
  - Admin can: invite/cancel invites, remove members.
  - Member can: view team notes/todos/members, leave the team.
- **Real-time role changes**: when the owner promotes/demotes a member, every team member's UI updates instantly via `member:roleUpdated` socket event — **no page reload required**.
- Activity logs (admin-only): every member join/leave/role-change, note create/update/delete, and todo toggle is recorded with actor + timestamp. TTL: auto-deleted after 1 year.

#### Todos
- Personal todos (no team) and team todos.
- Fields: title, description, priority (low/medium/high), due date, tags, isDone.
- Stats dashboard: total, completed, active, overdue.
- Filter by all / active / completed.
- Real-time toggle broadcast: when one team member checks off a todo, every other member's list updates instantly.

#### UI / UX
- Light + dark mode (toggle in sidebar).
- Fully responsive: hamburger-menu sidebar on mobile (≤768px), static sidebar on desktop.
- Lazy-loaded routes via `React.lazy` + `Suspense` for fast initial paint.
- React Query for server-state caching (staleTime 60s, gcTime 10min, `placeholderData` for no-flash refetches).
- Skeleton loaders for all async data.
- Optimistic UI for todo toggles (instant feedback).
- Toast notifications (react-hot-toast) for all user actions.

### 1.4 Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Initial page load (TTI) | < 2s on 4G |
| API response (p95) | < 300ms for cached reads, < 800ms for fresh |
| Cold start (Render free tier) | < 90s — handled with retry + keep-alive ping |
| Uptime | 99% (Render free tier sleeps after 15 min idle; keep-alive ping prevents this) |
| Bundle size (gzipped) | < 200KB main, < 50KB per lazy chunk |
| Lighthouse score | > 90 on Performance, Accessibility, Best Practices, SEO |

### 1.5 Out of Scope (v1)
- OAuth (Google/GitHub) login.
- File uploads / attachments.
- Markdown rendering (notes are plain text + tags for now).
- Mobile native apps (responsive web only).
- End-to-end encryption.

---

## 2. Technical Requirements (TRD)

### 2.1 Architecture Overview

```
┌─────────────────────────┐         ┌─────────────────────────────────────┐
│  Frontend (Vercel)      │  HTTPS  │  Backend (Render)                   │
│  React 18 + Vite 5      │ ──────> │  Express 4 + Helmet + Socket.io     │
│  React Query 5          │  WSS    │                                     │
│  Axios (auto-refresh)   │ <────── │  Routes: /api/auth, /notes,         │
│  Socket.io-client       │         │           /folders, /teams, /todos  │
└─────────────────────────┘         │                                     │
                                    │  MongoDB Atlas (cloud)              │
                                    │  └─ Mongoose 8 ODM                  │
                                    │                                     │
                                    │  SMTP: Gmail (Nodemailer)           │
                                    └─────────────────────────────────────┘
```

### 2.2 Frontend Stack
- **React 18** with hooks (no class components).
- **Vite 5** for dev server + build (esbuild minification).
- **TanStack React Query 5** for server state — `placeholderData: (prev) => prev` everywhere to avoid skeleton flashes on refetch.
- **Axios** with a custom interceptor that:
  - Auto-refreshes on 401 with a single-flight guard (`isRefreshing` + `refreshPromise`) so concurrent 401s share one refresh.
  - Retries once on network error / 503 (Render cold start) with a 3-second delay.
  - Surfaces 429s with a friendly toast (showing Retry-After in minutes).
- **Socket.io-client** — singleton, lazily created on first authenticated need; destroyed on logout.
- **react-hot-toast** for notifications.
- **CSS** — plain CSS modules (no Tailwind), one file per page + shared `global.css`.

### 2.3 Backend Stack
- **Node.js 18+** with **Express 4**.
- **Mongoose 8** for MongoDB ODM with compound indexes on hot paths (e.g. `{ userId, updatedAt }`, `{ teamId, updatedAt }`).
- **Socket.io 4** attached to the same HTTP server as Express (single port → no CORS issues on Render).
- **Helmet 7** for security headers (CSP, HSTS preload, COOP, X-Frame-Options DENY).
- **express-rate-limit 7** — auth limiter on `/login` + `/register` only; `/refresh` gets its own relaxed limiter (200/15min) because the frontend fires it automatically.
- **express-validator 7** for input validation + server-side HTML sanitization.
- **express-mongo-sanitize** for NoSQL injection prevention (strips `$`-prefixed keys from req.body/query/params).
- **hpp** for HTTP parameter pollution protection.
- **bcryptjs** for password hashing (12 rounds).
- **jsonwebtoken 9** for JWT (HS256, algorithms pinned).
- **Nodemailer 6** for team-invite emails via Gmail SMTP.
- **compression** for gzip.
- **winston** for structured logging.

### 2.4 Database Schema

#### User
```
{ name, email (unique), password (bcrypt, select:false),
  refreshToken (select:false), isActive, avatar, lastLoginAt, timestamps }
```

#### Note
```
{ title, body, tags[], userId, folderId?, teamId?,
  isPinned, isShared, shareToken (unique, partial-filter index — excludes null),
  isDeleted (soft delete), deletedAt, timestamps }
Indexes: { userId, updatedAt }, { userId, folderId }, { userId, isPinned },
         { userId, tags }, { teamId, updatedAt }, text(title, body)
```

#### Folder
```
{ name, userId, teamId?, color?, isArchived, timestamps }
Indexes: { userId }, { userId, createdAt }, { teamId }
```

#### Team
```
{ name, description?, ownerId, members[{ userId, role, joinedAt }],
  pendingInvites[{ email, token, role, invitedBy, expiresAt, accepted }],
  avatar?, color?, isArchived, timestamps }
Indexes: { members.userId }, { ownerId }
```

#### Todo
```
{ title, description?, isDone, doneAt, priority (low|medium|high),
  dueDate?, userId, teamId?, noteId?, assignedTo?, position, tags[], timestamps }
Indexes: { userId, isDone, position }, { teamId, isDone, position }
```

#### ActivityLog
```
{ teamId, actorId, actorName, action, description,
  targetType, targetId?, targetName?, metadata{}, timestamps }
Indexes: { teamId, createdAt }, { teamId, actorId, createdAt }, TTL createdAt (1 year)
```

### 2.5 Real-Time Events (Socket.io)

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `note:join` | client→server | `{ noteId }` | Enter a note's editing room |
| `note:leave` | client→server | `{ noteId }` | Leave a note's room |
| `note:update` | client→server | `{ noteId, title?, body?, tags? }` | Persist + broadcast edits |
| `note:updated` | server→client | `{ noteId, title, body, tags, updatedBy }` | Other editors see the change |
| `note:deleted` | server→client | `{ noteId, deletedBy }` | Editors are kicked to "deleted" state |
| `note:someone-editing` | server→client | `{ noteId, userName }` | "X is editing…" indicator |
| `note:user-left` | server→client | `{ noteId, userName }` | Clear the indicator |
| `team:join` / `team:leave` | client→server | `{ teamId }` | Subscribe to team events |
| `todo:toggled` | server→client | `{ todoId, isDone, toggledBy }` | Live todo checkbox sync |
| `todo:created` / `todo:deleted` | server→client | `{ todoId, teamId }` | Live todo list refresh |
| `note:list:changed` | server→client | `{ noteId, teamId, action }` | Refresh team notes list |
| `member:roleUpdated` | server→client | `{ teamId, memberId, previousRole, role, updatedByName }` | Live member role update — **no reload needed** |

### 2.6 Folder Structure

```
NexNote/
├── package.json             # monorepo helper scripts (npm run dev:backend, etc.)
├── render.yaml              # Render Blueprint (one-click backend deploy)
├── .nvmrc                   # pin Node version (18)
├── .gitignore
├── README.md                # ← this file (single source of truth for PRD & TRD)
├── backend/
│   ├── app.js               # Express app (middleware, routes, security)
│   ├── server.js            # HTTP + Socket.io server bootstrap
│   ├── config/db.js         # Mongoose connection + index repair
│   ├── models/              # User, Note, Folder, Team, Todo, ActivityLog
│   ├── routes/              # auth, notes, folders, teams, todos
│   ├── controllers/         # request handlers (thin)
│   ├── services/            # business logic (fat)
│   ├── middleware/          # auth, rateLimiter, validators, errorHandler, teamAuth
│   ├── sockets/index.js     # Socket.io server (note + team rooms)
│   ├── utils/               # tokenUtils, apiResponse, logger, emailUtils
│   ├── scripts/             # one-off DB fix scripts
│   ├── .env.example
│   └── package.json
└── frontend/
    ├── vercel.json          # SPA rewrites + security headers
    ├── vite.config.js       # dev proxy + build chunking
    ├── index.html
    ├── .env.example
    ├── package.json
    └── src/
        ├── App.jsx          # root: providers + screen router
        ├── main.jsx         # React entry
        ├── context/AuthContext.jsx
        ├── services/        # api.js (axios), socket.js (singleton)
        ├── hooks/           # useQueries, useSockets, useDebounce, useKeepAlive
        ├── components/      # Sidebar, NoteCard, Modal, Skeletons, ...
        ├── pages/           # AuthPage, Dashboard, NoteEditor, TeamsPage, ...
        ├── styles/          # one CSS file per page + global.css
        ├── lib/queryClient.js
        └── utils/helpers.js
```

---

## 3. Security

### 3.1 Authentication
- **bcryptjs** with 12 rounds (configurable via `BCRYPT_ROUNDS`).
- **Password rules**: minimum 8 chars + at least 1 letter + at least 1 number.
- **Access token** (15 min) lives **in memory only** — XSS cannot steal it from `localStorage`.
- **Refresh token** (7 days) lives in `localStorage` — acceptable trade-off for tab continuity; rotated on every refresh (old token is invalidated server-side).
- On logout, server clears the stored refresh token; client tears down the socket.

### 3.2 HTTP Security Headers (Helmet)
- **Content-Security-Policy**: `default-src 'self'`; no inline scripts; inline styles allowed (UI uses some); connect-src allows WebSocket + HTTPS.
- **HSTS**: 1 year, includeSubDomains, preload.
- **X-Frame-Options**: DENY (clickjacking protection).
- **X-Content-Type-Options**: nosniff.
- **Referrer-Policy**: strict-origin-when-cross-origin.
- **COOP**: same-origin.
- **CORP**: same-site.
- **DNS prefetch**: disabled.

### 3.3 Input Validation & Sanitization
- **express-validator** on every route — body, query, and param validation.
- **Server-side HTML tag stripping** (`sanitize` middleware) on all string inputs — XSS prevention.
- **express-mongo-sanitize** — strips `$`-prefixed keys from `req.body/query/params` to prevent NoSQL injection (`$where`, `$gt`, etc.).
- **hpp** — HTTP parameter pollution protection (collapses `?a=1&a=2` to a scalar).

### 3.4 Rate Limiting (per `nexnote-ratelimit-fix.md`)
| Endpoint | Limiter | Limit | Notes |
|----------|---------|-------|-------|
| `/api/*` | globalLimiter | 500 / 15min per IP | General API protection |
| `/api/auth/login` | authLimiter | 50 / 15min per IP | `skipSuccessfulRequests: true` — only FAILED logins count |
| `/api/auth/register` | authLimiter | 50 / 15min per IP | Same — only failed registrations count |
| `/api/auth/refresh` | refreshLimiter | 200 / 15min per IP | Relaxed — auto-fired by frontend |
| `/api/auth/change-password` | passwordResetLimiter | 5 / hour per IP | Strict — brute-force protection |
| `/api/teams/:teamId/invites` | inviteLimiter | 20 / hour per user | Per-user, not per-IP |
| `/api/ping` | (none) | — | Keep-alive ping; mounted BEFORE globalLimiter |

**Key implementation details:**
- `app.set("trust proxy", 1)` — required on Render/Vercel so `req.ip` reflects the real client IP, not the proxy's IP.
- Custom `realIpKeyGenerator` reads `x-forwarded-for` (first hop) → `x-real-ip` → `req.ip` so users behind Vercel's proxy are NOT collapsed into a single IP bucket.
- In development (`NODE_ENV !== 'production'`), every limiter is bumped to a very high value so local testing with multiple accounts on `127.0.0.1` never trips 429.

### 3.5 JWT
- HS256 with separate secrets for access and refresh tokens.
- `algorithms: ["HS256"]` explicitly pinned in `jwt.verify` to prevent algorithm confusion attacks.
- Refresh tokens are stored in the user document (select:false) and rotated on every `/refresh` call — reuse of an old token invalidates the session.

### 3.6 CORS
- Whitelist of allowed origins from `CORS_ORIGINS` env var (comma-separated).
- In development, any `localhost` / `127.0.0.1` origin is allowed.
- `credentials: true` for cookie support (currently unused — refresh token is in localStorage, not a cookie — but kept for future use).

### 3.7 MongoDB
- `mongoose.set("strictQuery", true)` — unknown query params are rejected.
- Connection retries (3 attempts with backoff) + SRV→standard URI fallback for restricted DNS (e.g. some ISPs block `mongodb+srv://` SRV lookups).
- Auto-repair of the `shareToken` index on startup (drops any legacy non-partial-filter index and recreates the correct one — prevents E11000 duplicate key errors on non-shared notes).

---

## 4. Performance

### 4.1 Backend
- **`.lean()`** on all read paths — skips Mongoose hydration → 30–50% faster.
- **`Promise.all`** for parallel independent queries (e.g. `count + find`, `noteCount + team`).
- **Compound indexes** on every filter combination the frontend uses.
- **`partialFilterExpression`** unique index on `Note.shareToken` — only indexes shared notes, not the millions of null ones.
- **gzip compression** on all responses.
- **ETag** (weak) on JSON responses — repeat GETs within cache window return 304 (no body).
- **`Cache-Control: private, max-age=120, stale-while-revalidate=300`** on `/notes/tags` and `/folders`.
- **Background email sending** — invite email doesn't block the invite API response.
- **Connection pooling** — `maxPoolSize: 10` for MongoDB.

### 4.2 Frontend
- **Route-level code splitting** via `React.lazy` (AuthPage, Dashboard, NoteEditor, TeamsPage, TodosPage, FolderDetailPage, SharedNotePage, ProfilePage).
- **Manual chunks** in `vite.config.js`: `vendor-react`, `vendor-query`, `vendor-utils`, `vendor-socket` — long cache for stable deps.
- **React Query** with `staleTime: 60s` + `placeholderData: (prev) => prev` — instant stale-while-revalidate, no skeleton flashes.
- **Hover-prefetch**: hovering the "Teams" sidebar item prefetches the teams query before the user clicks.
- **Skeleton loaders** on every async list (no blank screens).
- **`useKeepAlive`** hook pings `/api/ping` every 4 min — keeps Render's free tier warm.
- **Optimistic UI** for todo toggles — instant feedback, rollback on error.

### 4.3 Caching Strategy
| Layer | Mechanism | TTL |
|-------|-----------|-----|
| Browser (HTTP) | `Cache-Control: private, max-age=120` on `/notes/tags`, `/folders` | 2 min + 5 min stale-while-revalidate |
| Browser (HTTP) | `Cache-Control: public, max-age=31536000, immutable` on Vercel `/assets/*` | 1 year |
| Browser (ETag) | Weak ETags on JSON | forever (revalidated per request) |
| Client (React Query) | `staleTime: 60s`, `gcTime: 10min` | 60s stale, 10min GC |
| Server (MongoDB) | Compound indexes on hot paths | persistent |

---

## 5. Local Development

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas free tier)
- Gmail account (for invite emails — optional, app works without it)

### Backend
```bash
cd backend
cp .env.example .env
# Edit .env — fill in JWT_SECRET, JWT_REFRESH_SECRET, MONGODB_URI, FRONTEND_URL
npm install
npm run dev    # nodemon, port 5001
```

### Frontend
```bash
cd frontend
cp .env.example .env
# In dev, leave VITE_API_URL empty (Vite proxy forwards /api → localhost:5001)
npm install
npm run dev    # Vite, port 5173
```

Open http://localhost:5173 — the Vite dev proxy forwards API and WebSocket traffic to the backend automatically.

### Monorepo helper (optional)
From the repo root:
```bash
npm install            # installs nothing at root, just runs scripts
npm run install:all    # installs both backend + frontend deps
npm run dev:backend    # starts backend
npm run dev:frontend   # starts frontend
npm run build:frontend # builds frontend for production
```

---

## 6. Deployment — Frontend (Vercel) + Backend (Render)

### 6.1 Backend → Render

**Option A: One-click Blueprint (recommended)**

1. Push this repo to GitHub.
2. On Render, **New → Blueprint** → pick your repo. Render reads `render.yaml` and creates the service automatically.
3. After creation, fill in the environment variables (Render → Environment tab).

**Option B: Manual setup**

1. On Render, **New → Web Service** → connect your GitHub repo.
2. Settings:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
   - **Instance Type**: Free (or Starter for no cold starts)
3. Add the environment variables listed in section 7.
4. Deploy. Render gives you a URL like `https://nexnote-api.onrender.com`.

### 6.2 Frontend → Vercel

1. On Vercel, **Add New → Project** → import the same GitHub repo.
2. Settings:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (auto-detected)
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)
3. Environment Variables (Vercel → Settings → Environment Variables):
   ```
   VITE_API_URL=https://nexnote-api.onrender.com/api
   ```
   (Use your Render URL from step 6.1. Without this, the frontend tries relative `/api` which won't work cross-origin on Vercel.)
4. Deploy. Vercel gives you `https://your-app.vercel.app`.
5. **Important**: go back to Render → Environment → update `FRONTEND_URL` and `CORS_ORIGINS` to your final Vercel URL (production + preview URLs), then redeploy the backend.

### 6.3 Verifying the Deployment
1. Visit the Vercel URL — you should see the NexNote login page.
2. Register an account — should succeed and land on the (empty) dashboard.
3. Open browser DevTools → Network → confirm API calls hit `https://nexnote-api.onrender.com/api/...` and return 200.
4. Visit `https://nexnote-api.onrender.com/api/ping` directly — should return `{"success":true,"status":"ok",...}`.
5. Visit `https://nexnote-api.onrender.com/api/health` — should return version + uptime.
6. Open a second browser tab in incognito, log in as another user, create a team, invite yourself → check your inbox for the invite email.
7. Accept the invite → both users should see the team and be able to co-edit a note in real time.
8. Log in from a different IP / device — should NOT hit 429 (rate limit is per-IP, not per-account).

---

## 7. Environment Variables

### Backend (`backend/.env`)
See `backend/.env.example` for the full list. Critical ones:

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `MONGODB_URI` | ✅ | — | Atlas connection string |
| `JWT_SECRET` | ✅ | — | 32+ random chars |
| `JWT_REFRESH_SECRET` | ✅ | — | 32+ different random chars |
| `JWT_EXPIRES_IN` | optional | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | optional | `7d` | Refresh token lifetime |
| `FRONTEND_URL` | ✅ | — | Your Vercel URL (used in invite emails + CORS fallback) |
| `CORS_ORIGINS` | recommended | `FRONTEND_URL` | Comma-separated list of allowed origins |
| `RATE_LIMIT_WINDOW_MS` | optional | `900000` (15 min) | Rate limit window |
| `RATE_LIMIT_MAX` | optional | `500` | General API requests per window per IP |
| `AUTH_RATE_LIMIT_MAX` | optional | `50` | Failed login attempts per window per IP |
| `REFRESH_RATE_LIMIT_MAX` | optional | `200` | Refresh attempts per window per IP (relaxed — auto-fired) |
| `BCRYPT_ROUNDS` | optional | `12` | bcrypt hashing cost |
| `SMTP_USER` / `SMTP_PASS` | optional | — | Gmail address + 16-char App Password (for invite emails) |
| `SMTP_HOST` / `SMTP_PORT` | optional | Gmail defaults | Override if using non-Gmail SMTP |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | optional | `SMTP_USER` | Sender display name + reply-to |

### Frontend (`frontend/.env`)
| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `VITE_API_URL` | ✅ in prod | `/api` (dev) | Full URL to your Render backend, e.g. `https://nexnote-api.onrender.com/api` |

---

## 8. API Reference

### Auth (`/api/auth`)
| Method | Path | Auth | Rate-limited | Purpose |
|--------|------|------|--------------|---------|
| POST | `/register` | ❌ | ✅ 50/15min | Create account |
| POST | `/login` | ❌ | ✅ 50/15min (failed only) | Login |
| POST | `/refresh` | ❌ | ✅ 200/15min | Refresh access token |
| POST | `/logout` | ✅ | — | Invalidate refresh token |
| GET | `/me` | ✅ | — | Get current user |
| PATCH | `/me` | ✅ | — | Update name/avatar |
| POST | `/change-password` | ✅ | ✅ 5/hour | Change password |

### Notes (`/api/notes`) — all auth required
`GET /` (paginated, filter by folderId/tag/pinned/q/teamId) · `POST /` · `GET /:id` · `PATCH /:id` · `DELETE /:id` · `PATCH /:id/pin` · `POST /:id/share` · `DELETE /:id/share` · `GET /shared/:token` (public) · `GET /tags`

### Folders (`/api/folders`) — all auth required
`GET /` · `POST /` · `GET /:id` · `PATCH /:id` · `DELETE /:id`

### Teams (`/api/teams`) — all auth required
`GET /` · `POST /` · `GET /:teamId` · `PATCH /:teamId` · `DELETE /:teamId` · `GET /:teamId/stats` · `GET /:teamId/logs` · `POST /:teamId/invites` · `DELETE /:teamId/invites` · `DELETE /:teamId/members/:userId` · `PATCH /:teamId/members/:userId/role` · `POST /invites/:token/accept`

### Todos (`/api/todos`) — all auth required
`GET /` · `POST /` · `GET /:id` · `PATCH /:id` · `DELETE /:id` · `PATCH /:id/toggle` · `GET /stats`

### Public endpoints (no auth)
- `GET /api/ping` — lightweight keep-alive (mounted BEFORE globalLimiter)
- `GET /api/health` — health check with version + uptime
- `GET /api/notes/shared/:token` — read a publicly shared note

---

## 9. Troubleshooting

### "429 Too Many Requests" on login
- In development: ensure `NODE_ENV=development` in `backend/.env` — limiters are no-ops in dev.
- In production: check that `app.set("trust proxy", 1)` is in `backend/app.js` (it is, by default). Without this, Render's proxy IP is used as the key — every user shares one bucket.
- Verify the auth limiter is NOT mounted on `/api/auth/refresh` (it shouldn't be — refresh has its own relaxed limiter).

### "Cannot reach server" / network errors
- The Render free tier sleeps after 15 min of inactivity. The frontend's `useKeepAlive` hook pings `/api/ping` every 4 min to prevent this.
- If the server is already asleep, the first request takes 50–90s to cold-start. The frontend's axios interceptor retries once on network error / 503 with a 3-second delay.
- For production, upgrade Render to the **Starter** plan ($7/mo) to eliminate cold starts entirely.

### Refresh loop / repeated 401s
- The frontend uses a single-flight guard (`isRefreshing` + `refreshPromise`) so concurrent 401s share one refresh. If you see repeated refreshes, check that the guard is intact in `frontend/src/services/api.js`.
- The refresh token is rotated on every `/refresh` call — if two refreshes race, the loser's token is invalidated and the user is logged out. The single-flight guard prevents this.

### CORS errors
- Verify `CORS_ORIGINS` on Render includes your Vercel URL (production + any preview URLs you want to allow).
- In development, any `localhost` origin is allowed automatically.
- Sockets use the same origin resolver as Express (see `backend/server.js` → `corsOriginResolver`).

### E11000 duplicate key error on `notes.shareToken`
- This was a bug in an earlier version (non-shared notes had `shareToken: null` which collided on the unique index).
- Fixed by using `partialFilterExpression: { shareToken: { $type: "string" } }` — only shared notes are indexed.
- The backend auto-repairs the index on startup (`ensureNotesIndexes` in `backend/config/db.js`) — no manual action needed.
- If you still see this error after deploying, run `node backend/scripts/fixShareTokenIndex.js` manually.

### Team invite email not delivered
- Verify `SMTP_USER` and `SMTP_PASS` are set on Render.
- `SMTP_PASS` must be a **Gmail App Password** (16 chars, no spaces) — NOT your regular Gmail password.
- Enable 2-Step Verification on your Google account, then generate an App Password at https://myaccount.google.com/apppasswords.
- Check the SMTP connection in development via `GET /api/smtp-status` and send a test email via `POST /api/smtp-test-send`.

---

## License

Haroon Ameer Khan © NexNote — MIT License

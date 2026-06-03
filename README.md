# AI Interview Coach

A full-stack web app where users pick a **topic** and **difficulty**, get **5 AI-generated
interview questions** (streamed from Google Gemini), answer them one at a time, and can request
**AI hints** (guidance only — never the answer) **once per question**. After finishing, they see a
**session summary** with their answers and AI-assistance usage. All sessions are kept as history.

| Layer    | Tech                                                       |
| -------- | ---------------------------------------------------------- |
| Frontend | Next.js 15 (App Router, TypeScript), Tailwind CSS          |
| Backend  | Express 4, modular layered architecture                    |
| Database | MongoDB (Mongoose ODM)                                      |
| AI       | Google Gemini via `@google/genai` (streaming + structured) |
| Auth     | JWT access/refresh tokens in httpOnly cookies, bcrypt      |

---

## Features

- **Auth** — register, login, logout, silent token refresh, protected routes.
- **Topic & difficulty selection** — Generative AI / JavaScript / MongoDB × Beginner / Intermediate / Advanced.
- **Streaming question generation** — Gemini generates exactly 5 questions; tokens stream to the UI live (SSE).
- **Question flow** — one question at a time, save answers, free navigation, progress saved server-side.
- **AI assistance** — `Ask AI` per question returns hints / suggested approach / related concepts / resources, **enforced once per question** server-side and **never reveals the answer**.
- **Session summary** — answers, AI usage, and completion stats.
- **Session history** — every past session is listed on the dashboard.

---

## Project structure

```
ai_coach/
├── backend/                 # Express API
│   ├── src/
│   │   ├── config/          # env validation, DB connection, domain constants
│   │   ├── models/          # Mongoose schemas (User, Session)
│   │   ├── middleware/      # auth, validation, rate limiting, error handler
│   │   ├── services/        # business logic (auth, session, gemini)
│   │   ├── controllers/     # request/response handlers (incl. SSE)
│   │   ├── routes/          # route definitions
│   │   ├── validators/      # zod request schemas
│   │   ├── utils/           # ApiError, asyncHandler, token, logger
│   │   ├── app.js           # express app assembly
│   │   └── server.js        # bootstrap + graceful shutdown
│   └── .env.example
└── frontend/                # Next.js app
    └── src/
        ├── app/             # routes: /, /login, /register, /dashboard,
        │                    #         /interview/[sessionId], /summary/[sessionId]
        ├── components/      # UI kit + Navbar
        ├── context/         # AuthContext
        ├── hooks/           # useRequireAuth
        └── lib/             # API client (incl. SSE consumer) + types
```

---

## Prerequisites

- **Node.js ≥ 20**
- **MongoDB** — either local (`mongodb://127.0.0.1:27017`) or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster.
- **Gemini API key** — from [Google AI Studio](https://aistudio.google.com/apikey).

---

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env        # then fill in MONGO_URI, JWT secrets, GEMINI_API_KEY
npm install
npm run dev                 # http://localhost:5000
```

Required `.env` values:

| Variable             | Notes                                                       |
| -------------------- | ----------------------------------------------------------- |
| `MONGO_URI`          | Local or Atlas connection string                            |
| `JWT_ACCESS_SECRET`  | Long random string (`openssl rand -hex 32`)                 |
| `JWT_REFRESH_SECRET` | Different long random string                                |
| `GEMINI_API_KEY`     | From Google AI Studio                                       |
| `GEMINI_MODEL`       | Defaults to `gemini-2.5-flash`                              |
| `CLIENT_ORIGIN`      | Frontend origin(s), comma-separated (default `:3000`)       |

### 2. Frontend

```bash
cd frontend
cp .env.local.example .env.local   # NEXT_PUBLIC_API_URL defaults to http://localhost:5000/api
npm install
npm run dev                        # http://localhost:3000
```

Open **http://localhost:3000**, register, and start a session.

> From the repo root you can also run `npm run install:all`, then `npm run dev:backend` and
> `npm run dev:frontend` in separate terminals.

---

## API reference

Base path: `/api`. Auth uses httpOnly cookies (set on login/register); the access token is also
returned in the body for clients that prefer `Authorization: Bearer`.

| Method | Path                                          | Auth | Description                              |
| ------ | --------------------------------------------- | ---- | ---------------------------------------- |
| GET    | `/health`                                     | —    | Liveness check                           |
| GET    | `/catalog`                                    | —    | Allowed topics & difficulties            |
| POST   | `/auth/register`                              | —    | Create account                           |
| POST   | `/auth/login`                                 | —    | Log in                                   |
| POST   | `/auth/refresh`                               | cookie | Rotate tokens                          |
| POST   | `/auth/logout`                                | —    | Clear cookies                            |
| GET    | `/auth/me`                                     | ✓    | Current user                             |
| GET    | `/sessions`                                   | ✓    | List the user's sessions                 |
| POST   | `/sessions`                                   | ✓    | **SSE** — stream + create a 5-Q session  |
| GET    | `/sessions/:id`                               | ✓    | Get one session                          |
| POST   | `/sessions/:id/questions/:order/answer`       | ✓    | Submit/update an answer                  |
| POST   | `/sessions/:id/questions/:order/assist`       | ✓    | Get AI hint (once per question)          |
| POST   | `/sessions/:id/complete`                      | ✓    | Mark session completed                   |

### Streaming session creation (SSE)

`POST /api/sessions` responds with `text/event-stream`:

- `event: start` — `{ topic, difficulty }`
- `event: chunk` — `{ text }` (raw Gemini token deltas, repeated)
- `event: done`  — `{ session }` (persisted session document)
- `event: error` — `{ message }`

The frontend consumes this in `src/lib/api.ts → createSessionStream`.

---

## Design & security notes

- **Layered architecture**: routes → validators → controllers → services → models. Controllers stay
  thin; business rules live in services; Gemini access is isolated in one service.
- **Fail-fast config**: `config/env.js` validates all env vars with zod at boot.
- **Validation**: every request body/params validated with zod before reaching a controller.
- **Centralised errors**: `ApiError` + one error middleware normalises Mongoose/duplicate-key/cast
  errors and hides internals in production.
- **AuthZ**: session queries are always scoped to the authenticated `user` id — no cross-user access.
- **AI-once-per-question**: enforced in `session.service.js` (checks `assistance.used`), not just the UI.
- **Hints not answers**: the assistance prompt strictly forbids revealing solutions.
- **Security middleware**: `helmet`, CORS allow-list with credentials, per-route rate limiting,
  bcrypt (cost 12), httpOnly/SameSite cookies, `select:false` on the password hash.
- **Indexing**: `User.email` unique; `Session{ user, createdAt }` compound index for history queries.
- **Graceful shutdown**: SIGINT/SIGTERM close the HTTP server and Mongo connection.

---

## Notes / limitations

- Refresh-token rotation is stateless (not stored/blacklisted). For production, add a server-side
  token store to support hard logout/revocation.
- No automated test suite is included; the HTTP layer (routing, validation, auth guard, error
  handling) was verified manually against a running instance.

# Architecture Overview

This document describes the architecture of **AI Interview Coach** — how the system is structured,
how data flows through it, and the design decisions behind it.

---

## 1. High-level system

```
┌──────────────────────────┐         HTTPS / JSON + SSE        ┌──────────────────────────┐
│        Frontend          │  ───────────────────────────────▶ │         Backend          │
│   Next.js 15 (App Router)│                                    │      Express 4 (REST)    │
│   React 19 + Tailwind    │ ◀───────────────────────────────  │   Layered architecture   │
└──────────────────────────┘   httpOnly cookies (JWT) +         └────────────┬─────────────┘
                                Server-Sent Events                            │
                                                              ┌───────────────┼───────────────┐
                                                              │                               │
                                                     ┌────────▼────────┐            ┌──────────▼─────────┐
                                                     │     MongoDB     │            │   Google Gemini    │
                                                     │   (Mongoose)    │            │  (@google/genai)   │
                                                     └─────────────────┘            └────────────────────┘
```

- **Frontend** renders the UI, holds auth state in React context, and talks to the backend over a
  typed `fetch` client. Question generation is consumed as a **Server-Sent Events (SSE)** stream.
- **Backend** is a stateless REST API. It owns all business rules, validation, persistence, and the
  only credentials for MongoDB and Gemini. The browser never talks to Gemini or Mongo directly.
- **MongoDB** stores users and interview sessions (questions, answers, AI-assistance state, and AI
  evaluation scores).
- **Gemini** generates the interview questions (streamed), the hint guidance (non-streamed), and
  scores each answer (non-streamed, run as a background job after completion).

---

## 2. Backend architecture

A strict **layered / separation-of-concerns** design. A request flows top-to-bottom; each layer has
exactly one responsibility.

```
HTTP request
   │
   ▼
┌─────────────┐   route table, attaches middleware
│   routes/   │   e.g. /sessions → requireAuth → validate → controller
└──────┬──────┘
       ▼
┌─────────────┐   security & cross-cutting concerns
│ middleware/ │   helmet · CORS · rate limit · auth (JWT) · zod validate · error handler
└──────┬──────┘
       ▼
┌─────────────┐   thin HTTP adapters: read req, call service, shape res
│controllers/ │   (auth.controller, session.controller — incl. SSE writer)
└──────┬──────┘
       ▼
┌─────────────┐   business logic, the heart of the app
│  services/  │   auth.service · session.service · gemini.service
└──────┬──────┘
       ▼
┌─────────────┐   persistence (Mongoose schemas, indexes, instance methods)
│   models/   │   User · Session
└─────────────┘

Supporting:  config/ (env, db, constants)   utils/ (ApiError, asyncHandler, token, logger)
             validators/ (zod schemas)
```

### Layer responsibilities

| Layer            | Responsibility                                                              | Must NOT do                          |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| **routes**       | Map URLs to middleware + controller                                         | Contain logic                        |
| **middleware**   | Auth, validation, rate limiting, error normalization                        | Know about business rules            |
| **controllers**  | Parse request, call a service, format the HTTP response (incl. SSE frames)  | Contain business logic or DB queries |
| **services**     | Business rules, orchestration, the "once-per-question" rule, AI calls       | Touch `req`/`res`                    |
| **models**       | Schema, validation, indexes, hashing/compare methods                        | Make HTTP calls                      |
| **config/utils** | Env validation, DB connection, errors, tokens, logging                      | —                                    |

This keeps controllers thin and testable, isolates the Gemini integration in one file, and means a
business rule (e.g. AI-assist limit) lives in exactly one place.

### Key cross-cutting modules

- **`config/env.js`** — validates every environment variable with zod **at boot** and exits on
  failure (fail-fast). Nothing else reads `process.env` directly.
- **`utils/ApiError.js`** — an operational error carrying an HTTP status. Anything that is *not* an
  `ApiError` is treated as an unexpected bug by the error handler and hidden in production.
- **`utils/asyncHandler.js`** — wraps async controllers so rejected promises reach the error
  middleware instead of crashing the process.
- **`middleware/errorHandler.js`** — single funnel that normalizes Mongoose validation, cast, and
  duplicate-key (E11000) errors into clean JSON responses.

---

## 3. Data model

Two collections.

### `User`
| Field          | Type   | Notes                                          |
| -------------- | ------ | ---------------------------------------------- |
| `name`         | String | 2–60 chars                                     |
| `email`        | String | unique, lowercased, indexed                    |
| `passwordHash` | String | bcrypt (cost 12), `select: false` (never sent) |
| timestamps     | Date   | `createdAt` / `updatedAt`                       |

`comparePassword()` and `setPassword()` are instance methods; `toJSON` strips `passwordHash`.

### `Session` (with embedded questions)
A session embeds its questions because they are always read/written together and bounded (5),
making the whole interview a single-document read/write.

```
Session {
  user: ObjectId(ref User)        // owner — every query is scoped to this
  topic: enum                     // generative-ai | javascript | mongodb
  difficulty: enum                // beginner | intermediate | advanced
  status: enum                    // in_progress | completed
  questions: [ Question ]         // exactly 5
  completedAt: Date
  evaluation: {                   // session-level AI scoring (background job)
    status: enum                  // not_started | in_progress | completed | failed
    totalScore: Number            // sum of per-question scores (e.g. out of 50)
    maxScore: Number              // questions x 10
    startedAt: Date
    completedAt: Date
    error: String                 // set when status = failed
  }
  timestamps
}

Question (embedded, _id: false) {
  order: Number                   // 0-based position
  prompt: String                  // the question text
  userAnswer: String
  answeredAt: Date
  assistance: {                   // AI hint state — enforces once-per-question
    used: Boolean
    content: String               // markdown hint (NOT the answer)
    usedAt: Date
  }
  evaluation: {                   // AI score for this answer
    scored: Boolean
    score: Number                 // 0-10
    feedback: String              // short constructive feedback
  }
}
```

**Indexes**
- `User.email` — unique.
- `Session { user: 1, createdAt: -1 }` — compound, serves the "my sessions, newest first" list.

**Virtuals** — `answeredCount`, `assistanceUsedCount` are computed, not stored.

Embedding the per-question `evaluation` alongside the answer means the whole graded interview is one
document read — the summary page renders scores without any joins.

---

## 4. Authentication & authorization

- **Tokens**: short-lived **access** JWT (15m) + long-lived **refresh** JWT (7d). Both are typed
  (`typ` claim) so a refresh token can't be used as an access token.
- **Transport**: tokens are set as **httpOnly cookies** (not readable by JS → XSS-resistant). The
  refresh cookie is scoped to `path=/api/auth`. The access token is *also* returned in the response
  body for clients that prefer an `Authorization: Bearer` header. `requireAuth` accepts either.
- **Silent refresh**: the frontend API client catches a `401`, calls `/auth/refresh` once, and
  retries the original request transparently (`createSessionStream` and `request` in `lib/api.ts`).
- **Authorization**: every session operation loads the document with `{ _id, user: req.userId }`, so
  a user can never read or mutate another user's session (returns 404, not 403, to avoid leaking
  existence).

```
Browser ──login──▶ /auth/login ──▶ Set-Cookie: accessToken (15m), refreshToken (7d, /api/auth)
Browser ──any req─▶ (cookie sent) ──▶ requireAuth verifies access JWT ──▶ req.userId
   on 401 ──▶ /auth/refresh (refresh cookie) ──▶ new pair ──▶ retry original request
```

---

## 5. Gemini integration

Isolated entirely in **`services/gemini.service.js`**. Three distinct interactions:

### a) Question generation — **streaming + structured**
- Uses `ai.models.generateContentStream(...)` with a `responseSchema` that forces a JSON object of
  exactly 5 question strings (`responseMimeType: 'application/json'`).
- Raw token deltas are forwarded to the caller via an `onChunk` callback for live UX, while the full
  text is accumulated and parsed/validated when the stream finishes.

### b) AI assistance — **guidance, never the answer**
- Uses non-streaming `generateContent(...)` with a carefully constrained prompt that returns only
  *Hints / Suggested Approach / Related Concepts / Learning Resources* and **explicitly forbids** the
  final answer, code solution, or definitive explanation.

### c) Answer evaluation — **structured scoring**
- `generateEvaluation()` uses non-streaming `generateContent(...)` with a `responseSchema` of
  `{ score: integer 0–10, feedback: string }` at low temperature for consistent grading. The score is
  clamped to 0–10 defensively after parsing.
- Driven by the background job in `session.service.js` (see §7) — answered questions are graded in
  parallel; empty answers are scored 0 *without* an AI call.

### Upstream error mapping
A shared `mapGeminiError(err, fallback)` translates SDK failures into honest, user-facing
`ApiError`s instead of a blanket 500. It inspects `err.status`, `err.code`, and the (embedded)
message:
- Gemini **overloaded** (`503` / `UNAVAILABLE` / "high demand") → **`503`** "experiencing high
  demand, try again" — *not our fault*, and retryable.
- Gemini **quota/rate limit** (`429` / `RESOURCE_EXHAUSTED`) → **`429`**.
- Anything else → **`500`** with the generic fallback.

All three interactions route their `catch` through this mapper, so the same transient-vs-real
distinction is surfaced everywhere (stream `error` event, assist response, and `evaluation.error`).

---

## 6. The streaming flow (end to end)

Creating a session is the most interesting path because it streams.

```
Dashboard "Generate"                 POST /api/sessions (SSE)
        │                                     │
        │  createSessionStream()              ▼
        │  fetch + ReadableStream     controller sets text/event-stream
        │                                     │
        │ ◀── event: start ───────────  sse(start,{topic,difficulty})
        │ ◀── event: chunk (×N) ──────  gemini.service.streamQuestions(onChunk)
        │     (live token preview)            │ accumulate + validate 5 Qs
        │                             session.service.createSession() → Mongo
        │ ◀── event: done {session} ──  sse(done,{session}); res.end()
        ▼
  router.push(/interview/:id)
```

- If the **client disconnects** mid-generation (`req.on('close')`), the controller stops emitting and
  ends the response — no wasted writes.
- The frontend parses SSE frames manually from the `fetch` `ReadableStream` (`event:` + `data:` lines
  separated by a blank line) in `lib/api.ts`.

---

## 7. Background answer-evaluation flow

When a user finishes, answers are scored by AI **asynchronously** so the `complete` request returns
instantly and the user is never blocked on the model.

```
Interview "Finish"            POST /sessions/:id/complete
        │                              │
        │                     completeSession(): status=completed,
        │                     evaluation.status = in_progress  ──▶ Mongo
        │ ◀── 200 {session, in_progress} ─┘  (responds immediately)
        │                              │  (detached, NOT awaited)
        │                              ▼
        │                     runEvaluation():
        │                       • reload session fresh
        │                       • Promise.all over questions
        │                           – answered → gemini.generateEvaluation() (0-10 + feedback)
        │                           – empty    → score 0, no AI call
        │                       • sum → totalScore; status=completed ──▶ Mongo
        ▼
  router.push(/summary/:id)
        │
   summary page polls GET /sessions/:id every 3s while in_progress
        └──▶ status=completed → render /50 score + per-question feedback
             (a manual refresh shows the same persisted result)
```

Design points:
- **Fire-and-forget, persisted**: the controller calls `runEvaluation(...).catch(log)` without
  `await`. Because results are written to Mongo, the answer survives a page refresh or the user
  navigating away — the UI just reads current state.
- **Idempotent / restartable**: `complete` only starts scoring when `evaluation.status` is
  `not_started`/`failed`, so it doubles as a "(re)evaluate" trigger for older or failed sessions
  without duplicating work.
- **Fresh reload** inside `runEvaluation` avoids acting on a stale document after `complete` saved.
- **Failure isolation**: any error sets `status=failed` + `evaluation.error`; the rest of the session
  is untouched and the user can retry.

> This runs as an in-process task — fine for a single instance. For multiple backend replicas or
> crash-durability mid-scoring, move it to a job queue (e.g. BullMQ/Redis). See §10.

---

## 8. Frontend architecture

```
app/
  layout.tsx            AuthProvider + Navbar wrap every page
  page.tsx              landing (redirects authed users to /dashboard)
  login, register       auth forms → AuthContext
  dashboard             topic/difficulty pickers, streaming preview, session history
  interview/[id]        one-question-at-a-time flow, save, navigate, Ask AI
  summary/[id]          answers, AI-usage recap, /50 score + per-question feedback
                        (polls while evaluation.status = in_progress)

context/AuthContext     user state, login/register/logout, hydrate via /auth/me
hooks/useRequireAuth    redirects unauthenticated users to /login
components/             UI kit (Button, Input, Card, Badge, Spinner, Alert) + Navbar
lib/api.ts              typed fetch client, auto-refresh, SSE consumer
lib/types.ts            shared TypeScript domain types
```

- **State management**: auth is global via React Context; per-page data (session, current question,
  draft answer) is local component state. The summary page **polls** `GET /sessions/:id` on a 3s
  interval while evaluation is `in_progress`, then stops. No heavyweight store is needed at this scale.
- **Server-side enforcement first**: the UI hides the "Ask AI" button after use, but the *real* limit
  is enforced by the backend — the UI is a convenience, not the gate.
- **Responsive**: Tailwind utility classes with `sm:` breakpoints throughout.

---

## 9. Security summary

| Concern             | Mitigation                                                              |
| ------------------- | ----------------------------------------------------------------------- |
| Password storage    | bcrypt cost 12; `passwordHash` `select:false`                            |
| XSS token theft     | httpOnly cookies; tokens never in `localStorage`                        |
| CSRF                | `SameSite` cookies; CORS allow-list with credentials                    |
| Injection / bad input | zod validation on body/params for every route                         |
| Brute force / abuse | `express-rate-limit` — strict on auth, tighter on AI, baseline globally |
| Cross-user access   | All session queries scoped to `req.userId`                              |
| Header attacks      | `helmet`                                                                |
| Secret leakage      | All secrets in env; validated at boot; stack traces hidden in prod      |
| AI cost / answer leak | Once-per-question server-side; prompt forbids revealing answers        |
| Upstream AI faults  | `mapGeminiError` → honest 503/429 (retryable) vs 500; never leaks raw SDK errors |

---

## 10. Operational concerns

- **Boot**: `server.js` connects to Mongo first, then starts Express. Fatal startup errors exit
  non-zero so a process manager can restart.
- **Graceful shutdown**: `SIGINT`/`SIGTERM` close the HTTP server and Mongo connection (10s force
  timeout).
- **Logging**: structured timestamped logger; HTTP logging via `morgan` in development.
- **Config**: 12-factor — everything via environment variables, no hardcoded secrets.

### Known limitations / future work
- Refresh tokens are **stateless** (not stored or blacklisted) — add a server-side token store for
  hard logout / revocation.
- **Background evaluation is in-process** — fire-and-forget on the server. With multiple replicas, or
  to survive a crash mid-scoring, move it to a durable job queue (BullMQ/Redis). Until then, a failed
  run is recoverable via the `complete` re-trigger.
- The summary page **polls** for evaluation results; a push channel (SSE/WebSocket) would be tidier.
- No automated test suite — the HTTP layer was verified manually.
- Single MongoDB instance assumed — add replica-set/connection-pool tuning for production.
- AI assistance is non-streamed — could be upgraded to SSE like question generation.

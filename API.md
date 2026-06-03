# API Documentation

REST API for **AI Interview Coach**.

- **Base URL**: `http://localhost:5000/api` (configurable via the backend `PORT`)
- **Content type**: `application/json` for all requests/responses, except `POST /sessions`, which
  responds with `text/event-stream` (Server-Sent Events).
- **Auth**: httpOnly cookies set on login/register. The access token is also returned in the body, so
  clients may instead send `Authorization: Bearer <accessToken>`. Cookie-based callers must send
  credentials (`credentials: 'include'` in `fetch`).

---

## Conventions

### Success envelope
Every successful response includes `success: true` plus the relevant payload:

```json
{ "success": true, "session": { /* ... */ } }
```

### Error envelope
```json
{
  "success": false,
  "message": "Human-readable message",
  "details": [{ "field": "email", "message": "A valid email is required" }]
}
```
`details` is present only for validation errors (HTTP 400).

### Status codes
| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 200  | OK                                                     |
| 201  | Created (register)                                     |
| 400  | Validation failed / bad request                        |
| 401  | Missing/invalid/expired authentication                 |
| 403  | Forbidden (e.g. AI assist already used)                |
| 404  | Not found (incl. another user's session)               |
| 409  | Conflict (e.g. email already registered)               |
| 429  | Rate limit exceeded (our limiter, or upstream AI quota)|
| 500  | Internal error                                         |
| 503  | Upstream AI temporarily unavailable (high demand)      |

> **Upstream AI errors.** When Gemini is overloaded it returns `503 UNAVAILABLE` / "high demand";
> the API maps this to a `503` with a clear, retryable message rather than a generic `500`. Gemini
> quota/rate-limit errors (`RESOURCE_EXHAUSTED`) are mapped to `429`. These are surfaced verbatim to
> the client so the UI can tell the user it's a transient upstream issue, not their fault.

### Rate limits
| Scope            | Window | Max requests |
| ---------------- | ------ | ------------ |
| Auth endpoints   | 15 min | 20           |
| AI endpoints     | 1 min  | 15           |
| Global (all API) | 1 min  | 120          |

---

## Domain values

Topics and difficulties are server-validated. Fetch them from [`GET /catalog`](#get-catalog) rather
than hardcoding.

| Topic `value`   | Label         | &nbsp; | Difficulty `value` | Label        |
| --------------- | ------------- | ------ | ------------------ | ------------ |
| `generative-ai` | Generative AI |        | `beginner`         | Beginner     |
| `javascript`    | JavaScript    |        | `intermediate`     | Intermediate |
| `mongodb`       | MongoDB       |        | `advanced`         | Advanced     |
| `python`        | Python        |        |                    |              |
| `sql`           | SQL           |        |                    |              |
| `reactjs`       | React.js      |        |                    |              |
| `expressjs`     | Express.js    |        |                    |              |

> The list above reflects the current catalogue; always read `GET /catalog` at runtime since topics
> may change.

---

## Object shapes

### User
```json
{ "id": "665f…", "name": "Ada Lovelace", "email": "ada@example.com",
  "createdAt": "2026-06-03T10:00:00.000Z", "updatedAt": "2026-06-03T10:00:00.000Z" }
```

### Session
```json
{
  "id": "665f…",
  "topic": "javascript",
  "difficulty": "intermediate",
  "status": "in_progress",
  "questions": [
    {
      "order": 0,
      "prompt": "Explain how closures work in JavaScript and give a practical use case.",
      "userAnswer": "",
      "answeredAt": null,
      "assistance": { "used": false, "content": "", "usedAt": null },
      "evaluation": { "scored": false, "score": null, "feedback": "" }
    }
  ],
  "evaluation": {
    "status": "not_started",
    "totalScore": null,
    "maxScore": 50,
    "startedAt": null,
    "completedAt": null
  },
  "answeredCount": 0,
  "assistanceUsedCount": 0,
  "createdAt": "2026-06-03T10:00:00.000Z",
  "completedAt": null
}
```

**`evaluation.status`** (session-level): `not_started` → `in_progress` → `completed` (or `failed`,
which adds an `error` string). Per-question `evaluation` holds `scored`, `score` (0–10), and
`feedback`. See [AI answer evaluation](#ai-answer-evaluation).

### Session summary (list view)
```json
{
  "id": "665f…", "topic": "javascript", "difficulty": "intermediate",
  "status": "in_progress", "totalQuestions": 5, "answeredCount": 2,
  "assistanceUsedCount": 1, "createdAt": "…", "completedAt": null
}
```

---

# Endpoints

## Utility

### `GET /health`
Liveness check. No auth.

**200**
```json
{ "success": true, "status": "ok" }
```

---

### `GET /catalog`
Returns the allowed topics and difficulties. No auth.

**200**
```json
{
  "success": true,
  "topics": [
    { "value": "generative-ai", "label": "Generative AI" },
    { "value": "javascript", "label": "JavaScript" },
    { "value": "mongodb", "label": "MongoDB" }
  ],
  "difficulties": [
    { "value": "beginner", "label": "Beginner" },
    { "value": "intermediate", "label": "Intermediate" },
    { "value": "advanced", "label": "Advanced" }
  ]
}
```

---

## Authentication

### `POST /auth/register`
Create an account. Sets auth cookies. No auth required.

**Request body**
| Field      | Type   | Rules                                          |
| ---------- | ------ | ---------------------------------------------- |
| `name`     | string | 2–60 chars                                     |
| `email`    | string | valid email (lowercased)                       |
| `password` | string | ≥ 8 chars, at least one letter and one number  |

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "passw0rd" }
```

**201**
```json
{ "success": true, "user": { /* User */ }, "accessToken": "eyJ…" }
```
Also sets `accessToken` and `refreshToken` httpOnly cookies.

**Errors**: `400` validation, `409` email already exists.

```bash
curl -i -X POST http://localhost:5000/api/auth/register \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"passw0rd"}'
```

---

### `POST /auth/login`
Log in. Sets auth cookies. No auth required.

**Request body**
```json
{ "email": "ada@example.com", "password": "passw0rd" }
```

**200**
```json
{ "success": true, "user": { /* User */ }, "accessToken": "eyJ…" }
```

**Errors**: `400` validation, `401` invalid email or password.

```bash
curl -i -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"email":"ada@example.com","password":"passw0rd"}'
```

---

### `POST /auth/refresh`
Rotate tokens using the `refreshToken` cookie. Sets new auth cookies.

**200**
```json
{ "success": true, "user": { /* User */ }, "accessToken": "eyJ…" }
```

**Errors**: `401` missing/invalid/expired refresh token.

---

### `POST /auth/logout`
Clears both auth cookies.

**200**
```json
{ "success": true, "message": "Logged out" }
```

---

### `GET /auth/me`  🔒
Returns the currently authenticated user.

**200**
```json
{ "success": true, "user": { /* User */ } }
```

**Errors**: `401`.

---

## Sessions  🔒

All session endpoints require authentication and operate only on the caller's own sessions.

### `GET /sessions`
List the caller's sessions, newest first.

**200**
```json
{ "success": true, "sessions": [ { /* Session summary */ } ] }
```

---

### `POST /sessions`  — Server-Sent Events
Generate 5 interview questions with Gemini (**streamed**) and persist the session.

> ⚠️ Unlike all other endpoints, the response is `text/event-stream`, not JSON. Rate-limited as an
> AI endpoint (15/min).

**Request body**
| Field        | Type   | Rules                                   |
| ------------ | ------ | --------------------------------------- |
| `topic`      | string | one of the catalog topic values         |
| `difficulty` | string | one of the catalog difficulty values    |

```json
{ "topic": "javascript", "difficulty": "intermediate" }
```

**Response** — a stream of SSE frames (`event:` + `data:` JSON, separated by a blank line):

| Event   | `data` payload                     | Meaning                              |
| ------- | ---------------------------------- | ------------------------------------ |
| `start` | `{ "topic", "difficulty" }`        | Generation has begun                 |
| `chunk` | `{ "text": "…" }` (repeated)       | Raw Gemini token delta (live preview) |
| `done`  | `{ "session": { /* Session */ } }` | Final persisted session              |
| `error` | `{ "message": "…" }`               | Generation failed                    |

Example stream:
```
event: start
data: {"topic":"javascript","difficulty":"intermediate"}

event: chunk
data: {"text":"{\"questions\":[\"Explain"}

event: chunk
data: {"text":" how closures work…\"]}"}

event: done
data: {"session":{ "id":"665f…", "questions":[…] }}
```

If the client disconnects mid-stream, the server stops generating and closes the response.

**Validation errors** (e.g. bad topic) are returned **before** the stream starts as a normal `400`
JSON body. **Upstream AI errors** that occur after the stream opens (e.g. Gemini overloaded) are
delivered as an `error` event whose `message` is the user-facing reason (e.g. *"The AI service is
currently experiencing high demand…"*).

```bash
curl -N -X POST http://localhost:5000/api/sessions \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"topic":"javascript","difficulty":"intermediate"}'
```

JavaScript consumer: see `frontend/src/lib/api.ts → createSessionStream`.

---

### `GET /sessions/:sessionId`
Fetch one full session (including questions, answers, and any AI hints).

| Param       | Type   | Rules                  |
| ----------- | ------ | ---------------------- |
| `sessionId` | string | 24-char Mongo ObjectId |

**200**
```json
{ "success": true, "session": { /* Session */ } }
```

**Errors**: `400` invalid id, `401`, `404` not found / not owned.

---

### `POST /sessions/:sessionId/questions/:order/answer`
Submit or update the answer to a question.

| Param       | Type    | Rules                  |
| ----------- | ------- | ---------------------- |
| `sessionId` | string  | 24-char ObjectId       |
| `order`     | integer | ≥ 0 (0-based question) |

**Request body**
| Field    | Type   | Rules                       |
| -------- | ------ | --------------------------- |
| `answer` | string | ≤ 10,000 chars (default "") |

```json
{ "answer": "A closure is a function bundled with its lexical scope…" }
```

**200** — returns the updated session.
```json
{ "success": true, "session": { /* Session */ } }
```

**Errors**: `400` validation, `400` session already completed, `401`, `404`.

```bash
curl -X POST http://localhost:5000/api/sessions/665f…/questions/0/answer \
  -H 'Content-Type: application/json' -b cookies.txt \
  -d '{"answer":"A closure is …"}'
```

---

### `POST /sessions/:sessionId/questions/:order/assist`
Request AI assistance (hints/guidance) for a question. **Allowed once per question** and **never
returns the answer**. Rate-limited as an AI endpoint.

| Param       | Type    | Rules            |
| ----------- | ------- | ---------------- |
| `sessionId` | string  | 24-char ObjectId |
| `order`     | integer | ≥ 0              |

**200**
```json
{
  "success": true,
  "order": 0,
  "content": "### Hints\n- Think about what a function 'remembers'…\n### Suggested Approach\n…\n### Related Concepts\n…\n### Learning Resources\n…"
}
```
`content` is Markdown with sections: *Hints*, *Suggested Approach*, *Related Concepts*, *Learning
Resources*.

**Errors**:
- `403` — AI assistance already used for this question.
- `400` invalid params · `401` · `404` · `429`/`503` upstream AI busy · `500` AI failure.

```bash
curl -X POST http://localhost:5000/api/sessions/665f…/questions/0/assist -b cookies.txt
```

---

### `POST /sessions/:sessionId/complete`
Mark a session as completed (sets `status: "completed"` and `completedAt`) **and trigger background
AI evaluation**. Idempotent.

| Param       | Type   | Rules            |
| ----------- | ------ | ---------------- |
| `sessionId` | string | 24-char ObjectId |

**200** — returns the session **immediately** (does not wait for scoring). On the first call that
starts scoring, `evaluation.status` is `in_progress`:
```json
{ "success": true, "session": { /* Session, status: "completed", evaluation.status: "in_progress" */ } }
```

This endpoint also serves to **(re)start evaluation** for a session whose `evaluation.status` is
`not_started` or `failed` (e.g. a session created before evaluation existed). If evaluation is
already `in_progress` or `completed`, calling it again won't restart scoring.

**Errors**: `400` invalid id, `401`, `404`.

---

## AI answer evaluation

After a session is completed, the API scores every question **in the background** using Gemini and
stores the results on the session — the `complete` request returns right away and does **not** block
on the AI. The client then **polls `GET /sessions/:id`** until `evaluation.status` settles.

**How scoring works**
- Each **answered** question is graded **0–10** with short feedback (graded in parallel).
- **Empty/unanswered** questions are scored **0** with a fixed note — no AI call is made (faster &
  cheaper). Answers are trimmed before being sent.
- `evaluation.totalScore` is the sum across all questions, out of `evaluation.maxScore` (e.g. **/50**
  for 5 questions).

**Lifecycle of `evaluation.status`**
| Status        | Meaning                                                            |
| ------------- | ------------------------------------------------------------------ |
| `not_started` | Session not completed yet, or predates the feature                 |
| `in_progress` | Scoring is running in the background — poll `GET /sessions/:id`     |
| `completed`   | `totalScore` + per-question `score`/`feedback` are populated        |
| `failed`      | Scoring errored; `evaluation.error` explains why (retry via complete) |

**Completed example** (`GET /sessions/:id`):
```json
{
  "success": true,
  "session": {
    "id": "665f…",
    "status": "completed",
    "evaluation": {
      "status": "completed",
      "totalScore": 37,
      "maxScore": 50,
      "startedAt": "…",
      "completedAt": "…"
    },
    "questions": [
      {
        "order": 0,
        "prompt": "Explain how closures work…",
        "userAnswer": "A closure is …",
        "evaluation": { "scored": true, "score": 8, "feedback": "Good grasp of scope; mention practical use cases." }
      }
    ]
  }
}
```

> If Gemini is overloaded during scoring, `evaluation.status` becomes `failed` with the upstream
> message in `evaluation.error`; the client can retry by calling `POST /sessions/:id/complete` again.
> The frontend consumes this in `src/app/summary/[sessionId]/page.tsx` (polls every 3s while
> `in_progress`; results also appear on a manual page refresh).

---

## Typical flow

```
1. POST /auth/register            → account + cookies
2. GET  /catalog                  → topics & difficulties
3. POST /sessions (SSE)           → stream questions, get session.id
4. POST /sessions/:id/questions/0/answer    (repeat per question)
   POST /sessions/:id/questions/0/assist    (optional, once each)
5. POST /sessions/:id/complete    → completes + starts background scoring
6. GET  /sessions/:id  (poll)     → until evaluation.status = completed → show /50 score
7. GET  /sessions                 → history
```

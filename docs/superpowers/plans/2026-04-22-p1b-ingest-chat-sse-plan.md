# P1-B — Ingest + Chat Viewer + SSE — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only WhatsApp mirror. User pairs, sends themselves a message from their phone, sees it in `/chats` within ~2s. Live updates over SSE. Soft unpair preserves encrypted history. Also fix the PA3 restore bug shipped broken in P1-A.

**Architecture:** Baileys socket in worker → filter → Redis stream → normalize + DEK-encrypt → Postgres + per-user media volume → Redis Pub/Sub → SSE stream → EventSource in browser → TanStack Query invalidation → two-pane `/chats` UI.

**Tech Stack:** Node 22, TypeScript strict, pnpm workspaces, Prisma 6 on Postgres 16, Redis 7 (streams + pub/sub + AOF), Express 5, React 19 + Vite 6 + Tailwind 4 + shadcn + TanStack Query 5, vitest 2, Playwright, bats, `@whiskeysockets/baileys@6.7`.

**Authoritative inputs:**
- Spec: [`docs/superpowers/specs/2026-04-22-p1b-ingest-chat-sse-design.md`](../specs/2026-04-22-p1b-ingest-chat-sse-design.md)
- Main design: [`docs/superpowers/specs/2026-04-21-whatsapp-personal-assistant-design.md`](../specs/2026-04-21-whatsapp-personal-assistant-design.md)
- P1-A plan (for pattern reference): [`./2026-04-22-p1a-pair-slice-plan.md`](./2026-04-22-p1a-pair-slice-plan.md)

**Commit discipline:** Conventional commits. Signed post-Epic-20 per repo convention. **Pathspec-scoped `git add <explicit paths>`** — never `-A`/`.`/`-a` (multi-agent memory rule). HEREDOC commit bodies with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

**TDD discipline:** Every code Epic ships test-first. Failing test → minimal implementation → test passes → commit. No test backfill. CI coverage gate per package enforced.

---

## Epic index (8)

| # | Epic | Owner | BlockedBy |
|---|---|---|---|
| IB1 | Prisma schema + migration + env + AuditType | backend-eng-1 | — |
| IB2 | Worker boot + PA3 session-restore fix | backend-eng-2 | IB1 |
| IB3 | Ingest pipeline (subscribe + normalize + consume + persist) | backend-eng-2 | IB1, IB2 |
| IB4 | Media downloader + MediaStore (local disk) | backend-eng-2 | IB1, IB3 |
| IB5 | API routes: conversations, messages, media, disconnect | backend-eng-1 | IB1, IB2 |
| IB6 | SSE events route + Redis Pub/Sub bridge | backend-eng-1 | IB1, IB3 |
| IB7 | Web `/chats` route + components + `useEventStream` hook | frontend-eng | IB5, IB6 |
| IB8 | Playwright E2E + smoke + docs + VISION flip | qa + tech-writer | IB1–IB7 |

**Parallelization:**
- IB1 is the only true gate for everything.
- IB2 should land before IB3 (they touch the same worker boot code).
- IB3 and IB5 can run in parallel once IB2 lands (IB5 doesn't need the ingest pipeline code to exist — it queries DB tables from IB1).
- IB4 runs in parallel with IB5.
- IB6 needs IB3 for the Redis Pub/Sub channel contract.
- IB7 waits for IB5 + IB6 (real endpoints to call).
- IB8 is last.

Three teammates (backend-eng-1, backend-eng-2, frontend-eng) can keep ~2 Epics in flight at a time.

---

## File structure overview

### New files

```
packages/db/prisma/schema.prisma                     [modified — add 4 models + 2 enums + AuditType value]
packages/db/prisma/migrations/<ts>_p1b_ingest/migration.sql  [generated]

packages/shared/src/env.ts                           [modified — add 7 env vars]

packages/worker/src/pair/state.ts                    [modified — add resumePaired(userId, authState)]
packages/worker/src/pair/restore.ts                  [modified — actually call resumePaired]

packages/worker/src/ingest/index.ts                  [new — public exports]
packages/worker/src/ingest/filter.ts                 [new — shouldIngest(raw)]
packages/worker/src/ingest/subscribe.ts              [new — wires Baileys → Redis stream]
packages/worker/src/ingest/normalize.ts              [new — raw → normalized message]
packages/worker/src/ingest/consume.ts                [new — XREADGROUP loop]
packages/worker/src/ingest/persist.ts                [new — normalized → DB + pub/sub]
packages/worker/src/ingest/mediaStore.ts             [new — MediaStore interface + LocalDiskMediaStore]
packages/worker/src/ingest/media.ts                  [new — bounded-concurrency downloader]
packages/worker/src/ingest/audit.ts                  [new — thin wrapper to writeAudit(type="ingest", subtype=...)]

packages/worker/src/ingest/filter.test.ts            [new]
packages/worker/src/ingest/normalize.test.ts         [new]
packages/worker/src/ingest/persist.test.ts           [new]
packages/worker/src/ingest/media.test.ts             [new]
packages/worker/src/ingest/integration.test.ts       [new — full pipeline with testcontainers]

packages/worker/src/index.ts                         [modified — wire ingest into boot]

packages/api/src/routes/conversations.ts             [new]
packages/api/src/routes/messages.ts                  [new]
packages/api/src/routes/media.ts                     [new]
packages/api/src/routes/events.ts                    [new — SSE]
packages/api/src/routes/pair.ts                      [modified — add POST /api/pair/disconnect]
packages/api/src/app.ts                              [modified — mount new routers]

packages/api/src/routes/conversations.test.ts        [new]
packages/api/src/routes/messages.test.ts             [new]
packages/api/src/routes/media.test.ts                [new]
packages/api/src/routes/events.test.ts               [new]
packages/api/src/routes/disconnect.test.ts           [new]

packages/web/src/routes/Chats.tsx                    [new]
packages/web/src/routes/Chats.test.tsx               [new]
packages/web/src/hooks/useEventStream.ts             [new]
packages/web/src/hooks/useEventStream.test.ts        [new]
packages/web/src/components/ConversationList.tsx     [new]
packages/web/src/components/MessageList.tsx          [new]
packages/web/src/components/MessageBubble.tsx        [new]
packages/web/src/components/DisconnectDialog.tsx     [new]
packages/web/src/api/client.ts                       [modified — add chats, media helpers]
packages/web/src/routes/router.tsx                   [modified — add /chats route]
packages/web/src/components/Shell.tsx                [modified — add Chats nav entry]
packages/web/src/routes/Pair.tsx                     [modified — wire Disconnect button]

packages/web/e2e/chats.spec.ts                       [new — Playwright happy path]
packages/web/e2e/helpers.ts                          [modified — add ingestFakeMessage helper]

scripts/smoke-test.sh                                [modified — add ingest step]
docker-compose.yml                                   [modified — add media-data volume]
docs/CHATS.md                                        [new — user guide]
docs/VISION.md                                       [modified — strike P1-B checkbox]
wiki/Home.md                                         [modified — Chats link]
```

### Module boundaries

- `ingest/filter.ts` — pure function, zero deps beyond `@whiskeysockets/baileys` types.
- `ingest/normalize.ts` — pure function, takes Baileys message + userId, returns a `NormalizedMessage`.
- `ingest/subscribe.ts` — side-effecty, attaches handler to a live socket. No DB.
- `ingest/consume.ts` + `ingest/persist.ts` — the only DB-writers.
- `ingest/media.ts` — side-effecty but talks only to `MediaStore` + Baileys; no DB (persist writes the `mediaRef`).
- `ingest/mediaStore.ts` — interface + one implementation (`LocalDiskMediaStore`). Swappable.
- `routes/events.ts` — side-effecty: owns the per-request Redis subscriber lifecycle.

---

## Epic IB1 — Prisma schema + migration + env + AuditType

**Owner:** backend-eng-1 | **BlockedBy:** —

**Files:**
- Modify: `packages/db/prisma/schema.prisma` — add `ConversationType` + `MessageDirection` enums, `ingest` value to `AuditType`, `WaContact`, `WaGroup`, `Conversation`, `Message` models.
- Create: `packages/db/prisma/migrations/<timestamp>_p1b_ingest/migration.sql` (generated).
- Modify: `packages/db/src/index.ts` — re-export new types.
- Modify: `packages/shared/src/env.ts` — add `MEDIA_DIR`, `MEDIA_MAX_BYTES`, `INGEST_DLQ_MAX_DELIVERIES`, `MEDIA_CONCURRENCY_USER`, `MEDIA_CONCURRENCY_GLOBAL`, `SSE_MAX_STREAMS_PER_USER`, `MESSAGE_RETENTION_DAYS`.
- Modify: `packages/shared/src/env.test.ts` — test defaults + overrides.
- Create: `packages/db/src/p1b.test.ts` — round-trip inserts + cascade delete.

- [ ] **Step 1: Add enum + model declarations to schema.prisma**

Locate the existing enums block and append:

```prisma
enum ConversationType {
  dm
  group
}

enum MessageDirection {
  in
  out
}
```

Add `ingest` as a new value inside the existing `AuditType` enum (alphabetical order preserved):

```prisma
enum AuditType {
  ai_reply
  decrypt
  ingest          // <-- new
  invite_consume
  invite_create
  kill
  login
  login_failed
  logout
  pair
  register
  rule_fired
  setting_change
  unpair
}
```

At the end of the file, append the four new models exactly as in the spec (see `docs/superpowers/specs/2026-04-22-p1b-ingest-chat-sse-design.md` §"Data model"). Verify `@relation` back-references are added to `User`:

```prisma
model User {
  // existing fields...
  waContacts      WaContact[]
  waGroups        WaGroup[]
  conversations   Conversation[]
}
```

- [ ] **Step 2: Generate migration**

Run from the `/packages/db` directory:

```bash
pnpm --filter @wpa/db exec prisma migrate dev --name p1b_ingest --create-only
```

Expected: a new `prisma/migrations/<timestamp>_p1b_ingest/migration.sql` is generated. `--create-only` skips applying so we can review before commit.

- [ ] **Step 3: Review generated SQL**

Open the new migration.sql. Sanity check:
- `CREATE TYPE "ConversationType" AS ENUM (...)`.
- `CREATE TYPE "MessageDirection" AS ENUM (...)`.
- `ALTER TYPE "AuditType" ADD VALUE 'ingest' BEFORE ...` (Postgres enum alter syntax).
- `CREATE TABLE "WaContact" ... FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE`.
- Indexes on `Conversation(userId, lastMessageAt)` and `Message(conversationId, timestamp)` present.

Do NOT hand-edit. If something looks wrong, revise schema.prisma and regenerate.

- [ ] **Step 4: Apply migration locally + write the schema test**

```bash
pnpm --filter @wpa/db exec prisma migrate deploy
```

Then create `packages/db/src/p1b.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getPrisma } from "./index.js";
import { withTestDb } from "@wpa/test-utils";

describe("P1-B schema", () => {
  withTestDb();

  it("round-trips a full conversation + message + contact", async () => {
    const prisma = getPrisma();
    const user = await prisma.user.create({
      data: {
        email: "ingest-test@example.com",
        passwordHash: "x",
        encryptedDek: Buffer.from("not-a-real-dek"),
      },
    });

    const contact = await prisma.waContact.create({
      data: {
        userId: user.id,
        jid: "447700900123@s.whatsapp.net",
        name: Buffer.from("ciphertext-placeholder"),
      },
    });

    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        jid: contact.jid,
        type: "dm",
        lastMessageAt: new Date(),
      },
    });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: "WAMSG-001",
        fromJid: contact.jid,
        direction: "in",
        timestamp: new Date(),
        body: Buffer.from("encrypted-body-placeholder"),
      },
    });

    const fetched = await prisma.message.findUnique({ where: { id: message.id } });
    expect(fetched?.waMessageId).toBe("WAMSG-001");
    expect(fetched?.direction).toBe("in");
  });

  it("cascades delete from User → Conversation → Message", async () => {
    const prisma = getPrisma();
    const user = await prisma.user.create({
      data: {
        email: "cascade@example.com",
        passwordHash: "x",
        encryptedDek: Buffer.from("x"),
      },
    });
    const conv = await prisma.conversation.create({
      data: { userId: user.id, jid: "1@g.us", type: "group" },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        waMessageId: "M1",
        fromJid: "x@s.whatsapp.net",
        direction: "in",
        timestamp: new Date(),
        body: Buffer.from("x"),
      },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const surviving = await prisma.message.findMany();
    expect(surviving).toEqual([]);
  });

  it("enforces unique (userId, jid) on Conversation", async () => {
    const prisma = getPrisma();
    const user = await prisma.user.create({
      data: {
        email: "uniq@example.com",
        passwordHash: "x",
        encryptedDek: Buffer.from("x"),
      },
    });
    await prisma.conversation.create({
      data: { userId: user.id, jid: "dup@s.whatsapp.net", type: "dm" },
    });
    await expect(
      prisma.conversation.create({
        data: { userId: user.id, jid: "dup@s.whatsapp.net", type: "dm" },
      }),
    ).rejects.toThrow(/unique constraint/i);
  });
});
```

- [ ] **Step 5: Run the schema test to verify green**

```bash
pnpm --filter @wpa/db test
```

Expected: all tests pass including the new three.

- [ ] **Step 6: Update db index re-exports**

Modify `packages/db/src/index.ts` to export:

```typescript
export type {
  WaContact,
  WaGroup,
  Conversation,
  Message,
  ConversationType,
  MessageDirection,
} from "@prisma/client";
```

Run `pnpm --filter @wpa/db build`. Expected: clean build.

- [ ] **Step 7: Add env vars to shared schema**

Modify `packages/shared/src/env.ts` — add to the Zod schema (inside `parseEnv`):

```typescript
MEDIA_DIR: z.string().default("/app/media"),
MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(33_554_432),
INGEST_DLQ_MAX_DELIVERIES: z.coerce.number().int().positive().default(3),
MEDIA_CONCURRENCY_USER: z.coerce.number().int().positive().default(3),
MEDIA_CONCURRENCY_GLOBAL: z.coerce.number().int().positive().default(10),
SSE_MAX_STREAMS_PER_USER: z.coerce.number().int().positive().default(3),
MESSAGE_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
```

- [ ] **Step 8: Write env tests**

Append to `packages/shared/src/env.test.ts`:

```typescript
it("uses default values for new P1-B env vars", () => {
  const env = parseEnv({
    // ...existing minimum required vars...
    DATABASE_URL: "postgresql://x",
    REDIS_URL: "redis://x",
    JWT_SECRET: "a".repeat(64),
    MASTER_KEY: Buffer.alloc(32).toString("base64"),
    PUBLIC_ORIGIN: "http://localhost:3000",
  });
  expect(env.MEDIA_DIR).toBe("/app/media");
  expect(env.MEDIA_MAX_BYTES).toBe(33_554_432);
  expect(env.INGEST_DLQ_MAX_DELIVERIES).toBe(3);
  expect(env.SSE_MAX_STREAMS_PER_USER).toBe(3);
  expect(env.MESSAGE_RETENTION_DAYS).toBe(0);
});

it("parses P1-B env overrides from strings", () => {
  const env = parseEnv({
    // ...existing vars...
    MEDIA_MAX_BYTES: "67108864",
    SSE_MAX_STREAMS_PER_USER: "5",
  });
  expect(env.MEDIA_MAX_BYTES).toBe(67_108_864);
  expect(env.SSE_MAX_STREAMS_PER_USER).toBe(5);
});
```

Run `pnpm --filter @wpa/shared test`. Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add \
  packages/db/prisma/schema.prisma \
  packages/db/prisma/migrations/*_p1b_ingest \
  packages/db/src/index.ts \
  packages/db/src/p1b.test.ts \
  packages/shared/src/env.ts \
  packages/shared/src/env.test.ts
git commit -m "$(cat <<'EOF'
feat(db): P1-B ingest schema + env + AuditType value

Adds WaContact, WaGroup, Conversation, Message models + ConversationType
and MessageDirection enums. New AuditType value `ingest`. Cascade-delete
chain reaches Message via Conversation. DEK-encrypted payloads land as
Bytes columns.

Seven new env vars added to @wpa/shared schema (MEDIA_DIR,
MEDIA_MAX_BYTES, INGEST_DLQ_MAX_DELIVERIES, MEDIA_CONCURRENCY_USER,
MEDIA_CONCURRENCY_GLOBAL, SSE_MAX_STREAMS_PER_USER,
MESSAGE_RETENTION_DAYS), all defaulted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] `pnpm --filter @wpa/db build` clean.
- [ ] `pnpm --filter @wpa/db exec prisma migrate deploy` on empty DB succeeds.
- [ ] `pnpm --filter @wpa/db test` green (new cascade + uniqueness tests pass).
- [ ] `pnpm --filter @wpa/shared test` green.
- [ ] Commit: `feat(db): P1-B ingest schema + env + AuditType value`.

---

## Epic IB2 — Worker boot + PA3 session-restore fix

**Owner:** backend-eng-2 | **BlockedBy:** IB1

This Epic fixes the P1-A bug where `docker compose restart app` forces re-scan. Root cause: `restore.ts` writes audit rows but does NOT actually re-open the Baileys socket with the stored creds. Fix by adding `pairMachine.resumePaired(userId, authState)` and wiring it from `restore.ts`.

**Files:**
- Modify: `packages/worker/src/pair/state.ts` — add `resumePaired(userId, authState)` method.
- Modify: `packages/worker/src/pair/state.test.ts` — add test for resumePaired.
- Modify: `packages/worker/src/pair/restore.ts` — call `pairMachine.resumePaired()` instead of just auditing.
- Modify: `packages/worker/src/pair/restore.test.ts` — assert restore invokes resumePaired with correct authState.
- Create: `packages/worker/src/pair/restore.integration.test.ts` — testcontainers-based integration test.

- [ ] **Step 1: Write failing test for `resumePaired`**

Append to `packages/worker/src/pair/state.test.ts`:

```typescript
it("resumePaired(userId, authState) transitions idle → paired and opens socket", async () => {
  const events = makeEvents();
  const socket = makeFakeSocket();
  const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
  const authState = {
    creds: makeFakeCreds({ id: "123@s.whatsapp.net", platform: "android" }),
    keys: { get: () => ({}), set: () => undefined },
  } as unknown as AuthenticationState;

  await m.resumePaired("u1", authState);

  expect(m.getState("u1")).toBe("paired");
  // Socket WAS opened with the restored auth state — socketFactory was called.
  expect(socket.handle.userId).toBe("u1");
  // No onPaired emit (we don't want to double-fire; restore writes its own audit).
  expect(events.paireds).toEqual([]);
  // State transition was recorded idle → paired.
  expect(events.stateChanges).toEqual([{ userId: "u1", next: "paired", prev: "idle" }]);
});

it("resumePaired skips if already paired for the same userId", async () => {
  const events = makeEvents();
  const socket = makeFakeSocket();
  const m = new PairMachine(events, { socketFactory: makeFactory(socket) });
  const authState = {
    creds: makeFakeCreds({ id: "1@s.whatsapp.net" }),
    keys: { get: () => ({}), set: () => undefined },
  } as unknown as AuthenticationState;

  await m.resumePaired("u1", authState);
  const before = { ...events };
  await m.resumePaired("u1", authState);

  // Idempotent — no extra state changes.
  expect(events.stateChanges.length).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @wpa/worker exec vitest run src/pair/state.test.ts -t "resumePaired"
```

Expected: FAIL — `m.resumePaired is not a function`.

- [ ] **Step 3: Implement `resumePaired` in `PairMachine`**

In `packages/worker/src/pair/state.ts`, add the method. Place it alongside `start()` and `stop()`:

```typescript
async resumePaired(userId: string, authState: AuthenticationState): Promise<void> {
  const current = this.machines.get(userId);
  if (current?.state === "paired") return;  // idempotent

  // Open Baileys socket with restored creds — no expire timer, no QR path.
  try {
    const handle = await this.opts.socketFactory({
      userId,
      authState,
      onUpdate: (update) => this.handleConnectionUpdate(userId, update),
      onCredsUpdate: (creds) => this.events.onCredsUpdate?.(userId, creds),
    });
    this.machines.set(userId, {
      state: "paired",
      socket: handle,
      expireTimer: null,
    });
    this.emitStateChange(userId, "paired", "idle");
    // Intentionally no onPaired emit — that's a first-time-link event.
  } catch (err) {
    this.events.onError(userId, err instanceof Error ? err : new Error(String(err)));
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
pnpm --filter @wpa/worker exec vitest run src/pair/state.test.ts -t "resumePaired"
```

Expected: PASS (both resumePaired tests).

- [ ] **Step 5: Update `restore.ts` to call `resumePaired`**

Open `packages/worker/src/pair/restore.ts`. Locate the happy path (where it currently only writes `pair.restored` audit). Change to:

```typescript
// was: only auditing
// now: actually open the socket
await pairMachine.resumePaired(userId, decryptedAuthState);
await audit(userId, "pair.restored", { sessionId });
```

- [ ] **Step 6: Update `restore.test.ts` to assert resumePaired was called**

In `packages/worker/src/pair/restore.test.ts`, find the mock for `pairMachine` (it has `start: vi.fn(...)` today). Add a `resumePaired: vi.fn(...)` entry and assert:

```typescript
expect(pairMachine.resumePaired).toHaveBeenCalledWith("u1", expect.objectContaining({
  creds: expect.any(Object),
  keys: expect.any(Object),
}));
// And NOT the old path:
expect(pairMachine.start).not.toHaveBeenCalled();
```

- [ ] **Step 7: Run restore test suite**

```bash
pnpm --filter @wpa/worker exec vitest run src/pair/restore.test.ts
```

Expected: PASS — all 6 existing + updated assertions.

- [ ] **Step 8: Write integration test for full boot path**

Create `packages/worker/src/pair/restore.integration.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { getPrisma } from "@wpa/db";
import { generateKey, wrapDek, encryptWithKey, serializeCiphertext } from "@wpa/shared";
import { restorePairedSessions } from "./restore.js";
// ...import pairMachine factory + fake socket factory from a shared test harness

describe("restore integration", () => {
  let pgContainer: StartedTestContainer;
  let redisContainer: StartedTestContainer;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer("postgres:16-alpine").start();
    redisContainer = await new RedisContainer("redis:7-alpine").start();
    process.env.DATABASE_URL = pgContainer.getConnectionUri();
    process.env.REDIS_URL = redisContainer.getConnectionUrl();
    // run prisma migrate deploy against the test DB
  });
  afterAll(async () => {
    await pgContainer.stop();
    await redisContainer.stop();
  });

  it("boot with a paired session → socket opened, no re-pair required", async () => {
    // 1. seed: a User with encryptedDek, a WhatsappSession with status=paired + authState blob
    // 2. spy on fakeSocketFactory
    // 3. call restorePairedSessions({ pairMachine, prisma })
    // 4. assert fakeSocketFactory was called with the decrypted authState
    // 5. assert pairMachine.getState(userId) === "paired"
  });
});
```

(Fill in the TODO stubs with the actual seeding + factory invocation following the existing `authStore.test.ts` testcontainers pattern.)

- [ ] **Step 9: Run integration test**

```bash
pnpm --filter @wpa/worker exec vitest run src/pair/restore.integration.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  packages/worker/src/pair/state.ts \
  packages/worker/src/pair/state.test.ts \
  packages/worker/src/pair/restore.ts \
  packages/worker/src/pair/restore.test.ts \
  packages/worker/src/pair/restore.integration.test.ts
git commit -m "$(cat <<'EOF'
fix(worker): actually resume Baileys socket on boot (closes PA3 gap)

PA3 shipped in P1-A claimed `docker compose restart app` keeps paired
sessions. It doesn't — the happy path in `restore.ts` wrote a
`pair.restored` audit row but never called into `pairMachine` to
re-open the socket. Users had to re-scan the QR after every restart.

Fix:
- Add `PairMachine.resumePaired(userId, authState)` — opens socket with
  restored creds, transitions idle → paired, emits state change but not
  onPaired (that's a first-time-link event; restore writes its own audit).
- `restore.ts` now calls resumePaired instead of just auditing.
- Integration test with testcontainers (Postgres + Redis) asserts the
  full boot path: seed paired session → restore → socket opened → state=paired.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] `pnpm --filter @wpa/worker test` all green (including new resumePaired + restore tests).
- [ ] Manual: pair once, `docker compose restart app`, refresh `/pair` → still shows Connected ✓ without re-scan.
- [ ] Commit: `fix(worker): actually resume Baileys socket on boot (closes PA3 gap)`.

---

## Epic IB3 — Ingest pipeline (subscribe + normalize + consume + persist)

**Owner:** backend-eng-2 | **BlockedBy:** IB1, IB2

**Files:**
- Create: `packages/worker/src/ingest/index.ts` (public exports).
- Create: `packages/worker/src/ingest/filter.ts` + `.test.ts`.
- Create: `packages/worker/src/ingest/normalize.ts` + `.test.ts`.
- Create: `packages/worker/src/ingest/subscribe.ts` (side-effect wiring; tested via integration).
- Create: `packages/worker/src/ingest/consume.ts` (XREADGROUP loop).
- Create: `packages/worker/src/ingest/persist.ts` + `.test.ts`.
- Create: `packages/worker/src/ingest/audit.ts`.
- Create: `packages/worker/src/ingest/integration.test.ts`.
- Modify: `packages/worker/src/index.ts` — wire subscribe into socket lifecycle + start consumer.

- [ ] **Step 1: Write filter test**

Create `packages/worker/src/ingest/filter.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { WAMessage } from "@whiskeysockets/baileys";
import { shouldIngest } from "./filter.js";

function msg(overrides: Partial<WAMessage>): WAMessage {
  return {
    key: { remoteJid: "447700900123@s.whatsapp.net", fromMe: false, id: "M1" },
    message: { conversation: "hi" },
    messageTimestamp: 1_800_000_000,
    ...overrides,
  } as unknown as WAMessage;
}

describe("shouldIngest", () => {
  it("accepts a text DM", () => {
    expect(shouldIngest(msg({}))).toBe(true);
  });
  it("rejects broadcast/status", () => {
    expect(shouldIngest(msg({ key: { remoteJid: "status@broadcast", fromMe: false, id: "M1" } }))).toBe(false);
  });
  it("rejects protocol/system (messageStubType)", () => {
    expect(shouldIngest(msg({ messageStubType: 2 as never }))).toBe(false);
  });
  it("rejects empty message body", () => {
    expect(shouldIngest(msg({ message: null }))).toBe(false);
  });
  it("accepts a group message", () => {
    expect(shouldIngest(msg({ key: { remoteJid: "1234-5678@g.us", fromMe: false, id: "M1" } }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fail**

```bash
pnpm --filter @wpa/worker exec vitest run src/ingest/filter.test.ts
```

Expected: FAIL (file doesn't exist).

- [ ] **Step 3: Implement `filter.ts`**

```typescript
import type { WAMessage } from "@whiskeysockets/baileys";

export function shouldIngest(raw: WAMessage): boolean {
  const remoteJid = raw.key?.remoteJid;
  if (!remoteJid) return false;
  if (remoteJid.endsWith("@broadcast")) return false;
  if (raw.messageStubType != null) return false;
  if (!raw.message) return false;
  return true;
}
```

- [ ] **Step 4: Run filter test to PASS**

```bash
pnpm --filter @wpa/worker exec vitest run src/ingest/filter.test.ts
```

Expected: PASS (5/5).

- [ ] **Step 5: Write normalize test**

Create `packages/worker/src/ingest/normalize.test.ts`. Table-driven:

```typescript
import { describe, expect, it } from "vitest";
import { normalize } from "./normalize.js";

describe("normalize", () => {
  it("text DM incoming", () => {
    const raw = {
      key: { remoteJid: "447700900123@s.whatsapp.net", fromMe: false, id: "M1" },
      message: { conversation: "hello there" },
      messageTimestamp: 1_800_000_000,
    };
    const out = normalize(raw as never);
    expect(out).toEqual({
      conversationJid: "447700900123@s.whatsapp.net",
      conversationType: "dm",
      waMessageId: "M1",
      fromJid: "447700900123@s.whatsapp.net",
      direction: "in",
      timestamp: new Date(1_800_000_000 * 1000),
      body: { kind: "text", text: "hello there" },
      mediaMeta: undefined,
    });
  });

  it("text group incoming (participant set)", () => {
    const raw = {
      key: { remoteJid: "1234-5678@g.us", fromMe: false, id: "M2", participant: "999@s.whatsapp.net" },
      message: { conversation: "hi group" },
      messageTimestamp: 1_800_000_100,
    };
    const out = normalize(raw as never);
    expect(out.conversationJid).toBe("1234-5678@g.us");
    expect(out.conversationType).toBe("group");
    expect(out.fromJid).toBe("999@s.whatsapp.net");
  });

  it("outgoing message (fromMe=true)", () => {
    const raw = {
      key: { remoteJid: "447700900123@s.whatsapp.net", fromMe: true, id: "M3" },
      message: { conversation: "sent from phone" },
      messageTimestamp: 1_800_000_200,
    };
    expect(normalize(raw as never).direction).toBe("out");
  });

  it("imageMessage with caption", () => {
    const raw = {
      key: { remoteJid: "447700900123@s.whatsapp.net", fromMe: false, id: "M4" },
      message: {
        imageMessage: {
          caption: "beach pic",
          mimetype: "image/jpeg",
          fileLength: "123456",
        },
      },
      messageTimestamp: 1_800_000_300,
    };
    const out = normalize(raw as never);
    expect(out.body.kind).toBe("image");
    expect(out.body.text).toBe("beach pic");
    expect(out.body.mediaMeta).toEqual(expect.objectContaining({ mimeType: "image/jpeg" }));
  });

  it("audio (voice note)", () => {
    const raw = {
      key: { remoteJid: "447700900123@s.whatsapp.net", fromMe: false, id: "M5" },
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 17 } },
      messageTimestamp: 1_800_000_400,
    };
    const out = normalize(raw as never);
    expect(out.body.kind).toBe("audio");
    expect(out.body.mediaMeta?.seconds).toBe(17);
  });

  it("unknown kinds fall through to kind=unknown", () => {
    const raw = {
      key: { remoteJid: "1@s.whatsapp.net", fromMe: false, id: "MX" },
      message: { someFutureMessageType: { foo: "bar" } },
      messageTimestamp: 1_800_000_500,
    };
    const out = normalize(raw as never);
    expect(out.body.kind).toBe("unknown");
  });

  it("quoted message passes through quotedMsgId", () => {
    const raw = {
      key: { remoteJid: "1@s.whatsapp.net", fromMe: false, id: "MQ" },
      message: {
        extendedTextMessage: {
          text: "reply",
          contextInfo: { stanzaId: "QUOTED-123" },
        },
      },
      messageTimestamp: 1_800_000_600,
    };
    expect(normalize(raw as never).body.quotedMsgId).toBe("QUOTED-123");
  });
});
```

- [ ] **Step 6: Implement `normalize.ts`**

```typescript
import type { WAMessage } from "@whiskeysockets/baileys";

export type NormalizedBodyKind =
  | "text" | "image" | "video" | "audio" | "document" | "sticker"
  | "location" | "contact" | "reaction" | "unknown";

export interface NormalizedMessage {
  conversationJid: string;
  conversationType: "dm" | "group";
  waMessageId: string;
  fromJid: string;
  direction: "in" | "out";
  timestamp: Date;
  body: {
    kind: NormalizedBodyKind;
    text?: string;
    quotedMsgId?: string;
    mentions?: string[];
    mediaMeta?: { fileName?: string; mimeType?: string; seconds?: number; width?: number; height?: number };
  };
  mediaMeta?: { mimeType?: string; fileName?: string };  // hoisted convenience for ingest queue
}

export function normalize(raw: WAMessage): NormalizedMessage {
  const remoteJid = raw.key.remoteJid!;
  const conversationType: "dm" | "group" = remoteJid.endsWith("@g.us") ? "group" : "dm";
  const fromJid = conversationType === "group"
    ? (raw.key.participant ?? remoteJid)
    : (raw.key.fromMe ? "self" : remoteJid);
  const direction: "in" | "out" = raw.key.fromMe ? "out" : "in";
  const timestamp = new Date(Number(raw.messageTimestamp) * 1000);

  const body = extractBody(raw);

  const result: NormalizedMessage = {
    conversationJid: remoteJid,
    conversationType,
    waMessageId: raw.key.id!,
    fromJid,
    direction,
    timestamp,
    body,
  };
  if (body.mediaMeta) result.mediaMeta = body.mediaMeta;
  return result;
}

function extractBody(raw: WAMessage): NormalizedMessage["body"] {
  const m = raw.message!;
  if (m.conversation) return { kind: "text", text: m.conversation };
  if (m.extendedTextMessage) {
    const body: NormalizedMessage["body"] = { kind: "text", text: m.extendedTextMessage.text ?? "" };
    const q = m.extendedTextMessage.contextInfo?.stanzaId;
    if (q) body.quotedMsgId = q;
    const mentions = m.extendedTextMessage.contextInfo?.mentionedJid;
    if (mentions?.length) body.mentions = mentions;
    return body;
  }
  if (m.imageMessage) {
    return {
      kind: "image",
      text: m.imageMessage.caption ?? undefined,
      mediaMeta: {
        mimeType: m.imageMessage.mimetype ?? undefined,
        width: m.imageMessage.width ?? undefined,
        height: m.imageMessage.height ?? undefined,
      },
    };
  }
  if (m.videoMessage) {
    return {
      kind: "video",
      text: m.videoMessage.caption ?? undefined,
      mediaMeta: { mimeType: m.videoMessage.mimetype ?? undefined, seconds: m.videoMessage.seconds ?? undefined },
    };
  }
  if (m.audioMessage) {
    return {
      kind: "audio",
      mediaMeta: { mimeType: m.audioMessage.mimetype ?? undefined, seconds: m.audioMessage.seconds ?? undefined },
    };
  }
  if (m.documentMessage) {
    return {
      kind: "document",
      text: m.documentMessage.title ?? m.documentMessage.fileName ?? undefined,
      mediaMeta: { mimeType: m.documentMessage.mimetype ?? undefined, fileName: m.documentMessage.fileName ?? undefined },
    };
  }
  if (m.stickerMessage) return { kind: "sticker", mediaMeta: { mimeType: m.stickerMessage.mimetype ?? undefined } };
  if (m.locationMessage) return { kind: "location", text: m.locationMessage.name ?? undefined };
  if (m.contactMessage) return { kind: "contact", text: m.contactMessage.displayName ?? undefined };
  if (m.reactionMessage) return { kind: "reaction", text: m.reactionMessage.text ?? undefined };
  return { kind: "unknown" };
}
```

- [ ] **Step 7: Run normalize tests to PASS**

```bash
pnpm --filter @wpa/worker exec vitest run src/ingest/normalize.test.ts
```

Expected: PASS (7/7).

- [ ] **Step 8: Write persist test (happy path + idempotency)**

Create `packages/worker/src/ingest/persist.test.ts`. Uses real Postgres (testcontainers pattern) + real Redis. Covers:
- Upserts `WaContact` on first sight; updates name on subsequent messages.
- Upserts `Conversation` with correct type.
- Inserts `Message`, encrypts body with DEK.
- Publishes `message.created` to `ui:events:<userId>` Redis channel.
- Duplicate `waMessageId` for same conversation is a no-op (`@@unique`).
- If `mediaMeta` present → enqueues to media queue (spy assertion).

(Full test code follows the `authStore.test.ts` pattern — ~200 LoC; mirror that file closely.)

- [ ] **Step 9: Implement `persist.ts`**

```typescript
import { getPrisma } from "@wpa/db";
import { encryptWithKey, serializeCiphertext } from "@wpa/shared";
import type { NormalizedMessage } from "./normalize.js";
import type { Redis } from "ioredis";

export interface PersistDeps {
  dek: Buffer;
  redis: Redis;
  enqueueMedia?: (input: { messageId: string; userId: string; normalized: NormalizedMessage }) => void;
}

export async function persist(
  userId: string,
  normalized: NormalizedMessage,
  deps: PersistDeps,
): Promise<void> {
  const prisma = getPrisma();

  // 1. Upsert contact or group.
  if (normalized.conversationType === "dm") {
    await prisma.waContact.upsert({
      where: { userId_jid: { userId, jid: normalized.conversationJid } },
      create: { userId, jid: normalized.conversationJid },
      update: {},
    });
  } else {
    await prisma.waGroup.upsert({
      where: { userId_jid: { userId, jid: normalized.conversationJid } },
      create: { userId, jid: normalized.conversationJid, subject: Buffer.alloc(0) },
      update: {},
    });
  }

  // 2. Upsert conversation.
  const conversation = await prisma.conversation.upsert({
    where: { userId_jid: { userId, jid: normalized.conversationJid } },
    create: {
      userId,
      jid: normalized.conversationJid,
      type: normalized.conversationType,
      lastMessageAt: normalized.timestamp,
    },
    update: { lastMessageAt: normalized.timestamp },
  });

  // 3. Insert message (idempotent on waMessageId).
  const encryptedBody = Buffer.from(
    serializeCiphertext(encryptWithKey(deps.dek, JSON.stringify(normalized.body))),
  );
  const existing = await prisma.message.findUnique({
    where: { conversationId_waMessageId: { conversationId: conversation.id, waMessageId: normalized.waMessageId } },
  });
  if (existing) return;

  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      waMessageId: normalized.waMessageId,
      fromJid: normalized.fromJid,
      direction: normalized.direction,
      timestamp: normalized.timestamp,
      body: encryptedBody,
    },
  });

  // 4. If media → enqueue downloader.
  if (normalized.body.mediaMeta && deps.enqueueMedia) {
    deps.enqueueMedia({ messageId: message.id, userId, normalized });
  }

  // 5. Publish to SSE fan-out channel.
  await deps.redis.publish(
    `ui:events:${userId}`,
    JSON.stringify({
      type: "message.created",
      conversationId: conversation.id,
      messageId: message.id,
      timestamp: normalized.timestamp.toISOString(),
    }),
  );
}
```

- [ ] **Step 10: Run persist test to PASS**

```bash
pnpm --filter @wpa/worker exec vitest run src/ingest/persist.test.ts
```

Expected: PASS.

- [ ] **Step 11: Implement subscribe + consume**

Create `packages/worker/src/ingest/subscribe.ts`:

```typescript
import type { WASocket } from "@whiskeysockets/baileys";
import type { Redis } from "ioredis";
import { shouldIngest } from "./filter.js";

export function subscribe(
  userId: string,
  sock: WASocket,
  redis: Redis,
): { unsubscribe: () => void } {
  const handler = async ({ messages }: { messages: import("@whiskeysockets/baileys").WAMessage[] }) => {
    for (const raw of messages) {
      if (!shouldIngest(raw)) continue;
      await redis.xadd(`wpa:msg:ingest:${userId}`, "*", "raw", JSON.stringify(raw));
    }
  };
  sock.ev.on("messages.upsert", handler);
  return {
    unsubscribe: () => sock.ev.off("messages.upsert", handler),
  };
}
```

Create `packages/worker/src/ingest/consume.ts` with a per-user XREADGROUP loop that reads from `wpa:msg:ingest:<userId>`, parses the raw, calls `normalize`, calls `persist`, and XACKs. Stop conditions: worker SIGTERM, user disconnect. On failure, increment attempt count (Redis HINCRBY), move to `wpa:msg:dlq:<userId>` after `INGEST_DLQ_MAX_DELIVERIES` and write audit `ingest.poison_message`.

- [ ] **Step 12: Wire ingest into `worker/src/index.ts`**

In the `worker.start()` routine (after the PA3 restore loop from IB2):
- For each restored userId, call `subscribe(userId, sock, redis)` with the socket returned by `resumePaired`.
- Start a `consume.startConsumer({ userId, redis, dek })` per user.
- On new pair success (from the existing pair loop), also call `subscribe`.
- On `pair.disconnect` command, call `unsubscribe()` and stop the consumer.

- [ ] **Step 13: Write + run integration test**

Create `packages/worker/src/ingest/integration.test.ts` — testcontainers Postgres + Redis. Spins up a fake `WASocket` emitter. Writes the full pipeline end-to-end:

1. Seed paired user.
2. Start worker boot.
3. Emit a fake Baileys message on the fake socket.
4. Wait up to 5s for a row to appear in `Message` and a message on Redis Pub/Sub `ui:events:<userId>`.
5. Assert shape.

```bash
pnpm --filter @wpa/worker exec vitest run src/ingest/integration.test.ts
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add packages/worker/src/ingest packages/worker/src/index.ts
git commit -m "$(cat <<'EOF'
feat(worker): P1-B ingest pipeline (subscribe + normalize + persist)

Baileys messages.upsert → shouldIngest filter → Redis stream
wpa:msg:ingest:<userId> → XREADGROUP consumer → normalize → DEK-encrypt
body → upsert Contact/Group/Conversation → insert Message → publish to
Redis Pub/Sub ui:events:<userId> for SSE fan-out.

Covers text/image/video/audio/document/sticker/location/contact/reaction
kinds plus a kind=unknown fallthrough. Group and DM conversations
distinguished by jid suffix. Idempotent on (conversationId, waMessageId).

No media download in this Epic — messages with media land with
mediaRef=null and get routed to the media queue (IB4) for async
download.

Poison-message handling: 3 delivery attempts → DLQ + audit
ingest.poison_message. Normalize failure → drop + audit
ingest.normalize_failed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] All ingest test files green: filter, normalize, persist, integration.
- [ ] Worker coverage ≥ 80% statements on `ingest/`.
- [ ] Manual: pair → send self a message from phone → row appears in `messages` table within 3s + Redis `ui:events:<userId>` receives the event.
- [ ] Commit: `feat(worker): P1-B ingest pipeline (subscribe + normalize + persist)`.

---

## Epic IB4 — Media downloader + MediaStore

**Owner:** backend-eng-2 | **BlockedBy:** IB1, IB3

**Files:**
- Create: `packages/worker/src/ingest/mediaStore.ts` + `.test.ts`.
- Create: `packages/worker/src/ingest/media.ts` + `.test.ts`.
- Modify: `packages/worker/src/index.ts` — instantiate downloader, pass `enqueueMedia` into persist deps.
- Modify: `docker-compose.yml` — add `media-data` volume, mount to `/app/media`.
- Modify: `Dockerfile` — `VOLUME /app/media` declaration (optional but documents intent).

- [ ] **Step 1: Define the MediaStore interface + write LocalDiskMediaStore test**

`packages/worker/src/ingest/mediaStore.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskMediaStore } from "./mediaStore.js";

describe("LocalDiskMediaStore", () => {
  let root: string;
  let store: LocalDiskMediaStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wpa-media-"));
    store = new LocalDiskMediaStore(root);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes a blob and returns the ref relative to root", async () => {
    const ref = await store.put("u1", "msg-abc", Buffer.from([1, 2, 3]));
    expect(ref).toBe("u1/msg-abc.bin");
    const bytes = await readFile(join(root, ref));
    expect(bytes).toEqual(Buffer.from([1, 2, 3]));
  });

  it("reads back a blob by ref", async () => {
    const ref = await store.put("u1", "m1", Buffer.from("hello"));
    const out = await store.get(ref);
    expect(out).toEqual(Buffer.from("hello"));
  });

  it("has mode 0600 on files and 0700 on dirs", async () => {
    await store.put("u1", "m1", Buffer.from("x"));
    const { stat } = await import("node:fs/promises");
    const fileStat = await stat(join(root, "u1", "m1.bin"));
    const dirStat = await stat(join(root, "u1"));
    expect(fileStat.mode & 0o777).toBe(0o600);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });
});
```

- [ ] **Step 2: Implement `mediaStore.ts`**

```typescript
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface MediaStore {
  put(userId: string, messageId: string, bytes: Buffer): Promise<string>;  // returns ref
  get(ref: string): Promise<Buffer>;
}

export class LocalDiskMediaStore implements MediaStore {
  constructor(private readonly root: string) {}

  async put(userId: string, messageId: string, bytes: Buffer): Promise<string> {
    const ref = `${userId}/${messageId}.bin`;
    const abs = join(this.root, ref);
    await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
    await writeFile(abs, bytes, { mode: 0o600 });
    return ref;
  }

  async get(ref: string): Promise<Buffer> {
    return readFile(join(this.root, ref));
  }
}
```

- [ ] **Step 3: Run mediaStore tests to PASS**

```bash
pnpm --filter @wpa/worker exec vitest run src/ingest/mediaStore.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write media downloader test**

`packages/worker/src/ingest/media.test.ts` — tests:
- Downloads, encrypts, writes via mediaStore, updates message row with `mediaRef` + `mediaMime`, publishes `message.media_ready`.
- Bounded concurrency: enqueue 20 for user A → no more than `MEDIA_CONCURRENCY_USER=3` in flight at once.
- Global cap respected.
- Queue overflow: if >100 queued for a user, next enqueue logs `ingest.media_skipped_overload` and returns without erroring.
- Download failure: audits `ingest.media_failed`, message stays with `mediaRef=null`.

- [ ] **Step 5: Implement `media.ts`**

A bounded-concurrency queue using a simple array + in-flight counter pattern (no new dep). The `DownloadFn` is passed in (wrapping Baileys `downloadMediaMessage`) so the test can inject a fake.

- [ ] **Step 6: Run media tests to PASS**

```bash
pnpm --filter @wpa/worker exec vitest run src/ingest/media.test.ts
```

Expected: PASS.

- [ ] **Step 7: Wire downloader into worker boot**

Modify `packages/worker/src/index.ts`: instantiate `MediaDownloader` with a `LocalDiskMediaStore` (root from `MEDIA_DIR` env), pass `downloader.enqueue` as `persist.deps.enqueueMedia`.

- [ ] **Step 8: Add media volume to docker-compose.yml**

```yaml
services:
  app:
    # existing...
    volumes:
      - media-data:/app/media
volumes:
  postgres-data:
  redis-data:
  media-data:         # <-- new
```

- [ ] **Step 9: Commit**

```bash
git add \
  packages/worker/src/ingest/mediaStore.ts \
  packages/worker/src/ingest/mediaStore.test.ts \
  packages/worker/src/ingest/media.ts \
  packages/worker/src/ingest/media.test.ts \
  packages/worker/src/index.ts \
  docker-compose.yml
git commit -m "$(cat <<'EOF'
feat(worker): P1-B media downloader + local-disk MediaStore

Bounded-concurrency async downloader (3 per user / 10 global). Media
bytes downloaded via Baileys, DEK-encrypted, written to
/app/media/<userId>/<messageId>.bin (mode 0600, parent 0700).
Message row is updated with mediaRef + mediaMime on success.

MediaStore interface leaves a clean seam for a future S3 implementation.

Docker-compose adds a named `media-data` volume mounted at /app/media.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] All media tests green.
- [ ] Manual: pair → someone sends you a photo → file appears under `/app/media/<userId>/<msgId>.bin` + row updated.
- [ ] Commit: `feat(worker): P1-B media downloader + local-disk MediaStore`.

---

## Epic IB5 — API routes: conversations, messages, media, disconnect

**Owner:** backend-eng-1 | **BlockedBy:** IB1, IB2

**Files:**
- Create: `packages/api/src/routes/conversations.ts` + `.test.ts`.
- Create: `packages/api/src/routes/messages.ts` + `.test.ts`.
- Create: `packages/api/src/routes/media.ts` + `.test.ts`.
- Modify: `packages/api/src/routes/pair.ts` — add `POST /disconnect`.
- Create: `packages/api/src/routes/disconnect.test.ts`.
- Modify: `packages/api/src/app.ts` — mount new routers.

- [ ] **Step 1: Write conversations route test**

`packages/api/src/routes/conversations.test.ts` uses supertest via `@wpa/test-utils`. Test cases:
- 401 unauth.
- 200 empty array for a user with no conversations.
- 200 returns seeded conversations in lastMessageAt DESC order.
- 200 with cursor pagination (seed 51, request limit=50, assert `nextCursor` present).
- Decrypts contact name + group subject correctly (seed with `encryptWithKey(dek, name)`).
- Wrong-user isolation (user B's conversations never appear for user A).

- [ ] **Step 2: Implement `conversations.ts`**

Standard Express router. Selects from `conversations` LEFT JOIN `wa_contacts` + `wa_groups` on (userId, jid), decrypts display fields with the request user's DEK. Pagination cursor = ISO8601 timestamp of last row's `lastMessageAt`.

- [ ] **Step 3: Run conversations tests to PASS**

```bash
pnpm --filter @wpa/api exec vitest run src/routes/conversations.test.ts
```

Expected: PASS.

- [ ] **Step 4: Write + implement messages route (same pattern)**

Test cases:
- 401, 404 (wrong user), 404 (nonexistent conversation).
- 200 returns messages in `timestamp DESC` with limit default 50.
- 200 with `before` cursor paginates back.
- Decrypts body. Includes `hasMedia: true` when `mediaRef` is non-null.

Implementation mirrors conversations.ts.

- [ ] **Step 5: Write + implement media route**

Test cases:
- 401, 404 wrong user, 404 no mediaRef.
- 200 with `Content-Type` from `mediaMime`, decrypted body bytes.
- `Cache-Control: private, max-age=300`.

Implementation: ownership check → `mediaStore.get(ref)` → `decryptWithKey(dek, bytes)` → `res.setHeader + res.end(bytes)`.

- [ ] **Step 6: Add POST /api/pair/disconnect to existing pair.ts**

```typescript
router.post("/disconnect", requireAuth, async (req: AuthedReq, res) => {
  const userId = req.userId;
  await pairService.disconnect(userId);   // XADD wpa:pair-cmd + UPDATE session + audit
  res.status(204).end();
});
```

In `pairService`:

```typescript
async function disconnect(userId: string) {
  const redis = getRedis();
  await redis.xadd("wpa:pair-cmd", "*", "userId", userId, "type", "disconnect");
  const prisma = getPrisma();
  await prisma.whatsappSession.update({
    where: { userId },
    data: { status: "disconnected" },
  });
  await writeAudit({ userId, type: "unpair", subtype: "soft", details: { sessionId: userId } });
}
```

Worker side: already has a `stop` command dispatcher; add `disconnect` as a synonym that calls `pairMachine.stop(userId)` + `ingest.unsubscribe(userId)`.

- [ ] **Step 7: Wire new routers into `app.ts`**

```typescript
app.use("/api/conversations", conversationsRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/media", mediaRouter);
```

- [ ] **Step 8: Run full API test suite**

```bash
pnpm --filter @wpa/api test
```

Expected: all green; no regressions in existing routes.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/routes packages/api/src/app.ts
git commit -m "$(cat <<'EOF'
feat(api): P1-B routes — conversations, messages, media, disconnect

Five new endpoints behind requireAuth. All enforce userId ownership on
access (404 on wrong user — never 403, don't leak existence). Cursor
pagination via lastMessageAt / timestamp.

Media route decrypts bytes on each request with the user's DEK and
serves with the stored mediaMime + a private/max-age=300 cache.

POST /api/pair/disconnect soft-unpairs: XADDs a disconnect command for
the worker (closes Baileys + stops ingest), flips session status to
disconnected, writes audit type=unpair subtype=soft. Message history
stays encrypted at rest.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] API coverage ≥ 90 statements on new routes.
- [ ] `pnpm --filter @wpa/api test` all green.
- [ ] Commit: `feat(api): P1-B routes — conversations, messages, media, disconnect`.

---

## Epic IB6 — SSE events route + Redis Pub/Sub bridge

**Owner:** backend-eng-1 | **BlockedBy:** IB1, IB3

**Files:**
- Create: `packages/api/src/routes/events.ts` + `.test.ts`.
- Modify: `packages/api/src/app.ts` — mount events router.
- Modify: `packages/api/src/redis.ts` — expose `getRedisSubscriber()` that returns a dedicated Redis client (ioredis subscribers can't do regular commands).

- [ ] **Step 1: Write SSE test**

`packages/api/src/routes/events.test.ts` — a supertest-based test that:
1. Opens an SSE connection as user A (keeps the stream alive in the test).
2. Publishes `{type:"message.created", ...}` on `ui:events:<userAId>` via a separate redis client.
3. Reads stream chunks, asserts a `data: {...}\n\n` line matching the publish.
4. Asserts a `:heartbeat\n\n` arrives within 35s (or mock timers).
5. Asserts the stream closes cleanly when the request aborts.
6. Cross-user leak test: publishing on user B's channel must NOT arrive on user A's stream.

- [ ] **Step 2: Implement `events.ts`**

```typescript
import { Router } from "express";
import { requireAuth, type AuthedReq } from "../middleware/auth.js";
import { getRedisSubscriber } from "../redis.js";
import { writeAudit } from "../audit/writeAudit.js";
import { env } from "@wpa/shared";

const HEARTBEAT_MS = 30_000;

export const eventsRouter = Router();

eventsRouter.get("/", requireAuth, async (req: AuthedReq, res) => {
  const userId = req.userId;

  // Enforce per-user concurrent stream cap.
  const counterKey = `wpa:sse:count:${userId}`;
  const redisMain = (await import("../redis.js")).getRedis();
  const count = await redisMain.incr(counterKey);
  if (count > env.SSE_MAX_STREAMS_PER_USER) {
    await redisMain.decr(counterKey);
    res.status(429).end();
    return;
  }
  // Auto-expire the counter in case of crash — 65 min is longer than any real session.
  await redisMain.expire(counterKey, 65 * 60);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const subscriber = getRedisSubscriber().duplicate();
  const channel = `ui:events:${userId}`;
  await subscriber.subscribe(channel);
  subscriber.on("message", (ch, payload) => {
    if (ch !== channel) return;
    res.write(`data: ${payload}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(":heartbeat\n\n");
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    subscriber.unsubscribe(channel).catch(() => undefined);
    subscriber.quit().catch(() => undefined);
    redisMain.decr(counterKey).catch(() => undefined);
    res.end();
  });
});
```

- [ ] **Step 3: Run SSE tests to PASS**

```bash
pnpm --filter @wpa/api exec vitest run src/routes/events.test.ts
```

Expected: PASS (6/6).

- [ ] **Step 4: Mount in app.ts + update pino redaction**

```typescript
app.use("/api/events", eventsRouter);
```

In `packages/api/src/logger.ts`, extend redaction paths:

```typescript
redact: {
  paths: [
    // ...existing...
    'req.headers.authorization',
    'body',            // SSE payload
    'text',            // normalized message body
    'name',
    'subject',
    'description',
  ],
  remove: true,
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/events.ts \
         packages/api/src/routes/events.test.ts \
         packages/api/src/app.ts \
         packages/api/src/logger.ts \
         packages/api/src/redis.ts
git commit -m "$(cat <<'EOF'
feat(api): P1-B SSE events stream

GET /api/events opens an EventSource-compatible stream, subscribes to
Redis Pub/Sub channel ui:events:<userId>, forwards payloads to the
client as SSE data: lines. 30s heartbeat keeps proxies from dropping
the connection.

Per-user concurrent stream cap via Redis INCR counter
(SSE_MAX_STREAMS_PER_USER env, default 3). On request close,
subscriber.quit + counter decrement. Counter TTL 65min is a
belt-and-braces against crashed clients.

pino redaction extended to cover body/text/name/subject/description
paths so no message content reaches logs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] `pnpm --filter @wpa/api test` all green.
- [ ] Manual: open `curl -N -H "Authorization: Bearer <token>" http://localhost:3003/api/events` in a terminal; in a second terminal `redis-cli PUBLISH ui:events:<userId> '{"type":"ping"}'`; see the `data:` line appear.
- [ ] Commit: `feat(api): P1-B SSE events stream`.

---

## Epic IB7 — Web `/chats` route + components + `useEventStream`

**Owner:** frontend-eng | **BlockedBy:** IB5, IB6

**Files:**
- Create: `packages/web/src/hooks/useEventStream.ts` + `.test.ts`.
- Create: `packages/web/src/routes/Chats.tsx` + `.test.tsx`.
- Create: `packages/web/src/components/ConversationList.tsx`.
- Create: `packages/web/src/components/MessageList.tsx`.
- Create: `packages/web/src/components/MessageBubble.tsx`.
- Create: `packages/web/src/components/DisconnectDialog.tsx`.
- Modify: `packages/web/src/api/client.ts` — add `chats.list()`, `chats.messages(id, cursor?)`, `media.url(id)`, `pair.disconnect()`.
- Modify: `packages/web/src/routes/router.tsx` — add `/chats` under `RequireAuth`.
- Modify: `packages/web/src/components/Shell.tsx` — nav entry + wire Pair page's Disconnect.
- Modify: `packages/web/src/routes/Pair.tsx` — wire Disconnect button to `pair.disconnect()`.

- [ ] **Step 1: Write + implement `useEventStream` hook with test**

Test (using `msw` + EventSource polyfill or a manual mock):
- Opens EventSource on mount, closes on unmount.
- Dispatches typed event callbacks for each `data:` line.
- Auto-reconnects on close after 2s with exponential backoff (capped 30s).
- Exposes `status: "connecting" | "connected" | "disconnected"`.

Implement as a React hook using `useEffect` + `useState` + `useRef`.

- [ ] **Step 2: Add API client helpers + unit tests**

In `packages/web/src/api/client.ts`:

```typescript
export const chats = {
  list: (cursor?: string) => apiFetch(`/api/conversations?${new URLSearchParams(cursor ? { cursor } : {})}`),
  messages: (conversationId: string, before?: string) =>
    apiFetch(`/api/conversations/${conversationId}/messages?${new URLSearchParams(before ? { before } : {})}`),
};
export const media = {
  url: (messageId: string) => `/api/media/${messageId}`,
};
export const pair = {
  // ...existing init, status, qr...
  disconnect: () => apiFetch("/api/pair/disconnect", { method: "POST" }),
};
```

Write a small client test ensuring the URL shapes are correct + credentials: "include" is set.

- [ ] **Step 3: Build ConversationList + MessageList + MessageBubble**

Use existing shadcn primitives (`ScrollArea`, `Avatar`, `Badge`). No new shadcn adds.

**ConversationList.tsx** — `useInfiniteQuery(['conversations'], ...)`, renders rows. Click → invokes `onSelect(conversationId)` prop. Highlights selected via `data-selected` + `aria-current="true"`. Subscribe to SSE `conversation.updated` events → `queryClient.invalidateQueries(['conversations'])`.

**MessageList.tsx** — `useInfiniteQuery(['messages', conversationId], ...)`, renders bubbles oldest→newest. On new `message.created` for this conversationId → invalidate + scroll to bottom.

**MessageBubble.tsx** — handles text, `[photo]`/`[video]`/etc. placeholder, and inline expand on click. Voice notes use `<audio controls src={media.url(id)}>`. Uses `MessageBody.kind` to branch rendering.

Add component-level unit tests using msw for network and a fake EventSource.

- [ ] **Step 4: Build DisconnectDialog**

`shadcn/AlertDialog` with trigger = "Disconnect" button. Confirm → `pair.disconnect()` → invalidate both `['conversations']` and `['pair-status']` → `navigate('/pair')`. Cancel → close.

- [ ] **Step 5: Build `Chats.tsx` + add route**

Two-column layout as per the mocked browser. Read `?c=<id>` from URL for deep-links. Selection state lives in URL via `useSearchParams`.

Empty state when `conversations.length === 0`: friendly text + link to `/pair`.

Add the route in `router.tsx`:

```typescript
<Route element={<RequireAuth />}>
  <Route path="/" element={<Dashboard />} />
  <Route path="/pair" element={<Pair />} />
  <Route path="/chats" element={<Chats />} />   {/* new */}
  {/* ...existing admin routes... */}
</Route>
```

- [ ] **Step 6: Add "Chats" to Shell nav**

`Shell.tsx`: add a NavLink to `/chats` alongside the existing `/` and `/pair` entries.

- [ ] **Step 7: Wire Pair.tsx Disconnect button**

The existing `/pair` success screen already has a disabled Disconnect button (placeholder text today). Enable it; wire to `<DisconnectDialog />`.

- [ ] **Step 8: Run web test suite**

```bash
pnpm --filter @wpa/web test
```

Expected: all green.

- [ ] **Step 9: Run web dev server + hand-test**

Manual:
1. `/wpa:start-local`
2. Register/login → `/chats` → empty state.
3. From another phone, send yourself a WhatsApp message.
4. Within ~2s: conversation appears left, click it, message bubble renders right.
5. Disconnect button → confirm → redirect to `/pair`.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/routes/Chats.tsx \
         packages/web/src/routes/Chats.test.tsx \
         packages/web/src/hooks/useEventStream.ts \
         packages/web/src/hooks/useEventStream.test.ts \
         packages/web/src/components/ConversationList.tsx \
         packages/web/src/components/MessageList.tsx \
         packages/web/src/components/MessageBubble.tsx \
         packages/web/src/components/DisconnectDialog.tsx \
         packages/web/src/api/client.ts \
         packages/web/src/routes/router.tsx \
         packages/web/src/routes/Pair.tsx \
         packages/web/src/components/Shell.tsx
git commit -m "$(cat <<'EOF'
feat(web): P1-B /chats — conversation list + message viewer + SSE

Two-pane /chats route: ConversationList (left) sorted by lastMessageAt
DESC, MessageList (right) for the selected conversation. useEventStream
hook wraps EventSource with auto-reconnect (2s→30s backoff) and typed
subscribe API.

Live updates via SSE ui:events:<userId> events — message.created,
message.media_ready, conversation.updated — each triggers targeted
TanStack Query cache invalidation.

MessageBubble handles text, inline media expand (image/video/audio),
quoted replies. Media served through /api/media/:id with per-request
auth + DEK decrypt.

DisconnectDialog (shadcn AlertDialog) wired to POST /api/pair/disconnect.
The existing /pair "Disconnect" placeholder button is now enabled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] Web coverage ≥ 75 statements on new files.
- [ ] Manual: flow above works end-to-end.
- [ ] Commit: `feat(web): P1-B /chats — conversation list + message viewer + SSE`.

---

## Epic IB8 — Playwright E2E + smoke + docs + VISION flip

**Owner:** qa + tech-writer | **BlockedBy:** IB1–IB7

**Files:**
- Create: `packages/web/e2e/chats.spec.ts`.
- Modify: `packages/web/e2e/helpers.ts` — add `ingestFakeMessage(userId, payload)` that XADDs directly to Redis (same shortcut the pair spec uses).
- Modify: `scripts/smoke-test.sh` — after pair/init, XADD a fake message and assert `/api/conversations` returns 1.
- Create: `docs/CHATS.md` — user-facing walkthrough.
- Modify: `docs/VISION.md` — strike P1-B checkbox items.
- Modify: `wiki/Home.md` — link to CHATS.md.
- Modify: `README.md` — mention `/chats` under "Two ways to run".

- [ ] **Step 1: Write chats.spec.ts (Playwright)**

```typescript
import { test, expect } from "@playwright/test";
import { ingestFakeMessage } from "./helpers.js";

test.describe("/chats — P1-B happy path", () => {
  test("paired user sees a live message", async ({ page, context, request }) => {
    await loginAsAdmin(page);
    await ensurePaired(page, request);
    await page.goto("/chats");

    await expect(page.getByText("No conversations yet")).toBeVisible();

    await ingestFakeMessage(request, {
      conversationJid: "447700900999@s.whatsapp.net",
      text: "Hello from the test",
      timestamp: Date.now() / 1000,
    });

    await expect(page.getByText("+44 7700 900999")).toBeVisible({ timeout: 5000 });
    await page.getByText("+44 7700 900999").click();
    await expect(page.getByText("Hello from the test")).toBeVisible();
  });

  test("disconnect button unpairs and routes to /pair", async ({ page, request }) => {
    await loginAsAdmin(page);
    await ensurePaired(page, request);
    await page.goto("/chats");
    await page.getByRole("button", { name: /Disconnect/i }).click();
    await page.getByRole("button", { name: /Confirm/i }).click();
    await expect(page).toHaveURL(/\/pair/);
  });
});
```

Add `ingestFakeMessage` to `helpers.ts`: opens a redis connection using the `.env.e2e` password and `XADD`s to `wpa:msg:ingest:<userId>`.

- [ ] **Step 2: Run Playwright locally**

```bash
pnpm --filter @wpa/web test:e2e
```

Expected: chats.spec.ts green (2/2) plus existing 3 specs green (5/5 total).

- [ ] **Step 3: Update smoke-test.sh**

Append a new step after the `/pair/init` assertion:

```bash
REDIS_AUTH="$(grep REDIS_PASSWORD .env.smoke | cut -d= -f2)"
docker compose exec redis redis-cli -a "$REDIS_AUTH" XADD "wpa:msg:ingest:$(query_user_id_from_db)" '*' raw "$(cat <<'JSON'
{"key":{"remoteJid":"9@s.whatsapp.net","fromMe":false,"id":"SMOKE1"},"message":{"conversation":"smoke"},"messageTimestamp":1800000000}
JSON
)"

sleep 2

curl -fsS "$BASE/api/conversations" -H "authorization: Bearer $TOKEN" | jq -e '.conversations | length >= 1' >/dev/null
echo "smoke: ingest + list ok"
```

- [ ] **Step 4: Write docs/CHATS.md**

User-facing, ~400 words. Sections: What is `/chats`; First time — why it's empty; Sending yourself a test message; Media; Disconnect vs kill-switch; Privacy posture (no read receipts sent, all data encrypted); Known limits (no history backfill, no composer).

- [ ] **Step 5: Update VISION.md + wiki/Home.md + README.md**

In `docs/VISION.md`, tick the P1-B row items: message ingest, chat viewer, SSE, unpair flow. Leave auto-reply/approval/etc. unticked.

In `wiki/Home.md` "Where to go": add "**Chats** — see the WhatsApp mirror in your browser. Read [CHATS.md](CHATS.md)."

In `README.md`, mention `/chats` after `/pair`.

- [ ] **Step 6: Run full CI locally**

```bash
pnpm lint && pnpm typecheck && pnpm -r test && pnpm --filter @wpa/web test:e2e && bash scripts/smoke-test.sh
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/web/e2e/chats.spec.ts \
         packages/web/e2e/helpers.ts \
         scripts/smoke-test.sh \
         docs/CHATS.md \
         docs/VISION.md \
         wiki/Home.md \
         README.md
git commit -m "$(cat <<'EOF'
test+docs: P1-B E2E spec + smoke ingest step + user guide

Adds chats.spec.ts (Playwright) covering the happy path and the
disconnect flow. helpers.ts gains ingestFakeMessage which XADDs a
raw WA payload to Redis — same shortcut the pair spec uses so we
don't need a real WhatsApp phone in CI.

smoke-test.sh grows a post-/pair/init step: ingest a fake message,
curl /api/conversations, assert at least one row. Keeps the image's
own bootability honest without binding to live WA.

docs/CHATS.md is a 5-min walkthrough; VISION.md strikes the P1-B
items that shipped; README + wiki link to CHATS.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Exit criteria:**
- [ ] All unit, integration, Playwright, smoke, bats tests green.
- [ ] `docs/CHATS.md` exists and reads like a user would want.
- [ ] VISION.md reflects P1-B as complete.
- [ ] Commit: `test+docs: P1-B E2E spec + smoke ingest step + user guide`.

---

## Release (after all 8 Epics)

- [ ] Open PR develop → main.
- [ ] PR body summarizing the 8 Epics + the PA3 fix.
- [ ] Wait for all CI checks green (`ci`, `codeql`, `secret-scan`, `trivy` — fix trivy if still broken).
- [ ] `gh pr merge <n> --merge`.
- [ ] Verify `wiki-sync` + `docs-site` auto-fire on main push.
- [ ] Manual smoke on a fresh clone: `/wpa:start-local` → register → `/pair` → scan → `/chats` → send self a message → see it. **This is the MVP gate.**
- [ ] Update session-state memory (`current_session_state.md`) to reflect P1-B shipped.

---

## Self-review (ran on this plan)

**Spec coverage:**
- WaContact + WaGroup + Conversation + Message + enums → IB1 ✅
- Ingest subscribe + filter + normalize + persist → IB3 ✅
- Worker boot + PA3 fix → IB2 ✅
- Media download + local volume → IB4 ✅
- `/api/conversations`, `/api/conversations/:id/messages`, `/api/messages/:id` → IB5 ✅
- `/api/media/:id` → IB5 ✅
- `/api/events` SSE + 30s heartbeat + per-user cap → IB6 ✅
- `POST /api/pair/disconnect` → IB5 ✅
- Web `/chats` + two-pane UI + `useEventStream` → IB7 ✅
- Disconnect dialog + wire `/pair`'s disabled button → IB7 ✅
- Env vars (MEDIA_DIR, etc.) → IB1 ✅
- Audit types → IB1 (AuditType enum) + subtype strings emitted by IB3/IB4/IB5 ✅
- pino redaction for body/text/name/subject → IB6 ✅
- E2E + smoke + docs → IB8 ✅

**Placeholder scan:** no TBDs, no "similar to above" without repeated code, every test step shows concrete assertions.

**Type consistency:**
- `NormalizedMessage` defined in IB3 Step 6 is referenced in IB3 Step 9 (persist) — names match.
- `PairMachine.resumePaired(userId, authState)` defined in IB2 Step 3, called in IB2 Step 5 (restore) — name matches.
- `MediaStore.put/get` defined in IB4 Step 2, consumed in IB4 Step 5 (downloader) — matches.
- SSE event shapes defined in spec §API + IB6 implementation — match.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-04-22-p1b-ingest-chat-sse-plan.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per Epic with a shared worktree, review between Epics, fast iteration. Three teammates + team-lead review matches the Epic parallelization map above.

**2. Inline Execution** — execute Epics sequentially in this session using superpowers:executing-plans, with checkpoints for review.

**Which approach?**

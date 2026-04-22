-- P1-B ingest schema — idempotent on purpose.
--
-- Safety: this migration clears any prior partial P1-B state (from earlier
-- IB1 iterations that used PascalCase tables, or from any partial apply)
-- before creating the final snake_case schema. All DROP IF EXISTS guards
-- are no-ops on a fresh database.
--
-- Recovery from a failed prior attempt:
--   docker compose exec app pnpm --filter @wpa/db exec \
--     prisma migrate resolve --rolled-back 20260422194628_p1b_ingest
-- then restart the app; this migration will re-run cleanly.

-- DropStaleTables (old PascalCase naming from pre-@@map IB1 iterations).
DROP TABLE IF EXISTS "Message" CASCADE;
DROP TABLE IF EXISTS "Conversation" CASCADE;
DROP TABLE IF EXISTS "WaContact" CASCADE;
DROP TABLE IF EXISTS "WaGroup" CASCADE;

-- DropStaleTables (current snake_case — partial-apply recovery).
DROP TABLE IF EXISTS "messages" CASCADE;
DROP TABLE IF EXISTS "conversations" CASCADE;
DROP TABLE IF EXISTS "wa_contacts" CASCADE;
DROP TABLE IF EXISTS "wa_groups" CASCADE;

-- DropStaleTypes (partial-apply recovery).
DROP TYPE IF EXISTS "ConversationType";
DROP TYPE IF EXISTS "MessageDirection";

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('dm', 'group');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('in', 'out');

-- AlterEnum — idempotent via IF NOT EXISTS (Postgres 12+).
ALTER TYPE "AuditType" ADD VALUE IF NOT EXISTS 'ingest';

-- CreateTable
CREATE TABLE "wa_contacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" BYTEA,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wa_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wa_groups" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "subject" BYTEA NOT NULL,
    "description" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wa_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "fromJid" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "body" BYTEA NOT NULL,
    "mediaRef" TEXT,
    "mediaMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wa_contacts_userId_jid_key" ON "wa_contacts"("userId", "jid");

-- CreateIndex
CREATE UNIQUE INDEX "wa_groups_userId_jid_key" ON "wa_groups"("userId", "jid");

-- CreateIndex
CREATE INDEX "conversations_userId_lastMessageAt_idx" ON "conversations"("userId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_userId_jid_key" ON "conversations"("userId", "jid");

-- CreateIndex
CREATE INDEX "messages_conversationId_timestamp_idx" ON "messages"("conversationId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_waMessageId_key" ON "messages"("conversationId", "waMessageId");

-- AddForeignKey
ALTER TABLE "wa_contacts" ADD CONSTRAINT "wa_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wa_groups" ADD CONSTRAINT "wa_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

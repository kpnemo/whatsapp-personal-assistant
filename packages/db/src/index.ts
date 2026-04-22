import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient } from "@prisma/client";
export type {
  ApiKey,
  AuditLog,
  AuditType,
  Conversation,
  ConversationType,
  Invitation,
  Message,
  MessageDirection,
  RefreshToken,
  Role,
  User,
  WaContact,
  WaGroup,
  WhatsappSession,
  WhatsappSessionStatus,
} from "@prisma/client";

let instance: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  instance ??= new PrismaClient({ log: ["warn", "error"] });
  return instance;
}

export async function disconnectPrisma(): Promise<void> {
  if (instance) {
    await instance.$disconnect();
    instance = undefined;
  }
}

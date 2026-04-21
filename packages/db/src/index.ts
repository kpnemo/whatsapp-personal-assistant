export * from "./generated/index.js";
import { PrismaClient } from "./generated/index.js";

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

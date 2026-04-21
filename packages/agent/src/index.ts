import { pino } from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "agent" });

let running = true;
process.on("SIGTERM", () => {
  logger.info("shutdown");
  running = false;
});
process.on("SIGINT", () => {
  logger.info("shutdown");
  running = false;
});

async function main(): Promise<void> {
  logger.info("agent started (placeholder; AI lands in P2)");
  while (running) {
    await new Promise((r) => setTimeout(r, 30_000));
    logger.debug("heartbeat");
  }
  logger.info("agent exited");
}

void main();

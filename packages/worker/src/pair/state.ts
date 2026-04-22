import { DisconnectReason } from "@whiskeysockets/baileys";
import type {
  AuthenticationCreds,
  AuthenticationState,
  ConnectionState,
} from "@whiskeysockets/baileys";
import { pino, type Logger } from "pino";
import qrcode from "qrcode";

import { makeSocket, type SocketHandle } from "./baileys.js";

/**
 * Extract the Boom statusCode from a Baileys disconnect error, if any. Baileys
 * surfaces stream errors by wrapping them in `@hapi/boom` Errors whose
 * `.output.statusCode` matches `DisconnectReason`. We need the number (not the
 * Boom instance) because the test suite uses plain `Error` subclasses for
 * brevity.
 */
function disconnectStatusCode(err: unknown): number | null {
  if (err && typeof err === "object" && "output" in err) {
    const output = (err as { output?: { statusCode?: unknown } }).output;
    if (output && typeof output === "object" && typeof output.statusCode === "number") {
      return output.statusCode;
    }
  }
  return null;
}

/**
 * Pair state machine — drives a user's WhatsApp pair flow end-to-end.
 *
 * States:
 *  - `idle`           no socket, no timers
 *  - `generating`     socket opened, awaiting Baileys QR event
 *  - `awaiting_scan`  QR emitted, waiting for user to scan with their phone
 *  - `paired`         Baileys signalled `connection.update` with `connection === "open"`
 *  - `error`          unrecoverable failure during pair (logged; not auto-retried)
 *  - `expired`        2-minute timeout fired before the scan completed
 */
export type PairState = "idle" | "generating" | "awaiting_scan" | "paired" | "error" | "expired";

export interface PairMachineEvents {
  onStateChange: (userId: string, next: PairState, prev: PairState) => void;
  onQr: (userId: string, qrPng: string /* base64 PNG */) => void;
  onPaired: (userId: string, info: { phoneNumber: string; platform: string }) => void;
  onError: (userId: string, error: Error) => void;
  /**
   * Pass-through for Baileys `creds.update` — PA3 wires this to encrypted
   * persistence. PA2 callers typically supply a no-op.
   */
  onCredsUpdate?: (userId: string, creds: AuthenticationCreds) => void;
  /**
   * Fired when a Baileys socket is ready (connected or restored). Callers
   * (e.g. the ingest subscriber — IB3) use this to attach event listeners
   * such as `messages.upsert` to the live socket.
   */
  onSocketReady?: (userId: string, handle: SocketHandle) => void;
}

/**
 * Factory signature used by `PairMachine`. Tests inject a fake factory that
 * returns a `SocketHandle` while capturing the `onUpdate` + `onCredsUpdate`
 * callbacks so transitions can be driven synchronously.
 */
export type SocketFactory = typeof makeSocket;

export interface PairMachineOptions {
  /** Expire timeout in ms for `awaiting_scan`. Defaults to 120_000 (2 min). */
  expireMs?: number;
  logger?: Logger;
  /** Override for tests. Production code supplies the real `makeSocket`. */
  socketFactory?: SocketFactory;
}

const DEFAULT_EXPIRE_MS = 2 * 60 * 1000;

interface SingleMachine {
  state: PairState;
  socket: SocketHandle | null;
  timer: NodeJS.Timeout | null;
}

/**
 * Strip the `@s.whatsapp.net` suffix from a WhatsApp JID to recover the raw
 * phone number. Handles the colon-device-id suffix (`1234:5@s.whatsapp.net`)
 * defensively.
 */
function phoneNumberFromJid(jid: string): string {
  const atIndex = jid.indexOf("@");
  const beforeAt = atIndex === -1 ? jid : jid.slice(0, atIndex);
  const colonIndex = beforeAt.indexOf(":");
  return colonIndex === -1 ? beforeAt : beforeAt.slice(0, colonIndex);
}

export class PairMachine {
  private readonly events: PairMachineEvents;
  private readonly expireMs: number;
  private readonly logger: Logger;
  private readonly socketFactory: SocketFactory;
  private readonly machines = new Map<string, SingleMachine>();
  /** Tracks in-flight resumePaired calls to prevent TOCTOU races. */
  private readonly inFlightResumes = new Set<string>();

  constructor(events: PairMachineEvents, opts: PairMachineOptions = {}) {
    this.events = events;
    this.expireMs = opts.expireMs ?? DEFAULT_EXPIRE_MS;
    this.logger = opts.logger ?? pino({ level: "silent" });
    this.socketFactory = opts.socketFactory ?? makeSocket;
  }

  getState(userId: string): PairState {
    return this.machines.get(userId)?.state ?? "idle";
  }

  /**
   * Start (or restore) a pair flow for `userId`.
   *
   * - `authState === null` → fresh pair: open a socket and await QR (PA3 will
   *   wire up the persistent auth store when it lands).
   * - `authState !== null` → restore path: transition straight to `paired`.
   *   PA2 ships the pathway; PA3 actually wires the restore event loop.
   */
  async start(userId: string, authState: AuthenticationState | null): Promise<void> {
    const log = this.childLogger(userId);

    if (authState !== null) {
      // Restore path. PA2 only transitions; PA3 attaches the live socket.
      this.setMachine(userId, { state: "idle", socket: null, timer: null });
      this.transition(userId, "paired");
      // Fire onPaired if the stored creds carry enough info; best-effort in PA2.
      const me = authState.creds.me;
      if (me?.id) {
        this.events.onPaired(userId, {
          phoneNumber: phoneNumberFromJid(me.id),
          platform: authState.creds.platform ?? "",
        });
      }
      return;
    }

    // Fresh pair — reset any previous state (allows retry after expired/error).
    const existing = this.machines.get(userId);
    if (existing?.socket) {
      await existing.socket.dispose();
    }
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    this.setMachine(userId, { state: "idle", socket: null, timer: null });
    this.transition(userId, "generating");

    // Open Baileys socket with a fresh authState. The full initial creds are
    // supplied by PA3's authStore on restore; for PA2 we let the socketFactory
    // decide (production will feed `initAuthCreds()`; tests inject their own).
    try {
      const handle = await this.socketFactory({
        userId,
        authState: null,
        onUpdate: (update) => {
          this.handleUpdate(userId, update);
        },
        onCredsUpdate: (creds) => {
          this.events.onCredsUpdate?.(userId, creds);
        },
        logger: log,
      });
      const machine = this.machines.get(userId);
      if (machine) {
        machine.socket = handle;
      }
    } catch (err) {
      log.error({ err }, "makeSocket failed");
      this.transition(userId, "error");
      this.events.onError(userId, err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Arm the 2-minute expire timer. It fires the transition only if we're
    // still mid-pair; `paired` or `stop` clears it.
    const timer = setTimeout(() => {
      this.handleTimeout(userId);
    }, this.expireMs);
    // Avoid blocking process exit on the timer during dev.
    timer.unref?.();
    const machine = this.machines.get(userId);
    if (machine) {
      machine.timer = timer;
    }
  }

  /**
   * Restore a previously paired session on worker boot.
   *
   * Opens the Baileys socket with the decrypted `authState` from the DB
   * snapshot, transitions idle → paired, and emits `onStateChange`. Does NOT
   * emit `onPaired` — that event is for first-time links only; resumption
   * writes its own `pair.restored` audit upstream.
   *
   * Idempotent: if a `paired` machine already exists for this userId, returns
   * immediately without opening a second socket.
   *
   * On factory error: emits `onError` and leaves the machine in `error` state.
   */
  async resumePaired(userId: string, authState: AuthenticationState): Promise<void> {
    const current = this.machines.get(userId);
    if (current?.state === "paired") return;
    // TOCTOU guard: if another async caller is already mid-resume for this
    // userId, bail out immediately so we don't open a second socket.
    if (this.inFlightResumes.has(userId)) return;
    this.inFlightResumes.add(userId);

    // Ensure a machine entry exists so `transition` can use it.
    this.setMachine(userId, { state: "idle", socket: null, timer: null });

    const log = this.childLogger(userId);
    try {
      const handle = await this.socketFactory({
        userId,
        authState,
        onUpdate: (update) => {
          this.handleUpdate(userId, update);
        },
        onCredsUpdate: (creds) => {
          this.events.onCredsUpdate?.(userId, creds);
        },
        logger: log,
      });
      const machine = this.machines.get(userId);
      if (machine) {
        machine.socket = handle;
        machine.timer = null;
      }
      this.transition(userId, "paired");
      this.events.onSocketReady?.(userId, handle);
    } catch (err) {
      log.error({ err }, "resumePaired: socketFactory failed");
      this.transition(userId, "error");
      this.events.onError(userId, err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.inFlightResumes.delete(userId);
    }
  }

  /**
   * Stop a pair flow (user cancelled, shutdown, or rate-limited cleanup).
   */
  async stop(userId: string): Promise<void> {
    const machine = this.machines.get(userId);
    if (!machine) {
      return;
    }
    if (machine.timer) {
      clearTimeout(machine.timer);
      machine.timer = null;
    }
    if (machine.socket) {
      try {
        await machine.socket.dispose();
      } catch (err) {
        this.childLogger(userId).warn({ err }, "socket dispose failed during stop");
      }
      machine.socket = null;
    }
    this.transition(userId, "idle");
  }

  private handleUpdate(userId: string, update: Partial<ConnectionState>): void {
    const machine = this.machines.get(userId);
    if (!machine) {
      return;
    }
    const prevState = machine.state;

    if (update.qr) {
      // Convert the raw QR string into a base64 PNG. `toBuffer` throws on bad
      // input; treat as a non-fatal warning — WhatsApp will rotate the QR.
      qrcode
        .toBuffer(update.qr, { type: "png" })
        .then((buf) => {
          const png = buf.toString("base64");
          // Transition (or re-notify). `awaiting_scan → awaiting_scan` is a
          // legal re-emit per the spec.
          if (this.machines.get(userId)?.state === "generating") {
            this.transition(userId, "awaiting_scan");
          }
          this.events.onQr(userId, png);
        })
        .catch((err: unknown) => {
          this.childLogger(userId).warn({ err }, "qr png encode failed");
        });
      // Fall through — a single update may carry both `qr` and `connection`.
    }

    if (update.connection === "open") {
      // Read phone number out of creds. The authoritative source is the
      // socketHandle, but for PA2's synchronous test flow we read whatever
      // the fake factory stored on machine.socket.creds (see baileys.ts).
      const creds = machine.socket?.creds ?? null;
      const jid = creds?.me?.id ?? "";
      const platform = creds?.platform ?? "";
      this.transition(userId, "paired");
      if (machine.timer) {
        clearTimeout(machine.timer);
        machine.timer = null;
      }
      // Notify ingest (and other) subscribers that a live socket is ready.
      if (machine.socket) {
        this.events.onSocketReady?.(userId, machine.socket);
      }
      if (jid) {
        this.events.onPaired(userId, {
          phoneNumber: phoneNumberFromJid(jid),
          platform,
        });
      }
      return;
    }

    if (update.connection === "close") {
      if (prevState === "paired") {
        // Normal drop (handled by PA3's reconnect layer). Keep state, log.
        this.childLogger(userId).warn(
          { err: update.lastDisconnect?.error },
          "baileys connection closed while paired (PA3 reconnect handles this)",
        );
        return;
      }

      const disconnectErr = update.lastDisconnect?.error;
      const statusCode = disconnectStatusCode(disconnectErr);

      // 515 "restart required" is EXPECTED right after a successful QR scan.
      // WhatsApp's protocol tells the client to close + reopen with the freshly
      // received credentials — only then is the device truly paired.
      // We reconnect using the live creds+keys from the current socket handle
      // and keep the UI in `awaiting_scan` until the new socket reports `open`.
      if (
        statusCode === DisconnectReason.restartRequired &&
        machine.socket &&
        (prevState === "awaiting_scan" || prevState === "generating")
      ) {
        this.childLogger(userId).info(
          { prevState },
          "baileys requested restart (515) after pair — reconnecting with stored creds",
        );
        const freshAuthState: AuthenticationState = {
          creds: machine.socket.creds,
          keys: machine.socket.keys,
        };
        const oldSocket = machine.socket;
        machine.socket = null;
        // fire-and-forget dispose of the old socket — we already hold the live
        // creds/keys refs. Failures just leak a websocket.
        void oldSocket.dispose().catch((err: unknown) => {
          this.childLogger(userId).warn({ err }, "old socket dispose failed after 515");
        });
        void this.reopenSocket(userId, freshAuthState);
        return;
      }

      // Any other close mid-pair is unrecoverable for P1-A.
      const err = disconnectErr ?? new Error("baileys connection closed during pair");
      this.transition(userId, "error");
      if (machine.timer) {
        clearTimeout(machine.timer);
        machine.timer = null;
      }
      this.events.onError(userId, err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Reopen the Baileys socket after a 515 "restart required". Keeps the user
   * in `awaiting_scan` until the new socket fires `connection: open`.
   */
  private async reopenSocket(userId: string, authState: AuthenticationState): Promise<void> {
    const log = this.childLogger(userId);
    try {
      const handle = await this.socketFactory({
        userId,
        authState,
        onUpdate: (update) => {
          this.handleUpdate(userId, update);
        },
        onCredsUpdate: (creds) => {
          this.events.onCredsUpdate?.(userId, creds);
        },
        logger: log,
      });
      const machine = this.machines.get(userId);
      if (machine) {
        machine.socket = handle;
      }
    } catch (err) {
      log.error({ err }, "reopenSocket failed after 515 restart request");
      this.transition(userId, "error");
      this.events.onError(userId, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private handleTimeout(userId: string): void {
    const machine = this.machines.get(userId);
    if (!machine) {
      return;
    }
    if (machine.state !== "generating" && machine.state !== "awaiting_scan") {
      // Raced with open/close/stop — no-op.
      return;
    }
    // Dispose the socket so we don't leak a pending WA connection.
    if (machine.socket) {
      // fire-and-forget; we log any failure
      void machine.socket.dispose().catch((err: unknown) => {
        this.childLogger(userId).warn({ err }, "socket dispose failed on expire");
      });
      machine.socket = null;
    }
    machine.timer = null;
    this.transition(userId, "expired");
  }

  private transition(userId: string, next: PairState): void {
    // `transition` is only called after a machine has been created by
    // `start` / `setMachine`. Assert rather than silently paper over.
    const machine = this.machines.get(userId);
    if (!machine) {
      throw new Error(`pair-machine invariant: no machine for ${userId}`);
    }
    const prev = machine.state;
    machine.state = next;
    this.childLogger(userId).info({ prev, next }, "pair state transition");
    this.events.onStateChange(userId, next, prev);
  }

  private setMachine(userId: string, m: SingleMachine): void {
    this.machines.set(userId, m);
  }

  private childLogger(userId: string): Logger {
    return this.logger.child({ userId, name: "pair-machine" });
  }
}

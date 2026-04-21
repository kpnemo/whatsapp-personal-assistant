# Threat Model & Security Posture

This document explains what we defend against, what we don't, and the cryptographic assumptions behind encrypted-at-rest storage.

## Key hierarchy

```
MASTER_KEY (env, 32 bytes, never logged)
  └─ wraps (AES-256-GCM)
       user.encrypted_dek (per-user, 32 bytes)
         └─ encrypts (AES-256-GCM, unique IV/tag per record)
              message.body, summary.body, audit.details, etc.
```

## What we defend against

- Theft of a Postgres snapshot / backup.
- Theft of a Redis AOF file.
- Log file leak.
- Compromise of a single user's password (argon2id cost is high enough that offline brute force is slow).

## What we do NOT defend against

- Compromise of the host running this service. The master key is in the host's env.
- A malicious operator of the instance (you).
- WhatsApp's servers or WhatsApp-side admin actions.

## Crypto choices

- **AES-256-GCM** for all at-rest encryption. Unique 12-byte IV per record. 16-byte tag.
- **argon2id** (64 MB memory, 3 iterations, 4 lanes) for password hashing.
- **HS256 JWT** access tokens (15 min). Opaque random refresh tokens hashed with SHA-256 server-side.

## Reporting

Use [private vulnerability reporting](../SECURITY.md).

## Dependency audit posture

Last full audit: **2026-04-21** (Epic 25).

`pnpm audit --audit-level=high` is clean. Accepted lower-severity exposures:

- `vitest@2.1.9` bundles `vite@5.4.21` and `esbuild@0.21.5` (dev-only, test runner internals). This yields 3 moderate + 1 low transitive advisories (GHSA-4w7w-66w2-5vf9, GHSA-67mh-4wv8-2f99, GHSA-vg6x-rcgg-rjx6). We stay on vitest 2.x per the P0 plan's locked majors; these paths never reach production builds.

Majors locked by plan (do not auto-bump): Express 5, React 19, Tailwind 4, Prisma 6, ESLint 9, Vite 6, Vitest 2, Zod 3, express-rate-limit 7.

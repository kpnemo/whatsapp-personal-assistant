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

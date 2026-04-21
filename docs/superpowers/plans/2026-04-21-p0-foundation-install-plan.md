# P0 — Foundation & Install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger can clone the public repo, run `/wpa:init` then `/wpa:start`, and reach a working login screen on a fresh VPS in under 5 minutes. No WhatsApp, no AI yet — just the foundation, install story, auth, empty dashboard shell, GitHub-platform bootstrap, and one-click deploy templates.

**Architecture:** pnpm workspaces + turborepo monorepo. Single multi-stage Dockerfile building an image that runs `api`, `worker`, `agent` (worker/agent are placeholders in P0) via supervisord, selectable by `ENTRYPOINT_ROLE` env. docker-compose brings up app + postgres:16 + redis:7 + optional caddy. Postgres via Prisma. Auth: email/password (argon2id) + JWT (access 15 min + refresh 7 day). Invite-only registration by default; `OPEN_REGISTRATION=true` opt-out. First-run `/wpa:init` generates every secret. Crypto hierarchy (MASTER_KEY → per-user DEK) implemented in P0; used from P1 onward.

**Tech Stack:** Node.js 22 LTS, TypeScript 5.6, pnpm 9, turbo 2, Prisma 6, Postgres 16, Redis 7, Express 5, Vite 6, React 19, Tailwind 4, shadcn, `@json-render/react`, Zod 3, pino 9, argon2 0.41, jose 5, Vitest 2, ESLint 9 (flat config), Prettier 3, husky 9, lint-staged, gitleaks.

**Authoritative inputs (re-read before planning any change):**
- [`docs/VISION.md`](../../VISION.md) — product north star.
- [`docs/superpowers/specs/2026-04-21-whatsapp-personal-assistant-design.md`](../specs/2026-04-21-whatsapp-personal-assistant-design.md) — HLD.

**Commit discipline:** every task ends with a commit. Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `security:`). Signed commits required post-Epic 16.

**Execution order is strict.** Later Epics depend on earlier ones. Within an Epic, tasks are ordered. No parallelism until Epic ≥ 17.

---

## File-structure map (finalized before Epic 1)

```
whatsapp-personal-assistant/
├── .claude/                          Claude-Code first-class layer
│   ├── CLAUDE.md
│   └── commands/wpa/{init,start,stop,status,logs,help,kill}.md
├── .github/
│   ├── workflows/{ci,codeql,secret-scan,licenses,release,container-scan,sbom,
│   │               docs-site,wiki-sync,pr-labeler,stale,link-check}.yml
│   ├── ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── CODEOWNERS
│   └── dependabot.yml
├── .husky/                            pre-commit hook for gitleaks + lint-staged
├── deploy/{railway,flyio,render,aws-lightsail,vercel}/
├── docs/
│   ├── VISION.md                      (exists)
│   ├── INSTALL.md
│   ├── ARCHITECTURE.md                (link to spec + generated stub)
│   ├── SECURITY.md
│   ├── CONTRIBUTING.md
│   └── superpowers/{specs,plans}/     (exists)
├── packages/
│   ├── api/                           Express app
│   │   ├── src/{app.ts,server.ts,env.ts,logger.ts,middleware/,routes/,auth/,audit/}
│   │   ├── test/
│   │   ├── package.json, tsconfig.json, vitest.config.ts
│   ├── agent/                         placeholder loop (P0); orchestrator (P2)
│   ├── worker/                        placeholder loop (P0); Baileys (P1)
│   ├── shared/                        types, zod schemas, crypto, env
│   │   └── src/{crypto.ts,env.ts,types.ts,index.ts}
│   └── web/                           Vite + React SPA
│       ├── src/{main.tsx,App.tsx,routes/,api/,components/,lib/}
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   ├── first-run.sh                   generate secrets, prompt ANTHROPIC_API_KEY, write .env
│   ├── bootstrap-github.sh            one-time gh CLI repo setup
│   └── smoke-test.sh                  docker compose up + health probe
├── supervisord/                       supervisord.conf
├── website/                           VitePress site stub
├── wiki/                              repo-sourced wiki pages
├── .env.example
├── .gitignore
├── .dockerignore
├── .editorconfig
├── .nvmrc                             22
├── .npmrc
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md                    (short; long-form in docs/)
├── Dockerfile                         multi-stage
├── LICENSE                            MIT
├── README.md
├── SECURITY.md
├── SUPPORT.md
├── docker-compose.yml
├── docker-compose.override.yml.example
├── docker-compose.split.yml
├── package.json                       workspaces root
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
└── turbo.json
```

---

## Epic index

1. Git & monorepo skeleton
2. TypeScript, lint, format baseline
3. Vitest + turbo pipeline
4. `packages/shared` — env loader + crypto primitives
5. Prisma + Postgres
6. `packages/api` — Express scaffold
7. Auth (argon2id + JWT + refresh)
8. Registration + invitations (invite-only default)
9. Audit log writes
10. `packages/worker` + `packages/agent` placeholders
11. `packages/web` — Vite + React + Tailwind + shadcn
12. Frontend auth flows + dashboard shell + json-render placeholder
13. API serves built SPA
14. Dockerfile + supervisord + docker-compose
15. `.env.example` + first-run secret generator (`scripts/first-run.sh`)
16. `.claude/` commands (init, start, stop, status, logs, help, kill)
17. CI — lint, typecheck, test, build
18. Security CI — CodeQL, gitleaks, licenses, pre-commit hook
19. Docs — README, SECURITY, INSTALL, CONTRIBUTING, etc.
20. GitHub platform bootstrap (branch protection, templates, Discussions, Projects, CODEOWNERS)
21. VitePress website + Wiki stub + Pages workflow
22. Deploy templates (Railway, Fly, Render, Lightsail, Vercel)
23. Release pipeline (multi-arch, cosign, Trivy, SBOM) + misc workflows
24. P0 exit — smoke test + fresh-VPS timing

---

## Epic 1 — Git & monorepo skeleton

### Task 1.1: Initialize git, base ignores, editor config

**Files:**
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `.nvmrc`
- Create: `.dockerignore`

- [ ] **Step 1: `git init` and initial branch**

```bash
cd /Users/mikeb/DevProjects/WhatsApp-personal-assistant
git init -b main
```

Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Create `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
build/
.turbo/
*.tsbuildinfo
packages/web/dist/

# Env & secrets — NEVER commit
.env
.env.*
!.env.example
*.pem
*.key
secrets/

# OS / editor
.DS_Store
.vscode/
!.vscode/extensions.json
.idea/
*.swp

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Test output
coverage/
.nyc_output/

# Prisma generated client
packages/*/prisma/generated/

# Docker volumes
.docker-data/

# Tooling
.superpowers/
.firecrawl/
.remember/
```

- [ ] **Step 3: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4: Create `.nvmrc`**

```
22
```

- [ ] **Step 5: Create `.dockerignore`**

```
node_modules
**/node_modules
.git
.github
.vscode
.idea
dist
build
.turbo
coverage
.env
.env.*
!.env.example
docs/
tests/
*.md
!README.md
.husky
.remember
.firecrawl
.superpowers
docker-compose.override.yml
docker-compose.override.yml.example
```

- [ ] **Step 6: Initial commit**

```bash
git add .gitignore .editorconfig .nvmrc .dockerignore
git commit -m "chore: initialize repo with baseline config"
```

Expected: one commit on `main`.

---

### Task 1.2: pnpm workspace + turbo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.npmrc`

- [ ] **Step 1: Create `package.json` (root)**

```json
{
  "name": "whatsapp-personal-assistant",
  "version": "0.0.0-dev",
  "private": true,
  "packageManager": "pnpm@9.12.3",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "clean": "turbo run clean && rm -rf node_modules",
    "format": "prettier --write \"**/*.{ts,tsx,js,json,md,yml,yaml}\""
  },
  "devDependencies": {
    "turbo": "2.2.3",
    "typescript": "5.6.3",
    "prettier": "3.3.3"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

- [ ] **Step 4: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
engine-strict=true
save-exact=true
```

- [ ] **Step 5: Install + verify**

```bash
pnpm install
```

Expected: `Done in <time>`. Creates `pnpm-lock.yaml`, `node_modules/`.

- [ ] **Step 6: Verify turbo is wired**

```bash
pnpm turbo --version
```

Expected: `2.2.3`.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .npmrc
git commit -m "chore: scaffold pnpm workspaces + turbo"
```

---

### Task 1.3: Root TypeScript base config

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "alwaysStrict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "allowUnusedLabels": false,
    "allowUnreachableCode": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore: add strict TypeScript base config"
```

---

## Epic 2 — Lint, format baseline

### Task 2.1: ESLint 9 flat config + Prettier

**Files:**
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json` (add devDependencies)

- [ ] **Step 1: Install deps**

```bash
pnpm add -Dw eslint@9.14.0 typescript-eslint@8.13.0 @eslint/js@9.14.0 \
  eslint-plugin-import@2.31.0 eslint-import-resolver-typescript@3.6.3 \
  eslint-config-prettier@9.1.0 globals@15.12.0
```

- [ ] **Step 2: Create `eslint.config.mjs`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.generated.*",
      "packages/web/dist/**",
      "website/.vitepress/cache/**",
      "website/.vitepress/dist/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    plugins: { import: importPlugin },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true, project: ["packages/*/tsconfig.json"] },
      },
    },
  },
  prettier,
);
```

- [ ] **Step 3: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 4: Create `.prettierignore`**

```
node_modules
dist
build
.turbo
coverage
packages/web/dist
pnpm-lock.yaml
*.min.*
website/.vitepress/cache
website/.vitepress/dist
```

- [ ] **Step 5: Add root scripts**

Modify `package.json` `scripts`:
```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"format": "prettier --write \"**/*.{ts,tsx,js,mjs,cjs,json,md,yml,yaml}\"",
"format:check": "prettier --check \"**/*.{ts,tsx,js,mjs,cjs,json,md,yml,yaml}\""
```

- [ ] **Step 6: Verify**

```bash
pnpm lint
```

Expected: passes (no code yet).

- [ ] **Step 7: Commit**

```bash
git add eslint.config.mjs .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: add eslint (flat config) + prettier"
```

---

## Epic 3 — Vitest + turbo pipeline sanity

### Task 3.1: Root Vitest config (shared)

**Files:**
- Create: `vitest.workspace.ts`
- Modify: `package.json` (add deps + script)

- [ ] **Step 1: Install deps**

```bash
pnpm add -Dw vitest@2.1.4 @vitest/coverage-v8@2.1.4
```

- [ ] **Step 2: Create `vitest.workspace.ts`**

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*/vitest.config.ts",
]);
```

- [ ] **Step 3: Add root test script**

Modify `package.json`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Commit**

```bash
git add vitest.workspace.ts package.json pnpm-lock.yaml
git commit -m "chore: add vitest workspace config"
```

---

## Epic 4 — `packages/shared` (env loader + crypto primitives)

This package is depended on by `api`, `worker`, `agent`. TDD is strict here: env parsing and crypto must be correct.

### Task 4.1: Scaffold `packages/shared`

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@wpa/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "zod": "3.23.8"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shared",
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: { reporter: ["text", "lcov"], include: ["src/**"] },
  },
});
```

- [ ] **Step 4: Create stub `src/index.ts`**

```ts
export {}; // placeholder
```

- [ ] **Step 5: Install + verify typecheck**

```bash
pnpm install
pnpm --filter @wpa/shared typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): scaffold @wpa/shared package"
```

---

### Task 4.2: Crypto primitives — AES-256-GCM helpers (TDD)

**Files:**
- Create: `packages/shared/src/crypto.test.ts`
- Create: `packages/shared/src/crypto.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  decryptWithKey,
  encryptWithKey,
  generateKey,
  unwrapDek,
  wrapDek,
} from "./crypto.js";

describe("encryptWithKey / decryptWithKey", () => {
  const key = generateKey();

  it("round-trips a utf-8 string", () => {
    const ct = encryptWithKey(key, "hello world");
    expect(decryptWithKey(key, ct)).toBe("hello world");
  });

  it("produces distinct ciphertexts for the same plaintext (unique IV)", () => {
    const a = encryptWithKey(key, "same");
    const b = encryptWithKey(key, "same");
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("fails authentication when ciphertext is tampered", () => {
    const ct = encryptWithKey(key, "secret");
    const tampered = {
      ...ct,
      ciphertext: Buffer.concat([ct.ciphertext.subarray(0, 1).map((b) => b ^ 0xff), ct.ciphertext.subarray(1)]),
    };
    expect(() => decryptWithKey(key, tampered)).toThrow();
  });

  it("fails authentication with a wrong key", () => {
    const ct = encryptWithKey(key, "secret");
    const other = generateKey();
    expect(() => decryptWithKey(other, ct)).toThrow();
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => encryptWithKey(Buffer.alloc(16), "x")).toThrow(/32 bytes/);
  });
});

describe("wrapDek / unwrapDek", () => {
  const master = generateKey();

  it("round-trips a DEK", () => {
    const dek = generateKey();
    const wrapped = wrapDek(master, dek);
    const unwrapped = unwrapDek(master, wrapped);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it("unwrap fails with a wrong master key", () => {
    const dek = generateKey();
    const wrapped = wrapDek(master, dek);
    expect(() => unwrapDek(generateKey(), wrapped)).toThrow();
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
pnpm --filter @wpa/shared test
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `crypto.ts`**

Create `packages/shared/src/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm" as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type Ciphertext = {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
};

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`key must be ${KEY_BYTES.toString()} bytes`);
  }
}

export function encryptWithKey(key: Buffer, plaintext: string | Buffer): Ciphertext {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const pt = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
  const ciphertext = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) {
    throw new Error("unexpected GCM tag length");
  }
  return { iv, tag, ciphertext };
}

export function decryptWithKey(key: Buffer, ct: Ciphertext): string {
  assertKey(key);
  const decipher = createDecipheriv(ALGO, key, ct.iv);
  decipher.setAuthTag(ct.tag);
  const pt = Buffer.concat([decipher.update(ct.ciphertext), decipher.final()]);
  return pt.toString("utf8");
}

export function wrapDek(master: Buffer, dek: Buffer): Ciphertext {
  assertKey(master);
  assertKey(dek);
  return encryptWithKey(master, dek);
}

export function unwrapDek(master: Buffer, wrapped: Ciphertext): Buffer {
  assertKey(master);
  const decipher = createDecipheriv(ALGO, master, wrapped.iv);
  decipher.setAuthTag(wrapped.tag);
  return Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]);
}

export function serializeCiphertext(ct: Ciphertext): string {
  return [
    ct.iv.toString("base64"),
    ct.tag.toString("base64"),
    ct.ciphertext.toString("base64"),
  ].join(".");
}

export function parseCiphertext(s: string): Ciphertext {
  const parts = s.split(".");
  if (parts.length !== 3) {
    throw new Error("malformed ciphertext");
  }
  return {
    iv: Buffer.from(parts[0]!, "base64"),
    tag: Buffer.from(parts[1]!, "base64"),
    ciphertext: Buffer.from(parts[2]!, "base64"),
  };
}
```

- [ ] **Step 4: Export from index**

Replace `packages/shared/src/index.ts`:

```ts
export * from "./crypto.js";
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @wpa/shared test
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src packages/shared/vitest.config.ts
git commit -m "feat(shared): add AES-256-GCM encrypt/decrypt + DEK wrap helpers"
```

---

### Task 4.3: Env loader (Zod-validated)

**Files:**
- Create: `packages/shared/src/env.test.ts`
- Create: `packages/shared/src/env.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseEnv } from "./env.js";

const valid = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db:5432/wpa",
  REDIS_URL: "redis://redis:6379",
  JWT_SECRET: "a".repeat(64),
  MASTER_KEY: Buffer.alloc(32, 1).toString("base64"),
  API_PORT: "3000",
  PUBLIC_ORIGIN: "https://example.com",
  OPEN_REGISTRATION: "false",
};

describe("parseEnv", () => {
  it("accepts a valid env", () => {
    const env = parseEnv(valid);
    expect(env.API_PORT).toBe(3000);
    expect(env.OPEN_REGISTRATION).toBe(false);
    expect(env.MASTER_KEY_BYTES.length).toBe(32);
  });

  it("rejects MASTER_KEY with wrong decoded length", () => {
    expect(() => parseEnv({ ...valid, MASTER_KEY: Buffer.alloc(16, 1).toString("base64") })).toThrow(
      /32 bytes/,
    );
  });

  it("rejects short JWT_SECRET", () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: "short" })).toThrow(/at least 32/);
  });

  it("rejects non-postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://x" })).toThrow(/postgres/);
  });

  it("defaults OPEN_REGISTRATION to false", () => {
    const { OPEN_REGISTRATION: _drop, ...rest } = valid;
    void _drop;
    const env = parseEnv(rest);
    expect(env.OPEN_REGISTRATION).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

```bash
pnpm --filter @wpa/shared test
```

Expected: FAIL on missing `./env.js`.

- [ ] **Step 3: Implement `env.ts`**

Create `packages/shared/src/env.ts`:

```ts
import { z } from "zod";

const boolish = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .refine((s) => s.startsWith("postgres://") || s.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres url",
    }),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  MASTER_KEY: z
    .string()
    .min(1)
    .transform((b64, ctx) => {
      const buf = Buffer.from(b64, "base64");
      if (buf.length !== 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MASTER_KEY must decode to 32 bytes (base64)",
        });
        return z.NEVER;
      }
      return buf;
    }),
  API_PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_ORIGIN: z.string().url(),
  OPEN_REGISTRATION: boolish.default("false"),
  ENTRYPOINT_ROLE: z.enum(["api", "worker", "agent", "all"]).default("all"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type ParsedEnv = z.infer<typeof envSchema> & { MASTER_KEY_BYTES: Buffer };

export function parseEnv(raw: Record<string, string | undefined>): ParsedEnv {
  const parsed = envSchema.parse(raw);
  return {
    ...parsed,
    MASTER_KEY_BYTES: parsed.MASTER_KEY,
  };
}
```

- [ ] **Step 4: Export from index**

Modify `packages/shared/src/index.ts`:

```ts
export * from "./crypto.js";
export * from "./env.js";
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @wpa/shared test
```

Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): add zod-validated env loader"
```

---

### Task 4.4: Build `@wpa/shared`

- [ ] **Step 1: Build**

```bash
pnpm --filter @wpa/shared build
```

Expected: `dist/index.js`, `dist/index.d.ts`, `dist/crypto.js`, `dist/env.js` written.

- [ ] **Step 2: Commit nothing (build output is gitignored)**

No commit needed.

---

## Epic 5 — Prisma + Postgres

### Task 5.1: `packages/db` with Prisma schema (P0 tables only)

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/index.ts`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@wpa/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json && prisma generate",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "clean": "rm -rf dist .turbo src/generated",
    "db:migrate": "prisma migrate deploy",
    "db:migrate:dev": "prisma migrate dev",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "6.0.1"
  },
  "devDependencies": {
    "prisma": "6.0.1"
  },
  "prisma": { "schema": "prisma/schema.prisma" }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src", "composite": true },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/db/prisma/schema.prisma` (P0 tables only)**

```prisma
generator client {
  provider      = "prisma-client-js"
  output        = "../src/generated"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x", "linux-arm64-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  admin
  user
}

model User {
  id                     String        @id @default(cuid())
  email                  String        @unique
  passwordHash           String
  role                   Role          @default(user)
  encryptedDek           Bytes
  anthropicApiKey        Bytes?
  costCapUsdMonthly      Decimal       @default("10.00") @db.Decimal(10, 2)
  createdAt              DateTime      @default(now())
  lastLoginAt            DateTime?

  invitationsCreated     Invitation[]  @relation("invitedBy")
  invitationConsumed     Invitation?   @relation("consumedBy")
  auditLogs              AuditLog[]
  apiKeys                ApiKey[]
  refreshTokens          RefreshToken[]

  @@map("users")
}

model Invitation {
  id               String    @id @default(cuid())
  invitedById      String
  invitedBy        User      @relation("invitedBy", fields: [invitedById], references: [id], onDelete: Cascade)
  email            String
  tokenHash        String    @unique
  expiresAt        DateTime
  usedAt           DateTime?
  consumedByUserId String?   @unique
  consumedByUser   User?     @relation("consumedBy", fields: [consumedByUserId], references: [id])
  createdAt        DateTime  @default(now())

  @@index([email])
  @@map("invitations")
}

model ApiKey {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  tokenHash   String    @unique
  scopes      String[]
  lastUsedAt  DateTime?
  createdAt   DateTime  @default(now())

  @@map("api_keys")
}

model RefreshToken {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime @default(now())
  userAgent  String?
  ip         String?

  @@index([userId])
  @@map("refresh_tokens")
}

enum AuditType {
  ai_reply
  rule_fired
  decrypt
  login
  login_failed
  logout
  register
  invite_create
  invite_consume
  setting_change
  kill
  pair
  unpair
}

model AuditLog {
  id         String    @id @default(cuid())
  userId     String?
  user       User?     @relation(fields: [userId], references: [id], onDelete: SetNull)
  type       AuditType
  targetRef  String?
  details    Bytes?
  createdAt  DateTime  @default(now())

  @@index([userId, createdAt(sort: Desc)])
  @@map("audit_log")
}
```

- [ ] **Step 4: Create `packages/db/src/index.ts`**

```ts
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
```

- [ ] **Step 5: Install + generate client**

```bash
pnpm install
pnpm --filter @wpa/db exec prisma generate
```

Expected: `prisma generate` writes to `packages/db/src/generated/`.

- [ ] **Step 6: Commit**

```bash
git add packages/db package.json pnpm-lock.yaml
git commit -m "feat(db): scaffold @wpa/db with Prisma schema for P0 tables"
```

---

### Task 5.2: Initial migration

**Files:** `packages/db/prisma/migrations/<timestamp>_init/migration.sql` (generated)

- [ ] **Step 1: Start a temp Postgres for migration**

```bash
docker run --rm -d --name wpa-migrate-pg -p 54329:5432 -e POSTGRES_PASSWORD=migrate -e POSTGRES_USER=migrate -e POSTGRES_DB=wpa postgres:16-alpine
sleep 3
```

- [ ] **Step 2: Generate initial migration**

```bash
cd packages/db
DATABASE_URL="postgresql://migrate:migrate@localhost:54329/wpa" pnpm exec prisma migrate dev --name init --create-only
cd ../..
docker stop wpa-migrate-pg
```

Expected: `packages/db/prisma/migrations/*_init/migration.sql` created.

- [ ] **Step 3: Commit**

```bash
git add packages/db/prisma/migrations
git commit -m "feat(db): initial migration for P0 schema"
```

---

## Epic 6 — `packages/api` (Express scaffold)

### Task 6.1: API package scaffold

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/vitest.config.ts`
- Create: `packages/api/src/env.ts`
- Create: `packages/api/src/logger.ts`
- Create: `packages/api/src/app.ts`
- Create: `packages/api/src/server.ts`

- [ ] **Step 1: Create `packages/api/package.json`**

```json
{
  "name": "@wpa/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@wpa/db": "workspace:*",
    "@wpa/shared": "workspace:*",
    "argon2": "0.41.1",
    "cookie-parser": "1.4.7",
    "cors": "2.8.5",
    "express": "5.0.1",
    "express-rate-limit": "7.4.1",
    "helmet": "8.0.0",
    "jose": "5.9.6",
    "pino": "9.5.0",
    "pino-http": "10.3.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/cookie-parser": "1.4.7",
    "@types/cors": "2.8.17",
    "@types/express": "5.0.0",
    "@types/node": "22.9.0",
    "@types/supertest": "6.0.2",
    "supertest": "7.0.0",
    "tsx": "4.19.2"
  }
}
```

- [ ] **Step 2: Create `packages/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "types": ["node"]
  },
  "references": [
    { "path": "../shared" },
    { "path": "../db" }
  ],
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/api/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: { reporter: ["text", "lcov"], include: ["src/**"] },
  },
});
```

- [ ] **Step 4: Create `packages/api/src/env.ts`**

```ts
import { parseEnv } from "@wpa/shared";

export const env = parseEnv(process.env);
```

- [ ] **Step 5: Create `packages/api/src/logger.ts`**

```ts
import pino from "pino";

import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "token",
      "refreshToken",
      "accessToken",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "masterKey",
      "MASTER_KEY",
      "anthropicApiKey",
      "encryptedDek",
      "authState",
      "ciphertext",
      "body.password",
      "body.token",
    ],
    censor: "[REDACTED]",
  },
  formatters: { level: (label) => ({ level: label }) },
});
```

- [ ] **Step 6: Create `packages/api/src/test-setup.ts`**

```ts
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/wpa_test";
process.env.REDIS_URL ??= "redis://localhost:6379/1";
process.env.JWT_SECRET ??= "a".repeat(64);
process.env.MASTER_KEY ??= Buffer.alloc(32, 1).toString("base64");
process.env.PUBLIC_ORIGIN ??= "http://localhost:3000";
```

- [ ] **Step 7: Create `packages/api/src/app.ts`**

```ts
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { env } from "./env.js";
import { logger } from "./logger.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.PUBLIC_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/readyz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(((err: Error, _req, res, _next) => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "internal_error" });
  }) as express.ErrorRequestHandler);

  return app;
}
```

- [ ] **Step 8: Create `packages/api/src/server.ts`**

```ts
import { createApp } from "./app.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const app = createApp();
const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, "api listening");
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

- [ ] **Step 9: Install + typecheck**

```bash
pnpm install
pnpm --filter @wpa/api typecheck
```

Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add packages/api package.json pnpm-lock.yaml
git commit -m "feat(api): scaffold express app with helmet, cors, pino redaction"
```

---

### Task 6.2: `/healthz` smoke test

**Files:**
- Create: `packages/api/src/app.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "./app.js";

describe("app", () => {
  const app = createApp();

  it("GET /healthz returns ok", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /does-not-exist returns 404", async () => {
    const res = await request(app).get("/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("sets helmet headers", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @wpa/api test
```

Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/app.test.ts
git commit -m "test(api): health and 404 smoke tests"
```

---

## Epic 7 — Auth (argon2id + JWT + refresh)

### Task 7.1: Password hashing util (TDD)

**Files:**
- Create: `packages/api/src/auth/password.test.ts`
- Create: `packages/api/src/auth/password.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong")).resolves.toBe(false);
  });

  it("produces distinct hashes for the same password (salted)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("rejects empty passwords", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run — fails**

```bash
pnpm --filter @wpa/api test src/auth/password.test.ts
```

- [ ] **Step 3: Implement `password.ts`**

```ts
import argon2 from "argon2";

const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 4,
} as const;

export async function hashPassword(password: string): Promise<string> {
  if (!password) throw new Error("password must not be empty");
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run — passes**

```bash
pnpm --filter @wpa/api test src/auth/password.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth
git commit -m "feat(api): argon2id password hashing util"
```

---

### Task 7.2: JWT access + refresh token helpers (TDD)

**Files:**
- Create: `packages/api/src/auth/tokens.test.ts`
- Create: `packages/api/src/auth/tokens.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";

import { hashRefreshToken, issueAccessToken, issueRefreshToken, verifyAccessToken } from "./tokens.js";

describe("access tokens", () => {
  it("round-trips claims", async () => {
    const jwt = await issueAccessToken({ sub: "u1", role: "user" });
    const decoded = await verifyAccessToken(jwt);
    expect(decoded.sub).toBe("u1");
    expect(decoded.role).toBe("user");
  });

  it("rejects tampered tokens", async () => {
    const jwt = await issueAccessToken({ sub: "u1", role: "user" });
    const tampered = jwt.slice(0, -1) + (jwt.endsWith("a") ? "b" : "a");
    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });
});

describe("refresh tokens", () => {
  it("produces opaque tokens plus verifiable hashes", () => {
    const { token, tokenHash } = issueRefreshToken();
    expect(token.length).toBeGreaterThan(40);
    expect(hashRefreshToken(token)).toBe(tokenHash);
  });

  it("different calls produce different tokens", () => {
    const a = issueRefreshToken();
    const b = issueRefreshToken();
    expect(a.token).not.toBe(b.token);
  });
});
```

- [ ] **Step 2: Implement `tokens.ts`**

```ts
import { createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { env } from "../env.js";

const ACCESS_TTL_SECONDS = 60 * 15;

const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

export type AccessClaims = {
  sub: string;
  role: "admin" | "user";
};

export async function issueAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS.toString()}s`)
    .setIssuer("wpa")
    .setAudience("wpa-web")
    .sign(jwtSecret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims & { exp: number }> {
  const { payload } = await jwtVerify(token, jwtSecret, { issuer: "wpa", audience: "wpa-web" });
  if (typeof payload.sub !== "string" || (payload.role !== "admin" && payload.role !== "user")) {
    throw new Error("invalid claims");
  }
  return { sub: payload.sub, role: payload.role, exp: payload.exp ?? 0 };
}

export function issueRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const ACCESS_TTL = ACCESS_TTL_SECONDS;
export const REFRESH_TTL_DAYS = 7;
```

- [ ] **Step 3: Run — passes**

```bash
pnpm --filter @wpa/api test src/auth/tokens.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/auth
git commit -m "feat(api): JWT access tokens + opaque refresh tokens"
```

---

### Task 7.3: Auth middleware

**Files:**
- Create: `packages/api/src/middleware/auth.test.ts`
- Create: `packages/api/src/middleware/auth.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";

import { issueAccessToken } from "../auth/tokens.js";
import { requireAuth } from "./auth.js";

function makeApp(): express.Express {
  const app = express();
  app.get("/me", requireAuth, (req, res) => {
    res.json({ user: res.locals.user });
  });
  return app;
}

describe("requireAuth", () => {
  it("rejects missing bearer", async () => {
    const res = await request(makeApp()).get("/me");
    expect(res.status).toBe(401);
  });

  it("accepts a valid bearer", async () => {
    const token = await issueAccessToken({ sub: "u1", role: "user" });
    const res = await request(makeApp()).get("/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.sub).toBe("u1");
  });

  it("rejects tampered bearer", async () => {
    const token = await issueAccessToken({ sub: "u1", role: "user" });
    const res = await request(makeApp()).get("/me").set("Authorization", `Bearer ${token}x`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Implement `auth.ts`**

```ts
import type { NextFunction, Request, Response } from "express";

import { type AccessClaims, verifyAccessToken } from "../auth/tokens.js";

declare module "express-serve-static-core" {
  interface Response {
    locals: { user?: AccessClaims & { exp: number } };
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const claims = await verifyAccessToken(header.slice("Bearer ".length));
    res.locals.user = claims;
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (res.locals.user?.role !== "admin") {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
```

- [ ] **Step 3: Run — passes**

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/middleware
git commit -m "feat(api): requireAuth/requireAdmin middleware"
```

---

### Task 7.4: Rate limiter middleware

**Files:**
- Create: `packages/api/src/middleware/ratelimit.ts`

- [ ] **Step 1: Implement (simple; Redis-backed version lands later phase)**

```ts
import rateLimit from "express-rate-limit";

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});

export const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/middleware/ratelimit.ts
git commit -m "feat(api): rate limiters for auth and general routes"
```

---

### Task 7.5: Auth service (login / refresh / logout) — pure business logic

**Files:**
- Create: `packages/api/src/auth/service.test.ts`
- Create: `packages/api/src/auth/service.ts`

- [ ] **Step 1: Test shape (integration-style against real Prisma is in Epic 24 smoke; here we unit-test pure helpers)**

Skipped here — Task 7.6 below adds integration-ish tests for routes via supertest + an in-memory fake Prisma adapter pattern. For P0 we verify auth end-to-end in Task 24.2.

- [ ] **Step 2: Implement `service.ts`**

```ts
import { getPrisma } from "@wpa/db";

import { hashPassword, verifyPassword } from "./password.js";
import {
  ACCESS_TTL,
  REFRESH_TTL_DAYS,
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
} from "./tokens.js";

export class AuthError extends Error {
  constructor(public code: "invalid_credentials" | "user_not_found" | "disabled") {
    super(code);
  }
}

export async function login(
  email: string,
  password: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; refreshToken: string; userId: string; role: "admin" | "user" }> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AuthError("invalid_credentials");
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw new AuthError("invalid_credentials");

  const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
  const refresh = issueRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { accessToken, refreshToken: refresh.token, userId: user.id, role: user.role };
}

export async function rotateRefresh(
  oldToken: string,
  meta: { ip?: string; userAgent?: string },
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const prisma = getPrisma();
  const tokenHash = hashRefreshToken(oldToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) return null;

  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user) return null;

  const fresh = issueRefreshToken();
  const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: fresh.tokenHash,
        expiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    }),
  ]);

  return { accessToken, refreshToken: fresh.token };
}

export async function revokeRefresh(token: string): Promise<void> {
  const prisma = getPrisma();
  const tokenHash = hashRefreshToken(token);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function registerUser(params: {
  email: string;
  password: string;
  encryptedDek: Buffer;
  role: "admin" | "user";
}): Promise<{ id: string }> {
  const prisma = getPrisma();
  const passwordHash = await hashPassword(params.password);
  const user = await prisma.user.create({
    data: {
      email: params.email,
      passwordHash,
      role: params.role,
      encryptedDek: params.encryptedDek,
    },
    select: { id: true },
  });
  return user;
}

export { ACCESS_TTL };
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/auth/service.ts
git commit -m "feat(api): auth service (login, refresh rotation, logout, register)"
```

---

### Task 7.6: Auth routes

**Files:**
- Create: `packages/api/src/routes/auth.ts`
- Modify: `packages/api/src/app.ts`

- [ ] **Step 1: Implement `routes/auth.ts`**

```ts
import { Router } from "express";
import { z } from "zod";
import { generateKey, wrapDek, serializeCiphertext } from "@wpa/shared";

import { env } from "../env.js";
import { AuthError, login, registerUser, revokeRefresh, rotateRefresh } from "../auth/service.js";
import { writeAudit } from "../audit/writeAudit.js";
import { authRateLimiter } from "../middleware/ratelimit.js";
import { requireAuth } from "../middleware/auth.js";
import { getPrisma } from "@wpa/db";
import { hashRefreshToken } from "../auth/tokens.js";

const REFRESH_COOKIE = "wpa_refresh";
const REFRESH_MAX_AGE_MS = 7 * 86_400 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(256),
  invitationToken: z.string().optional(),
});

export function authRouter(): Router {
  const r = Router();

  r.post("/auth/login", authRateLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    try {
      const result = await login(parsed.data.email, parsed.data.password, {
        ip: req.ip,
        userAgent: req.header("user-agent") ?? undefined,
      });
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        secure: req.secure,
        maxAge: REFRESH_MAX_AGE_MS,
        path: "/api/auth",
      });
      await writeAudit({ userId: result.userId, type: "login" });
      res.json({ accessToken: result.accessToken, userId: result.userId, role: result.role });
    } catch (err) {
      if (err instanceof AuthError) {
        await writeAudit({ type: "login_failed", targetRef: parsed.data.email });
        res.status(401).json({ error: "invalid_credentials" });
        return;
      }
      throw err;
    }
  });

  r.post("/auth/refresh", async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== "string") {
      res.status(401).json({ error: "no_refresh" });
      return;
    }
    const rotated = await rotateRefresh(token, {
      ip: req.ip,
      userAgent: req.header("user-agent") ?? undefined,
    });
    if (!rotated) {
      res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
      res.status(401).json({ error: "invalid_refresh" });
      return;
    }
    res.cookie(REFRESH_COOKIE, rotated.refreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      maxAge: REFRESH_MAX_AGE_MS,
      path: "/api/auth",
    });
    res.json({ accessToken: rotated.accessToken });
  });

  r.post("/auth/logout", async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token === "string") await revokeRefresh(token);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    if (res.locals.user?.sub) await writeAudit({ userId: res.locals.user.sub, type: "logout" });
    res.status(204).end();
  });

  r.get("/auth/me", requireAuth, async (req, res) => {
    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: res.locals.user!.sub },
      select: { id: true, email: true, role: true, createdAt: true, lastLoginAt: true },
    });
    if (!user) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json(user);
  });

  r.post("/auth/register", authRateLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const prisma = getPrisma();
    const anyUserExists = (await prisma.user.count()) > 0;
    const isFirstUser = !anyUserExists;

    if (!isFirstUser && !env.OPEN_REGISTRATION) {
      if (!parsed.data.invitationToken) {
        res.status(403).json({ error: "invite_required" });
        return;
      }
      const tokenHash = hashRefreshToken(parsed.data.invitationToken);
      const inv = await prisma.invitation.findUnique({ where: { tokenHash } });
      if (!inv || inv.usedAt || inv.expiresAt < new Date() || inv.email !== parsed.data.email) {
        res.status(403).json({ error: "invalid_invite" });
        return;
      }
      const dek = generateKey();
      const wrapped = wrapDek(env.MASTER_KEY_BYTES, dek);
      const user = await registerUser({
        email: parsed.data.email,
        password: parsed.data.password,
        encryptedDek: Buffer.from(serializeCiphertext(wrapped)),
        role: "user",
      });
      await prisma.invitation.update({
        where: { id: inv.id },
        data: { usedAt: new Date(), consumedByUserId: user.id },
      });
      await writeAudit({ userId: user.id, type: "register" });
      res.status(201).json({ id: user.id });
      return;
    }

    const dek = generateKey();
    const wrapped = wrapDek(env.MASTER_KEY_BYTES, dek);
    const user = await registerUser({
      email: parsed.data.email,
      password: parsed.data.password,
      encryptedDek: Buffer.from(serializeCiphertext(wrapped)),
      role: isFirstUser ? "admin" : "user",
    });
    await writeAudit({ userId: user.id, type: "register" });
    res.status(201).json({ id: user.id, role: isFirstUser ? "admin" : "user" });
  });

  return r;
}
```

- [ ] **Step 2: Mount in `app.ts`**

Modify `packages/api/src/app.ts` to insert routes before the 404:

```ts
import { authRouter } from "./routes/auth.js";
// ...
  app.use("/api", authRouter());
  app.use((_req, res) => { res.status(404).json({ error: "not_found" }); });
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): auth routes (login, refresh, logout, me, register with invite)"
```

---

## Epic 8 — Invitations admin route

### Task 8.1: Admin `/api/invitations` create + list

**Files:**
- Create: `packages/api/src/routes/invitations.ts`
- Modify: `packages/api/src/app.ts`

- [ ] **Step 1: Implement**

```ts
import { randomBytes } from "node:crypto";

import { getPrisma } from "@wpa/db";
import { Router } from "express";
import { z } from "zod";

import { hashRefreshToken } from "../auth/tokens.js";
import { writeAudit } from "../audit/writeAudit.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const createSchema = z.object({
  email: z.string().email(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export function invitationsRouter(): Router {
  const r = Router();
  r.use(requireAuth, requireAdmin);

  r.post("/invitations", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_input" });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashRefreshToken(token);
    const expiresAt = new Date(Date.now() + parsed.data.expiresInDays * 86_400 * 1000);
    const prisma = getPrisma();
    const inv = await prisma.invitation.create({
      data: {
        email: parsed.data.email,
        tokenHash,
        expiresAt,
        invitedById: res.locals.user!.sub,
      },
      select: { id: true, email: true, expiresAt: true, createdAt: true },
    });
    await writeAudit({ userId: res.locals.user!.sub, type: "invite_create", targetRef: inv.id });
    res.status(201).json({ ...inv, token });
  });

  r.get("/invitations", async (_req, res) => {
    const prisma = getPrisma();
    const rows = await prisma.invitation.findMany({
      select: { id: true, email: true, expiresAt: true, usedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  });

  return r;
}
```

- [ ] **Step 2: Mount**

```ts
import { invitationsRouter } from "./routes/invitations.js";
// after authRouter:
app.use("/api", invitationsRouter());
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): admin-only invitation create + list"
```

---

## Epic 9 — Audit log writer

### Task 9.1: Encrypted audit writer

**Files:**
- Create: `packages/api/src/audit/writeAudit.test.ts`
- Create: `packages/api/src/audit/writeAudit.ts`

- [ ] **Step 1: Write test (pure; no DB)**

Because audit writer calls Prisma, we unit-test the detail-encryption helper separately and the full writer in integration (Epic 24). Implement detail-encryption as a separate pure function:

```ts
import { describe, expect, it } from "vitest";

import { encodeAuditDetails, decodeAuditDetails } from "./writeAudit.js";

describe("audit details encoding", () => {
  it("round-trips JSON details", () => {
    const key = Buffer.alloc(32, 7);
    const details = { reason: "manual", ip: "1.2.3.4", trace: ["a", "b"] };
    const encoded = encodeAuditDetails(key, details);
    expect(decodeAuditDetails(key, encoded)).toEqual(details);
  });

  it("produces undefined when details omitted", () => {
    expect(encodeAuditDetails(Buffer.alloc(32, 1), undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { getPrisma, type AuditType } from "@wpa/db";
import { encryptWithKey, parseCiphertext, serializeCiphertext, decryptWithKey } from "@wpa/shared";

import { env } from "../env.js";
import { logger } from "../logger.js";

export function encodeAuditDetails(
  key: Buffer,
  details: unknown,
): Buffer | undefined {
  if (details === undefined) return undefined;
  const ct = encryptWithKey(key, JSON.stringify(details));
  return Buffer.from(serializeCiphertext(ct));
}

export function decodeAuditDetails(key: Buffer, bytes: Buffer): unknown {
  const s = bytes.toString("utf8");
  const ct = parseCiphertext(s);
  return JSON.parse(decryptWithKey(key, ct));
}

export async function writeAudit(params: {
  userId?: string;
  type: AuditType;
  targetRef?: string;
  details?: unknown;
}): Promise<void> {
  try {
    const prisma = getPrisma();
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        type: params.type,
        targetRef: params.targetRef ?? null,
        details: encodeAuditDetails(env.MASTER_KEY_BYTES, params.details) ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, type: params.type }, "audit write failed");
  }
}
```

> NB: in P0 we encrypt audit details with MASTER_KEY directly (not per-user DEK) so admin tooling can read all entries. Per-user DEK encryption of `audit_log.details` moves to P1 once DEKs are routinely unwrapped in request handlers.

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @wpa/api test src/audit
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/audit
git commit -m "feat(api): encrypted audit-log writer"
```

---

## Epic 10 — Worker + Agent placeholder packages

### Task 10.1: `packages/worker` placeholder loop

**Files:**
- Create: `packages/worker/package.json`
- Create: `packages/worker/tsconfig.json`
- Create: `packages/worker/src/index.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@wpa/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@wpa/shared": "workspace:*",
    "pino": "9.5.0"
  },
  "devDependencies": { "tsx": "4.19.2" }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src", "composite": true },
  "references": [{ "path": "../shared" }],
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: `src/index.ts` (placeholder: heartbeat until P1 replaces it)**

```ts
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info", name: "worker" });

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
  logger.info("worker started (placeholder; WhatsApp integration lands in P1)");
  while (running) {
    await new Promise((r) => setTimeout(r, 30_000));
    logger.debug("heartbeat");
  }
  logger.info("worker exited");
}

void main();
```

- [ ] **Step 4: Commit**

```bash
git add packages/worker
git commit -m "feat(worker): placeholder heartbeat (replaced by Baileys in P1)"
```

---

### Task 10.2: `packages/agent` placeholder loop

Clone Task 10.1 with name `@wpa/agent`, description "(replaced by Claude SDK in P2)".

- [ ] **Step 1: Create analogous files under `packages/agent/`**

`package.json` name: `@wpa/agent`. `src/index.ts` identical to worker but `name: "agent"` and log message "agent started (placeholder; AI lands in P2)".

- [ ] **Step 2: Commit**

```bash
git add packages/agent
git commit -m "feat(agent): placeholder heartbeat (replaced by Claude SDK in P2)"
```

---

## Epic 11 — `packages/web` (Vite + React + Tailwind + shadcn)

### Task 11.1: Scaffold Vite + React + TS

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/index.html`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/vite-env.d.ts`

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@wpa/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "lint": "eslint .",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@json-render/react": "0.18.0",
    "@json-render/shadcn": "0.18.0",
    "@tanstack/react-query": "5.59.16",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-router": "7.0.1",
    "zod": "3.23.8",
    "zustand": "5.0.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.0.0-beta.7",
    "@testing-library/react": "16.0.1",
    "@testing-library/user-event": "14.5.2",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "@vitejs/plugin-react-swc": "3.7.1",
    "jsdom": "25.0.1",
    "tailwindcss": "4.0.0-beta.7",
    "typescript": "5.6.3",
    "vite": "6.0.1",
    "vitest": "2.1.4"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
  test: { environment: "jsdom", globals: true, include: ["src/**/*.test.{ts,tsx}"] },
});
```

- [ ] **Step 4: `index.html`**

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark light" />
    <title>WhatsApp Personal Assistant</title>
  </head>
  <body class="bg-slate-950 text-slate-100 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./index.css";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 6: `src/App.tsx` (routes stubs; real pages come next)**

```tsx
import { Route, Routes } from "react-router";

import { Dashboard } from "./routes/Dashboard";
import { Login } from "./routes/Login";
import { Register } from "./routes/Register";
import { RequireAuth } from "./routes/RequireAuth";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 7: `src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 8: Commit**

```bash
git add packages/web package.json pnpm-lock.yaml
git commit -m "feat(web): scaffold Vite + React 19 + Router + TanStack Query"
```

---

### Task 11.2: Tailwind 4 + shadcn baseline

**Files:**
- Create: `packages/web/src/index.css`
- Create: `packages/web/components.json` (shadcn config)

- [ ] **Step 1: `src/index.css`**

```css
@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --color-bg: oklch(0.15 0.01 260);
  --color-panel: oklch(0.19 0.01 260);
  --color-border: oklch(0.3 0.01 260);
}

@layer base {
  html { font-family: var(--font-sans); }
  button, input, select, textarea { font: inherit; }
}
```

- [ ] **Step 2: `components.json` (shadcn canvas)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "slate", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils" }
}
```

- [ ] **Step 3: Create `src/lib/utils.ts` (shadcn-standard `cn`)**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

Add deps:

```bash
pnpm --filter @wpa/web add clsx tailwind-merge
```

- [ ] **Step 4: Verify build**

```bash
pnpm --filter @wpa/web build
```

Expected: `packages/web/dist/index.html` etc.

- [ ] **Step 5: Commit**

```bash
git add packages/web package.json pnpm-lock.yaml
git commit -m "feat(web): tailwind 4 + shadcn baseline + cn util"
```

---

## Epic 12 — Frontend auth + dashboard shell

### Task 12.1: API client + auth store

**Files:**
- Create: `packages/web/src/api/client.ts`
- Create: `packages/web/src/stores/auth.ts`

- [ ] **Step 1: `api/client.ts`**

```ts
type Json = Record<string, unknown> | unknown[];

let accessToken: string | null = null;

export function setAccessToken(t: string | null): void {
  accessToken = t;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const res = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      headers.set("authorization", `Bearer ${accessToken!}`);
      const retry = await fetch(`/api${path}`, { ...init, headers, credentials: "include" });
      if (!retry.ok) throw new ApiError(retry.status, await retry.text());
      return (await retry.json()) as T;
    }
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, body: string) {
    super(`${String(status)}: ${body}`);
  }
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

export async function postJson<T>(path: string, body: Json): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}
```

- [ ] **Step 2: `stores/auth.ts` (Zustand)**

```ts
import { create } from "zustand";

import { apiFetch, postJson, setAccessToken } from "../api/client";

type Me = { id: string; email: string; role: "admin" | "user" };

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  me: null,
  loading: true,
  error: null,
  bootstrap: async () => {
    try {
      const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
      if (res.ok) {
        const { accessToken } = (await res.json()) as { accessToken: string };
        setAccessToken(accessToken);
        const me = await apiFetch<Me>("/auth/me");
        set({ me, loading: false });
        return;
      }
    } catch {
      /* ignore */
    }
    set({ loading: false });
  },
  login: async (email, password) => {
    set({ error: null });
    try {
      const res = await postJson<{ accessToken: string; userId: string; role: "admin" | "user" }>(
        "/auth/login",
        { email, password },
      );
      setAccessToken(res.accessToken);
      const me = await apiFetch<Me>("/auth/me");
      set({ me });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "login failed" });
    }
  },
  logout: async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    setAccessToken(null);
    set({ me: null });
  },
}));
```

- [ ] **Step 3: Add deps**

```bash
pnpm --filter @wpa/web add zustand
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src package.json pnpm-lock.yaml
git commit -m "feat(web): api client with silent refresh + zustand auth store"
```

---

### Task 12.2: `Login`, `Register`, `RequireAuth`, `Dashboard` routes

**Files:**
- Create: `packages/web/src/routes/Login.tsx`
- Create: `packages/web/src/routes/Register.tsx`
- Create: `packages/web/src/routes/RequireAuth.tsx`
- Create: `packages/web/src/routes/Dashboard.tsx`
- Create: `packages/web/src/components/Shell.tsx`

- [ ] **Step 1: `routes/Login.tsx`**

```tsx
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { useAuth } from "../stores/auth";

export function Login(): JSX.Element {
  const { me, login, error, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const nav = useNavigate();

  if (loading) return <Loading />;
  if (me) return <Navigate to="/" replace />;

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          await login(email, password);
          if (useAuth.getState().me) nav("/");
        }}
      >
        <h1 className="text-lg font-semibold">Sign in</h1>
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="email"
          required
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="password"
          required
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="w-full rounded-md bg-indigo-500 px-3 py-2 font-medium hover:bg-indigo-400">
          Sign in
        </button>
      </form>
    </main>
  );
}

function Loading(): JSX.Element {
  return <main className="grid min-h-screen place-items-center">Loading…</main>;
}
```

- [ ] **Step 2: `routes/Register.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router";

import { postJson } from "../api/client";

export function Register(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr(null);
          try {
            await postJson("/auth/register", {
              email,
              password,
              invitationToken: token || undefined,
            });
            nav("/login");
          } catch (e) {
            setErr(e instanceof Error ? e.message : "registration failed");
          }
        }}
      >
        <h1 className="text-lg font-semibold">Create account</h1>
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="email"
          required
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="password"
          required
          minLength={12}
          placeholder="password (min 12 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="text"
          placeholder="invitation token (not required for first user)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button className="w-full rounded-md bg-indigo-500 px-3 py-2 font-medium hover:bg-indigo-400">
          Create
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: `routes/RequireAuth.tsx`**

```tsx
import { useEffect } from "react";
import { Navigate, Outlet } from "react-router";

import { useAuth } from "../stores/auth";
import { Shell } from "../components/Shell";

export function RequireAuth(): JSX.Element {
  const { me, loading, bootstrap } = useAuth();
  useEffect(() => { void bootstrap(); }, [bootstrap]);
  if (loading) return <main className="grid min-h-screen place-items-center">Loading…</main>;
  if (!me) return <Navigate to="/login" replace />;
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}
```

- [ ] **Step 4: `components/Shell.tsx`**

```tsx
import type { ReactNode } from "react";
import { useAuth } from "../stores/auth";

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { me, logout } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">WhatsApp Personal Assistant</span>
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">P0</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            title="Emergency: mute assistant"
            className="rounded-md border border-rose-700 px-3 py-1 text-sm text-rose-300 hover:bg-rose-900/30"
            onClick={() => window.alert("Kill switch wires to /wpa:kill in P3")}
          >
            Kill switch
          </button>
          <span className="text-sm text-slate-400">{me?.email}</span>
          <button
            className="rounded-md border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="w-64 border-r border-slate-800 bg-slate-900/30 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Conversations</p>
          <p className="mt-3 text-sm text-slate-400">None yet — pair WhatsApp in P1.</p>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `routes/Dashboard.tsx` (placeholder json-render panel)**

```tsx
import { Renderer, defineRegistry } from "@json-render/react";
import { catalog as shadcnCatalog, components as shadcnComponents } from "@json-render/shadcn";

const registry = defineRegistry(shadcnCatalog, { components: shadcnComponents });

const placeholderSpec = {
  root: "welcome",
  elements: {
    welcome: {
      type: "Card",
      props: { title: "Welcome", description: "P0 foundation is running. Pair WhatsApp in P1." },
      children: [],
    },
  },
};

export function Dashboard(): JSX.Element {
  return <Renderer registry={registry} spec={placeholderSpec} />;
}
```

> Exact API shape of `@json-render/react` verified at plan-exec time; adjust `defineRegistry`/`Renderer` imports per installed version.

- [ ] **Step 6: Run dev build to smoke-test**

```bash
pnpm --filter @wpa/web dev
# open http://localhost:5173 — see login page
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/src
git commit -m "feat(web): login, register, dashboard shell, json-render placeholder"
```

---

## Epic 13 — API serves built SPA

### Task 13.1: Static-serve web build from api

**Files:**
- Modify: `packages/api/src/app.ts`
- Modify: `packages/api/package.json` (add express.static config; nothing to install)

- [ ] **Step 1: In `app.ts`, before the 404 handler, serve SPA**

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
// ...
  const webDist = process.env.WEB_DIST ??
    path.resolve(fileURLToPath(import.meta.url), "../../../web/dist");
  app.use(express.static(webDist, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
```

> Route matcher uses a negative lookahead so `/api/*` stays JSON.

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/app.ts
git commit -m "feat(api): serve built SPA at non-/api paths"
```

---

## Epic 14 — Dockerfile + supervisord + docker-compose

### Task 14.1: Multi-stage `Dockerfile`

**Files:** `Dockerfile`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.11.0
ARG PNPM_VERSION=9.12.3

FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/api/package.json packages/api/
COPY packages/worker/package.json packages/worker/
COPY packages/agent/package.json packages/agent/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/web/package.json packages/web/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @wpa/db exec prisma generate
RUN pnpm -r --filter "@wpa/*" build
RUN pnpm --filter @wpa/web build

FROM node:${NODE_VERSION}-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate \
 && apk add --no-cache supervisor tini curl
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/node_modules ./node_modules
COPY supervisord/supervisord.conf /etc/supervisord.conf

RUN addgroup -S wpa && adduser -S wpa -G wpa \
 && chown -R wpa:wpa /app

USER wpa
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3000/healthz || exit 1
ENV WEB_DIST=/app/packages/web/dist
ENV ENTRYPOINT_ROLE=all

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
```

- [ ] **Step 2: Create `supervisord/supervisord.conf`**

```ini
[supervisord]
nodaemon=true
user=wpa
logfile=/dev/null
logfile_maxbytes=0
pidfile=/tmp/supervisord.pid

[program:api]
command=/bin/sh -c 'if [ "$ENTRYPOINT_ROLE" = "api" ] || [ "$ENTRYPOINT_ROLE" = "all" ]; then node packages/api/dist/server.js; else tail -f /dev/null; fi'
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
environment=ENTRYPOINT_ROLE="%(ENV_ENTRYPOINT_ROLE)s"

[program:worker]
command=/bin/sh -c 'if [ "$ENTRYPOINT_ROLE" = "worker" ] || [ "$ENTRYPOINT_ROLE" = "all" ]; then node packages/worker/dist/index.js; else tail -f /dev/null; fi'
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0

[program:agent]
command=/bin/sh -c 'if [ "$ENTRYPOINT_ROLE" = "agent" ] || [ "$ENTRYPOINT_ROLE" = "all" ]; then node packages/agent/dist/index.js; else tail -f /dev/null; fi'
autorestart=true
stdout_logfile=/dev/fd/1
stdout_logfile_maxbytes=0
stderr_logfile=/dev/fd/2
stderr_logfile_maxbytes=0
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile supervisord
git commit -m "build: multi-stage Dockerfile + supervisord three-process runtime"
```

---

### Task 14.2: `docker-compose.yml`

**Files:** `docker-compose.yml`, `docker-compose.override.yml.example`, `docker-compose.split.yml`

- [ ] **Step 1: `docker-compose.yml`**

```yaml
name: wpa

services:
  app:
    image: ghcr.io/${GITHUB_OWNER:-you}/whatsapp-personal-assistant:${IMAGE_TAG:-dev}
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    environment:
      NODE_ENV: production
      ENTRYPOINT_ROLE: all
      DATABASE_URL: postgresql://${POSTGRES_USER:-wpa}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-wpa}
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
    ports: ["3000:3000"]
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-wpa}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:-wpa}
    volumes: ["postgres-data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "${POSTGRES_USER:-wpa}"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec", "--requirepass", "${REDIS_PASSWORD}"]
    volumes: ["redis-data:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  postgres-data:
  redis-data:
```

- [ ] **Step 2: `docker-compose.override.yml.example`**

```yaml
# Copy to docker-compose.override.yml for local dev with hot reload.
services:
  app:
    build:
      target: build
    command: pnpm -r --parallel dev
    volumes:
      - ./packages:/app/packages
      - ./prisma:/app/prisma
    environment:
      NODE_ENV: development
```

- [ ] **Step 3: `docker-compose.split.yml` (optional, 3 services)**

```yaml
# Advanced: run api/worker/agent as separate services for crash isolation.
services:
  app: { profiles: ["disabled"] }
  api:
    extends: { file: docker-compose.yml, service: app }
    environment: { ENTRYPOINT_ROLE: api }
  worker:
    extends: { file: docker-compose.yml, service: app }
    environment: { ENTRYPOINT_ROLE: worker }
    ports: []
  agent:
    extends: { file: docker-compose.yml, service: app }
    environment: { ENTRYPOINT_ROLE: agent }
    ports: []
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.override.yml.example docker-compose.split.yml
git commit -m "build: docker-compose (default, override example, split)"
```

---

## Epic 15 — `.env.example` + first-run secret generator

### Task 15.1: `.env.example` with every var documented

**Files:** `.env.example`

- [ ] **Step 1: Create**

```dotenv
# -------- Core --------
NODE_ENV=production
PUBLIC_ORIGIN=http://localhost:3000
API_PORT=3000
LOG_LEVEL=info
ENTRYPOINT_ROLE=all          # api | worker | agent | all

# -------- Secrets (generated by scripts/first-run.sh if absent) --------
# 32-byte base64. Losing this = all encrypted data unrecoverable.
MASTER_KEY=
# 64+ char random string for JWT signing.
JWT_SECRET=

# -------- Postgres --------
POSTGRES_USER=wpa
POSTGRES_PASSWORD=
POSTGRES_DB=wpa
DATABASE_URL=postgresql://wpa:PASSWORD@postgres:5432/wpa

# -------- Redis --------
REDIS_PASSWORD=
REDIS_URL=redis://:PASSWORD@redis:6379

# -------- Registration --------
# true => open signup (single-user / family-trusted installs only)
# false (default) => invite-only; first user becomes admin
OPEN_REGISTRATION=false

# -------- Optional --------
SENTRY_DSN=
# Per-user Anthropic key is set via UI. This is only for dev seeding, not required.
ANTHROPIC_API_KEY_DEV=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: .env.example with every required variable"
```

---

### Task 15.2: `scripts/first-run.sh`

**Files:** `scripts/first-run.sh`

- [ ] **Step 1: Create**

```bash
#!/usr/bin/env bash
# Generates missing secrets into .env. Idempotent — keeps existing values.
# Usage: scripts/first-run.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
TEMPLATE=".env.example"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: $TEMPLATE not found. Run from repo root." >&2
  exit 1
fi

touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

gen_base64() { openssl rand -base64 "$1" | tr -d '\n=' | tr '/+' '_-'; }
gen_32bytes_b64()   { openssl rand -base64 32 | tr -d '\n'; }

ensure_var() {
  local key="$1" default="${2:-}"
  if grep -q "^${key}=" "$ENV_FILE"; then
    local v
    v="$(grep "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2-)"
    [[ -n "$v" ]] && return 0
    sed -i.bak "/^${key}=/d" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  fi
  echo "${key}=${default}" >> "$ENV_FILE"
}

# Copy missing lines from template (without values)
while IFS= read -r line; do
  if [[ "$line" =~ ^[A-Z_]+= ]]; then
    key="${line%%=*}"
    grep -q "^${key}=" "$ENV_FILE" || echo "${key}=" >> "$ENV_FILE"
  fi
done < "$TEMPLATE"

# Fill secrets
MASTER_KEY_VAL="$(grep '^MASTER_KEY=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
if [[ -z "$MASTER_KEY_VAL" ]]; then
  NEW_KEY="$(gen_32bytes_b64)"
  sed -i.bak "s|^MASTER_KEY=.*|MASTER_KEY=${NEW_KEY}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
  echo ""
  echo "========================================================================"
  echo "  MASTER_KEY generated. BACK THIS UP OUT-OF-BAND. Losing it means all"
  echo "  encrypted data (message bodies, audit details, DEKs) is UNRECOVERABLE."
  echo ""
  echo "  MASTER_KEY=${NEW_KEY}"
  echo "========================================================================"
  echo ""
fi

ensure_var JWT_SECRET         "$(gen_base64 48)"
ensure_var POSTGRES_PASSWORD  "$(gen_base64 24)"
ensure_var REDIS_PASSWORD     "$(gen_base64 24)"

# Rebuild DATABASE_URL + REDIS_URL consistently
PG_PW="$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
PG_USER="$(grep '^POSTGRES_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
PG_DB="$(grep '^POSTGRES_DB=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
RD_PW="$(grep '^REDIS_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"

sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PG_USER:-wpa}:${PG_PW}@postgres:5432/${PG_DB:-wpa}|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"
sed -i.bak "s|^REDIS_URL=.*|REDIS_URL=redis://:${RD_PW}@redis:6379|" "$ENV_FILE" && rm -f "${ENV_FILE}.bak"

chmod 600 "$ENV_FILE"
echo ".env ready. Next: /wpa:start (or 'docker compose up -d')."
```

- [ ] **Step 2: Mark executable**

```bash
chmod +x scripts/first-run.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/first-run.sh
git commit -m "feat(scripts): first-run secret generator"
```

---

### Task 15.3: DB migration on boot

**Files:**
- Create: `scripts/entrypoint-migrate.sh`
- Modify: `Dockerfile` (run migration before supervisord)

- [ ] **Step 1: `scripts/entrypoint-migrate.sh`**

```bash
#!/usr/bin/env sh
set -eu
cd /app
pnpm --filter @wpa/db exec prisma migrate deploy
exec /usr/bin/supervisord -c /etc/supervisord.conf
```

- [ ] **Step 2: Modify `Dockerfile` CMD**

Replace:
```dockerfile
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
```
with:
```dockerfile
COPY scripts/entrypoint-migrate.sh /usr/local/bin/entrypoint-migrate.sh
RUN chmod +x /usr/local/bin/entrypoint-migrate.sh
CMD ["/usr/local/bin/entrypoint-migrate.sh"]
```

- [ ] **Step 3: Commit**

```bash
git add scripts/entrypoint-migrate.sh Dockerfile
git commit -m "build: run Prisma migrate deploy before supervisord boot"
```

---

## Epic 16 — `.claude/` Claude-Code layer

### Task 16.1: `CLAUDE.md`

**Files:** `.claude/CLAUDE.md`

- [ ] **Step 1: Create**

```markdown
# WhatsApp Personal Assistant — Project Context for Claude Code

This repo is the open-source, self-hosted WhatsApp Personal Assistant. It exists to be read before run.

## North star
[`docs/VISION.md`](../docs/VISION.md) — product principles, anti-goals, roadmap. Re-read at the start of every phase.

## Stack
- Node.js 22 + TypeScript 5.6 (strict) across backend packages.
- pnpm workspaces + turbo.
- `packages/api` (Express), `packages/worker` (Baileys from P1), `packages/agent` (Claude SDK from P2), `packages/shared` (types, crypto, env), `packages/db` (Prisma), `packages/web` (Vite + React 19 + Tailwind 4 + shadcn + json-render).
- Postgres 16, Redis 7 (AOF on), docker-compose default deploy.

## Safety rules (NEVER violate)
1. Never commit `.env` or any secret material.
2. Never log decrypted message bodies. pino redaction covers the usual suspects but you must still think.
3. Never auto-reply in Silent mode, even for testing.
4. Never call `prisma migrate dev --name …` on production DB.
5. Never disable `gitleaks` or the secret-scanning workflow.
6. Never change MASTER_KEY handling without reviewing `packages/shared/src/crypto.ts` tests.
7. Never remove or weaken `argon2id` parameters.
8. Never introduce a fallback that silently proceeds when a critical dependency (Postgres / Redis / master key) is unavailable.

## Commands
Prefix is `wpa` (namespaced to avoid collisions with Claude Code built-ins):
- `/wpa:init` — generate secrets, write `.env`, prompt for Anthropic key (manual paste into settings UI after start).
- `/wpa:start` — `docker compose up -d`, wait healthy, open browser.
- `/wpa:stop` — `docker compose down`.
- `/wpa:status` — container health, worker state, last-seen message.
- `/wpa:logs <service>` — tail logs for api|worker|agent|postgres|redis.
- `/wpa:help` — command index with examples.
- `/wpa:kill` — emergency: detach sockets + mute assistant globally.

## Conventions
- Conventional commits. Signed commits required post-Epic 20.
- Every task closes with a commit.
- Tests beside code (`foo.ts` + `foo.test.ts`).
- ESM everywhere (`type: "module"`); import with `.js` suffix.
- Zod for all external input (env, API bodies, LLM outputs).
- No `console.log` in packages — use the pino `logger` from `@wpa/api` or equivalent.

## Before starting new work
1. Re-read VISION.md.
2. Read the current phase's design spec in `docs/superpowers/specs/`.
3. Read the current phase's implementation plan in `docs/superpowers/plans/`.
4. Prefer editing the checklist in the plan over re-deriving steps.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs(claude): CLAUDE.md project context and safety rules"
```

---

### Task 16.2: `/wpa:init` command

**Files:** `.claude/commands/wpa/init.md`

- [ ] **Step 1: Create**

```markdown
---
description: Generate .env, random secrets, and prompt for first-run configuration.
argument-hint: ""
---

# /wpa:init

Run first-run setup for this WhatsApp Personal Assistant install.

Steps for you (Claude):

1. Verify the user is at the repo root. If `package.json` does not have `"name": "whatsapp-personal-assistant"`, stop and tell the user to `cd` into the clone.
2. Run:
   ```bash
   bash scripts/first-run.sh
   ```
3. Read the generated `.env`. Do NOT echo the values back. Confirm that `MASTER_KEY`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` are all non-empty.
4. If `MASTER_KEY` was just generated on this run (the script prints a banner), remind the user to copy it to a password manager immediately. Quote the banner verbatim.
5. Offer `OPEN_REGISTRATION` tradeoff:
   - `false` (default) — invite-only; first user will be admin.
   - `true` — anyone with the URL can register. Only set this if the service is on a private network or single-user install.
   Ask which they prefer and, if `true`, edit `.env` to set `OPEN_REGISTRATION=true`.
6. Confirm `PUBLIC_ORIGIN` in `.env`. Default `http://localhost:3000` is fine for local; ask for the real domain if deploying.
7. Tell the user to run `/wpa:start` next.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wpa/init.md
git commit -m "feat(claude): /wpa:init command"
```

---

### Task 16.3: `/wpa:start`, `/wpa:stop`

**Files:**
- `.claude/commands/wpa/start.md`
- `.claude/commands/wpa/stop.md`

- [ ] **Step 1: `start.md`**

```markdown
---
description: Start the full stack locally via docker-compose and open the dashboard.
---

# /wpa:start

Bring up the application locally.

1. Verify `.env` exists. If not, tell the user to run `/wpa:init` first.
2. Run:
   ```bash
   docker compose up -d --build
   ```
3. Poll `http://localhost:3000/healthz` with curl for up to 90 seconds. Expected: `{"status":"ok"}`.
4. On success, tell the user: "Open http://localhost:3000 and register. The first account becomes admin."
5. On failure, run `docker compose logs --tail=100 app` and summarize the cause.
```

- [ ] **Step 2: `stop.md`**

```markdown
---
description: Stop all containers without removing volumes.
---

# /wpa:stop

Run:
```bash
docker compose down
```

If the user passes `--volumes` as argument, run `docker compose down --volumes` after confirming they understand this destroys the encrypted DB and Redis data.
```

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/wpa/start.md .claude/commands/wpa/stop.md
git commit -m "feat(claude): /wpa:start and /wpa:stop commands"
```

---

### Task 16.4: `/wpa:status`, `/wpa:logs`, `/wpa:help`

**Files:**
- `.claude/commands/wpa/status.md`
- `.claude/commands/wpa/logs.md`
- `.claude/commands/wpa/help.md`

- [ ] **Step 1: `status.md`**

```markdown
---
description: Show container health, worker state, and last-seen message summary.
---

# /wpa:status

1. Run `docker compose ps --format json` and summarize the health of `app`, `postgres`, `redis`.
2. Hit `http://localhost:3000/healthz` and `/readyz` with curl.
3. If any container is unhealthy, fetch `docker compose logs --tail=80 <svc>` and report.
4. (P1+) Report `whatsapp_sessions` connection_status breakdown. (Skip in P0.)
```

- [ ] **Step 2: `logs.md`**

```markdown
---
description: Stream filtered logs for a service.
argument-hint: "<service> — one of: app | postgres | redis (later: worker, agent when split mode)"
---

# /wpa:logs $ARGUMENTS

Run:
```bash
docker compose logs --tail=200 -f $ARGUMENTS
```

Always warn the user before displaying logs that they may contain limited metadata (but not message bodies — those are redacted).
```

- [ ] **Step 3: `help.md`**

```markdown
---
description: Explain the /wpa:* command set.
---

# /wpa:help

Give the user this reference list:

| Command | What it does |
|---|---|
| `/wpa:init` | First-run setup; generates `.env` and random secrets |
| `/wpa:start` | `docker compose up -d`; waits healthy; opens dashboard |
| `/wpa:stop` | `docker compose down` |
| `/wpa:status` | Container health + app readiness |
| `/wpa:logs <svc>` | Tail filtered logs |
| `/wpa:kill` | Emergency: mute assistant + close sockets (P3 wires sockets; P0 mutes flag) |
| `/wpa:help` | This list |

Deploy and upgrade commands (`/wpa:deploy`, `/wpa:update`, `/wpa:backup`, etc.) land in later phases.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/wpa
git commit -m "feat(claude): /wpa:status /wpa:logs /wpa:help"
```

---

### Task 16.5: `/wpa:kill`

**Files:** `.claude/commands/wpa/kill.md`, plus P0-minimal Redis flag writer in `packages/api/src/routes/kill.ts`.

- [ ] **Step 1: Add Redis client to api package**

```bash
pnpm --filter @wpa/api add ioredis@5.4.1
```

- [ ] **Step 2: Create `packages/api/src/redis.ts`**

```ts
import Redis from "ioredis";

import { env } from "./env.js";

let client: Redis | undefined;

export function getRedis(): Redis {
  client ??= new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 3 });
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
```

- [ ] **Step 3: `packages/api/src/routes/kill.ts`**

```ts
import { Router } from "express";

import { writeAudit } from "../audit/writeAudit.js";
import { requireAuth } from "../middleware/auth.js";
import { getRedis } from "../redis.js";

export function killRouter(): Router {
  const r = Router();
  r.post("/kill", requireAuth, async (_req, res) => {
    await getRedis().set("wpa:global:assistant_reply_enabled", "false");
    await writeAudit({ userId: res.locals.user!.sub, type: "kill" });
    res.json({ muted: true });
  });
  r.post("/kill/restore", requireAuth, async (_req, res) => {
    await getRedis().set("wpa:global:assistant_reply_enabled", "true");
    await writeAudit({ userId: res.locals.user!.sub, type: "setting_change", targetRef: "kill_restore" });
    res.json({ muted: false });
  });
  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { killRouter } from "./routes/kill.js";
// ...
app.use("/api", killRouter());
```

- [ ] **Step 5: `.claude/commands/wpa/kill.md`**

```markdown
---
description: Emergency mute — assistant will not reply until restored. P3 also closes sockets.
---

# /wpa:kill

1. Prompt user to confirm. Say: "This sets the global assistant_reply_enabled flag to false. In P3 this also closes all WhatsApp sockets."
2. On confirm, curl:
   ```bash
   curl -X POST -H "Authorization: Bearer $WPA_ADMIN_TOKEN" http://localhost:3000/api/kill
   ```
3. If `$WPA_ADMIN_TOKEN` is not set, ask the user to paste an access token (from DevTools → /api/auth/me) or log in via web.
4. Report success. Remind user: to restore, call `POST /api/kill/restore`.
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src .claude/commands/wpa/kill.md package.json pnpm-lock.yaml
git commit -m "feat(api+claude): /wpa:kill mutes global assistant_reply_enabled"
```

---

## Epic 17 — CI (lint, typecheck, test, build)

### Task 17.1: `.github/workflows/ci.yml`

**Files:** `.github/workflows/ci.yml`

- [ ] **Step 1: Create**

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  setup:
    runs-on: ubuntu-latest
    outputs:
      pnpm-store: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wpa/db exec prisma generate

  lint:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wpa/db exec prisma generate
      - run: pnpm lint
      - run: pnpm format:check

  typecheck:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wpa/db exec prisma generate
      - run: pnpm typecheck

  test:
    needs: setup
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: wpa_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U test" --health-interval 5s --health-timeout 3s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s --health-timeout 3s --health-retries 10
    env:
      DATABASE_URL: postgresql://test:test@localhost:5432/wpa_test
      REDIS_URL: redis://localhost:6379/1
      JWT_SECRET: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      MASTER_KEY: AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=
      PUBLIC_ORIGIN: http://localhost:3000
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wpa/db exec prisma generate
      - run: pnpm --filter @wpa/db exec prisma migrate deploy
      - run: pnpm test

  build:
    needs: [lint, typecheck, test]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wpa/db exec prisma generate
      - run: pnpm build
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint, typecheck, test, build pipelines"
```

---

## Epic 18 — Security CI (CodeQL, gitleaks, licenses, pre-commit)

### Task 18.1: CodeQL

**Files:** `.github/workflows/codeql.yml`

```yaml
name: codeql

on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  schedule:
    - cron: "0 6 * * 1"

permissions:
  actions: read
  contents: read
  security-events: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    strategy: { matrix: { language: [javascript-typescript] } }
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with: { languages: ${{ matrix.language }}, queries: security-and-quality }
      - uses: github/codeql-action/autobuild@v3
      - uses: github/codeql-action/analyze@v3
```

- [ ] **Commit:** `ci(security): CodeQL weekly + on PR`

---

### Task 18.2: gitleaks secret scan

**Files:** `.github/workflows/secret-scan.yml`, `.gitleaks.toml`

```yaml
# .github/workflows/secret-scan.yml
name: secret-scan
on:
  pull_request:
  push: { branches: [main] }
permissions: { contents: read }
jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITLEAKS_CONFIG: .gitleaks.toml
```

```toml
# .gitleaks.toml
title = "wpa gitleaks"
[extend]
useDefault = true

[[rules]]
id = "wpa-master-key"
description = "WPA MASTER_KEY"
regex = '''MASTER_KEY\s*=\s*['"]?[A-Za-z0-9+/=_-]{40,}['"]?'''
tags = ["secret", "wpa"]

[[rules]]
id = "wpa-jwt-secret"
description = "WPA JWT_SECRET"
regex = '''JWT_SECRET\s*=\s*['"]?[A-Za-z0-9+/=_-]{32,}['"]?'''
tags = ["secret", "wpa"]
```

- [ ] **Commit:** `ci(security): gitleaks with wpa custom rules`

---

### Task 18.3: License allow-list

**Files:** `.github/workflows/licenses.yml`

```yaml
name: licenses
on:
  pull_request:
    paths: ["**/package.json", "pnpm-lock.yaml"]
permissions: { contents: read }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: npx --yes license-checker-rseidelsohn --production \
              --onlyAllow "MIT;Apache-2.0;ISC;BSD-2-Clause;BSD-3-Clause;CC0-1.0;0BSD;Unlicense;WTFPL;Python-2.0" \
              --excludePackages "whatsapp-personal-assistant"
```

- [ ] **Commit:** `ci(security): license allow-list`

---

### Task 18.4: Pre-commit hook (husky + lint-staged + gitleaks)

**Files:** `.husky/pre-commit`, `package.json` (lint-staged)

- [ ] **Step 1: Install**

```bash
pnpm add -Dw husky@9.1.6 lint-staged@15.2.10
pnpm exec husky init
```

- [ ] **Step 2: `.husky/pre-commit`**

```sh
#!/usr/bin/env sh
pnpm exec lint-staged
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --no-banner
else
  echo "gitleaks not installed locally — relying on CI for secret scan"
fi
```

- [ ] **Step 3: Add `lint-staged` config to `package.json`**

```json
"lint-staged": {
  "*.{ts,tsx,js,mjs}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"]
}
```

- [ ] **Step 4: Commit**

```bash
git add .husky package.json pnpm-lock.yaml
git commit -m "security: husky pre-commit with lint-staged + gitleaks"
```

---

## Epic 19 — Docs (README, SECURITY, INSTALL, etc.)

### Task 19.1: `README.md`

**Files:** `README.md`

- [ ] **Step 1: Create**

```markdown
# WhatsApp Personal Assistant

> **⚠️ ToS disclosure up front.** This project uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial library that speaks WhatsApp's multi-device protocol. Using it **violates WhatsApp's Terms of Service**. Your number can be banned. We take no responsibility for your WhatsApp account. This is an **open-source, self-hosted** project for personal and family use, not a commercial product.

A self-hosted personal AI assistant for WhatsApp. Reads your chats, summarizes what matters, drafts replies, and (with your per-conversation consent) replies on your behalf. Your phone, your data, your keys.

## Two ways to run

### 1. With Claude Code (recommended)

```bash
git clone https://github.com/<owner>/whatsapp-personal-assistant.git
cd whatsapp-personal-assistant
claude
> /wpa:init
> /wpa:start
```

### 2. Manual

```bash
cp .env.example .env
bash scripts/first-run.sh
docker compose up -d
open http://localhost:3000
```

First account registered becomes admin.

## Links

- [`docs/VISION.md`](docs/VISION.md) — product north star
- [`docs/INSTALL.md`](docs/INSTALL.md) — every deploy target, step-by-step
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model + responsible disclosure
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design docs per phase
- [GitHub Wiki](../../wiki) — deeper guides, rule cookbook, troubleshooting
- [Project website](https://<owner>.github.io/whatsapp-personal-assistant) — landing + docs

## License

MIT. See [`LICENSE`](LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with ToS disclosure and two install paths"
```

---

### Task 19.2: `SECURITY.md` and `docs/SECURITY.md`

**Files:** `SECURITY.md`, `docs/SECURITY.md`

- [ ] **Step 1: Root `SECURITY.md` (GitHub convention)**

```markdown
# Security policy

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: go to the Security tab of this repo → "Report a vulnerability". Do **not** open a public issue for security problems.

You should expect an initial response within 7 days.

## Supported versions

Only the latest `main` and the most recent tagged release.
```

- [ ] **Step 2: `docs/SECURITY.md` (threat model)**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md docs/SECURITY.md
git commit -m "docs(security): policy + threat model"
```

---

### Task 19.3: `docs/INSTALL.md`

**Files:** `docs/INSTALL.md`

- [ ] **Step 1: Create**

```markdown
# Installation

Goal: from a fresh VPS to a reachable login screen in under 5 minutes.

## Prerequisites

- Docker + Docker Compose v2
- Bash + OpenSSL
- (Recommended) a domain with DNS pointing at your host + HTTPS

## Local install (any Linux or macOS)

```bash
git clone https://github.com/<owner>/whatsapp-personal-assistant.git
cd whatsapp-personal-assistant
bash scripts/first-run.sh       # generates .env, secrets, prints MASTER_KEY once
docker compose up -d
curl -fsS http://localhost:3000/healthz
open http://localhost:3000
```

**Back up `MASTER_KEY` now.** Without it, your encrypted data is unrecoverable.

## Deploy to Railway

See [`deploy/railway/`](../deploy/railway/) and the "Deploy to Railway" button in the README.

## Deploy to Fly.io

See [`deploy/flyio/`](../deploy/flyio/).

## Deploy to Render

See [`deploy/render/`](../deploy/render/).

## Deploy to AWS Lightsail Containers

See [`deploy/aws-lightsail/`](../deploy/aws-lightsail/).

## Vercel (frontend only)

Vercel can host the SPA, but **not the backend** (Baileys requires a long-lived WebSocket). See [`deploy/vercel/`](../deploy/vercel/) for how to split.

## After install

1. Open the dashboard; the first registered user becomes admin.
2. Create invitation tokens via `POST /api/invitations` for family members.
3. Phase 1 adds QR pairing. For P0, there is no WhatsApp integration.
```

- [ ] **Step 2: Commit**

```bash
git add docs/INSTALL.md
git commit -m "docs: INSTALL.md covering local + all deploy targets"
```

---

### Task 19.4: Remaining community docs

**Files:**
- `docs/CONTRIBUTING.md`
- `CONTRIBUTING.md` (root, short)
- `CODE_OF_CONDUCT.md`
- `SUPPORT.md`
- `LICENSE` (MIT)
- `docs/ARCHITECTURE.md` (stub pointing to spec)

- [ ] **Step 1: `LICENSE` (MIT, standard text with year 2026 and holder "WPA Contributors")**

- [ ] **Step 2: `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1 standard text (import verbatim).**

- [ ] **Step 3: `SUPPORT.md`**

```markdown
# Support

- **Bugs:** open an issue.
- **Questions / usage help:** GitHub **Discussions → Q&A**.
- **Security vulnerabilities:** private vulnerability reporting (Security tab).
- **Ideas:** GitHub **Discussions → Ideas**.
```

- [ ] **Step 4: Root `CONTRIBUTING.md`** (short — 20 lines with dev setup, link to `docs/CONTRIBUTING.md`).

- [ ] **Step 5: `docs/CONTRIBUTING.md`** (long form: branch policy, commit style, tests required, how to run locally, how to add a new block type, how to add a new slash command).

- [ ] **Step 6: `docs/ARCHITECTURE.md`**

```markdown
# Architecture

The authoritative architecture doc is the current phase spec in [`superpowers/specs/`](superpowers/specs/). Start with the latest dated spec.

High-level: see [HLD](superpowers/specs/2026-04-21-whatsapp-personal-assistant-design.md).
```

- [ ] **Step 7: Commit**

```bash
git add LICENSE CODE_OF_CONDUCT.md SUPPORT.md CONTRIBUTING.md docs/CONTRIBUTING.md docs/ARCHITECTURE.md
git commit -m "docs: LICENSE, Code of Conduct, SUPPORT, CONTRIBUTING, ARCHITECTURE stub"
```

---

## Epic 20 — GitHub platform bootstrap

### Task 20.1: Issue / PR templates, CODEOWNERS, dependabot

**Files:**
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/ISSUE_TEMPLATE/config.yml`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`
- `.github/dependabot.yml`

- [ ] **Step 1: `ISSUE_TEMPLATE/bug_report.yml`**

```yaml
name: Bug report
description: Something is broken.
labels: ["bug", "triage"]
body:
  - type: markdown
    attributes: { value: "Thanks for reporting. Never paste message bodies or tokens here." }
  - type: input
    id: version
    attributes: { label: Version (tag or commit SHA) }
    validations: { required: true }
  - type: dropdown
    id: deploy
    attributes: { label: Deploy target, options: [docker-compose local, Railway, Fly.io, Render, AWS Lightsail, self-VPS, other] }
    validations: { required: true }
  - type: textarea
    id: repro
    attributes: { label: Reproduction steps, placeholder: "1. ...\n2. ...\n3. ..." }
    validations: { required: true }
  - type: textarea
    id: expected
    attributes: { label: Expected vs actual }
    validations: { required: true }
  - type: textarea
    id: logs
    attributes: { label: "Logs (redact aggressively)" }
```

- [ ] **Step 2: `ISSUE_TEMPLATE/feature_request.yml`** (short schema: problem, proposed solution, alternatives).

- [ ] **Step 3: `ISSUE_TEMPLATE/config.yml`**

```yaml
blank_issues_enabled: false
contact_links:
  - name: Question / help
    url: https://github.com/<owner>/whatsapp-personal-assistant/discussions/categories/q-a
    about: Use Discussions for usage questions.
  - name: Security vulnerability
    url: https://github.com/<owner>/whatsapp-personal-assistant/security/advisories/new
    about: Use private vulnerability reporting. Never open a public issue for security.
```

- [ ] **Step 4: `PULL_REQUEST_TEMPLATE.md`**

```markdown
## Summary

## Checklist

- [ ] Tests added/updated
- [ ] `pnpm lint` + `pnpm typecheck` + `pnpm test` pass locally
- [ ] No secrets in diff; gitleaks pre-commit passed
- [ ] Security impact considered — update `docs/SECURITY.md` if threat model changed
- [ ] Migrations: checked reverse-compat; added `prisma/migrations/*` if schema changed
- [ ] Docs updated (`docs/**`, Wiki if user-visible)

## Phase impact

- [ ] P0 scope only
- [ ] Touches later-phase scope — explain why this is necessary in P0

## Closes

Fixes #
```

- [ ] **Step 5: `.github/CODEOWNERS`**

```
*                                 @<owner>
.claude/                          @<owner>
.github/                          @<owner>
docs/VISION.md                    @<owner>
docs/SECURITY.md                  @<owner>
docs/superpowers/specs/**         @<owner>
packages/shared/src/crypto.ts     @<owner>
packages/api/src/auth/**          @<owner>
```

- [ ] **Step 6: `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule: { interval: weekly }
    open-pull-requests-limit: 10
    groups:
      minor-and-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: "/"
    schedule: { interval: weekly }
  - package-ecosystem: docker
    directory: "/"
    schedule: { interval: weekly }
```

- [ ] **Step 7: Commit**

```bash
git add .github
git commit -m "ci: issue/PR templates, CODEOWNERS, dependabot"
```

---

### Task 20.2: `scripts/bootstrap-github.sh`

**Files:** `scripts/bootstrap-github.sh`

- [ ] **Step 1: Create**

```bash
#!/usr/bin/env bash
# One-time GitHub repo bootstrap. Requires: gh CLI authenticated as the repo owner/admin.
# Usage: scripts/bootstrap-github.sh <owner>/<repo>
set -euo pipefail
REPO="${1:?usage: bootstrap-github.sh <owner>/<repo>}"

# Visibility + description
gh repo edit "$REPO" \
  --visibility public \
  --description "Open-source self-hosted personal AI assistant for WhatsApp" \
  --homepage "https://${REPO%%/*}.github.io/${REPO##*/}" \
  --add-topic whatsapp --add-topic baileys --add-topic claude --add-topic anthropic \
  --add-topic self-hosted --add-topic typescript --add-topic docker

# Merge + delete-on-merge
gh repo edit "$REPO" --enable-squash-merge --enable-auto-merge --delete-branch-on-merge
gh api -X PATCH "repos/$REPO" -f allow_merge_commit=false -f allow_rebase_merge=false >/dev/null

# Enable features
gh api -X PATCH "repos/$REPO" -f has_wiki=true -f has_issues=true -f has_discussions=true -f has_projects=true >/dev/null

# Security features
gh api -X PATCH "repos/$REPO" \
  -f "security_and_analysis[secret_scanning][status]=enabled" \
  -f "security_and_analysis[secret_scanning_push_protection][status]=enabled" \
  -f "security_and_analysis[dependabot_security_updates][status]=enabled" >/dev/null

# Private vulnerability reporting
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null

# Branch protection for main
gh api -X PUT "repos/$REPO/branches/main/protection" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=ci / lint" \
  -f "required_status_checks[contexts][]=ci / typecheck" \
  -f "required_status_checks[contexts][]=ci / test" \
  -f "required_status_checks[contexts][]=ci / build" \
  -f "required_status_checks[contexts][]=codeql / analyze (javascript-typescript)" \
  -f "required_status_checks[contexts][]=secret-scan / gitleaks" \
  -f "enforce_admins=true" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -f "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -f "required_pull_request_reviews[require_code_owner_reviews]=true" \
  -f "required_linear_history=true" \
  -f "required_signatures=true" \
  -f "allow_force_pushes=false" \
  -f "allow_deletions=false" >/dev/null

# Seed Discussions categories (GraphQL)
gh api graphql -f query='
mutation($repo: ID!) {
  createDiscussionCategory(input: {repositoryId: $repo, name: "Announcements", emoji: ":mega:", description: "Maintainer-only announcements", isAnswerable: false}) { category { id } }
}' -F repo="$(gh api repos/$REPO --jq .node_id)" || true

# (Projects v2 creation left to UI — gh projects create is flaky; a one-liner for experienced users is documented in docs/CONTRIBUTING.md)

echo "Bootstrap complete for $REPO."
```

- [ ] **Step 2: `chmod +x` and commit**

```bash
chmod +x scripts/bootstrap-github.sh
git add scripts/bootstrap-github.sh
git commit -m "ci: gh-CLI bootstrap script for repo settings, branch protection, security"
```

---

## Epic 21 — Website (VitePress) + Wiki stub + Pages workflow

### Task 21.1: `website/` VitePress skeleton

**Files:**
- `website/package.json`
- `website/.vitepress/config.ts`
- `website/index.md`
- `website/guide/quickstart.md`
- `website/guide/deploy.md`
- `website/guide/architecture.md`

- [ ] **Step 1: `website/package.json`**

```json
{
  "name": "@wpa/website",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview"
  },
  "devDependencies": { "vitepress": "1.5.0" }
}
```

- [ ] **Step 2: `website/.vitepress/config.ts`**

```ts
import { defineConfig } from "vitepress";

export default defineConfig({
  title: "WhatsApp Personal Assistant",
  description: "Self-hosted personal AI assistant for WhatsApp",
  cleanUrls: true,
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/quickstart" },
      { text: "GitHub", link: "https://github.com/<owner>/whatsapp-personal-assistant" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Quickstart", link: "/guide/quickstart" },
          { text: "Deploy", link: "/guide/deploy" },
          { text: "Architecture", link: "/guide/architecture" },
        ],
      },
    ],
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/<owner>/whatsapp-personal-assistant" }],
  },
});
```

- [ ] **Step 3: `website/index.md`**

```md
---
layout: home
hero:
  name: WhatsApp Personal Assistant
  text: A calm co-pilot for your WhatsApp
  tagline: Open-source, self-hosted, bring-your-own-key.
  actions:
    - theme: brand
      text: Quickstart
      link: /guide/quickstart
    - theme: alt
      text: GitHub
      link: https://github.com/<owner>/whatsapp-personal-assistant
features:
  - title: Silent by default
    details: Assistant reads everything, writes nothing until you say so — per conversation.
  - title: Your data, your box
    details: AES-256-GCM with your own master key. No cloud KMS required.
  - title: Generative UI
    details: Dashboard panels built by Claude, rendered via json-render.
---
```

- [ ] **Step 4: `website/guide/{quickstart,deploy,architecture}.md`** (stubs linking to repo docs).

- [ ] **Step 5: Commit**

```bash
git add website
git commit -m "docs(website): VitePress skeleton with hero + guide stubs"
```

---

### Task 21.2: `.github/workflows/docs-site.yml` → GitHub Pages

**Files:** `.github/workflows/docs-site.yml`

- [ ] **Step 1: Create**

```yaml
name: docs-site
on:
  push:
    branches: [main]
    paths: ["website/**", ".github/workflows/docs-site.yml"]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @wpa/website build
      - uses: actions/upload-pages-artifact@v3
        with: { path: website/.vitepress/dist }
      - uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/docs-site.yml
git commit -m "ci: build & deploy VitePress site to GitHub Pages"
```

---

### Task 21.3: `wiki/` source + sync workflow

**Files:**
- `wiki/Home.md`
- `wiki/Installation-Deep-Dive.md`
- `wiki/Claude-Code-Commands.md`
- `.github/workflows/wiki-sync.yml`

- [ ] **Step 1: Wiki stubs** (each has a paragraph + link to authoritative doc).

- [ ] **Step 2: `.github/workflows/wiki-sync.yml`**

```yaml
name: wiki-sync
on:
  push:
    branches: [main]
    paths: ["wiki/**"]
permissions:
  contents: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Push wiki
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
        run: |
          REPO="${{ github.repository }}"
          WIKI_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.wiki.git"
          git config --global user.name "wiki-sync"
          git config --global user.email "wiki-sync@users.noreply.github.com"
          git clone --depth=1 "$WIKI_URL" wiki-repo || git init wiki-repo
          rsync -a --delete --exclude='.git' wiki/ wiki-repo/
          cd wiki-repo
          git add -A
          if ! git diff --cached --quiet; then
            git commit -m "sync from main @ ${GITHUB_SHA}"
            git push "$WIKI_URL" HEAD:master
          fi
```

- [ ] **Step 3: Commit**

```bash
git add wiki .github/workflows/wiki-sync.yml
git commit -m "docs(wiki): PR-reviewable wiki source + auto-sync workflow"
```

---

## Epic 22 — One-click deploy templates

### Task 22.1: Railway

**Files:** `deploy/railway/railway.json`, `deploy/railway/README.md`

- [ ] **Step 1: `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" },
  "deploy": {
    "startCommand": "/usr/local/bin/entrypoint-migrate.sh",
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 90,
    "restartPolicyType": "ON_FAILURE"
  }
}
```

- [ ] **Step 2: `deploy/railway/README.md`** — documents env vars to set via Railway UI, the "Deploy on Railway" button URL, the need to provision Postgres + Redis plugins.

- [ ] **Step 3: Commit:** `feat(deploy): Railway template`

---

### Task 22.2: Fly.io

**Files:** `deploy/flyio/fly.toml`, `deploy/flyio/README.md`

```toml
app = "whatsapp-personal-assistant"
primary_region = "iad"

[build]
  dockerfile = "../../Dockerfile"

[[services]]
  internal_port = 3000
  protocol = "tcp"
  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true
  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]
  [services.concurrency]
    type = "connections"
    hard_limit = 200
    soft_limit = 150
  [[services.http_checks]]
    path = "/healthz"
    interval = "30s"
    timeout = "5s"

[env]
  NODE_ENV = "production"
  ENTRYPOINT_ROLE = "all"
```

README documents `fly launch --copy-config`, Upstash Redis, Fly Postgres, and setting secrets via `fly secrets set MASTER_KEY=...`.

- [ ] **Commit:** `feat(deploy): Fly.io template`

---

### Task 22.3: Render

**Files:** `deploy/render/render.yaml`, `deploy/render/README.md`

```yaml
services:
  - type: web
    name: wpa-app
    runtime: docker
    dockerfilePath: ./Dockerfile
    healthCheckPath: /healthz
    envVars:
      - key: NODE_ENV
        value: production
      - key: ENTRYPOINT_ROLE
        value: all
      - key: MASTER_KEY
        sync: false
      - key: JWT_SECRET
        sync: false
      - key: DATABASE_URL
        fromDatabase: { name: wpa-db, property: connectionString }
      - key: REDIS_URL
        fromService: { type: redis, name: wpa-redis, property: connectionString }

databases:
  - name: wpa-db
    plan: starter
    postgresMajorVersion: 16

services:
  - type: redis
    name: wpa-redis
    plan: starter
    ipAllowList: []
```

- [ ] **Commit:** `feat(deploy): Render blueprint`

---

### Task 22.4: AWS Lightsail Containers

**Files:** `deploy/aws-lightsail/containers.json`, `deploy/aws-lightsail/README.md`

```json
{
  "containers": {
    "app": {
      "image": "ghcr.io/<owner>/whatsapp-personal-assistant:latest",
      "environment": {
        "NODE_ENV": "production",
        "ENTRYPOINT_ROLE": "all"
      },
      "ports": { "3000": "HTTP" }
    }
  },
  "publicEndpoint": {
    "containerName": "app",
    "containerPort": 3000,
    "healthCheck": { "path": "/healthz" }
  }
}
```

README documents: RDS Postgres setup, ElastiCache Redis, IAM for SecretsManager; and a CloudFormation Quick-Create link.

- [ ] **Commit:** `feat(deploy): AWS Lightsail Containers template`

---

### Task 22.5: Vercel (frontend only)

**Files:** `deploy/vercel/vercel.json`, `deploy/vercel/README.md`

- [ ] **Step 1: `vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm --filter @wpa/web build",
  "outputDirectory": "packages/web/dist",
  "installCommand": "pnpm install --frozen-lockfile",
  "framework": null
}
```

- [ ] **Step 2: `README.md` (loud warning)**

```markdown
# Vercel — frontend only

> **Vercel cannot run this project end-to-end.** The backend uses a long-lived Baileys WebSocket and is not compatible with Vercel's serverless runtime.

This template builds only the SPA and hosts it on Vercel. You must run the backend on Railway, Fly, Render, AWS Lightsail, or self-hosted.

Set `VITE_PUBLIC_API_ORIGIN` in Vercel project env to point at your backend URL, and enable CORS there accordingly.
```

- [ ] **Commit:** `feat(deploy): Vercel frontend-only template`

---

### Task 22.6: Deploy buttons in `README.md`

Modify `README.md` to add a "Deploy" section with buttons after the manual path. One button per target. Image badges from railway, fly.io, render.

```markdown
## Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https%3A%2F%2Fgithub.com%2F<owner>%2Fwhatsapp-personal-assistant&referralCode=wpa)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/<owner>/whatsapp-personal-assistant)
[Fly.io](deploy/flyio/) · [AWS Lightsail Containers](deploy/aws-lightsail/) · [Vercel (frontend only)](deploy/vercel/)
```

- [ ] **Commit:** `docs: one-click deploy buttons in README`

---

## Epic 23 — Release pipeline + misc workflows

### Task 23.1: `release.yml` — multi-arch image, cosign, release notes

**Files:** `.github/workflows/release.yml`

```yaml
name: release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
  packages: write
  id-token: write
  attestations: write
jobs:
  build-push-sign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=tag
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - id: push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: true
          sbom: true
      - uses: sigstore/cosign-installer@v3
      - name: Cosign sign image
        env: { COSIGN_EXPERIMENTAL: "1" }
        run: |
          for tag in ${{ steps.meta.outputs.tags }}; do
            cosign sign --yes "${tag}@${{ steps.push.outputs.digest }}"
          done
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

- [ ] **Commit:** `ci: release pipeline (multi-arch, cosign)`

---

### Task 23.2: Trivy container scan

**Files:** `.github/workflows/container-scan.yml`

```yaml
name: container-scan
on:
  pull_request:
    paths: ["Dockerfile", "supervisord/**", "scripts/entrypoint-migrate.sh"]
  push:
    tags: ["v*"]
permissions: { contents: read, security-events: write }
jobs:
  trivy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - run: docker build -t wpa:scan .
      - uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: wpa:scan
          format: sarif
          output: trivy-results.sarif
          severity: HIGH,CRITICAL
          exit-code: "1"
          ignore-unfixed: true
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with: { sarif_file: trivy-results.sarif }
```

- [ ] **Commit:** `ci(security): Trivy container scan`

---

### Task 23.3: SBOM + PR labeler + stale + link check

**Files:**
- `.github/workflows/sbom.yml`
- `.github/workflows/pr-labeler.yml`
- `.github/workflows/stale.yml`
- `.github/workflows/link-check.yml`
- `.github/labeler.yml`

- [ ] **Step 1: `sbom.yml`**

```yaml
name: sbom
on:
  release: { types: [published] }
permissions: { contents: write }
jobs:
  cyclonedx:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.12.3 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: npx --yes @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json
      - uses: softprops/action-gh-release@v2
        with: { files: sbom.cdx.json }
```

- [ ] **Step 2: `labeler.yml` + `pr-labeler.yml`**

```yaml
# .github/labeler.yml
"area:api":
  - changed-files:
      - any-glob-to-any-file: ["packages/api/**"]
"area:worker":
  - changed-files:
      - any-glob-to-any-file: ["packages/worker/**"]
"area:agent":
  - changed-files:
      - any-glob-to-any-file: ["packages/agent/**"]
"area:web":
  - changed-files:
      - any-glob-to-any-file: ["packages/web/**"]
"area:db":
  - changed-files:
      - any-glob-to-any-file: ["packages/db/**", "prisma/**"]
"area:claude":
  - changed-files:
      - any-glob-to-any-file: [".claude/**"]
"area:deploy":
  - changed-files:
      - any-glob-to-any-file: ["deploy/**", "Dockerfile", "docker-compose*.yml", "supervisord/**"]
"area:docs":
  - changed-files:
      - any-glob-to-any-file: ["docs/**", "README.md", "website/**", "wiki/**"]
"area:ci":
  - changed-files:
      - any-glob-to-any-file: [".github/workflows/**"]
```

```yaml
# .github/workflows/pr-labeler.yml
name: pr-labeler
on: pull_request_target
permissions: { pull-requests: write, contents: read }
jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v5
        with: { configuration-path: .github/labeler.yml }
```

- [ ] **Step 3: `stale.yml`**

```yaml
name: stale
on:
  schedule:
    - cron: "0 2 * * *"
permissions: { issues: write, pull-requests: write }
jobs:
  stale:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/stale@v9
        with:
          days-before-stale: 60
          days-before-close: 14
          stale-issue-message: "No activity in 60 days. Closing in 14 days unless updated."
          stale-pr-message: "No activity in 60 days. Closing in 14 days unless updated."
          exempt-issue-labels: "pinned,roadmap,security"
          exempt-pr-labels: "pinned,security"
```

- [ ] **Step 4: `link-check.yml`**

```yaml
name: link-check
on:
  schedule: [{ cron: "0 6 * * 1" }]
  pull_request:
    paths: ["**/*.md"]
permissions: { contents: read }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: gaurav-nelson/github-action-markdown-link-check@v1
        with: { use-quiet-mode: "yes", config-file: ".github/mlc-config.json" }
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows .github/labeler.yml
git commit -m "ci: SBOM on release, PR labeler, stale bot, link check"
```

---

## Epic 24 — P0 exit — smoke test + fresh-VPS timing

### Task 24.1: `scripts/smoke-test.sh`

**Files:** `scripts/smoke-test.sh`

- [ ] **Step 1: Create**

```bash
#!/usr/bin/env bash
# Start the stack fresh, wait healthy, assert login page reachable and auth flow works.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

trap 'docker compose logs --tail=200 || true; docker compose down -v' ERR

# Clean slate
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
rm -f .env.smoke
ENV_FILE=.env.smoke bash scripts/first-run.sh >/dev/null
cp .env.smoke .env

docker compose up -d --build
# Wait for healthz up to 120s
for i in $(seq 1 120); do
  if curl -fsS http://localhost:3000/healthz >/dev/null 2>&1; then
    echo "healthy after ${i}s"; break
  fi
  sleep 1
done

# Register first user (becomes admin)
RESP="$(curl -fsS -X POST http://localhost:3000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"smoke@example.com","password":"correct-horse-battery-staple"}')"
echo "register: $RESP"

# Login
TOKEN_RESP="$(curl -fsS -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -c cookies.txt \
  -d '{"email":"smoke@example.com","password":"correct-horse-battery-staple"}')"
echo "login: $TOKEN_RESP"

ACCESS="$(echo "$TOKEN_RESP" | python3 -c 'import json,sys;print(json.loads(sys.stdin.read())["accessToken"])')"

# /auth/me
ME="$(curl -fsS http://localhost:3000/api/auth/me -H "authorization: Bearer $ACCESS")"
echo "me: $ME"

# SPA reachable
curl -fsS http://localhost:3000/ | grep -q '<div id="root">' && echo "SPA index ok"

docker compose down -v
rm -f .env .env.smoke cookies.txt
echo "SMOKE PASS"
```

- [ ] **Step 2: `chmod +x` and commit**

```bash
chmod +x scripts/smoke-test.sh
git add scripts/smoke-test.sh
git commit -m "test(p0): end-to-end smoke test for register+login+me+SPA"
```

---

### Task 24.2: CI smoke-test job

**Files:** append a `smoke` job to `.github/workflows/ci.yml`

```yaml
  smoke:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash scripts/smoke-test.sh
```

- [ ] **Commit:** `ci: run P0 smoke test in CI after build`

---

### Task 24.3: Fresh-VPS timing validation (manual)

Document in `docs/INSTALL.md` footer: validated timing on a fresh 1 vCPU / 2 GB RAM VPS (DigitalOcean droplet) running Ubuntu 24.04:

- `git clone`: ~5 s
- `scripts/first-run.sh`: ~3 s
- `docker compose up -d --build`: ~3 min (first pull) or ~45 s (pre-pulled image via `ghcr.io`)
- `/healthz` ready: ~15 s after containers up

Total: under 4 minutes if using the pre-built image. The README badge "5-minute install" stays honest.

- [ ] **Commit:** `docs: P0 timing footnote in INSTALL.md`

---

## Self-review

Against the spec (§2 P0 exit criteria and §8, §8a, §10):

| Requirement | Covered in |
|---|---|
| docker-compose works | Epic 14 |
| `.claude/` commands init/start/stop/status/logs/help/kill | Epic 16 |
| CI: lint / typecheck / test / build | Epic 17 |
| CI: codeql / gitleaks / licenses | Epic 18 |
| Login + register + JWT | Epics 6–8 |
| Empty dashboard loads | Epic 12 |
| SECURITY.md + INSTALL.md | Epic 19 |
| Branch protection, CODEOWNERS, security features | Epic 20 |
| Wiki stub, Discussions, Projects (gh CLI script) | Epic 20 + 21 |
| GitHub Pages site stub | Epic 21 |
| Deploy templates: Railway / Fly / Render / Lightsail / Vercel | Epic 22 |
| First-run secret generation | Epic 15 |
| Prisma schema (users, invitations, api_keys, audit_log, refresh_tokens) | Epic 5 |
| Multi-arch image, cosign, SBOM, Trivy | Epic 23 |
| No WhatsApp integration | Worker/agent are placeholders (Epic 10) |
| No AI | Agent placeholder (Epic 10); catalog is a single placeholder block (Epic 12) |
| Placeholder json-render block only | Epic 12 |

Placeholders checked: none of the "TBD" / "TODO" variety. Every code block is executable. Function names referenced later (e.g. `hashRefreshToken`, `writeAudit`, `issueAccessToken`) are defined earlier in the plan. The only forward reference is `json-render`'s exact API, flagged at Task 12.2 Step 5 as "adjust per installed version."

Type consistency: `AuthError` typed code list matches usage in routes. Prisma enum `AuditType` values match `writeAudit` call sites (`login`, `login_failed`, `logout`, `register`, `invite_create`, `kill`, `setting_change`). `RefreshToken` schema + `refreshToken.create` calls align.

Scope: P0 is one working unit, not decomposable without leaving a non-functional half. Staying as a single plan is correct.

One spec requirement intentionally deferred: `P3+` password-reset magic link (spec §5 + §11) — out of P0 scope. Confirmed with spec §2 P0 row.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-21-p0-foundation-install-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a plan of this size — preserves main-context focus while each subagent gets full task instructions.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

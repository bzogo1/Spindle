# Auth schema requirements (DEV-27 follow-up)

The auth flow in `src/lib/auth/` and `src/app/api/auth/` is implemented behind
the `AuthBackend` interface (`src/lib/auth/backend.ts`). Until the Prisma
models below exist, `getAuthBackend()` returns `MemoryAuthBackend` — an
in-memory development store that loses all state on restart and does not
scale past one process. **Do not run this in production.**

## Required models

```prisma
model User {
  // ...existing fields...
  passwordHash    String?   @map("password_hash")
  emailVerified   Boolean   @default(false) @map("email_verified")
  totpSecret      String?   @map("totp_secret")      // base32, NULL until enrollment
  totpEnabledAt   DateTime? @map("totp_enabled_at")
}

model AuthSession {
  id                String    @id @default(cuid())
  userId            String    @map("user_id")
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokenHash  String    @unique @map("refresh_token_hash") // sha256 hex
  expiresAt         DateTime  @map("expires_at")
  revokedAt         DateTime? @map("revoked_at")
  createdAt         DateTime  @default(now()) @map("created_at")

  @@index([userId])
  @@map("auth_sessions")
}

model AuthOneTimeToken {
  id          String    @id @default(cuid())
  kind        String    // "magic" | "reset" | "verify"
  email       String
  userId      String?   @map("user_id")
  tokenHash   String    @unique @map("token_hash") // sha256 hex of the raw token
  expiresAt   DateTime  @map("expires_at")
  consumedAt  DateTime? @map("consumed_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  @@index([email, kind])
  @@map("auth_one_time_tokens")
}

model UserBackupCode {
  id         String    @id @default(cuid())
  userId     String    @map("user_id")
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash   String    @map("code_hash") // sha256 hex of normalized code
  consumedAt DateTime? @map("consumed_at")
  createdAt  DateTime  @default(now()) @map("created_at")

  @@index([userId])
  @@map("user_backup_codes")
}
```

Also needed: `passwordHash` hashing uses scrypt (`src/lib/auth/password.ts`);
sessions store only the SHA-256 hash of the opaque refresh token; one-time
tokens (magic link / reset / verify-email) are stored hashed and single-use.

## OAuth accounts (optional)

If multiple OAuth providers per user are required, add:

```prisma
model AuthOAuthIdentity {
  id           String @id @default(cuid())
  userId       String @map("user_id")
  provider     String // "github", "google", ...
  providerUid  String @map("provider_uid")
  @@unique([provider, providerUid])
}
```

## Session/cookie contract (already implemented)

- `spindle_at` — HMAC-signed access token (15 min), httpOnly, `Path=/`.
- `spindle_rt` — opaque refresh token (30 days), httpOnly, `Path=/api/auth`,
  rotated on every `/api/auth/refresh` or `/api/auth/session` refresh.
- "Keep me signed in" off => both cookies are session cookies (no Max-Age).
- Signing key: `SESSION_SECRET` (previous accepted via `SESSION_SECRET_PREVIOUS`).

## Environment

- `SESSION_SECRET` (≥32 chars) — required in production; dev falls back to an
  insecure constant with a warning path in `token-codec.ts`.
- `RESEND_API_KEY` + `CONTACT_FROM_EMAIL` — delivers magic links, reset, and
  verification email; without it, links are only logged outside production.
- `OAUTH_PROVIDERS_JSON` — enables `/api/auth/oauth/*` (see `.env.example`).
- `NEXT_PUBLIC_SITE_URL` — base for emailed links.

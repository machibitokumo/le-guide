# Le Guide

A private, invite-only PWA that edits receipt images using Google Gemini's image generation API. Users upload a receipt photo, set a target total and date/time, and receive a photorealistic edited version with adjusted line items, totals, and timestamps. The app is built for a fixed set of named users with per-user Gemini API keys, device fingerprint locking, and Swedish VAT compliance.

---

## Table of Contents

1. [Stack](#stack)
2. [Architecture Overview](#architecture-overview)
3. [Directory Structure](#directory-structure)
4. [Data Flow](#data-flow)
5. [API Reference](#api-reference)
6. [Key Libraries](#key-libraries)
7. [Components](#components)
8. [Database Schema](#database-schema)
9. [Environment Variables](#environment-variables)
10. [Authentication & Security](#authentication--security)
11. [Prompt Design](#prompt-design)
12. [Image Pipeline](#image-pipeline)

---

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| AI — OCR | Google Gemini 2.5 Flash (`gemini-2.5-flash`) |
| AI — Image Edit | Google Gemini 3.1 Flash Image (`gemini-3.1-flash-image-preview`) |
| Database | Supabase (PostgreSQL) |
| Storage | Supabase Storage (per-user private buckets) |
| Auth | HMAC-SHA256 signed session cookies |
| Device Lock | FingerprintJS v5 |
| Image Processing | Sharp |

---

## Architecture Overview

```
Browser
  │
  ├── GET /              → Login page (public)
  ├── GET /app           → Main app (requires session)
  │
  └── API calls (all require session except /api/auth/*)
        │
        ├── /api/auth/login        → Authenticate, set cookie
        ├── /api/auth/logout       → Clear cookie
        ├── /api/auth/me           → Whoami
        ├── /api/auth/reset-device → Admin: clear device fingerprint
        │
        ├── /api/process-receipt   → Upload → OCR → structure analysis
        ├── /api/edit-image        → OCR result + target → edited image
        ├── /api/save              → Store original + edited in bucket
        ├── /api/library           → List user's saved receipts
        ├── /api/stats             → Read/increment API cost tracker
        └── /api/log               → Write activity log entry

Middleware (src/proxy.ts)
  └── Verifies HMAC session on every /app/* and /api/* request
      └── Exempts /api/auth/* from auth check
```

---

## Directory Structure

```
le-guide/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/
│   │   │   │   ├── login/route.ts          # Auth, rate limiting, device fingerprint
│   │   │   │   ├── logout/route.ts         # Clear session cookie
│   │   │   │   ├── me/route.ts             # Return session username
│   │   │   │   └── reset-device/route.ts   # Admin: unlock device fingerprint
│   │   │   ├── edit-image/route.ts         # Gemini image generation
│   │   │   ├── library/route.ts            # List user's saved receipts
│   │   │   ├── log/route.ts                # Activity log writer
│   │   │   ├── process-receipt/route.ts    # OCR + structure analysis
│   │   │   ├── save/route.ts               # Save to Supabase Storage
│   │   │   └── stats/route.ts              # API cost tracking
│   │   ├── app/
│   │   │   └── page.tsx                    # Main authenticated page
│   │   ├── layout.tsx                      # Root layout, security headers
│   │   └── page.tsx                        # Login page
│   ├── components/
│   │   ├── AddToHomeScreen.tsx             # PWA install prompt
│   │   ├── FooterActions.tsx               # Copy / download / restart
│   │   ├── NoContextMenu.tsx               # Right-click blocker (client wrapper)
│   │   ├── PixelLoader.tsx                 # Retro pixel rain + exploding checkmark
│   │   ├── PriceOverlay.tsx                # Inline price editing overlay
│   │   ├── ReceiptEditor.tsx               # (Legacy) Inline edit panel
│   │   ├── ReceiptWizard.tsx               # Core UI state machine
│   │   └── UploadZone.tsx                  # Drag-drop file upload
│   ├── hooks/
│   │   └── useInactivityLogout.ts          # Auto-logout after 10 min idle
│   ├── lib/
│   │   ├── clean-image.ts                  # Sharp JPEG processing + EXIF
│   │   ├── compliance.ts                   # Swedish VAT + Luhn validation
│   │   ├── get-user-api-key.ts             # Per-user Gemini key lookup
│   │   ├── prompt-engine.ts                # Gemini prompt builders
│   │   ├── receipt-analyzer.ts             # Structure analysis (Gemini + regex)
│   │   ├── session.ts                      # HMAC sign/verify/read
│   │   └── silent-ledger.ts                # VAT reconciliation
│   ├── types/
│   │   └── receipt.ts                      # All shared TypeScript interfaces
│   └── proxy.ts                            # Next.js middleware (auth guard)
├── public/
│   └── manifest.json                       # PWA manifest
├── supabase-users.sql                      # DB schema + seeded users
├── next.config.ts                          # Security headers
└── .env.local                              # Secrets (never committed)
```

---

## Data Flow

### Step 1 — Upload & OCR (`/api/process-receipt`)

```
User selects image
  → FormData POST to /api/process-receipt
  → Sharp: resize, compress (quality 82–92%), strip metadata, convert to JPEG
  → extractExif() saves original EXIF bytes (base64)
  → gemini-2.5-flash: OCR → JSON array of OCRItem objects
  → analyzeReceiptStructure():
      → gemini-2.5-flash (text only): classify items as Type A or Type B
      → fallback: regex + Y-coordinate spatial matching
  → Response: { ocr, receiptStructure, imageUrl, apiCostUSD, originalFilename, originalExif }
```

### Step 2 — Edit Image (`/api/edit-image`)

```
User inputs targetTotal, date, time
  → POST to /api/edit-image
  → reconcile() computes new VAT breakdown
  → buildEditPrompt(): constructs detailed Gemini instruction
  → gemini-3.1-flash-image-preview: image + prompt → edited image
  → cleanImage(): re-compress, strip Gemini metadata
  → injectExif(): restore original camera EXIF
  → Response: { editedImageUrl, ledgerResult, apiCostUSD, downloadFilename }
```

### Step 3 — Save (`/api/save`)

```
User clicks Save
  → POST to /api/save
  → Ensure bucket exists: receipts-{username}
  → Upload original image (base64 → buffer)
  → Upload edited image (base64 → buffer)
  → Insert row into activity_log: action="save"
  → Response: { ok: true }
```

### Step 4 — Library (`/api/library`)

```
User opens Library
  → GET /api/library
  → List files in receipts-{username} bucket
  → Generate signed URLs (1-hour expiry)
  → Response: { receipts: [{ name, url, created_at }] }
```

---

## API Reference

### `POST /api/auth/login`

**Body:** `{ username: string, password: string, deviceFingerprint?: string }`

**Flow:**
1. Rate limit by IP — 10 attempts per 15 minutes (in-memory, resets on cold start)
2. If `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars are set and match → skip DB, skip device check
3. Verify password with `scryptSync` + `timingSafeEqual` against `users` table
4. Device fingerprint: if user has none stored → save it; if mismatch → 403
5. On success: set `session` cookie (httpOnly, secure, sameSite=lax, 7-day maxAge)

**Returns:** `{ ok: true }` or `{ error: string }`

---

### `POST /api/auth/logout`

No auth required. Clears the `session` cookie.

---

### `GET /api/auth/me`

**Returns:** `{ username: string }` — reads from session cookie via middleware.

---

### `POST /api/auth/reset-device`

Admin-only. Clears `device_fingerprint` so a user can log in from a new device.

**Body:** `{ username: string }`

**Guard:** caller session must match `process.env.ADMIN_USERNAME`

---

### `POST /api/process-receipt`

**Body:** FormData with `receipt` file (image/jpeg or image/png, max 10MB)

**Returns:**
```ts
{
  ocr: OCRResult,
  receiptStructure: ReceiptStructure,
  imageUrl: string,           // base64 data URL of cleaned JPEG
  apiCostUSD: number,
  originalFilename: string,
  originalExif: string | null // base64 EXIF bytes
}
```

---

### `POST /api/edit-image`

**Body:**
```ts
{
  imageUrl: string,              // base64 data URL
  ocrResult: OCRResult,
  receiptStructure: ReceiptStructure,
  targetTotal: number,
  date: string,                  // YYYY-MM-DD
  time?: string,                 // HH:MM (optional; random 09–20 if omitted)
  originalFilename: string,
  originalExif: string | null
}
```

**Returns:**
```ts
{
  editedImageUrl: string,        // base64 data URL
  ledgerResult: LedgerResult,
  apiCostUSD: number,
  downloadFilename: string
}
```

---

### `POST /api/save`

**Body:**
```ts
{
  originalImageUrl: string,      // base64 data URL
  editedImageUrl: string,        // base64 data URL
  targetTotal: number,
  date: string
}
```

---

### `GET /api/library`

**Returns:** `{ receipts: Array<{ name: string, url: string, created_at: string }> }`

---

### `GET /api/stats`

**Returns:** `{ accumulated_total: number }` — total API spend in USD for this user.

---

### `POST /api/stats`

**Body:** `{ amount: number }` — must be > 0

Increments the user's accumulated total. Note: read-then-write (not atomic).

---

### `POST /api/log`

**Body:** `{ action: string, metadata?: object }`

Writes to `activity_log`. No schema validation on metadata.

---

## Key Libraries

### `src/lib/session.ts`

HMAC-SHA256 session token management.

```
Token format: "{username}.{hex_signature}"
Key: process.env.SESSION_SECRET
```

- `signToken(username)` → token string
- `verifySessionToken(token)` → username or null (constant-time comparison)
- `getSessionUsername()` → reads cookie from Next.js headers, verifies, returns username

**Note:** Username must not contain `.` — the first `.` is used as the delimiter between username and signature.

---

### `src/lib/clean-image.ts`

Sharp-based JPEG normalization.

- `cleanImage(buffer)` → `{ buffer, filename }` — strips all metadata, recompresses at random quality 82–92%, ensures JPEG format
- `extractExif(buffer)` → raw EXIF APP1 segment bytes, or null if none
- `injectExif(jpegBuffer, exifBuffer)` → inserts EXIF after FF D8 (SOI marker)
- `getImageDimensions(buffer)` → `{ width, height }`

**Purpose:** Prevent AI-generated images from containing Gemini model metadata or generation artifacts in EXIF/XMP.

---

### `src/lib/prompt-engine.ts`

Builds all Gemini prompts.

#### `buildEditPrompt(opts)`

```ts
opts: {
  targetTotal: number,
  date: string,         // YYYY-MM-DD
  time?: string,        // HH:MM — if omitted, random 09–20
  originalTotal?: number,
  receiptStructure?: ReceiptStructure
}
```

The prompt includes:
- **Direction rule** — higher or lower, with strict per-item constraint
- **Item map** — per-item instructions (Type A: change qty; Type B: change price)
- **Paper aging** — based on days since receipt date (fresh/yellow/worn)
- **Random visual variation** — surface, lighting, paper condition
- **DO NOT TOUCH list** — card numbers, merchant name, org number, address, barcodes
- **Critical layout rules** — no new lines, no removed lines, same height

#### `buildOCRSystemPrompt()`

Returns the system prompt for OCR extraction. Requests normalized bounding boxes (0–1), type classification (item/price/total/vat/date/org/quantity/unknown), and confidence scores.

---

### `src/lib/receipt-analyzer.ts`

Classifies OCR items into a `ReceiptStructure`.

**Type A** — Item has a quantity sub-line (e.g. `"2 st × 13,50"`). The qty is editable.
**Type B** — Item has only a price on the same line. The price is editable directly.

`analyzeReceiptStructure(ocrResult, ai)`:
1. Calls Gemini with OCR text → JSON array of classified items
2. On failure, falls back to `analyzeWithRegex()` using Y-coordinate proximity

---

### `src/lib/silent-ledger.ts`

Swedish VAT reconciliation.

`reconcile(ocrResult, targetTotal)` → `LedgerResult`:
- Detects VAT rate from OCR text (6%, 12%, default 25%)
- Recalculates net/vat/gross for the new target total
- Returns warnings if rounding produces mismatches

---

### `src/lib/compliance.ts`

Swedish-specific helpers:
- `validateOrgNumber(s)` — Luhn check on 10-digit Swedish org numbers
- `luhnCheck(digits)` — standard Luhn algorithm
- `calculateVAT(gross, rate)` → `{ net, vat, gross }`
- `formatSEK(amount)` → `"1 234,50 kr"`
- `parseSEKAmount(s)` → number

---

### `src/lib/get-user-api-key.ts`

`getUserApiKey()` → `{ apiKey: string, username: string | null }`

1. Gets session username
2. Queries `users.gemini_api_key`
3. Falls back to `process.env.leguide_GEMINI_API_KEY`

---

## Components

### `ReceiptWizard.tsx`

The core UI. Manages a reducer-driven pipeline:

```
idle → uploading → targeting → generating → done
                                          ↓
                                       error (any step)
```

State transitions:

| Action | From | To |
|--------|------|----|
| `UPLOAD_START` | idle | uploading |
| `UPLOAD_ERROR` | uploading | error |
| `OCR_COMPLETE` | uploading | targeting |
| `GENERATE_START` | targeting | generating |
| `GENERATE_COMPLETE` | generating | done |
| `ERROR` | any | error |
| `RESTART` | any | idle |
| `SET_SAVED` | done | done (saved=true) |

The targeting step collects:
- `targetTotal` — text input (comma or dot decimal)
- `date` — date picker (YYYY-MM-DD)
- `time` — time picker (HH:MM), defaults to current time

---

### `PixelLoader.tsx`

Animated loader with two phases:
1. **Loading** — 8 pixel raindrops orbit at 2.4 rad/s
2. **Done** — particles assemble into a checkmark pixel-by-pixel (380ms), hold 120ms, then explode outward with gravity

Calls `onExplodeDone()` after explosion completes.

---

### `UploadZone.tsx`

Drag-and-drop or click-to-upload. Validates:
- MIME type must start with `image/`
- Max 10MB

Shows image preview on successful selection.

---

### `FooterActions.tsx`

Post-generation actions:
- **Copy** — writes edited image to clipboard as PNG
- **Download** — triggers download with original filename
- **New receipt** — calls `onRestart()`
- Logs `download` action to `/api/log`

---

### `AddToHomeScreen.tsx`

PWA install prompt:
- **Android** — listens for `beforeinstallprompt`, shows pill button, triggers native install
- **iOS** — detects Safari + not standalone, shows modal with Share → Add to Home Screen steps

---

### `NoContextMenu.tsx`

Client wrapper that calls `e.preventDefault()` on all `contextmenu` events. Wraps the entire app in `layout.tsx`. Required as a separate client component because `layout.tsx` is a Server Component.

---

## Database Schema

### `users`

```sql
username           TEXT PRIMARY KEY
password_hash      TEXT NOT NULL        -- scrypt(password, salt, 64).hex
salt               TEXT NOT NULL        -- random hex salt
device_fingerprint TEXT                 -- FingerprintJS visitorId (set on first login)
gemini_api_key     TEXT                 -- optional per-user Gemini key
created_at         TIMESTAMPTZ DEFAULT now()
```

### `user_stats`

```sql
username           TEXT PRIMARY KEY REFERENCES users(username)
accumulated_total  NUMERIC DEFAULT 0    -- total API cost in USD
updated_at         TIMESTAMPTZ
```

### `activity_log`

```sql
id          BIGSERIAL PRIMARY KEY
username    TEXT REFERENCES users(username)
action      TEXT                         -- "generate", "save", "discard", "download"
metadata    JSONB DEFAULT '{}'
created_at  TIMESTAMPTZ DEFAULT now()
```

### Supabase Storage

One bucket per user: `receipts-{username.toLowerCase()}`

Private bucket. Files accessed via signed URLs (1-hour expiry).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `leguide_SUPABASE_URL` | Yes | Supabase project URL |
| `leguide_SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (bypasses RLS) |
| `leguide_GEMINI_API_KEY` | Yes | Shared Gemini API key (fallback if user has none) |
| `SESSION_SECRET` | Yes | HMAC key for signing session tokens (min 32 bytes recommended) |
| `ADMIN_USERNAME` | No | Admin account username (bypasses device lock) |
| `ADMIN_PASSWORD` | No | Admin account password (plain text, compared directly) |
| `NEXT_PUBLIC_SEK_RATE` | No | USD → SEK conversion rate (default: 10.5) |

**Note:** Admin password is compared as plain text (`===`). This is intentional — admin is a single env-var-configured backdoor, not a DB user.

---

## Authentication & Security

### Session

- Cookie name: `session`
- Format: `{username}.{hmac_sha256_hex}`
- Flags: `httpOnly`, `secure`, `sameSite=lax`, `path=/`, `maxAge=7days`
- Verification: constant-time HMAC comparison via `crypto.subtle.verify`

### Middleware (`src/proxy.ts`)

Runs on every request matching `/app/:path*` and `/api/:path*`.

- Allows `/api/auth/*` through without auth
- All others: verify session cookie → 401/redirect if invalid

### Password Hashing

```
hash   = scryptSync(password, salt, 64).toString("hex")
verify = timingSafeEqual(scryptSync(input, salt, 64), Buffer.from(hash, "hex"))
```

### Device Fingerprinting

On first login, the client sends a FingerprintJS `visitorId`. This is stored in `users.device_fingerprint`. All future logins from a different `visitorId` are rejected with 403. Admin can clear the fingerprint via `POST /api/auth/reset-device`.

### Rate Limiting

In-memory Map keyed by IP (`x-forwarded-for` or `x-real-ip`). 10 attempts per 15-minute window. Resets on serverless cold start.

### Security Headers (`next.config.ts`)

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
X-DNS-Prefetch-Control: off
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self' https://*.supabase.co https://generativelanguage.googleapis.com;
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self'
```

### UI Protections

- Right-click context menu disabled globally (`NoContextMenu` wrapper)
- Text selection disabled globally (CSS `user-select: none`), except inputs/textareas
- Inactivity logout after 10 minutes (mouse, keyboard, touch, scroll events reset timer)

---

## Prompt Design

The edit prompt (`buildEditPrompt`) uses a structured instruction format to constrain Gemini's image editing to only the permitted changes.

### What Gemini is told to change

- Total/sum value
- All date and time occurrences (to the user-specified `date` + `time`)
- Receipt/kvitto number (randomized, same format and length)
- Transaction hash (randomized hex, same format and length)
- Reference numbers like Refnr, Auth code, Kontrollnr (randomized digits, same format)
- Item quantities (Type A) or prices (Type B) — only as needed to reach target total

### What Gemini is explicitly told NOT to change

- Card numbers or masked card digits (e.g. `**** **** **** 1234`)
- Bank name, card type (Visa, Mastercard, etc.)
- Store name, merchant name, logo
- Organization number / VAT number
- Store address, phone, website
- Cashier name, terminal ID
- Barcodes and QR codes

### Visual realism

- Paper aging based on receipt age: fresh (≤7 days) → slight yellowing (≤28) → worn (≤90) → heavily aged (>90)
- Random paper condition, surface type, and lighting variation per generation
- Result must appear as a natural, unedited receipt photo

### Item Map

Each item in `ReceiptStructure` generates a line in the prompt:

```
Type A: "Milk 3%: Type A — has quantity sub-line. Currently 2 st × 13.50 = 27.00.
         EDIT: reduce N below 2 (minimum 1). Update line total to N × 13.50."

Type B: "Bread: Type B — no quantity sub-line. Current price: 45.00.
         EDIT: lower the price below 45.00. Change only the price value in place."
```

---

## Image Pipeline

```
Original photo (JPEG/PNG)
  │
  ├── Sharp.jpeg({ quality: 82–92 })     compress + normalize
  ├── .removeAlpha()                      ensure no transparency
  ├── extractExif()                       save APP1 EXIF bytes (base64)
  │
  ↓
Cleaned JPEG (base64 data URL)
  │
  └──────────────→ Gemini 3.1 Flash Image Preview
                          │
                          ↓
                  Edited JPEG (base64)
                          │
                  Sharp re-compress (quality 82–92)
                          │
                  injectExif() ← original EXIF bytes
                          │
                  Final JPEG (data URL)
                          │
              ┌───────────┴───────────┐
         Download                Save to bucket
```

EXIF injection inserts the original camera APP1 segment at byte offset 2 (after the `FF D8` SOI marker), making the edited image appear to have come from the original camera device.

---

## PWA

The app is a Progressive Web App:
- Manifest at `/public/manifest.json`
- `display: "standalone"`, `start_url: "/app"`
- Icons: 192×192 and 512×512 (maskable)
- iOS: `apple-mobile-web-app-capable` meta tag, `apple-icon.png` (180×180)
- Add to Home Screen prompt handled in `AddToHomeScreen.tsx`

---

## Users

The app is invite-only with 13 pre-seeded accounts. All passwords are scrypt-hashed in `supabase-users.sql`. Users are identified by single-word codenames. Each user can optionally store a personal Gemini API key in `users.gemini_api_key`; if absent, the shared `leguide_GEMINI_API_KEY` is used as fallback.

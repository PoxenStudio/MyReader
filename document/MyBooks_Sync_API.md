# Readest Native Sync — Server Implementation Guide

This document describes everything a backend (e.g. MyReader) needs to implement in
order to act as the sync server for the Readest app, replacing/complementing
`document/MyBooks_WebAPI.md`. It covers the two sync subsystems that together make
up "Readest Native Sync":

1. **Legacy record sync** (`/api/sync`) — books, reading progress/config, and
   notes/highlights/bookmarks. Last-write-wins by `updated_at`.
2. **Replica sync** (`/api/sync/replicas`, `/api/sync/replica-keys`) — a CRDT-based
   sync for dictionaries, fonts, background textures, OPDS catalogs, and app
   settings. Field-level last-write-wins via Hybrid Logical Clocks (HLC).
3. **Binary storage** (`/api/storage/*`) — signed-URL upload/download used by both
   subsystems for book files, covers, and replica binaries (dictionaries, fonts,
   textures).

KOSync (`/api/kosync` → `/syncs/progress`) is a **separate, third** protocol
(KOReader-compatible, progress-only) and is NOT covered here.

All endpoints require `Authorization: Bearer <accessToken>` (Supabase access
token in the current implementation; MyReader can substitute its own bearer
token as long as it can be resolved to a stable `user_id`).

The feature is currently gated behind `ENABLE_SYNC_FEATURE` in
`apps/readest-app/src/services/mybooks/constants.ts` — set to `true` once the
server implements the endpoints below.

---

## 1. Legacy Record Sync — `/api/sync`

Client implementation: `apps/readest-app/src/libs/sync.ts` (`SyncClient`).

### 1.1 `GET /api/sync`

Pulls incremental changes since a given timestamp.

**Query parameters:**

| Param      | Type   | Required | Description |
|------------|--------|----------|-------------|
| `since`    | number | yes      | Unix ms timestamp; return records with `updated_at > since` (and tombstones with `deleted_at > since`) |
| `type`     | string | no       | One of `books`, `configs`, `notes`. If omitted, return all three. |
| `book`     | string | no       | Filter to a single `book_hash` |
| `meta_hash`| string | no       | Filter to a single `meta_hash` |

**Response `200`:**

```json
{
  "books": [ /* BookRecord[] | null */ ],
  "notes": [ /* BookNoteRecord[] | null */ ],
  "configs": [ /* BookConfigRecord[] | null */ ]
}
```

Only the categories matching `type` (or all three if `type` omitted) need be
populated; the others may be `null`.

### 1.2 `POST /api/sync`

Pushes local changes. Server applies last-write-wins by `updated_at` per record
(matched by `id` + `user_id`), then returns the resulting/merged state (same
shape as the GET response) so the client can reconcile.

**Request body:**

```json
{
  "books": [ /* Partial<BookRecord>[] */ ],
  "notes": [ /* Partial<BookNoteRecord>[] */ ],
  "configs": [ /* Partial<BookConfigRecord>[] */ ]
}
```

**Response `200`:** same shape as `GET /api/sync`.

**Errors:** any non-2xx returns `{ "error": "<message>" }`; the client surfaces
`error.error || response.statusText`.

### 1.3 Common record envelope — `BookDataRecord`

Every record in all three categories carries:

```ts
interface BookDataRecord {
  id: string;            // stable per-record id, e.g. UUID
  book_hash: string;     // Book.hash — partial MD5 of the book file
  meta_hash?: string;    // Book.metaHash — MD5 of metadata, aggregates editions
  user_id: string;
  updated_at: number | null;  // ms epoch; drives last-write-wins
  deleted_at: number | null;  // ms epoch tombstone; null = not deleted
}
```

### 1.4 `books` — `BookRecord = BookDataRecord & Book`

```ts
interface Book {
  url?: string;            // remote-only book content URL
  filePath?: string;       // local transient file path (not synced meaningfully)
  hash: string;            // = book_hash
  metaHash?: string;       // = meta_hash
  storageType?: 'local' | 'cloud';
  format: BookFormat;      // 'EPUB' | 'PDF' | ... (see BookFormat enum)
  title: string;
  sourceTitle?: string;
  author: string;
  group?: string;          // deprecated, use groupId/groupName
  groupId?: string;
  groupName?: string;
  tags?: string[];
  coverImageUrl?: string | null;

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;

  uploadedAt?: number | null;
  downloadedAt?: number | null;
  coverDownloadedAt?: number | null;
  syncedAt?: number | null;

  progress?: [number, number];      // [currentPage, totalPages], 1-based
  readingStatus?: 'unread' | 'reading' | 'finished';
  primaryLanguage?: string;

  metadata?: BookMetadata;          // see types/book.ts for full shape
  files?: { format: BookFormat; size: number; href: string }[];
  originCoverUrl?: string | null;
}
```

The actual book **file** and **cover image** are not embedded in this record —
they are uploaded/downloaded separately via `/api/storage/*` (§3), keyed by
`book_hash`.

### 1.5 `notes` — `BookNoteRecord = BookDataRecord & BookNote`

This is the category that carries **bookmarks, highlights, and annotations** —
the thing KOSync does *not* cover.

```ts
type BookNoteType = 'bookmark' | 'annotation' | 'excerpt';
type HighlightStyle = 'highlight' | 'underline' | 'squiggly';
type HighlightColor = 'red' | 'yellow' | 'green' | 'blue' | 'violet' | string; // hex allowed

interface BookNote {
  bookHash?: string;   // = book_hash
  metaHash?: string;   // = meta_hash
  id: string;          // = id
  type: BookNoteType;
  cfi: string;         // canonicalized EPUB CFI for the note location
  xpointer0?: string;  // start XPointer (KOReader interop)
  xpointer1?: string;  // end XPointer (KOReader interop)
  page?: number;       // for paginated/fixed-layout formats
  text?: string;       // selected/excerpted text
  style?: HighlightStyle;
  color?: HighlightColor;
  note: string;        // user-written note content
  global?: boolean;    // apply to every occurrence of `text` in the section

  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}
```

### 1.6 `configs` — `BookConfigRecord = BookDataRecord & BookConfig`

Per-book reading progress and per-book view settings.

```ts
interface BookConfig {
  schemaVersion?: number;
  bookHash?: string;
  metaHash?: string;
  progress?: [number, number];   // [currentPage, totalPages]
  location?: string;             // CFI of current location
  xpointer?: string;             // XPointer of current location (KOReader interop)
  booknotes?: BookNote[];        // (legacy inline copy; primary source is `notes` category)
  rsvpPosition?: { cfi: string; wordText: string };
  searchConfig?: Partial<BookSearchConfig>;
  viewSettings?: Partial<ViewSettings>;  // large object, see types/book.ts

  lastSyncedAtConfig?: number;
  lastSyncedAtNotes?: number;
  lastPushedAtConfig?: number;
  lastPushedAtNotes?: number;
}
```

### 1.7 Sync cadence

Client-side polling intervals (`apps/readest-app/src/services/constants.ts`):
`SYNC_PROGRESS_INTERVAL_SEC = 3`, `SYNC_NOTES_INTERVAL_SEC = 5`,
`SYNC_BOOKS_INTERVAL_SEC = 5`. These only matter for server-side rate-limiting
expectations — no special server behavior is required beyond standard
last-write-wins merge.

---

## 2. Replica Sync (CRDT) — `/api/sync/replicas` & `/api/sync/replica-keys`

Client implementation:
- `apps/readest-app/src/libs/replicaSyncClient.ts` (HTTP client)
- `apps/readest-app/src/libs/replicaSyncServer.ts` (validation contract — **server must mirror this**)
- `apps/readest-app/src/libs/replicaSchemas.ts` (per-kind field schemas/limits)
- `apps/readest-app/src/libs/crdt.ts` (HLC + merge algorithm — **server must implement `mergeReplica`**)
- `apps/readest-app/src/libs/crdt.README.md` (design rationale)

This subsystem syncs **non-book** user data: dictionaries, custom fonts,
background textures, OPDS catalog subscriptions, and app settings (including
`syncCategories`, theme, etc). It does **not** carry books, notes, or progress.

### 2.1 Core data types

```ts
/** Branded HLC string. Lexicographic compare == temporal order. */
type Hlc = string; // format: `${physicalMs:13-hex}-${counter:8-hex}-${deviceId}`

interface FieldEnvelope<V = unknown> {
  v: V;     // value
  t: Hlc;   // HLC timestamp this field was last written
  s: string; // device/source id that wrote it (tiebreaker)
}

type FieldsObject = Record<string, FieldEnvelope>;

interface ManifestFile {
  filename: string;
  byteSize: number;
  partialMd5: string;
  mtime?: number;
}

interface Manifest {
  files: ManifestFile[];
  schemaVersion: number;
}

interface ReplicaRow {
  user_id: string;
  kind: string;                 // one of KIND_ALLOWLIST keys
  replica_id: string;           // stable id of the entity (e.g. dictionary id, font id, 'singleton' for settings)
  fields_jsonb: FieldsObject;   // CRDT field map
  manifest_jsonb: Manifest | null; // binary file manifest, for binary kinds
  deleted_at_ts: Hlc | null;    // tombstone HLC, null = not deleted
  reincarnation: string | null; // opaque token; see §2.5
  updated_at_ts: Hlc;           // row-level HLC (max of all field HLCs / deletion)
  schema_version: number;
}

/** Encrypted field value — replaces `v` when the field is end-to-end encrypted */
interface CipherEnvelope {
  c: string;   // ciphertext, base64
  i: string;   // IV, base64
  s: string;   // saltId — references a row in replica_keys
  alg: string; // e.g. "aes-gcm/pbkdf2-600k-sha256"
  h: string;   // SHA-256 integrity sidecar of plaintext, base64
}
```

The server treats `FieldEnvelope.v` opaquely when it equals a `CipherEnvelope`
shape (`{c,i,s,alg,h}` all strings) — it never decrypts, only stores and
forwards. Encryption/decryption happens entirely client-side.

### 2.2 HLC format and ordering

`hlcPack(physicalMs, counter, deviceId)`:

```
${physicalMs.toString(16).padStart(13,'0')}-${counter.toString(16).padStart(8,'0')}-${deviceId}
```

- `physicalMs`: wall-clock ms since epoch, 13 hex digits (max `0xfffffffffffff`)
- `counter`: monotonic tiebreaker within the same `physicalMs`, 8 hex digits (max `0xffffffff`)
- `deviceId`: opaque string, final tiebreaker

**Ordering is plain lexicographic string comparison** (`a < b` ⇔ `a` happened
before `b`). The server needs this for:
- Sorting/filtering "since" cursors in pull queries (`updated_at_ts > since`)
- Implementing `mergeReplica` (see §2.5) if merging happens server-side

### 2.3 `POST /api/sync/replicas` — Push

**Request:**

```json
{ "rows": [ /* ReplicaRow[] */ ] }
```

**Response `200`:**

```json
{ "rows": [ /* ReplicaRow[] — server's post-merge view of the pushed rows */ ] }
```

The server should, for each pushed row:
1. Validate (see §2.6).
2. Fetch the existing row for `(user_id, kind, replica_id)`, if any.
3. Merge via `mergeReplica(existing, incoming)` (§2.5) — CRDT merge, never a
   blind overwrite.
4. Persist the merged row.
5. Return the merged row (so the client's local copy converges with the
   server's, including any fields the server already had that the client
   didn't send).

### 2.4 `GET /api/sync/replicas?kind=<kind>&since=<hlc>` — Pull (single kind)

**Query parameters:**

| Param   | Type   | Required | Description |
|---------|--------|----------|-------------|
| `kind`  | string | yes      | one of `KIND_ALLOWLIST` keys (§2.7) |
| `since` | string | no       | HLC string; return rows with `updated_at_ts > since`. Omit/empty for full sync. |

**Response `200`:**

```json
{ "rows": [ /* ReplicaRow[] for user_id = caller, kind = <kind>, updated_at_ts > since */ ] }
```

**Response `404`:** client treats this as "no rows" (empty array) — server may
return 404 if the kind/user has no data, or just return `{ "rows": [] }` with
200. Either is acceptable; 200 is simpler.

Rows should be returned **including tombstones** (`deleted_at_ts != null`) so
clients can remove locally-deleted entities. Do not hard-delete rows server-side
on tombstone — tombstones must remain queryable for catch-up sync.

### 2.5 `POST /api/sync/replicas` with `{ cursors: [...] }` — Batched pull

Same endpoint, discriminated by body shape (`rows` => push, `cursors` => batch
pull). This collapses N per-kind `GET` polls into one request.

**Request:**

```json
{
  "cursors": [
    { "kind": "settings", "since": "0000019... -00000000-device123" },
    { "kind": "dictionary", "since": null }
  ]
}
```

**Response `200`:**

```json
{
  "results": [
    { "kind": "settings", "rows": [ /* ReplicaRow[] */ ] },
    { "kind": "dictionary", "rows": [ /* ReplicaRow[] */ ] }
  ]
}
```

Validation (`validatePullBatch`):
- `cursors` must be a non-empty array of objects with `kind` (allow-listed,
  non-empty string, no duplicates within the batch) and `since` (`string | null`).
- `cursors.length` must be `<= MAX_PULL_BATCH` (50).
- Empty `cursors` array => `{ "results": [] }`.

### 2.6 CRDT merge algorithm — `mergeReplica`

The server is the source of truth for the merged state returned from push, so
it **must implement the same merge semantics** as
`apps/readest-app/src/libs/crdt.ts::mergeReplica`. Pseudocode:

```ts
function mergeFields(local: FieldsObject, remote: FieldsObject): FieldsObject {
  const out = { ...local };
  for (const key of Object.keys(remote)) {
    const lo = local[key];
    const re = remote[key];
    out[key] = lo ? pickWinner(lo, re) : re;
  }
  return out;
}

// Per-field last-write-wins: higher HLC wins; on exact tie, higher
// source/device id (`s`, string compare `>=`) wins.
function pickWinner(a: FieldEnvelope, b: FieldEnvelope): FieldEnvelope {
  const cmp = hlcCompare(a.t, b.t);
  if (cmp > 0) return a;
  if (cmp < 0) return b;
  return a.s >= b.s ? a : b;
}

function mergeReplica(local: ReplicaRow, remote: ReplicaRow): ReplicaRow {
  // identity check: same user_id, kind, replica_id (else error)
  const fields = mergeFields(local.fields_jsonb, remote.fields_jsonb);

  // tombstone: remove-wins — max of both deletion HLCs (null = not deleted)
  const deleted_at_ts = hlcMax(local.deleted_at_ts, remote.deleted_at_ts);

  // reincarnation: "undelete" token. Whichever side's reincarnation token
  // has the higher updated_at_ts HLC wins, UNLESS deleted_at_ts is newer
  // than that HLC (i.e. a later delete supersedes the reincarnation).
  const candidates = [local, remote]
    .filter(r => r.reincarnation)
    .map(r => ({ token: r.reincarnation, t: r.updated_at_ts }));
  const winner = candidates.length
    ? candidates.reduce((a, b) => hlcCompare(a.t, b.t) >= 0 ? a : b)
    : null;
  const reincarnation = (winner && (!deleted_at_ts || hlcCompare(winner.t, deleted_at_ts) > 0))
    ? winner.token : null;

  // manifest: take whichever row's manifest belongs to the row with the
  // higher updated_at_ts (or the non-null one if only one side has it)
  const manifest_jsonb = remote.manifest_jsonb === null ? local.manifest_jsonb
    : local.manifest_jsonb === null ? remote.manifest_jsonb
    : (hlcCompare(remote.updated_at_ts, local.updated_at_ts) > 0 ? remote.manifest_jsonb : local.manifest_jsonb);

  const schema_version = Math.max(local.schema_version, remote.schema_version);

  // updated_at_ts = max(max of all field HLCs and deleted_at_ts, local.updated_at_ts, remote.updated_at_ts)
  const contentUpdatedAt = max(deleted_at_ts, ...fields.values().map(f => f.t));
  const updated_at_ts = hlcMax(contentUpdatedAt, hlcMax(local.updated_at_ts, remote.updated_at_ts));

  return { user_id: local.user_id, kind: local.kind, replica_id: local.replica_id,
           fields_jsonb: fields, manifest_jsonb, deleted_at_ts, reincarnation,
           updated_at_ts, schema_version };
}
```

Where `hlcMax(a, b)` returns the lexicographically larger of two (possibly
null) HLCs (`null` is treated as "smallest").

**Reincarnation** exists so a client can fully reset/recreate a logically
"deleted" entity (e.g. re-add a dictionary with the same `replica_id` after
deleting it) without the old tombstone/fields bleeding through:
`withReincarnation(row, token)` clears `fields_jsonb` to `{}`,
`deleted_at_ts` to `null`, and sets `reincarnation = token`.

### 2.7 Validation rules (server must enforce — `validatePushBatch` / `validateRow`)

| Limit | Value | Notes |
|---|---|---|
| `MAX_PUSH_BATCH` | 100 rows | `rows.length > 100` => `413 VALIDATION` |
| `MAX_PULL_BATCH` | 50 cursors | `cursors.length > 50` => `413 VALIDATION` |
| `HLC_SKEW_TOLERANCE_MS` | 60,000 | `updated_at_ts` / `deleted_at_ts` physical time must be within ±60s of server `now()`, else `409 CLOCK_SKEW` |
| `MAX_JSON_BYTES` | 65536 (64 KiB) | `JSON.stringify(fields_jsonb).length` (UTF-8 bytes) per row |
| `MAX_FIELD_COUNT` | 64 | max keys in `fields_jsonb` |
| `MAX_FILENAME_LEN` | 255 | per manifest file |

Per-row checks, in order, each producing a specific error (see §2.9 for HTTP
status mapping):

1. `row.user_id` must equal the authenticated user's id → else `403 AUTH`.
2. `row.kind` must be in `KIND_ALLOWLIST` → else `422 UNKNOWN_KIND`.
3. `row.schema_version` must be within `[minSchemaVersion, maxSchemaVersion]`
   for that kind → else `422 SCHEMA_TOO_NEW`.
4. `Object.keys(fields_jsonb).length <= MAX_FIELD_COUNT` → else `422 VALIDATION`.
5. `byteLength(JSON.stringify(fields_jsonb)) <= MAX_JSON_BYTES` → else `422 VALIDATION`.
6. Every value in `fields_jsonb` must be a `FieldEnvelope` (`{v, t: string, s: string}`)
   or a `CipherEnvelope` (`{c, i, s, alg, h}` all strings) → else `422 VALIDATION`.
7. `fields_jsonb` must match the per-kind field schema (§2.8, extra/unknown keys
   allowed via `catchall` for most kinds — see below) → else `422 VALIDATION`.
8. If `manifest_jsonb != null`: validate against `{ files: ManifestFile[], schemaVersion: number }`
   and each `files[].filename` via filename rules (non-empty, ≤255 chars, no
   `.`/`..`, no `/` or `\`, no control characters) → else `422 VALIDATION`.
9. `updated_at_ts` (and `deleted_at_ts` if present) physical-time component
   must be within `HLC_SKEW_TOLERANCE_MS` of server time → else `409 CLOCK_SKEW`.

Per-user row-count caps (`maxRowsPerUser`, §2.8) should be enforced on insert
of a *new* `replica_id` (existing rows being updated don't count against the
cap) → exceeding it should map to `402`/`507 QUOTA_EXCEEDED`.

### 2.8 `KIND_ALLOWLIST` — supported kinds and field schemas

All kinds use the generic `ReplicaRow` envelope (§2.1). `fields_jsonb` keys are
typed per kind below. Every kind's schema is a `catchall(fieldEnvelopeWithCipher)`
— i.e. the server only validates the **shape** (`FieldEnvelope` or
`CipherEnvelope`) of unlisted keys, not their names/values; client-side adapters
enforce the actual whitelist of field names.

| `kind` | `maxRowsPerUser` | schema version range | `binary` | `replica_id` semantics |
|---|---|---|---|---|
| `dictionary` | 200 | 1–1 | true | one row per custom dictionary |
| `font` | 500 | 1–1 | true | one row per custom font |
| `texture` | 200 | 1–1 | true | one row per background texture |
| `opds_catalog` | 50 | 1–1 | false | one row per OPDS catalog subscription |
| `settings` | 1 | 1–1 | false | singleton row, `replica_id = 'singleton'` |

`binary: true` kinds carry an associated `manifest_jsonb` describing files
stored via `/api/storage/*` (§3) under `Readest/Replicas/<kind>/<replica_id>/<filename>`.

**`dictionary` fields** (each is a `FieldEnvelope` unless noted):
- `name`, `enabled`, `lang` — plus arbitrary additional catchall fields.

**`font` fields:**
- `name`, `family`, `style`, `weight`, `variable`, `byteSize`, `downloadedAt` — plus catchall.

**`texture` fields:**
- `name`, `byteSize`, `downloadedAt` — plus catchall.

**`opds_catalog` fields:**
- `name`, `url`, `description`, `icon`, `customHeaders`, `autoDownload`,
  `disabled`, `addedAt` — plus catchall.
- `username`, `password` — these may be either plain `FieldEnvelope` or
  `CipherEnvelope` (encrypted credentials; present only if the publishing
  device had its passphrase unlocked).

**`settings` fields:**
- Fully open-shaped `Record<string, FieldEnvelope | CipherEnvelope>`. Keys are
  either a bare setting name (e.g. `theme`) or `<group>.<id>` for flat-map
  settings (e.g. `providerEnabled.builtin:wiktionary`,
  `syncCategories.dictionary`, `shortcut.toggleSidebar`). The server does not
  validate key names — only the 64-field / 64 KiB caps and envelope shape.

### 2.9 `SyncErrorCode` → HTTP status mapping

Client-side error codes (`apps/readest-app/src/libs/errors.ts`). The server
should return `{ "error": "<message>", "code": "<SyncErrorCode>", "offendingIndex"?: number }`
with the matching HTTP status; if `code` is absent the client derives a
default from the status:

| HTTP status | default `code` |
|---|---|
| 401, 403 | `AUTH` |
| 402, 507 | `QUOTA_EXCEEDED` |
| 409 | `CLOCK_SKEW` |
| 413, 422 | `VALIDATION` |
| >=500 | `SERVER` |
| other | `VALIDATION` |

Full `SyncErrorCode` enum (server should use the most specific applicable
code): `TIMEOUT`, `AUTH`, `QUOTA_EXCEEDED`, `CLOCK_SKEW`, `VALIDATION`, `SERVER`,
`DECRYPT`, `INTEGRITY`, `UNSUPPORTED_ALG`, `SALT_NOT_FOUND`, `CRYPTO_UNAVAILABLE`,
`NO_PASSPHRASE`, `LOCAL_FILE_MISSING`, `TRANSFER`, `STORAGE`, `MANIFEST_COMMIT`,
`UNKNOWN_KIND`, `SCHEMA_TOO_NEW`, `LEGACY_MIGRATION_SKIP`, `HLC_PERSIST`.
(The last several — `DECRYPT`…`HLC_PERSIST` — are purely client-side error
states and never need to be produced by the server.)

### 2.10 `/api/sync/replica-keys` — encryption salt registry

Used for the optional end-to-end encryption layer (§4). The server stores
opaque salts; it never sees passphrases or derived keys.

```ts
interface ReplicaKeyRow {
  saltId: string;   // opaque id referenced by CipherEnvelope.s
  alg: string;      // e.g. "aes-gcm/pbkdf2-600k-sha256"
  salt: string;     // base64 PBKDF2 salt
  createdAt: string; // ISO timestamp
}
```

- **`GET /api/sync/replica-keys`** → `{ "rows": ReplicaKeyRow[] }` — all salts
  ever created for this user, oldest first (rotation keeps old salts so older
  envelopes remain decryptable).
- **`POST /api/sync/replica-keys`** with body `{ "alg": string }` → `{ "row": ReplicaKeyRow }`.
  Server generates a fresh random salt (16+ bytes), stores
  `(user_id, saltId, alg, salt, createdAt)`, returns the new row. Used on
  passphrase setup/rotation.
- **`DELETE /api/sync/replica-keys`** → `204`/`200` empty body. **Destructive**:
  deletes *all* salts for the user. Used on "forgot passphrase" — after this,
  all `CipherEnvelope` fields for this user become permanently undecryptable
  and should ideally be purged or treated as opaque garbage by the server (the
  client will overwrite/reincarnate replicas as needed).

---

## 3. Binary Storage — `/api/storage/*`

Client implementation: `apps/readest-app/src/libs/storage.ts`,
`apps/readest-app/src/services/cloudService.ts`.

Used for: book files & covers (existing MyReader book-upload flow — see
`MyBooks_WebAPI.md`), and replica binaries (dictionaries, fonts, textures) for
the CRDT sync subsystem. All transfers go through **signed URLs** — the API
issues a short-lived PUT/GET URL, the client uploads/downloads directly against
that URL (e.g. to S3/R2), bypassing the API server for the bulk transfer.

### Path convention

```
Readest/Books/<book_hash>/<filename>            -- book files/covers (CLOUD_BOOKS_SUBDIR)
Readest/Replicas/<kind>/<replica_id>/<filename> -- replica binaries (CLOUD_REPLICAS_SUBDIR)
```

The full storage key is `<user_id>/<path>`.

### 3.1 `POST /api/storage/upload`

**Request:**

```json
{
  "fileName": "Readest/Replicas/font/abc123/MyFont.ttf",
  "fileSize": 123456,
  "replicaKind": "font",
  "replicaId": "abc123",
  "temp": false
}
```

(For book uploads, `bookHash` is sent instead of `replicaKind`/`replicaId` —
see `MyBooks_WebAPI.md` for that flow.)

**Response `200`:**

```json
{ "uploadUrl": "https://...", "downloadUrl": "https://..." }
```

`downloadUrl` is only meaningful/returned when `temp: true`. Client then issues
`PUT <uploadUrl>` with the raw file bytes (web: `fetch`/XHR; Tauri: native
upload via plugin).

### 3.2 `POST /api/storage/download` (batch) / `GET /api/storage/download?fileKey=...` (single)

**Batch request:**

```json
{ "fileKeys": ["<user_id>/Readest/Replicas/font/abc123/MyFont.ttf", "..."] }
```

**Batch response:**

```json
{ "downloadUrls": { "<fileKey>": "https://...", "...": "..." } }
```

**Single (`GET`) response:** `{ "downloadUrl": "https://..." }`.

Client then issues `GET <downloadUrl>` directly to fetch bytes.

### 3.3 `DELETE /api/storage/delete?fileKey=<key>`

Deletes a single object. Empty response body expected.

### 3.4 `GET /api/storage/stats`

```ts
interface StorageStats {
  totalFiles: number;
  totalSize: number;
  usage: number;
  quota: number;
  usagePercentage: number;
  byBookHash: Array<{ bookHash: string | null; fileCount: number; totalSize: number }>;
}
```

`quota` should reflect the user's plan: `DEFAULT_STORAGE_QUOTA` =
`{ free: 500MB, plus: 5GB, pro: 20GB, purchase: 0 }` (bytes).

### 3.5 `GET /api/storage/list`

**Query params:** `page`, `pageSize`, `sortBy` (`created_at|updated_at|file_size|file_key`),
`sortOrder` (`asc|desc`), `bookHash`, `search`.

**Response:**

```ts
interface FileRecord {
  file_key: string;
  file_size: number;
  book_hash: string | null;
  replica_kind: string | null;
  replica_id: string | null;
  created_at: string;
  updated_at: string | null;
}
interface ListFilesResponse {
  files: FileRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
```

### 3.6 `DELETE /api/storage/purge`

**Request:** `{ "fileKeys": string[] }`

**Response:**

```ts
interface PurgeFilesResult {
  success: string[];
  failed: Array<{ fileKey: string; error: string }>;
  deletedCount: number;
  failedCount: number;
}
```

---

## 4. End-to-end encryption envelope (informational — no server-side crypto)

Some replica fields (e.g. `opds_catalog.username`/`password`, and arbitrary
`settings` fields) may be sent as `CipherEnvelope` instead of a plain value.
The server stores/forwards these opaquely — it never derives keys or decrypts.
For completeness:

- Key derivation: PBKDF2-HMAC-SHA256, 600,000 iterations, 256-bit AES-GCM key
  (`alg = "aes-gcm/pbkdf2-600k-sha256"`), salt from `replica_keys.salt`
  (referenced by `CipherEnvelope.s = saltId`).
- Encryption: AES-GCM with random IV (`CipherEnvelope.i`), ciphertext
  base64 in `CipherEnvelope.c`.
- Integrity: SHA-256 of the plaintext, base64 in `CipherEnvelope.h`, verified
  by the client after decryption (constant-time compare).

The server only needs to: (1) store/serve `replica_keys` rows (§2.10), and
(2) pass `CipherEnvelope`-shaped field values through `fields_jsonb` untouched,
validating only their shape (`{c, i, s, alg, h}`, all strings).

---

## 5. Settings & category gating (client behavior, for context)

- `SystemSettings.syncCategories: Record<SyncCategory, boolean>` where
  `SyncCategory` ∈ `{ book, progress, note, dictionary, font, texture, opds_catalog, settings }`.
  `book`/`progress`/`note` gate the legacy sync (§1); the rest gate replica
  kinds (§2). Default: all `true` except none disabled by default
  (`DEFAULT_OFF_CATEGORIES` currently only includes a hypothetical
  `credentials` category, not part of `SyncCategory`).
- `dictionary` syncing depends on `settings` also being enabled
  (`CATEGORY_DEPENDENTS = { dictionary: ['settings'] }`) — purely a
  client-side ordering/dependency concern, no server action needed.
- `SystemSettings.lastSyncedAtReplicas: Record<string, Hlc | null>` — per-kind
  pull cursors, persisted client-side. The server is stateless with respect to
  cursors; it only filters by the `since` HLC passed in each pull request.

---

## 6. Summary checklist for MyReader implementation

- [ ] `GET/POST /api/sync` — books/configs/notes, last-write-wins by `updated_at`/`deleted_at` (§1)
- [ ] `POST /api/sync/replicas` — push (CRDT merge) and batched pull via `{cursors}` (§2.3, §2.5)
- [ ] `GET /api/sync/replicas?kind=&since=` — single-kind pull (§2.4)
- [ ] Implement `mergeReplica`/`mergeFields`/HLC compare server-side (§2.6)
- [ ] Enforce all validation limits and error codes (§2.7, §2.9)
- [ ] `GET/POST/DELETE /api/sync/replica-keys` (§2.10)
- [ ] `/api/storage/{upload,download,delete,stats,list,purge}` with signed URLs,
      including `Readest/Replicas/<kind>/<replica_id>/<filename>` path support (§3)
- [ ] Per-user storage quota enforcement (§3.4, `DEFAULT_STORAGE_QUOTA`)
- [ ] Per-kind row-count caps (`maxRowsPerUser`, §2.8)
- [ ] Set `ENABLE_SYNC_FEATURE = true` (and `ENABLE_BOOK_UPLOAD` as applicable) in `apps/readest-app/src/services/mybooks/constants.ts` once ready

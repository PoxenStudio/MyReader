This page outlines the database schema used by the Readest Sync API. The authoritative source is the migrations folder in the main repo — [`docker/volumes/db/migrations`](https://github.com/readest/readest/tree/main/docker/volumes/db/migrations) — apply each `NNN_*.sql` file in numeric order against a fresh Supabase project to reproduce the schema below.

The schema covers:

* **Reading data** — `books`, `book_configs`, `book_notes`, `files`
* **Share links** — `book_shares`
* **CRDT replicas** — `replicas`, `replica_keys` (used for custom dictionaries, fonts, textures, OPDS catalogs, and bundled app settings)

---

## Reading data

### `books`

One row per book in the user's library.

```sql
create table public.books (
  user_id uuid not null,
  book_hash text not null,
  meta_hash text null,
  format text null, -- 'EPUB' | 'PDF' | 'MOBI' | 'CBZ' | 'FB2' | 'FBZ'
  title text null,
  source_title text null,
  author text null,
  "group" text null,
  tags text[] null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  deleted_at timestamp with time zone null,
  uploaded_at timestamp with time zone null,
  progress integer[] null,
  reading_status text null,
  group_id text null,
  group_name text null,
  metadata json null,
  constraint books_pkey primary key (user_id, book_hash),
  constraint books_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_books ON public.books
  FOR SELECT to authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY insert_books ON public.books
  FOR INSERT to authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY update_books ON public.books
  FOR UPDATE to authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY delete_books ON public.books
  FOR DELETE to authenticated USING ((select auth.uid()) = user_id);
```

### `book_configs`

Per-book reading state: position, search history, view settings, and the latest RSVP cursor.

```sql
create table public.book_configs (
  user_id uuid not null,
  book_hash text not null,
  meta_hash text null,
  location text null,
  xpointer text null,
  progress jsonb null,
  search_config jsonb null,
  view_settings jsonb null,
  rsvp_position text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  deleted_at timestamp with time zone null,
  constraint book_configs_pkey primary key (user_id, book_hash),
  constraint book_configs_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

ALTER TABLE public.book_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_book_configs ON public.book_configs
  FOR SELECT to authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY insert_book_configs ON public.book_configs
  FOR INSERT to authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY update_book_configs ON public.book_configs
  FOR UPDATE to authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY delete_book_configs ON public.book_configs
  FOR DELETE to authenticated USING ((select auth.uid()) = user_id);
```

> `rsvp_position` (added in migration `001`) stores the user's last RSVP (rapid-serial visual presentation) cursor so resume-after-reopen works across devices.

### `book_notes`

Highlights, underlines, and freeform notes. One row per annotation.

```sql
create table public.book_notes (
  user_id uuid not null,
  book_hash text not null,
  meta_hash text null,
  id text not null,
  type text null,
  cfi text null,
  text text null,
  style text null,
  color text null,
  note text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  deleted_at timestamp with time zone null,
  constraint book_notes_pkey primary key (user_id, book_hash, id),
  constraint book_notes_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

ALTER TABLE public.book_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_book_notes ON public.book_notes
  FOR SELECT to authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY insert_book_notes ON public.book_notes
  FOR INSERT to authenticated WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY update_book_notes ON public.book_notes
  FOR UPDATE to authenticated USING ((select auth.uid()) = user_id);
CREATE POLICY delete_book_notes ON public.book_notes
  FOR DELETE to authenticated USING ((select auth.uid()) = user_id);
```

### `files`

Pointers into object storage for every uploaded binary (book files plus replica-kind binaries such as custom dictionaries and fonts). `replica_kind` / `replica_id` group binaries by their owning replica row when there is no book hash.

```sql
create table public.files (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  book_hash text null,
  file_key text not null,
  file_size bigint not null,
  replica_kind text null,
  replica_id text null,
  created_at timestamp with time zone null default now(),
  deleted_at timestamp with time zone null,
  constraint files_pkey primary key (id),
  constraint files_file_key_key unique (file_key),
  constraint files_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index idx_files_user_id_deleted_at
  on public.files (user_id, deleted_at);
create index idx_files_file_key
  on public.files (file_key);
create index idx_files_file_key_deleted_at
  on public.files (file_key, deleted_at);
create index idx_files_replica_lookup
  on public.files (user_id, replica_kind, replica_id);

alter table public.files enable row level security;

create policy "Users can insert their own files"
on public.files for insert
with check ( auth.uid() = user_id );

create policy "Users can view their own active files"
on public.files for select
using ( auth.uid() = user_id and deleted_at is null );

create policy "Users can soft-delete their own files"
on public.files for update
using ( auth.uid() = user_id )
with check ( deleted_at is null or deleted_at > now() );

create policy "Users can delete their own files permanently"
on public.files for delete
using ( auth.uid() = user_id );
```

---

## Share links

### `book_shares`

Backs the time-limited `/s/{token}` share landing pages. Lookups by `token_hash` are O(1); the plaintext `token` is RLS-restricted to the owner so they can copy the link after the create dialog closes.

```sql
CREATE TABLE public.book_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  token text NOT NULL,
  user_id uuid NOT NULL,
  book_hash text NOT NULL,
  book_title text NOT NULL,
  book_author text NULL,
  book_format text NOT NULL,
  book_size bigint NOT NULL,
  cfi text NULL,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone NULL,
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT book_shares_pkey PRIMARY KEY (id),
  CONSTRAINT book_shares_token_hash_key UNIQUE (token_hash),
  CONSTRAINT book_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_book_shares_user_id ON public.book_shares (user_id);
CREATE INDEX idx_book_shares_user_id_book_hash ON public.book_shares (user_id, book_hash);

ALTER TABLE public.book_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY book_shares_select ON public.book_shares
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY book_shares_insert ON public.book_shares
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY book_shares_update ON public.book_shares
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY book_shares_delete ON public.book_shares
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
```

The public `/download/confirm` beacon uses a `SECURITY DEFINER` helper so unauthenticated visitors can bump the download counter only on still-active rows:

```sql
CREATE OR REPLACE FUNCTION public.increment_book_share_download(
  p_token_hash text,
  p_now timestamp with time zone
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.book_shares
  SET download_count = download_count + 1
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND expires_at > p_now;
$$;

GRANT EXECUTE ON FUNCTION public.increment_book_share_download(text, timestamp with time zone)
  TO anon, authenticated, service_role;
```

---

## CRDT replicas

Replicas back the cross-device sync of imported assets and bundled app settings. Each row is a CRDT envelope: per-field LWW values, a manifest pointing at binaries in `files`, an HLC tombstone, and an `updated_at_ts` cursor.

The allowlist of `kind` values is the gate for what can sync. Today: **`dictionary`, `font`, `texture`, `opds_catalog`, `settings`** (see migrations `006`, `009`, `011`).

### `replica_keys`

Per-account PBKDF2 salts for encrypted-field envelopes (e.g. OPDS credentials). Rotating the sync passphrase appends a new row; "forget passphrase" deletes every row for the user.

```sql
CREATE TABLE public.replica_keys (
  user_id uuid NOT NULL,
  salt_id text NOT NULL,
  alg text NOT NULL,
  salt bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT replica_keys_pkey PRIMARY KEY (user_id, salt_id),
  CONSTRAINT replica_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.replica_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY replica_keys_select ON public.replica_keys
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replica_keys_insert ON public.replica_keys
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY replica_keys_delete ON public.replica_keys
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
```

### `replicas`

```sql
CREATE TABLE public.replicas (
  user_id uuid NOT NULL,
  kind text NOT NULL,
  replica_id text NOT NULL,
  fields_jsonb jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest_jsonb jsonb NULL,
  deleted_at_ts text NULL,
  reincarnation text NULL,
  updated_at_ts text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  modified_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT replicas_pkey PRIMARY KEY (user_id, kind, replica_id),
  CONSTRAINT replicas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT replicas_kind_allowlist CHECK (kind IN ('dictionary', 'font', 'texture', 'opds_catalog', 'settings')),
  CONSTRAINT replicas_fields_size CHECK (pg_column_size(fields_jsonb) <= 65536),
  CONSTRAINT replicas_schema_version CHECK (schema_version >= 1 AND schema_version <= 1000)
);

CREATE INDEX idx_replicas_pull_cursor
  ON public.replicas (user_id, kind, updated_at_ts);

ALTER TABLE public.replicas ENABLE ROW LEVEL SECURITY;

CREATE POLICY replicas_select ON public.replicas
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_insert ON public.replicas
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_update ON public.replicas
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY replicas_delete ON public.replicas
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
```

Key columns:

* `fields_jsonb` — per-field LWW envelopes `{<field>: {v, t: <Hlc>, s}}`. The `64 KiB` cap matches the client-side validator in `src/libs/replicaSchemas.ts`.
* `manifest_jsonb` — committed last after binaries upload. `null` means "binaries pending"; the row isn't downloadable yet.
* `deleted_at_ts` — remove-wins tombstone HLC. A field write never revives a tombstoned row.
* `reincarnation` — explicit re-import token; swaps the row to alive under a new logical identity.
* `updated_at_ts` — `max(field HLCs, deleted_at_ts, manifest-commit HLC)`. Drives the pull cursor.
* `schema_version` — bumped per-kind when the field shape changes.

### CRDT merge functions

`crdt_merge_replica()` is the atomic upsert used by `POST /api/sync/replicas`. It mirrors `mergeReplica()` in `src/libs/crdt.ts`, so client-side optimistic merges converge with the server.

Properties (verified by `src/__tests__/libs/crdt.test.ts` and the server-merge race test):

* Commutative, associative, and idempotent on `fields_jsonb`.
* **Remove-wins**: a field write never revives a tombstone.
* Preserves unknown fields from either side (forwards-compat across `schema_version` bumps).
* `deviceId` lex-tiebreak when two field envelopes share the same HLC.

```sql
-- HLC max helper. NULLs lose. Plain text comparison since the HLC packing
-- format makes lexicographic order match temporal order.
CREATE OR REPLACE FUNCTION public.hlc_max(a text, b text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN a IS NULL THEN b
    WHEN b IS NULL THEN a
    WHEN a >= b THEN a
    ELSE b
  END;
$$;

-- Per-field LWW merge for fields_jsonb. Per-key: keep the envelope with the
-- larger envelope.t (HLC). Tie on HLC: deviceId (envelope.s) lex-order tiebreak.
CREATE OR REPLACE FUNCTION public.crdt_merge_fields(local_fields jsonb, remote_fields jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  result jsonb := COALESCE(local_fields, '{}'::jsonb);
  k text;
  l_env jsonb;
  r_env jsonb;
  l_t text;
  r_t text;
  l_s text;
  r_s text;
BEGIN
  IF remote_fields IS NULL THEN
    RETURN result;
  END IF;
  FOR k IN SELECT jsonb_object_keys(remote_fields) LOOP
    r_env := remote_fields -> k;
    l_env := result -> k;
    IF l_env IS NULL THEN
      result := jsonb_set(result, ARRAY[k], r_env, true);
    ELSE
      l_t := l_env ->> 't';
      r_t := r_env ->> 't';
      IF r_t > l_t THEN
        result := jsonb_set(result, ARRAY[k], r_env, true);
      ELSIF r_t = l_t THEN
        l_s := COALESCE(l_env ->> 's', '');
        r_s := COALESCE(r_env ->> 's', '');
        IF r_s > l_s THEN
          result := jsonb_set(result, ARRAY[k], r_env, true);
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Content updated_at_ts = max over field HLCs and tombstone HLC.
CREATE OR REPLACE FUNCTION public.crdt_compute_updated_at(fields jsonb, deleted_at text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $$
DECLARE
  result text := COALESCE(deleted_at, '0000000000000-00000000-');
  k text;
  env jsonb;
  t text;
BEGIN
  IF fields IS NULL THEN
    RETURN result;
  END IF;
  FOR k IN SELECT jsonb_object_keys(fields) LOOP
    env := fields -> k;
    t := env ->> 't';
    IF t IS NOT NULL AND t > result THEN
      result := t;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- Atomic replica upsert. Migration 005 preserves the max of existing row,
-- incoming row, and content/tombstone timestamps so manifest-only commits
-- can't reset the pull cursor backwards.
CREATE OR REPLACE FUNCTION public.crdt_merge_replica(
  p_user_id uuid,
  p_kind text,
  p_replica_id text,
  p_fields_jsonb jsonb,
  p_manifest_jsonb jsonb,
  p_deleted_at_ts text,
  p_reincarnation text,
  p_updated_at_ts text,
  p_schema_version integer
) RETURNS public.replicas
LANGUAGE plpgsql
AS $$
DECLARE
  result public.replicas;
BEGIN
  INSERT INTO public.replicas AS r (
    user_id, kind, replica_id,
    fields_jsonb, manifest_jsonb, deleted_at_ts,
    reincarnation, updated_at_ts, schema_version
  ) VALUES (
    p_user_id, p_kind, p_replica_id,
    COALESCE(p_fields_jsonb, '{}'::jsonb),
    p_manifest_jsonb, p_deleted_at_ts,
    p_reincarnation, p_updated_at_ts, p_schema_version
  )
  ON CONFLICT (user_id, kind, replica_id) DO UPDATE SET
    fields_jsonb   = public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
    deleted_at_ts  = public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts),
    reincarnation  = CASE
                       WHEN r.reincarnation IS NULL AND EXCLUDED.reincarnation IS NULL
                         THEN NULL
                       WHEN r.reincarnation IS NOT NULL AND EXCLUDED.reincarnation IS NULL
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR r.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN r.reincarnation
                                ELSE NULL
                              END
                       WHEN r.reincarnation IS NULL AND EXCLUDED.reincarnation IS NOT NULL
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR EXCLUDED.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN EXCLUDED.reincarnation
                                ELSE NULL
                              END
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN CASE
                                WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                  OR EXCLUDED.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                  THEN EXCLUDED.reincarnation
                                ELSE NULL
                              END
                       ELSE CASE
                              WHEN public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts) IS NULL
                                OR r.updated_at_ts > public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                                THEN r.reincarnation
                              ELSE NULL
                            END
                     END,
    manifest_jsonb = CASE
                       WHEN EXCLUDED.manifest_jsonb IS NULL
                         THEN r.manifest_jsonb
                       WHEN r.manifest_jsonb IS NULL
                         THEN EXCLUDED.manifest_jsonb
                       WHEN EXCLUDED.updated_at_ts > r.updated_at_ts
                         THEN EXCLUDED.manifest_jsonb
                       ELSE r.manifest_jsonb
                     END,
    schema_version = GREATEST(r.schema_version, EXCLUDED.schema_version),
    updated_at_ts  = public.hlc_max(
                       public.hlc_max(r.updated_at_ts, EXCLUDED.updated_at_ts),
                       public.crdt_compute_updated_at(
                         public.crdt_merge_fields(r.fields_jsonb, EXCLUDED.fields_jsonb),
                         public.hlc_max(r.deleted_at_ts, EXCLUDED.deleted_at_ts)
                       )
                     ),
    modified_at    = now()
  RETURNING * INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hlc_max(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_merge_fields(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_compute_updated_at(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crdt_merge_replica(uuid, text, text, jsonb, jsonb, text, text, text, integer) TO authenticated;
```

### Passphrase RPCs

`pgcrypto` provides `gen_random_bytes()`. The three RPCs run `SECURITY INVOKER` so RLS on `replica_keys` / `replicas` enforces the per-user guard:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Mint a new salt for the calling user. Only pbkdf2-600k-sha256 is accepted.
CREATE OR REPLACE FUNCTION public.replica_keys_create(p_alg text)
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_salt_id text := gen_random_uuid()::text;
  v_salt bytea := extensions.gen_random_bytes(32);
BEGIN
  IF p_alg <> 'pbkdf2-600k-sha256' THEN
    RAISE EXCEPTION 'Unsupported alg: %', p_alg USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.replica_keys (user_id, salt_id, alg, salt)
  VALUES (auth.uid(), v_salt_id, p_alg, v_salt);
  RETURN QUERY
    SELECT v_salt_id, p_alg, encode(v_salt, 'base64'), now();
END;
$$;

-- List the calling user's salts (most recent first).
CREATE OR REPLACE FUNCTION public.replica_keys_list()
RETURNS TABLE(salt_id text, alg text, salt_b64 text, created_at timestamptz)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT salt_id, alg, encode(salt, 'base64') AS salt_b64, created_at
  FROM public.replica_keys
  WHERE user_id = (SELECT auth.uid())
  ORDER BY created_at DESC;
$$;

-- "Forget passphrase": strip every cipher envelope from the user's
-- replicas (plaintext fields are untouched) and drop all salt rows.
-- The next encrypted push from any device mints a fresh salt + key.
CREATE OR REPLACE FUNCTION public.replica_keys_forget()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'replica_keys_forget called without an authenticated user';
  END IF;

  UPDATE public.replicas r
  SET fields_jsonb = (
    SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
    FROM jsonb_each(r.fields_jsonb)
    WHERE NOT (
      jsonb_typeof(value -> 'v') = 'object'
      AND value -> 'v' ? 'alg'
    )
  )
  WHERE r.user_id = v_user_id
    AND EXISTS (
      SELECT 1 FROM jsonb_each(r.fields_jsonb) e
      WHERE jsonb_typeof(e.value -> 'v') = 'object'
        AND e.value -> 'v' ? 'alg'
    );

  DELETE FROM public.replica_keys WHERE user_id = v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replica_keys_create(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replica_keys_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.replica_keys_forget() TO authenticated;
```

---

## Self-host the Readest Sync API

If you'd like to run your own sync service instead of using the default Readest servers, you can self‑host by setting up a [Supabase](https://supabase.com/) instance with the same table schema used by Readest.

Apply every migration in [`docker/volumes/db/migrations`](https://github.com/readest/readest/tree/main/docker/volumes/db/migrations) in numeric order — the SQL on this page is generated from those files.

Once your Supabase instance is ready, configure the following environment variables in your `.env.local` file (see [example here](https://github.com/readest/readest/blob/main/apps/readest-app/.env.local.example#L4-L11)):

```env
# Supabase project URL
NEXT_PUBLIC_SUPABASE_URL=YOUR_SUPABASE_URL

# Supabase anonymous public key
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

# Optional: Fixed quota for each account (in bytes)
NEXT_PUBLIC_STORAGE_FIXED_QUOTA=1073741824 # 1GB, change as needed

# Base URL of your self‑hosted Sync API
NEXT_PUBLIC_API_BASE_URL=https://your-api-base-url.com

# Supabase admin key (used by the API backend)
SUPABASE_ADMIN_KEY=YOUR_SUPABASE_ADMIN_KEY
```

Once set, your Readest app will use your own Supabase + API endpoint for syncing books, progress, notes, share links, and replica-backed assets across devices.

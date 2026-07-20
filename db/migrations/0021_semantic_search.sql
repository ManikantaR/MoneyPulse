-- 11.10 local semantic transaction search: pgvector + Ollama nomic-embed-text (768-dim).
--
-- NAS DATA-VOLUME MIGRATION PATH (corrected after a staging rehearsal — see below):
-- This migration requires the `vector` extension, which ships in the
-- `pgvector/pgvector:pg16` image but NOT in the stock `postgres:16-alpine` image
-- used previously.
--
-- CORRECTION: an earlier version of this comment claimed pgvector/pgvector:pg16
-- is "built FROM the same postgres:16 base image" as the prior image, so the
-- existing volume could just be reused in place. That's false: the live NAS
-- Postgres image is `postgres:16-alpine` (musl libc), while `pgvector/pgvector:pg16`
-- is Debian-based (glibc) — confirmed directly from a staging container's boot log
-- ("PostgreSQL 16.14 (Debian 16.14-1.pgdg12+1)"). Swapping the image in place on
-- an Alpine-created data directory risks silent collation-order corruption on any
-- text/varchar index (musl and glibc don't sort text identically) — not a crash,
-- a QUIET wrong-order bug. Do NOT just `docker compose pull && up -d postgres`.
--
-- PROVEN-SAFE PATH (rehearsed on an on-demand staging stack before this landed):
--   1. pg_dump -Fc the current (Alpine) database.
--   2. Bring up pgvector/pgvector:pg16 against a FRESH, empty volume (not the old one).
--   3. pg_restore the dump into the fresh cluster — this rebuilds every index from
--      scratch under the new image's real collation, sidestepping the risk entirely
--      rather than gambling on in-place compatibility.
--   4. Run this migration (CREATE EXTENSION vector + the table below) against the
--      restored cluster.
--   5. Point the app at the new container; verify. Keep the OLD container + volume
--      stopped but untouched for a rollback window — nothing destructive happened
--      to it, so rollback is "point the app back," not "restore from backup."
-- Verified end-to-end on a copy of real prod data: identical row counts across all
-- tables and a matching content checksum on `transactions` pre/post restore.
--
-- This file itself is idempotent (`IF NOT EXISTS` throughout) and safe to re-run.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "transaction_embeddings" (
  "transaction_id" uuid PRIMARY KEY REFERENCES "transactions"("id") ON DELETE CASCADE,
  "embedding" vector(768) NOT NULL,
  "model" varchar(100) NOT NULL DEFAULT 'nomic-embed-text',
  "embedded_at" timestamptz NOT NULL DEFAULT now()
);

-- Approximate nearest-neighbor index for cosine similarity search.
-- IVFFlat requires rows to already exist to pick good cluster centers, but
-- CREATE INDEX is safe to run against an empty table too (falls back to a
-- reasonable default) and this migration always runs before any backfill.
CREATE INDEX IF NOT EXISTS "idx_transaction_embeddings_cosine"
  ON "transaction_embeddings"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);

-- 11.10 local semantic transaction search: pgvector + Ollama nomic-embed-text (768-dim).
--
-- NAS DATA-VOLUME MIGRATION PATH:
-- This migration requires the `vector` extension, which ships in the
-- `pgvector/pgvector:pg16` image but NOT in the stock `postgres:16` image used
-- previously. Two supported paths, pick one before this migration runs:
--
--   1. (Recommended) Swap the compose `image:` for the `postgres` service to
--      `pgvector/pgvector:pg16` (already done in docker-compose.yml /
--      docker-compose.dev.yml as part of this change). pgvector/pgvector is
--      built FROM the same postgres:16 base image, so the existing data
--      volume is fully compatible — no dump/restore needed, just
--      `docker compose pull && docker compose up -d postgres` and the new
--      image boots against the existing PGDATA directory unchanged.
--   2. If you cannot change the image (e.g. a pinned base image policy),
--      install the pgvector extension files into the running container's
--      Postgres `$libdir` manually (build from source or copy from a
--      pgvector image) so `CREATE EXTENSION vector` below succeeds against
--      the stock image.
--
-- Either way this file is idempotent (`IF NOT EXISTS` throughout) and safe
-- to re-run.
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

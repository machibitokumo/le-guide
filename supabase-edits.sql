-- Le Guide: schema-tillägg för generate-and-verify-pipelinen
-- Körs efter supabase-users.sql. Idempotent.

-- =====================================================================
-- 1. activity_log: baseline-tabell om den inte redan finns
-- =====================================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGSERIAL PRIMARY KEY,
  username    TEXT REFERENCES users(username) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_log_username_created_idx
  ON activity_log (username, created_at DESC);

CREATE INDEX IF NOT EXISTS activity_log_action_idx
  ON activity_log (action);

-- JSONB-index för de nya verify-loop-fälten så vi kan filtrera/aggregera snabbt
CREATE INDEX IF NOT EXISTS activity_log_metadata_doc_type_idx
  ON activity_log ((metadata->>'doc_type'));

CREATE INDEX IF NOT EXISTS activity_log_metadata_verdict_idx
  ON activity_log ((metadata->>'verify_verdict'));

CREATE INDEX IF NOT EXISTS activity_log_metadata_bailed_idx
  ON activity_log ((metadata->>'bailed_out'))
  WHERE metadata ? 'bailed_out';

-- =====================================================================
-- 2. edit_runs: full debug-spår per genereringsförsök
--    (target.md / actual.md / plan.json sparas här, 30 dagars TTL)
-- =====================================================================

CREATE TABLE IF NOT EXISTS edit_runs (
  id              BIGSERIAL PRIMARY KEY,
  username        TEXT REFERENCES users(username) ON DELETE SET NULL,

  -- Dokument
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('kvitto', 'faktura')),
  original_filename TEXT,

  -- Mål
  target_total    NUMERIC(12, 2),
  target_date     DATE,
  target_time     TEXT,

  -- Plan från redigeringsplaneraren (Qwen reasoning)
  edit_plan       JSONB,           -- { docType, operations[], vatBreakdown[], warnings[] }
  target_md       TEXT,            -- kanonisk markdown som domaren jämför mot

  -- Resultat
  passed          BOOLEAN,
  bailed_out      BOOLEAN DEFAULT false,
  attempts        INTEGER NOT NULL DEFAULT 0,
  final_verdict   TEXT CHECK (final_verdict IN ('PASS', 'FAIL') OR final_verdict IS NULL),

  -- Per-attempt detaljer (verdict, diff, correction, usage per modell, actual_md)
  attempts_log    JSONB DEFAULT '[]'::jsonb,

  -- Tokenanvändning aggregerad
  total_input_tokens  INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  total_cost_usd      NUMERIC(10, 6) DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

CREATE INDEX IF NOT EXISTS edit_runs_username_created_idx
  ON edit_runs (username, created_at DESC);

CREATE INDEX IF NOT EXISTS edit_runs_doc_type_idx
  ON edit_runs (doc_type);

CREATE INDEX IF NOT EXISTS edit_runs_failed_idx
  ON edit_runs (created_at DESC)
  WHERE passed IS NOT TRUE;

CREATE INDEX IF NOT EXISTS edit_runs_expires_idx
  ON edit_runs (expires_at);

-- =====================================================================
-- 3. TTL-cleanup: kör som cron eller via pg_cron
-- =====================================================================

CREATE OR REPLACE FUNCTION purge_expired_edit_runs()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  deleted INTEGER;
BEGIN
  DELETE FROM edit_runs WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- Schemaläggs separat med pg_cron om det finns:
-- SELECT cron.schedule('purge-edit-runs', '0 3 * * *', $$ SELECT purge_expired_edit_runs() $$);

-- =====================================================================
-- 4. RLS — endast service-role-klienten skriver hit
-- =====================================================================

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE edit_runs    ENABLE ROW LEVEL SECURITY;

-- Inga policies = bara service_role har access. Lägg till user-policies om
-- klienten någonsin ska läsa direkt (idag går allt via Next.js API).

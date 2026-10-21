-- UrbaTrame · authentification des étudiants autorisés
-- PostgreSQL 14+ recommandé. Exécuter une seule fois dans la base de préproduction.
-- La liste est gérée par l'outil local de l'administratrice, jamais par une route publique.

CREATE TABLE IF NOT EXISTS whitelisted_students (
  email          text PRIMARY KEY,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text NOT NULL DEFAULT 'owner-cli',
  deactivated_at timestamptz,
  CONSTRAINT whitelisted_students_email_lower CHECK (email = lower(email)),
  CONSTRAINT whitelisted_students_domain CHECK (email ~ '^[^[:space:]@]+@univ-constantine3[.]dz$')
);

CREATE TABLE IF NOT EXISTS student_users (
  id                uuid PRIMARY KEY,
  email             text NOT NULL UNIQUE REFERENCES whitelisted_students(email) ON UPDATE CASCADE ON DELETE RESTRICT,
  role              text NOT NULL DEFAULT 'student' CHECK (role = 'student'),
  tier              text NOT NULL DEFAULT 'max' CHECK (tier = 'max'),
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz,
  is_active         boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS otp_verifications (
  id             uuid PRIMARY KEY,
  email          text NOT NULL REFERENCES whitelisted_students(email) ON UPDATE CASCADE ON DELETE RESTRICT,
  code_mac       text NOT NULL CHECK (code_mac ~ '^[a-f0-9]{64}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  attempts_count integer NOT NULL DEFAULT 0 CHECK (attempts_count >= 0),
  consumed_at    timestamptz,
  invalidated_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS otp_verifications_email_created_idx
  ON otp_verifications (email, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_verifications_expiry_idx
  ON otp_verifications (expires_at);

CREATE TABLE IF NOT EXISTS otp_send_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL,
  ip_hash    text NOT NULL CHECK (ip_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_send_events_email_time_idx
  ON otp_send_events (email, created_at DESC);
CREATE INDEX IF NOT EXISTS otp_send_events_ip_time_idx
  ON otp_send_events (ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS student_sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES student_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS student_sessions_user_expiry_idx
  ON student_sessions (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS student_sessions_expiry_idx
  ON student_sessions (expires_at);

CREATE TABLE IF NOT EXISTS student_whitelist_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text NOT NULL,
  action     text NOT NULL CHECK (action IN ('add', 'reactivate', 'remove', 'import')),
  actor      text NOT NULL DEFAULT 'owner-cli',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS student_whitelist_audit_email_time_idx
  ON student_whitelist_audit (email, created_at DESC);

-- Nettoyage manuel/planifié possible :
-- DELETE FROM otp_verifications WHERE expires_at < now() - interval '1 day';
-- DELETE FROM otp_send_events WHERE created_at < now() - interval '2 days';
-- DELETE FROM student_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days';

-- NextBid Authentication Gateway - Database Schema
-- Run this in Supabase SQL Editor.
-- nextbid_users already exists - we ALTER it to add columns.

-- 1. COMPANIES (NEW)
CREATE TABLE IF NOT EXISTS nextbid_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  tier VARCHAR(50) NOT NULL DEFAULT 'standard',
  dedicated_server_ip VARCHAR(50),
  dedicated_server_ports JSONB,
  stripe_customer_id VARCHAR(255),
  billing_email VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- 2. USERS - ALTER EXISTING TABLE (add columns if not exist)
DO $addcol$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nextbid_users' AND column_name = 'company_id') THEN ALTER TABLE nextbid_users ADD COLUMN company_id UUID REFERENCES nextbid_companies(id) ON DELETE SET NULL; END IF; END $addcol$;
DO $addcol$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nextbid_users' AND column_name = 'domain') THEN ALTER TABLE nextbid_users ADD COLUMN domain VARCHAR(50) DEFAULT 'engine'; END IF; END $addcol$;
DO $addcol$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nextbid_users' AND column_name = 'phone') THEN ALTER TABLE nextbid_users ADD COLUMN phone VARCHAR(50); END IF; END $addcol$;
DO $addcol$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nextbid_users' AND column_name = 'email_verified') THEN ALTER TABLE nextbid_users ADD COLUMN email_verified BOOLEAN DEFAULT false; END IF; END $addcol$;
DO $addcol$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nextbid_users' AND column_name = 'onboarding_completed') THEN ALTER TABLE nextbid_users ADD COLUMN onboarding_completed BOOLEAN DEFAULT false; END IF; END $addcol$;
DO $addcol$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'nextbid_users' AND column_name = 'onboarding_step') THEN ALTER TABLE nextbid_users ADD COLUMN onboarding_step INTEGER DEFAULT 0; END IF; END $addcol$;
CREATE INDEX IF NOT EXISTS idx_nextbid_users_company ON nextbid_users(company_id);
CREATE INDEX IF NOT EXISTS idx_nextbid_users_domain ON nextbid_users(domain);

-- 3. COMPANY TRADELINE SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS nextbid_company_tradelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES nextbid_companies(id) ON DELETE CASCADE,
  tradeline VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(company_id, tradeline)
);
CREATE INDEX IF NOT EXISTS idx_company_tradelines_company ON nextbid_company_tradelines(company_id);
CREATE INDEX IF NOT EXISTS idx_company_tradelines_tradeline ON nextbid_company_tradelines(tradeline);

-- 4. COMPANY CREDENTIALS (Crowdsourced)
CREATE TABLE IF NOT EXISTS nextbid_company_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES nextbid_companies(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  username VARCHAR(255),
  password_encrypted VARCHAR(255),
  api_key_encrypted VARCHAR(255),
  extra_data JSONB,
  is_configured BOOLEAN DEFAULT false,
  status VARCHAR(50) DEFAULT 'pending',
  last_used TIMESTAMP WITH TIME ZONE,
  last_error TEXT,
  use_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(company_id, source)
);
CREATE INDEX IF NOT EXISTS idx_company_credentials_company ON nextbid_company_credentials(company_id);
CREATE INDEX IF NOT EXISTS idx_company_credentials_source ON nextbid_company_credentials(source);

-- 5. SESSIONS
CREATE TABLE IF NOT EXISTS nextbid_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES nextbid_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  ip_address VARCHAR(50),
  user_agent TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON nextbid_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON nextbid_sessions(expires_at);

-- 6. API TOKENS
CREATE TABLE IF NOT EXISTS nextbid_api_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES nextbid_users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  prefix VARCHAR(10) NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  scopes TEXT[],
  last_used TIMESTAMP WITH TIME ZONE,
  use_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON nextbid_api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON nextbid_api_tokens(prefix);

-- 7. AUDIT LOG
CREATE TABLE IF NOT EXISTS nextbid_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES nextbid_users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(255),
  ip_address VARCHAR(50),
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON nextbid_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON nextbid_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON nextbid_audit_log(created_at);

-- 8. CREDENTIAL POOL VIEW
CREATE OR REPLACE VIEW v_credential_pool AS
SELECT cc.id, cc.company_id, c.name AS company_name, cc.source,
  cc.username, cc.password_encrypted, cc.api_key_encrypted,
  cc.status, cc.last_used, cc.use_count, cc.success_count, cc.failure_count
FROM nextbid_company_credentials cc
JOIN nextbid_companies c ON cc.company_id = c.id
WHERE cc.is_configured = true AND cc.status IN ('valid', 'pending') AND c.is_active = true
ORDER BY cc.last_used NULLS FIRST, cc.use_count ASC;

-- 9. HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION get_next_credential(p_source VARCHAR)
RETURNS TABLE (id UUID, company_id UUID, username VARCHAR, password_encrypted VARCHAR, api_key_encrypted VARCHAR) AS $func$
DECLARE v_cred RECORD;
BEGIN
  SELECT cc.* INTO v_cred FROM nextbid_company_credentials cc
  JOIN nextbid_companies c ON cc.company_id = c.id
  WHERE cc.source = p_source AND cc.is_configured = true AND cc.status IN ('valid', 'pending') AND c.is_active = true
  ORDER BY cc.last_used NULLS FIRST, cc.use_count ASC LIMIT 1;
  IF v_cred IS NOT NULL THEN
    UPDATE nextbid_company_credentials SET last_used = NOW(), use_count = use_count + 1 WHERE nextbid_company_credentials.id = v_cred.id;
    RETURN QUERY SELECT v_cred.id, v_cred.company_id, v_cred.username, v_cred.password_encrypted, v_cred.api_key_encrypted;
  END IF;
END;
$func$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_credential_success(p_credential_id UUID) RETURNS VOID AS $func$
BEGIN UPDATE nextbid_company_credentials SET status = 'valid', success_count = success_count + 1, last_error = NULL, updated_at = NOW() WHERE id = p_credential_id; END;
$func$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_credential_failure(p_credential_id UUID, p_error TEXT) RETURNS VOID AS $func$
BEGIN UPDATE nextbid_company_credentials SET failure_count = failure_count + 1, last_error = p_error, status = CASE WHEN failure_count >= 5 THEN 'invalid' ELSE 'pending' END, updated_at = NOW() WHERE id = p_credential_id; END;
$func$ LANGUAGE plpgsql;

-- 10. SEED DATA (uses random UUIDs)
DO $seed$
DECLARE dev_company_id UUID;
BEGIN
  INSERT INTO nextbid_companies (name, tier) VALUES ('NextBid Dev Team', 'enterprise') ON CONFLICT DO NOTHING RETURNING id INTO dev_company_id;
  IF dev_company_id IS NULL THEN SELECT id INTO dev_company_id FROM nextbid_companies WHERE name = 'NextBid Dev Team'; END IF;
  UPDATE nextbid_users SET company_id = dev_company_id, domain = 'engine', onboarding_completed = true WHERE role = 'admin' AND company_id IS NULL;
  INSERT INTO nextbid_company_tradelines (company_id, tradeline) SELECT dev_company_id, t.tradeline FROM (VALUES ('security'), ('administrative'), ('facilities'), ('electrical'), ('logistics'), ('lowvoltage'), ('landscaping'), ('hvac'), ('plumbing'), ('janitorial'), ('support'), ('waste'), ('construction'), ('roofing'), ('painting'), ('flooring'), ('demolition'), ('environmental'), ('concrete'), ('fencing')) AS t(tradeline) ON CONFLICT DO NOTHING;
END $seed$;

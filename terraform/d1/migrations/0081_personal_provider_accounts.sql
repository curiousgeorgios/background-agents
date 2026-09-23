-- Ownership is distinct from created_by: audit attribution may change or be null,
-- while only the owner may connect, select, or spend this account.
ALTER TABLE model_provider_accounts ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

UPDATE model_provider_accounts
SET owner_user_id = created_by
WHERE created_by IS NOT NULL;

CREATE INDEX idx_model_provider_accounts_owner_provider
ON model_provider_accounts(owner_user_id, provider, status)
WHERE archived_at IS NULL;

-- The previous installation-wide default is copied to its account's owner.
-- Accounts without a known owner remain unselectable until reviewed manually.
CREATE TABLE personal_model_provider_account_defaults (
  owner_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  unattended_mode TEXT NOT NULL DEFAULT 'provider_account',
  created_by TEXT,
  updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, provider),
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_account_id, provider)
    REFERENCES model_provider_accounts(id, provider),
  CHECK (unattended_mode IN ('provider_account', 'api_key'))
);

INSERT INTO personal_model_provider_account_defaults
  (owner_user_id, provider, provider_account_id, unattended_mode,
   created_by, updated_by, created_at, updated_at)
SELECT accounts.owner_user_id, defaults.provider, defaults.provider_account_id,
       defaults.unattended_mode, defaults.created_by, defaults.updated_by,
       defaults.created_at, defaults.updated_at
FROM model_provider_account_defaults AS defaults
JOIN model_provider_accounts AS accounts ON accounts.id = defaults.provider_account_id
WHERE accounts.owner_user_id IS NOT NULL;

DROP TRIGGER model_provider_accounts_protect_default;
DELETE FROM model_provider_account_defaults;

CREATE TRIGGER personal_provider_default_requires_owner
BEFORE INSERT ON personal_model_provider_account_defaults
WHEN NOT EXISTS (
  SELECT 1 FROM model_provider_accounts
  WHERE id = NEW.provider_account_id AND provider = NEW.provider
    AND owner_user_id = NEW.owner_user_id AND status = 'active' AND archived_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'provider default account must belong to owner and remain active');
END;

CREATE TRIGGER personal_provider_default_update_requires_owner
BEFORE UPDATE ON personal_model_provider_account_defaults
WHEN NOT EXISTS (
  SELECT 1 FROM model_provider_accounts
  WHERE id = NEW.provider_account_id AND provider = NEW.provider
    AND owner_user_id = NEW.owner_user_id AND status = 'active' AND archived_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'provider default account must belong to owner and remain active');
END;

CREATE TRIGGER model_provider_accounts_protect_personal_default
BEFORE UPDATE OF status, archived_at ON model_provider_accounts
WHEN (NEW.status = 'disabled' OR NEW.archived_at IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM personal_model_provider_account_defaults
    WHERE provider_account_id = OLD.id AND provider = OLD.provider
  )
BEGIN
  SELECT RAISE(ABORT, 'provider default account must remain active');
END;

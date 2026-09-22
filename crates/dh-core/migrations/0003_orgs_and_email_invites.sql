-- Orgs, members and email bound invites (spec 0011). Adds who-may-create-org
-- controls, org creator tracking, email invites that can carry an org and
-- role, and tightens the shareable link to a bounded, member only code. The
-- `viewer` org role goes away: an existing viewer becomes a member with an
-- explicit read only connection grant, so their data access does not change.

ALTER TABLE users
    ADD COLUMN can_create_orgs BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT users_create_orgs_admin_only CHECK (NOT can_create_orgs OR server_role = 'admin');

ALTER TABLE server_settings
    ADD COLUMN open_org_creation BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE organizations
    ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX organizations_created_by_idx ON organizations (created_by);

ALTER TABLE server_invites
    ADD COLUMN org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    ADD COLUMN org_role TEXT CHECK (org_role IN ('owner','admin','member')),
    ADD CONSTRAINT server_invites_org_role_pair CHECK ((org_id IS NULL) = (org_role IS NULL));

-- Every existing viewer keeps read access, explicitly, before the role goes
-- away: one read only grant per connection they can already see, then their
-- role becomes member.
INSERT INTO connection_grants (conn_id, user_id, can_read, can_update, can_delete)
SELECT c.id, m.user_id, 1, 0, 0
FROM org_members m
JOIN connections c ON c.org_id = m.org_id
WHERE m.role = 'viewer'
  AND NOT EXISTS (
      SELECT 1 FROM connection_grants g WHERE g.conn_id = c.id AND g.user_id = m.user_id
  );
UPDATE org_members SET role = 'member' WHERE role = 'viewer';

ALTER TABLE org_members DROP CONSTRAINT org_members_role_check;
ALTER TABLE org_members ADD CONSTRAINT org_members_role_check CHECK (role IN ('owner','admin','member'));

ALTER TABLE org_invites DROP CONSTRAINT org_invites_role_check;
ALTER TABLE org_invites ADD CONSTRAINT org_invites_role_check CHECK (role IN ('owner','admin','member'));

-- The old links had no required limit or expiry; delete them (upgrade notes
-- say so) rather than backfill values nobody chose, then tighten the table.
DELETE FROM org_invites;

ALTER TABLE org_invites DROP CONSTRAINT org_invites_role_check;
ALTER TABLE org_invites ADD CONSTRAINT org_invites_role_check CHECK (role = 'member');
ALTER TABLE org_invites ALTER COLUMN max_uses SET NOT NULL;
ALTER TABLE org_invites ADD CONSTRAINT org_invites_max_uses_range CHECK (max_uses BETWEEN 1 AND 100);
ALTER TABLE org_invites ALTER COLUMN expires_ms SET NOT NULL;

-- One open invite per email per org, and one open plain server invite (no
-- org) per email, replacing the old "one open invite per email" rule.
DROP INDEX server_invites_open_email_idx;
CREATE UNIQUE INDEX server_invites_open_email_idx ON server_invites (email, COALESCE(org_id, '')) WHERE used_ms IS NULL;

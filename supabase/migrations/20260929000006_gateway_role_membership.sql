-- Lets the migration/owner role SET ROLE authority_gateway, which is how the
-- pgTAP suites exercise the gateway exactly as the application connects. It
-- grants nothing to any client role and does not widen the gateway role.
grant authority_gateway to postgres with set true;

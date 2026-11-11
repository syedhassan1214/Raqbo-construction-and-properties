-- =====================================================================
-- RAQBO update 24 — fix "Export backup" (admin → Backups)
-- The function wrote an audit-log entry but was marked STABLE, so
-- Postgres refused it ("cannot execute INSERT in a read-only transaction").
-- Safe to run more than once.
-- =====================================================================
alter function public.admin_export_backup() volatile;

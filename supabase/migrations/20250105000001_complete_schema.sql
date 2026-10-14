-- Legacy migration marker.
--
-- The former contents mixed several incompatible schemas, referenced tables
-- before they existed, and did not match the application models. Keeping this
-- version as a no-op preserves the existing migration version for projects
-- where it was already recorded. The supported schema starts in
-- 20260904032053_community_core.sql.

select 'legacy migration retained as a no-op' as status;

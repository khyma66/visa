-- Keep the current and previous UTC day. With daily cleanup at 03:37 UTC,
-- even a signature created just after midnight expires in under 52 hours.
-- This leaves margin within the published three-day maximum.
select cron.schedule('post-view-dedup-retention','37 3 * * *', $job$delete from private.post_view_dedup where day < (now() at time zone 'UTC')::date-1$job$);

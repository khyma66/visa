-- Read-only inventory. Run independently on the confirmed source and target.
-- updated_at is NOT an ingestion completion watermark.
select 'posts' as entity,count(*) as total,
       count(*) filter (where group_id is null) as unassigned,
       max(created_at) as newest_created,max(updated_at) as newest_updated
from public.posts;
select 'comments' as entity,count(*) as total from public.comments
union all select 'questions',count(*) from public.questions
union all select 'answers',count(*) from public.answers
union all select 'communities',count(*) from public.communities;

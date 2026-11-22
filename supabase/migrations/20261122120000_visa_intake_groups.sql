-- Visa + intake + university groups reuse public communities. Developed against the
-- isolated PGlite harness only; no hosted database was used.
begin;
set local lock_timeout='5s';

-- Ordinary communities keep all four fields null. A group has all four, validated.
alter table public.communities
  add column group_visa_type text,
  add column intake_term text,
  add column intake_year smallint,
  add column university text;
alter table public.communities add constraint communities_intake_fields check(
  (group_visa_type is null and intake_term is null and intake_year is null and university is null)
  or (group_visa_type in ('F-1 / OPT','H-1B','H-4','H-4 / EAD','B1/B2')
    and intake_term in ('spring','fall') and intake_year between 2024 and 2100
    and university is not null and char_length(university) between 3 and 60));
create index communities_public_intake_idx on public.communities(group_visa_type,intake_term,intake_year,member_count desc,slug)
  where is_public is true and is_active is true and group_visa_type is not null;
-- Table-level writes stay revoked; make sure no column grant reopens these fields.
revoke insert(group_visa_type,intake_term,intake_year,university),update(group_visa_type,intake_term,intake_year,university)
  on public.communities from public,anon,authenticated;

-- Appending columns keeps every existing reader and setof-returning RPC compatible.
create or replace view public.community_directory with(security_invoker=true) as
  select id,slug,display_name,description,country,category,rules,member_count,created_at,created_by,
    group_visa_type,intake_term,intake_year,university
  from public.communities where is_public is true and is_active is true;
revoke all on public.community_directory from public,anon,authenticated;
grant select on public.community_directory to anon,authenticated;

create function private.create_intake_group(target_visa text,target_term text,target_year integer,university_name text,expected_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  me uuid:=(select auth.uid());
  clean text:=regexp_replace(btrim(coalesce(university_name,'')),'\s+',' ','g');
  this_year integer:=extract(year from now())::integer;
  code text; category text; handle text; prefix text; slug_body text; group_slug text; existing public.communities; result uuid;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  code:=case target_visa when 'F-1 / OPT' then 'F1' when 'H-1B' then 'H1B' when 'H-4' then 'H4' when 'H-4 / EAD' then 'H4EAD' when 'B1/B2' then 'B1B2' end;
  category:=case target_visa when 'F-1 / OPT' then 'Study' when 'H-1B' then 'Work visas' when 'H-4' then 'Family' when 'H-4 / EAD' then 'Family' when 'B1/B2' then 'Travel' end;
  if code is null then raise exception 'Choose a supported visa type' using errcode='22023'; end if;
  if target_term is null or target_term not in ('spring','fall') then raise exception 'Choose a Spring or Fall intake' using errcode='22023'; end if;
  if target_year is null or target_year not between this_year and this_year+3 then raise exception 'Choose an upcoming intake' using errcode='22023'; end if;
  if char_length(clean) not between 3 and 60 or clean !~ '^[A-Za-z0-9][A-Za-z0-9 .,&''()-]*$'
    or char_length(regexp_replace(clean,'[^A-Za-z]','','g'))<3 then
    raise exception 'Enter a university name of 3 to 60 letters, numbers or basic punctuation' using errcode='22023';
  end if;
  handle:=private.community_handle(code||' '||initcap(target_term)||' '||target_year||' '||clean);
  -- One group per visa, intake and university; concurrent requests resolve to the same row.
  perform pg_advisory_xact_lock(hashtextextended('intake-group:'||lower(handle),0));
  select * into existing from public.communities where lower(display_name)=lower(handle);
  if existing.id is not null then
    if existing.group_visa_type is distinct from target_visa or existing.intake_term is distinct from target_term
      or existing.intake_year is distinct from target_year or existing.is_public is not true or existing.is_active is not true then
      raise exception 'That group name is already taken' using errcode='23505';
    end if;
    return jsonb_build_object('id',existing.id,'slug',existing.slug,'created',false);
  end if;
  prefix:=lower(code)||'-'||target_term||right(target_year::text,2)||'-';
  slug_body:=btrim(left(btrim(regexp_replace(lower(clean),'[^a-z0-9]+','-','g'),'-'),35-char_length(prefix)),'-');
  group_slug:=prefix||slug_body||'-'||left(md5(lower(handle)),4);
  -- Reuses the audited path: quota, registered profile, guards and owner membership.
  result:=private.create_public_community(group_slug,handle,
    format('%s members starting %s %s at %s: arrival, classes, housing and visa steps.',target_visa,initcap(target_term),target_year,clean),
    'United States',category,'{}'::text[]);
  update public.communities set group_visa_type=target_visa,intake_term=target_term,intake_year=target_year,university=clean where id=result;
  return jsonb_build_object('id',result,'slug',group_slug,'created',true);
end $$;
create function public.create_intake_group(target_visa text,target_term text,target_year integer,university_name text,expected_user uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select private.create_intake_group(target_visa,target_term,target_year,university_name,expected_user);
$$;
revoke all on function private.create_intake_group(text,text,integer,text,uuid),public.create_intake_group(text,text,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_intake_group(text,text,integer,text,uuid),public.create_intake_group(text,text,integer,text,uuid) to authenticated;

commit;

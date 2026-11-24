-- F-1 groups keep their Spring/Fall intake; other visa groups are by university
-- only. Developed against the isolated PGlite harness; no hosted writes.
begin;
set local lock_timeout='5s';

lock table public.communities in share row exclusive mode;
do $$ begin
  if exists(select 1 from public.communities where group_visa_type is not null and group_visa_type<>'F-1 / OPT'
      and (intake_term is not null or intake_year is not null))
    or exists(select 1 from public.communities where group_visa_type='F-1 / OPT' and (intake_term is null or intake_year is null)) then
    raise exception 'Existing non-F-1 intake groups require reviewed reconciliation';
  end if;
end $$;
alter table public.communities drop constraint communities_intake_fields;
alter table public.communities add constraint communities_intake_fields check(
  (group_visa_type is null and intake_term is null and intake_year is null and university is null)
  or (university is not null and char_length(university) between 3 and 60 and (
    -- Explicit NOT NULL: a NULL comparison would otherwise satisfy the CHECK.
    (group_visa_type='F-1 / OPT' and intake_term is not null and intake_year is not null
      and intake_term in ('spring','fall') and intake_year between 2024 and 2100)
    or (group_visa_type is not null and group_visa_type in ('H-1B','H-4','H-4 / EAD','B1/B2') and intake_term is null and intake_year is null))));

-- Same signature, grants and audited creation path; intake applies to F-1 only.
create or replace function private.create_intake_group(target_visa text,target_term text,target_year integer,university_name text,expected_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  me uuid:=(select auth.uid());
  clean text:=regexp_replace(btrim(coalesce(university_name,'')),'\s+',' ','g');
  this_year integer:=extract(year from now())::integer;
  has_intake boolean:=target_visa='F-1 / OPT';
  code text; category text; label text; handle text; prefix text; slug_body text; group_slug text; summary text;
  existing public.communities; result uuid;
begin
  if me is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if expected_user is distinct from me then raise exception 'Account changed' using errcode='42501'; end if;
  code:=case target_visa when 'F-1 / OPT' then 'F1' when 'H-1B' then 'H1B' when 'H-4' then 'H4' when 'H-4 / EAD' then 'H4EAD' when 'B1/B2' then 'B1B2' end;
  category:=case target_visa when 'F-1 / OPT' then 'Study' when 'H-1B' then 'Work visas' when 'H-4' then 'Family' when 'H-4 / EAD' then 'Family' when 'B1/B2' then 'Travel' end;
  if code is null then raise exception 'Choose a supported visa type' using errcode='22023'; end if;
  if has_intake then
    if target_term is null or target_term not in ('spring','fall') then raise exception 'Choose a Spring or Fall intake' using errcode='22023'; end if;
    if target_year is null or target_year not between this_year and this_year+3 then raise exception 'Choose an upcoming intake' using errcode='22023'; end if;
  elsif target_term is not null or target_year is not null then
    raise exception 'Intakes apply to F-1 groups only' using errcode='22023';
  end if;
  if char_length(clean) not between 3 and 60 or clean !~ '^[A-Za-z0-9][A-Za-z0-9 .,&''()-]*$'
    or char_length(regexp_replace(clean,'[^A-Za-z]','','g'))<3 then
    raise exception 'Enter a university name of 3 to 60 letters, numbers or basic punctuation' using errcode='22023';
  end if;
  label:=case when has_intake then initcap(target_term)||' '||target_year else '' end;
  handle:=private.community_handle(code||' '||label||' '||clean);
  -- One group per visa, intake (F-1 only) and university; concurrent requests resolve to the same row.
  perform pg_advisory_xact_lock(hashtextextended('intake-group:'||lower(handle),0));
  select * into existing from public.communities where lower(display_name)=lower(handle);
  if existing.id is not null then
    if existing.group_visa_type is distinct from target_visa or existing.intake_term is distinct from target_term
      or existing.intake_year is distinct from target_year or existing.is_public is not true or existing.is_active is not true then
      raise exception 'That group name is already taken' using errcode='23505';
    end if;
    return jsonb_build_object('id',existing.id,'slug',existing.slug,'created',false);
  end if;
  prefix:=lower(code)||'-'||case when has_intake then target_term||right(target_year::text,2)||'-' else '' end;
  slug_body:=btrim(left(btrim(regexp_replace(lower(clean),'[^a-z0-9]+','-','g'),'-'),35-char_length(prefix)),'-');
  group_slug:=prefix||slug_body||'-'||left(md5(lower(handle)),4);
  summary:=case when has_intake
    then format('%s members starting %s at %s: arrival, classes, housing and visa steps.',target_visa,label,clean)
    else format('%s members at %s: sharing visa steps, timelines and local tips.',target_visa,clean) end;
  -- Reuses the audited path: quota, registered profile, guards and owner membership.
  result:=private.create_public_community(group_slug,handle,summary,'United States',category,'{}'::text[]);
  update public.communities set group_visa_type=target_visa,intake_term=case when has_intake then target_term end,
    intake_year=case when has_intake then target_year end,university=clean where id=result;
  return jsonb_build_object('id',result,'slug',group_slug,'created',true);
end $$;
revoke all on function private.create_intake_group(text,text,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_intake_group(text,text,integer,text,uuid) to authenticated;

commit;

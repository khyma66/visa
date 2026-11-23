import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const apply = async (db, name) => db.exec(await readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'));
async function baseDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema realtime; create table realtime.messages(topic text,extension text,payload jsonb);
    alter table realtime.messages enable row level security;
    create function realtime.topic() returns text language sql stable as $$select current_setting('realtime.topic',true)$$;
    create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql as $$insert into realtime.messages values(topic,'broadcast',payload);$$;
    grant usage on schema realtime to authenticated; grant select on realtime.messages to authenticated;
    create publication supabase_realtime;
    create table public.users(id uuid primary key);
    create table public.communities(id uuid primary key default gen_random_uuid(),name varchar(100) unique not null,display_name varchar(100) not null,
      slug varchar(100) unique not null,description text,country varchar(50),category varchar(50),rules text[],moderators uuid[],
      member_count integer default 0,is_public boolean default true,is_active boolean default true,created_at timestamptz default now());
    create table public.community_members(id uuid primary key default gen_random_uuid(),community_id uuid references public.communities(id) on delete cascade,
      user_id uuid references public.users(id) on delete cascade,role varchar(20) default 'member',joined_at timestamptz default now(),is_active boolean default true,unique(community_id,user_id));
    grant all on public.communities,public.community_members to anon,authenticated,service_role;
    create policy "Public communities are viewable by everyone" on public.communities for select using(is_active=true);
    create policy "Authenticated users can join communities" on public.community_members for insert with check(auth.uid()=user_id);
    create policy "Users can view their community memberships" on public.community_members for select using(auth.uid()=user_id);`);
  for (const name of ['20260904032053_community_core','20260907191603_secure_community_views',
    '20260910031322_realtime_discovery_and_message_requests','20260910034701_production_access_hardening',
    '20260910035131_imported_comment_discovery','20260910055528_launch_safety_and_moderation',
    '20260911050812_community_write_guard_gaps','20260928164013_community_membership_access_hardening',
    '20260928164317_revoke_client_table_administration','20261006045523_public_community_lifecycle',
    '20261006051458_bounded_community_reads','20261013191116_private_owner_feedback',
    '20261104042956_member_reports_and_community_names']) await apply(db, name);
  return db;
}

test('visa intake groups reuse communities with validated, deduplicated, rate-limited creation', { timeout: 60000 }, async t => {
  const db = await baseDatabase();
  const [member, other, outsider] = Array.from({ length: 3 }, randomUUID);
  const year = new Date().getUTCFullYear() + 1;
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  async function actor(id, role = 'authenticated') {
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    if (role) await db.exec(`set role ${role}`);
  }
  async function isolated(fn) { await actor(null, null); await db.exec('begin'); try { await fn(); } finally { await db.exec('rollback'); } }
  const create = (visa = 'F-1 / OPT', term = 'fall', y = year, university = 'Stanford University', expected = member) =>
    scalar('select create_intake_group($1,$2,$3,$4,$5)', [visa, term, y, university, expected]);
  try {
    for (const id of [member, other]) await db.query('insert into auth.users values($1)', [id]);
    const legacy = await scalar("insert into communities(name,display_name,slug) values('h1b-visa','H1BVisaHolders','h1b-visa') returning id");
    await apply(db, '20261122120000_visa_intake_groups');

    await t.test('existing communities keep their IDs and expose null intake fields', async () => {
      await actor(null, 'anon');
      const row = (await db.query('select id,group_visa_type,intake_term,intake_year,university from community_directory where id=$1', [legacy])).rows[0];
      assert.deepEqual(row, { id: legacy, group_visa_type: null, intake_term: null, intake_year: null, university: null });
    });
    await t.test('a member creates a group as owner, with a generated name, address and category', () => isolated(async () => {
      await actor(member);
      const result = await create();
      assert.equal(result.created, true);
      assert.match(result.slug, /^f1-fall\d\d-stanford-university-[0-9a-f]{4}$/);
      assert(result.slug.length <= 40);
      const row = (await db.query('select * from community_directory where id=$1', [result.id])).rows[0];
      assert.equal(row.display_name, `F1Fall${year}StanfordUniversity`);
      assert.equal(row.category, 'Study'); assert.equal(row.country, 'United States');
      assert.deepEqual([row.group_visa_type, row.intake_term, row.intake_year, row.university], ['F-1 / OPT', 'fall', year, 'Stanford University']);
      assert.equal(row.member_count, 1); assert.equal(row.created_by, member);
      assert.equal(await scalar('select role from community_members where community_id=$1 and user_id=$2', [result.id, member]), 'owner');
      await actor(null, 'anon');
      assert.equal(await scalar("select count(*)::int from community_directory where group_visa_type='F-1 / OPT' and intake_term='fall' and intake_year=$1", [year]), 1);
    }));
    await t.test('the same visa, intake and university resolves to one group without spending quota', () => isolated(async () => {
      await actor(member); const first = await create();
      await actor(other);
      for (const spelling of ['stanford university', '  Stanford   University ', 'Stanford-University'])
        assert.deepEqual(await create(undefined, undefined, undefined, spelling, other), { id: first.id, slug: first.slug, created: false });
      await actor(null, null);
      assert.equal(await scalar("select count(*)::int from private.community_rate_windows where user_id=$1", [other]), 0);
      assert.equal(await scalar('select count(*)::int from communities where group_visa_type is not null'), 1);
    }));
    await t.test('different intakes and visas are separate groups; long names fit the address rules', () => isolated(async () => {
      await actor(member);
      const fall = await create(); const spring = await create('F-1 / OPT', 'spring');
      const work = await create('H-4 / EAD', 'spring', year, 'Massachusetts Institute of Technology and Extra Long Campus');
      assert.equal(new Set([fall.id, spring.id, work.id]).size, 3);
      assert(work.slug.length <= 40 && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(work.slug) && !work.slug.includes('--'), work.slug);
      assert.equal(await scalar('select category from communities where id=$1', [work.id]), 'Family');
    }));
    for (const [label, args, pattern] of [
      ['unsupported visa', ['General'], /supported visa/], ['invalid term', ['F-1 / OPT', 'summer'], /Spring or Fall/],
      ['past intake', ['F-1 / OPT', 'fall', year - 2], /upcoming intake/], ['far future intake', ['F-1 / OPT', 'fall', year + 4], /upcoming intake/],
      ['short university', ['F-1 / OPT', 'fall', year, 'MI'], /university name/], ['symbols', ['F-1 / OPT', 'fall', year, '<script>x</script>'], /university name/],
      ['too long', ['F-1 / OPT', 'fall', year, 'U'.repeat(61)], /university name/], ['numbers only', ['F-1 / OPT', 'fall', year, '12345'], /university name/],
    ]) await t.test(`rejects ${label}`, () => isolated(async () => { await actor(member); await assert.rejects(() => create(...args), pattern); }));
    await t.test('requires the signed-in account the browser expects', () => isolated(async () => {
      await actor(member); await assert.rejects(() => create('F-1 / OPT', 'fall', year, 'Stanford University', other), /Account changed/);
    }));
    await t.test('anonymous and service callers cannot create groups', async () => {
      for (const role of ['anon', 'service_role']) await isolated(async () => { await actor(member, role); await assert.rejects(() => create(), /permission denied/); });
      await isolated(async () => { await actor(null); await assert.rejects(() => create(), /Authentication required/); });
    });
    await t.test('accounts without a registered profile cannot create groups', () => isolated(async () => {
      await actor(outsider); await assert.rejects(() => create(undefined, undefined, undefined, undefined, outsider), /Registered profile|community_rate_windows_user_id_fkey/);
    }));
    await t.test('creation shares the daily community quota', () => isolated(async () => {
      await actor(member);
      for (const name of ['Alpha University', 'Beta University', 'Gamma University']) await create('F-1 / OPT', 'fall', year, name);
      await assert.rejects(() => create('F-1 / OPT', 'fall', year, 'Delta University'), /Too many requests/);
    }));
    await t.test('members cannot write intake fields directly', () => isolated(async () => {
      await actor(member);
      await assert.rejects(() => db.query("update communities set group_visa_type='H-1B',intake_term='fall',intake_year=$1,university='Fake' where id=$2", [year, legacy]), /permission denied/);
    }));
    await t.test('partial or invalid intake fields are rejected even for trusted writes', () => isolated(async () => {
      await assert.rejects(() => db.query("update communities set group_visa_type='H-1B' where id=$1", [legacy]), /communities_intake_fields/);
    }));
    await t.test('a non-group community with the generated name is not silently reused', () => isolated(async () => {
      await db.query("insert into communities(name,display_name,slug) values('taken','F1Fall'||$1||'StanfordUniversity','taken')", [year]);
      await actor(member); await assert.rejects(() => create(), /already taken/);
    }));
    await t.test('hidden groups are not returned or reused', () => isolated(async () => {
      await actor(member); const result = await create();
      await actor(null, null); await db.query('update communities set is_public=false where id=$1', [result.id]);
      await actor(other); await assert.rejects(() => create(undefined, undefined, undefined, undefined, other), /already taken/);
    }));
    await t.test('my communities RPC still returns directory rows after the view change', () => isolated(async () => {
      await actor(member); const result = await create();
      const row = (await db.query('select * from my_community_directory_page()')).rows[0];
      assert.equal(row.id, result.id); assert.equal(row.university, 'Stanford University');
    }));
  } finally { await db.close(); }
});

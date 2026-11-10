// Offline scheduling proposal only. This module has no network or database client.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseCsv, serializeCsv } from './editorial-csv.mjs';

const local = new Intl.DateTimeFormat('en-CA', { timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' });
function calendar(date) {
  const p=Object.fromEntries(local.formatToParts(date).map(p=>[p.type,p.value]));
  return {day:`${p.year}-${p.month}-${p.day}`,month:`${p.year}-${p.month}`,hour:Number(p.hour),minute:Number(p.minute)};
}
// Spread proposals across the 08:00–21:00 Chicago window. A stable batch/date
// seed makes reruns reproducible; this is cadence planning, not identity masking.
function postingSlots(batch,day,daily,gapMinutes) {
  const minimum=Math.ceil(gapMinutes/15),count=Math.min(daily,Math.max(1,Math.floor(52/minimum)));
  const step=52/count,jitter=Math.max(0,Math.floor((Math.floor(step)-minimum)/2));
  return new Set(Array.from({length:count},(_,i)=>{
    const seed=createHash('sha256').update(`${batch}:${day}:${i}`).digest().readUInt32BE(0);
    return Math.max(0,Math.min(51,Math.floor((i+0.5)*step)+(seed%(jitter*2+1))-jitter));
  }));
}
export function planSchedule(rows, accounts, {from,now=new Date().toISOString(),daily=5,monthly=150,gapMinutes=60}={}) {
  const start=Date.parse(from),clock=Date.parse(now);
  assert(Number.isFinite(start)&&Number.isFinite(clock)&&start>=clock,'Start must be a future ISO timestamp');
  assert(Number.isInteger(daily)&&daily>=1&&daily<=10&&Number.isInteger(monthly)&&monthly>=1&&monthly<=300,'Invalid posting limits');
  assert(Number.isInteger(gapMinutes)&&gapMinutes>=20&&gapMinutes<=1440,'Invalid posting gap');
  assert(Array.isArray(accounts)&&accounts.length>0&&accounts.length<=100,'Supply 1–100 verified consent records');
  const keys=new Set();
  for(const a of accounts) {
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.author_id),'Use verified website account UUIDs, not Gmail passwords');
    assert(a.enabled===true&&Number.isInteger(a.daily_limit)&&a.daily_limit>=1&&a.daily_limit<=3&&Number.isFinite(Date.parse(a.expires_at))&&typeof a.source_key==='string','Invalid consent record');
    const key=`${a.author_id}:${a.source_key}`;assert(!keys.has(key),'Duplicate account/source consent');keys.add(key);
  }
  const pending=rows.filter(r=>r.review_decision==='approved');
  assert(pending.length>0,'No approved rows to schedule');
  assert(pending.length<=10000,'Batch exceeds 10,000 posts');
  const ids=new Set();
  for(const r of pending) {
    assert(!ids.has(r.id),'Duplicate draft ID');ids.add(r.id);
    assert(/^[1-9][0-9]{0,7}$/.test(String(r.backend_revision)),'Stage and review drafts before planning');
    assert(accounts.some(a=>a.source_key===r.source_key),'No consent record for a source');
    assert(r.reuse_basis?.trim().length>=20&&r.reviewer_notes?.trim().length>=10,'Approved rows need reuse basis and review notes');
    assert(!r.author_id&&!r.scheduled_at,'Use unscheduled approved rows; reconcile existing assignments first');
  }
  const days=new Map(),months=new Map(),authorDays=new Map(),planned=new Map();
  const batch=createHash('sha256').update(JSON.stringify(pending.map(r=>r.id))).digest('hex'),slots=new Map();
  let tick=Math.ceil(start/900000)*900000,last=-Infinity,cursor=0;
  const end=clock+90*86400000;
  while(planned.size<pending.length&&tick<=end) {
    const date=new Date(tick),c=calendar(date),iso=date.toISOString();
    if(!slots.has(c.day))slots.set(c.day,postingSlots(batch,c.day,daily,gapMinutes));
    if(c.hour>=8&&c.hour<21&&slots.get(c.day).has((c.hour-8)*4+c.minute/15)&&tick-last>=gapMinutes*60000&&(days.get(c.day)??0)<daily&&(months.get(c.month)??0)<monthly) {
      // Stable CSV order, rotating verified accounts. Source-specific permissions
      // and account-wide daily counts both apply to every proposal.
      const row=pending.find(r=>!planned.has(r.id));
      let chosen=-1;
      for(let n=0;n<accounts.length;n++) {
        const i=(cursor+n)%accounts.length,a=accounts[i];
        if(a.source_key===row.source_key&&Date.parse(a.expires_at)>tick&&(authorDays.get(`${a.author_id}:${c.day}`)??0)<a.daily_limit){chosen=i;break;}
      }
      if(chosen>=0) {
        const a=accounts[chosen],key=`${a.author_id}:${c.day}`;
        planned.set(row.id,{...row,author_id:a.author_id,scheduled_at:iso});
        days.set(c.day,(days.get(c.day)??0)+1);months.set(c.month,(months.get(c.month)??0)+1);
        authorDays.set(key,(authorDays.get(key)??0)+1);cursor=(chosen+1)%accounts.length;last=tick;
      }
    }
    tick+=900000;
  }
  assert(planned.size===pending.length,'Insufficient consent or capacity within 90 days; no partial plan created');
  return rows.map(r=>planned.get(r.id)??r);
}
async function main() {
  const {values}=parseArgs({options:{file:{type:'string'},accounts:{type:'string'},from:{type:'string'},out:{type:'string'}}});
  assert(values.file&&values.accounts&&values.from&&values.out,'Supply --file reviewed.csv --accounts consents.json --from ISO --out plan.csv');
  const rows=planSchedule(parseCsv(await readFile(values.file,'utf8')),JSON.parse(await readFile(values.accounts,'utf8')),values);
  await writeFile(values.out,serializeCsv(rows),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({planned:rows.filter(r=>r.review_decision==='approved').length,output:values.out,publishing_activated:false,backend_changed:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});

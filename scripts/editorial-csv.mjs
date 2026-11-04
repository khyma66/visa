import assert from 'node:assert/strict';
export const COLUMNS = ['review_decision','title','body','reviewer_notes','review_flags','visa_type','post_kind','experience_category','tags',
  'source_posted_at','original_text','source_url','reuse_basis','author_id','scheduled_at','id','source_key','source_hash','run_id','backend_revision','rewrite_version','model'];
export const safeCell = value => /^(?:'|\s*[=+@-])/.test(String(value??'')) ? `'${value}` : String(value??'');
export function serializeCsv(rows,columns=COLUMNS) {
  const quote=value=>'"'+safeCell(Array.isArray(value)?JSON.stringify(value):value).replaceAll('"','""')+'"';
  return '\uFEFF'+[columns.map(quote).join(','),...rows.map(row=>columns.map(key=>quote(row[key])).join(','))].join('\r\n')+'\r\n';
}
export function parseCsv(text) {
  assert(Buffer.byteLength(text)<20*1024*1024,'Review file exceeds 20 MB');
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted) { if(ch==='"') { if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;} }else cell+=ch;continue; }
    if(ch==='"') {assert(!cell&&!closed,'Malformed CSV quote');quoted=true;continue;}
    if(ch===','||ch==='\n'||ch==='\r') {
      row.push(cell);cell='';closed=false;
      if(ch!==','){if(ch==='\r'&&text[i+1]==='\n')i++;rows.push(row);row=[];}
    }else{assert(!closed,'Unexpected content after CSV quote');cell+=ch;}
  }
  assert(!quoted,'Unclosed CSV quote');
  if(cell||row.length){row.push(cell);rows.push(row);}
  const headers=rows.shift();assert(headers&&new Set(headers).size===headers.length,'Missing or duplicate CSV columns');
  assert(COLUMNS.every(key=>headers.includes(key)),'Required review columns missing');
  return rows.filter(values=>values.some(Boolean)).map(values=>{
    assert(values.length===headers.length,'CSV row has the wrong number of columns');
    return Object.fromEntries(headers.map((key,i)=>[key,values[i].replace(/^'(?='|\s*[=+@-])/,'')]));
  });
}

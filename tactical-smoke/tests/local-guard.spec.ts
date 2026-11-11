import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
import { emptyAudit, installReadOnlyGuard } from '../lib/guard';

test('two real browser document reads, same context, and zero server-side engagement writes',async({page,context})=>{
  let writes = 0, reads = 0;
  const server = createServer((req,res)=>{
    if(req.method!=='GET'){writes++;res.writeHead(500).end();return;}
    if(req.url==='/api/post-views?id=apify-fixture'){res.setHeader('Content-Type','application/json');res.end('[{"post_id":"apify-fixture","views":7}]');return;}
    reads++;
    res.setHeader('Content-Type','text/html');
    res.end('<main><section><h1>Public fixture post</h1><span aria-label="7 views on VisaThreads">7 views</span></section><article><div class="whitespace-pre-wrap">A synthetic local test body.</div></article></main><script>fetch("/api/post-views?id=apify-fixture",{method:"POST"});</script>');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Local fixture unavailable');
  const origin=`http://127.0.0.1:${address.port}`,post={url:origin+'/us/en/questions/apify-fixture'};
  const audit=emptyAudit();
  try {
    await installReadOnlyGuard(context,[post],audit,origin);
    for(let i=0;i<2;i++){
      const response=i===0?await page.goto(post.url):await page.reload();
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading',{name:'Public fixture post'})).toBeVisible();
      await expect.poll(()=>audit.suppressedViews).toBe(i+1);
    }
    expect(audit.documents).toBe(2);expect(reads).toBe(2);expect(writes).toBe(0);
    await page.evaluate(()=>fetch('/api/messages',{method:'POST'}).catch(()=>{}));
    await expect.poll(()=>audit.blockedWrites).toBe(1);expect(writes).toBe(0);
    await expect(page.reload()).rejects.toThrow();expect(reads).toBe(2);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('redirects cannot escape the allowlist and create a hidden extra visit',async({page,context})=>{
  let unexpected = 0;
  const server=createServer((req,res)=>{
    if(req.url?.startsWith('/us/en/questions/'))res.writeHead(302,{Location:'/not-allowlisted'}).end();
    else{unexpected++;res.end('Must not be opened');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Local fixture unavailable');
  const origin=`http://127.0.0.1:${address.port}`,post={url:origin+'/us/en/questions/apify-fixture'},audit=emptyAudit();
  try{
    await installReadOnlyGuard(context,[post],audit,origin);
    await expect(page.goto(post.url)).rejects.toThrow();
    expect(audit.redirects).toBe(1);expect(unexpected).toBe(0);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('an allowlisted read RPC uses GET with no request body on the wire',async({page,context})=>{
  let gets=0,writes=0;
  const server=createServer((req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    if(req.method!=='GET'){writes++;res.writeHead(500).end();return;}
    if(req.url?.startsWith('/read-rpc')){
      gets++;expect(req.headers['content-length']).toBeUndefined();
      res.setHeader('Content-Type','application/json');res.end('[]');return;
    }
    res.setHeader('Content-Type','text/html');res.end('<main>Local RPC fixture</main>');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw new Error('Local fixture unavailable');
  const origin=`http://127.0.0.1:${address.port}`,post={url:origin+'/us/en/questions/apify-fixture'},audit=emptyAudit();
  const original=context.request.get.bind(context.request);
  context.request.get=async(target,options)=>{
    const url=new URL(String(target));
    expect(url.origin).toBe('https://cycnichledvqbxevrwnt.supabase.co');
    expect(url.pathname).toBe('/rest/v1/rpc/platform_post_page');
    expect(options?.maxRedirects).toBe(0);
    return original(origin+'/read-rpc'+url.search,options);
  };
  try{
    await installReadOnlyGuard(context,[post],audit,origin);
    await page.goto(post.url);
    await page.evaluate(()=>fetch('https://cycnichledvqbxevrwnt.supabase.co/rest/v1/rpc/platform_post_page',{
      method:'POST',body:JSON.stringify({query_text:'visa',before_time:null}),
    }).then(r=>r.json()));
    expect(audit.readRpcGets).toBe(1);expect(gets).toBe(1);expect(writes).toBe(0);
  }finally{context.request.get=original;await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

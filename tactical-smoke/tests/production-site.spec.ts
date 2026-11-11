import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { SITE_URL, LIMITS, VisitBudget } from '../lib/policy.mjs';
import { emptyAudit, installReadOnlyGuard } from '../lib/guard';

test('production homepage renders the real feed and measured views after reload without writes',async({page,context},info)=>{
  const audit=emptyAudit(),budget=new VisitBudget();
  let phase='setup',successful=false;
  await installReadOnlyGuard(context,[{url:SITE_URL}],audit);
  try{
    for(let opening=0;opening<LIMITS.visits;opening++){
      const remaining=budget.previous===null?0:LIMITS.gapMs-(Date.now()-budget.previous);
      if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      budget.take();phase=opening===0?'open':'reload';
      const response=opening===0?await page.goto(SITE_URL,{waitUntil:'domcontentloaded'}):await page.reload({waitUntil:'domcontentloaded'});
      expect(response?.status(),'public homepage status').toBe(200);
      expect(page.url(),'fixed production homepage').toBe(SITE_URL);
      await expect(page).toHaveTitle(/VisaThreads/);
      await expect(page.locator('main h1')).toHaveText('U.S. Visa Community');
      await expect(page.locator('#challenge-running, #challenge-form, iframe[src*="challenges.cloudflare.com"]')).toHaveCount(0);
      await expect(page.locator('main input[type="password"]')).toHaveCount(0);
      const cards=page.locator('main article.feed-card');
      await expect(cards.first(),'real public feed loads').toBeVisible();
      const count=Math.min(await cards.count(),5);
      for(let i=0;i<count;i++){
        const card=cards.nth(i);
        await expect(card.locator('a[href*="/questions/"], a[href*="/experiences/"]').first()).toBeVisible();
        await expect(card.locator('.post-preview-select')).toBeVisible();
        // Do not include member-written previews in assertion diagnostics.
        expect((await card.locator('.post-preview-select').innerText()).trim().length,'nonempty preview').toBeGreaterThan(0);
        const views=card.locator('[aria-label$="view on VisaThreads"], [aria-label$="views on VisaThreads"]');
        await expect(views,'measured view label, including genuine zero').toBeVisible();
        await expect(views).toHaveAttribute('aria-label',/^[\d,]+ views? on VisaThreads$/);
      }
      expect(audit.blockedWrites,'unexpected first-party mutation attempt').toBe(0);
      expect(audit.redirects,'redirects are not followed').toBe(0);
    }
    expect(audit.documents,'bounded document openings').toBe(2);
    expect(budget.used).toBe(2);
    expect(audit.requests).toBeLessThanOrEqual(LIMITS.requests);
    successful=true;
    console.log(JSON.stringify({mode:'production-read-only',homepage_openings:budget.used,forwarded_writes:0,view_posts_suppressed:audit.suppressedViews}));
  }finally{
    if(!successful)await writeFile(info.outputPath('diagnostic.json'),JSON.stringify({phase,used_visits:budget.used,budget:budget.limit,audit},null,2));
  }
});

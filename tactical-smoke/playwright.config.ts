import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests', testMatch:'production-site.spec.ts',
  workers:1, fullyParallel:false, retries:0, repeatEach:1, forbidOnly:true,
  timeout:180_000, globalTimeout:240_000,
  expect:{timeout:15_000}, reporter:'dot', outputDir:'test-results/production',
  use:{browserName:'chromium',headless:true,serviceWorkers:'block',acceptDownloads:false,
    ignoreHTTPSErrors:false,bypassCSP:false,actionTimeout:15_000,navigationTimeout:25_000,
    extraHTTPHeaders:{DNT:'1','Sec-GPC':'1'},
    screenshot:'only-on-failure',trace:'retain-on-failure',video:'off'},
});

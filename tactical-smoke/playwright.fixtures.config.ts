import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests',testMatch:'local-guard.spec.ts',workers:1,retries:0,timeout:30_000,
  reporter:'dot',outputDir:'test-results/local',
  use:{browserName:'chromium',headless:true,serviceWorkers:'block',screenshot:'off',trace:'off'},
});

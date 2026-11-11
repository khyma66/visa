import { SITE_URL, LIMITS } from '../lib/policy.mjs';
console.log(JSON.stringify({mode:'production-read-only',site:SITE_URL,visit_budget:LIMITS.visits,browser_concurrency:1,minimum_gap_seconds:10,posting:false,voting:false,messaging:false,synthetic_engagement:false}));

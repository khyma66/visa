# VisaThreads search discoverability

The owner requested visibility in ChatGPT search, rather than workspace domain verification or a GPT-builder identity. Search eligibility is managed through public crawling and indexing signals; this change does not represent an OpenAI business registration, endorsement, or guaranteed search placement.

Official crawler guidance: https://developers.openai.com/api/docs/bots

- The production robots route explicitly permits `OAI-SearchBot` while excluding private routes. Model-training crawler settings remain separate.
- The community homepage emits a server-rendered `WebSite` and `Organization` graph with the real brand, logo and published support contact, linking to the About page. The graph uses the request CSP nonce and safe JSON serialization.
- The sitemap lists reviewed public editorial destinations. Existing publication gates still control native discussions and imported content.
- Preview and UAT deployments remain excluded from search discovery and the public identity graph.

After a production release, verify HTTP 200 responses for robots, sitemap, community, About and guides using the documented search-crawler user agent. Check canonical URLs, indexable metadata, the identity graph and matching CSP nonce. A user-agent probe checks the application's response; it does not prove access from every OpenAI IP address or actual inclusion in its search index.

On November 12, 2026, the pre-change production audit found a working 14-URL sitemap and indexable public editorial pages. A search for `site:visathreads.com VisaThreads visa questions` returned no results. Treat that as an observation of that search at that time, not proof that every index excludes the site.

OpenAI documents that robots changes can take about 24 hours to be reflected. That is not a promise that a site will be indexed, cited or ranked within 24 hours. There is no reason to purchase ChatGPT Business or add a workspace domain-verification record for this crawler configuration.

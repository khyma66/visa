# Required Credentials for Cloudflare and Supabase

> **Legacy architecture reference — do not use these setup commands for the current app.** Follow [current launch credentials](LIVE_CREDENTIALS.md) and [go-live steps](GO_LIVE_CHECKLIST.md). The old configuration/SQL examples below are not the reviewed production path; never put privileged keys in Wrangler `vars`, and do not create the legacy tables from this guide.

## Supabase Credentials
### How to Obtain:
1. Go to https://supabase.com/ and create an account
2. Create a new project
3. In your project dashboard, go to Settings > API
4. Find the following:
   - **Supabase URL**: Looks like `https://your-project.supabase.co`
   - **Supabase publishable key**: Looks like `sb_publishable_...`
   - **Supabase secret key**: Keep this only in a server-side secret manager; never commit it.


## Cloudflare R2 Credentials
### How to Obtain:
1. Go to https://dash.cloudflare.com/ and log in
2. Click on "R2" in the sidebar
3. Create a new bucket or use an existing one
4. In bucket settings, go to "Settings" > "R2 API Tokens"
5. Generate an API token with permissions to read/write to your bucket
6. Note down:
   - **Account ID**: Found in Cloudflare dashboard homepage under "Account"
   - **Access Key ID**: From the API token you created
   - **Access Key Secret**: From the API token you created
   - **Bucket Name**: Your R2 bucket name

## Cloudflare Workers Credentials
### How to Obtain:
1. Go to https://dash.cloudflare.com/ and log in
2. Click on "Workers" in the sidebar
3. Create a new worker or use an existing one
4. For API access:
   - Go to Profile > API Tokens
   - Create a token with "Workers Scripts" permission
5. Note down:
   - **Account ID**: Found in Cloudflare dashboard homepage
   - **API Token**: The token you created
   - **Worker URL**: Your worker's URL (e.g., `https://your-worker-name.YOUR_SUBDOMAIN.workers.dev`)

## Environment Variables
Create a `.env` file in your project root with the following variables:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
SUPABASE_SECRET_KEY=store_in_server_secret_manager

# Cloudflare R2
CF_ACCOUNT_ID=your-account-id
CF_R2_ACCESS_KEY_ID=replace_me
CF_R2_ACCESS_KEY_SECRET=replace_me

CF_R2_BUCKET_NAME=data-pipeline
PUBLIC_CF_ACCOUNT_ID=your-account-id
s3 end-point = https://your-account-id.r2.cloudflarestorage.com
# Worker
WORKER_URL=https://your-worker.example.workers.dev
WORKER_SECRET=replace_me


# Cloudflare Workers
CF_API_TOKEN=Z{

```

## Wrangler Configuration
Your `wrangler.toml` should have these sections:

```toml
name = "visa-1"
main = "src/index.js"
compatibility_date = "2026-01-22"

compatibility_flags = [
  "nodejs_compat"
]

account_id = "your-cloudflare-account-id"
workers_dev = true

# R2 Bucket
[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "your-bucket-name"

# KV Namespace
[[kv_namespaces]]
binding = "PROCESSED_KEYS"
id = "your-kv-namespace-id"

# Queues
[[queues.producers]]
binding = "PROCESS_QUEUE"
queue = "r2-process-queue"

[[queues.producers]]
binding = "POSTS_QUEUE"
queue = "r2-process-queue"

[[queues.consumers]]
queue = "r2-process-queue"
max_batch_size = 1
max_batch_timeout = 30
max_retries = 5
dead_letter_queue = "r2-process-queue-dlq"

# KV Namespace for Clusters Cache
[[kv_namespaces]]
binding = "POSTS_KV"
id = "your-clusters-kv-namespace-id"

# Environment
[vars]
SUPABASE_URL = "https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY = "your-service-key"
CF_ACCOUNT_ID = "your-account-id"
CF_API_TOKEN = "your-api-token"

# Triggers
[triggers]
crons = ["0 */6 * * *"]

# AI
[ai]
binding = "AI"
```

## Database Setup
Run this SQL in your Supabase dashboard to create the required tables:

```sql
-- Posts table
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  group_id TEXT DEFAULT 'default',
  cluster_id TEXT,
  r2_key TEXT,
  comment_count INTEGER DEFAULT 0
);

-- Comments table
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clusters table
CREATE TABLE IF NOT EXISTS clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  post_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_posts_group ON posts(group_id);
CREATE INDEX idx_posts_cluster ON posts(cluster_id);
CREATE INDEX idx_comments_post ON comments(post_id);
```

## Verification
Once all credentials are set up, test your application:
1. Run `npm run dev`
2. Navigate to http://localhost:4321/
3. Check the API endpoints:
   - http://localhost:4321/api/posts
   - http://localhost:4321/api/clusters

You should see JSON responses indicating the endpoints are working correctly.

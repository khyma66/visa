# 🚀 Complete End-to-End AI Stack Overflow Implementation

## Architecture
```
Astro Frontend (Pages)
    ↓ User Input (posts + comments)
R2 Storage (JSON + Text)
    ↓ Auto-process every 6hrs
Workers AI (Clustering + Summarization)
    ↓ Batch processing
Supabase (References + Metadata)
    ↓ Real-time fetch
Live UI (Astro)
```

---

## 📁 FOLDER STRUCTURE (Copy to Cursor)

```
visa-1/
├── backend/
│   ├── src/
│   │   ├── index.py              ← HTTP endpoints
│   │   ├── worker.py             ← Main pipeline
│   │   ├── ai_cluster.py         ← AI clustering
│   │   └── supabase_client.py    ← DB operations
│   └── wrangler.toml
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── index.astro       ← Home page
│   │   │   ├── submit.astro      ← Add posts
│   │   │   └── api/
│   │   │       └── upload.ts     ← Upload to R2
│   │   ├── components/
│   │   │   ├── PostCard.astro
│   │   │   └── CommentThread.astro
│   │   └── layouts/
│   │       └── Layout.astro
│   ├── astro.config.mjs
│   └── package.json
│
├── scripts/
│   ├── upload-posts.sh           ← Upload test data
│   ├── deploy-all.sh             ← Full stack deploy
│   └── seed-data.json            ← Test posts
```

---

## 1️⃣ BACKEND SCRIPTS

### `backend/src/index.py` (HTTP Endpoints)
```python
import json
from worker import queue_handler, extract_posts_and_comments
from ai_cluster import cluster_posts_batched
from supabase_client import save_to_supabase

async def fetch(request, env, ctx):
    """HTTP API endpoints"""
    path = request.url.split("?")[0]
    
    if path.endswith("/health"):
        return Response(json.dumps({"status": "healthy", "timestamp": "2026-01-23"}),
                       headers={"Content-Type": "application/json"})
    
    elif path.endswith("/run"):
        # Manual trigger
        await env.PROCESS_QUEUE.send({"key": "posts.json"})
        return Response(json.dumps({"status": "triggered", "message": "Processing posts.json"}),
                       headers={"Content-Type": "application/json"})
    
    elif path.endswith("/api/posts"):
        # GET: List posts from Supabase
        posts = await get_posts_from_supabase(env)
        return Response(json.dumps(posts),
                       headers={"Content-Type": "application/json"})
    
    elif path.endswith("/api/upload") and request.method == "POST":
        # POST: Upload new posts to R2
        body = await request.json()
        key = await upload_to_r2(env, body)
        await env.PROCESS_QUEUE.send({"key": key})
        return Response(json.dumps({"status": "queued", "key": key}),
                       headers={"Content-Type": "application/json"})
    
    elif path.endswith("/api/modify") and request.method == "POST":
        # AI code modification
        return await ai_modify_worker(request, env)
    
    return Response("AI Stack Overflow API\nEndpoints: /health, /run, /api/posts, /api/upload, /api/modify")

async def get_posts_from_supabase(env):
    """Fetch posts from Supabase"""
    url = f"{env.SUPABASE_URL}/rest/v1/posts?select=*&order=inserted_at.desc&limit=20"
    headers = {
        "apikey": env.SUPABASE_KEY,
        "Authorization": f"Bearer {env.SUPABASE_KEY}"
    }
    resp = await fetch(url, {"headers": headers})
    return await resp.json()

async def upload_to_r2(env, posts_data):
    """Upload posts to R2"""
    key = f"posts-{int(datetime.now().timestamp())}.json"
    await env.MY_BUCKET.put(key, json.dumps(posts_data))
    return key

async def ai_modify_worker(request, env):
    """AI code modification"""
    body = await request.json()
    prompt = body.get("prompt", "")
    
    ai_response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        "prompt": f"Modify Cloudflare Worker:\n{prompt}",
        "max_tokens": 4000
    })
    
    return Response(json.dumps({"modified": True, "response": ai_response.response}),
                   headers={"Content-Type": "application/json"})

__exports__ = {"fetch": fetch, "queue_handler": queue_handler}
```

### `backend/src/worker.py` (Queue Consumer)
```python
import json
from typing import List, Dict, Any
from ai_cluster import cluster_posts_batched
from supabase_client import upsert_posts, upsert_comments, log_event

async def queue_handler(batch, env, ctx):
    """Main queue consumer - processes R2 JSON files"""
    for msg in batch:
        try:
            data = json.loads(msg.body)
            key = data.get("key", "posts.json")
            
            print(f"🔄 Processing: {key}")
            
            # 1. Fetch from R2
            r2_obj = await env.MY_BUCKET.get(key)
            if not r2_obj:
                print(f"❌ Not found: {key}")
                continue
            
            body = await r2_obj.text()
            raw_data = json.loads(body)
            
            # Normalize
            if isinstance(raw_data, dict):
                raw_data = [raw_data]
            
            # 2. Extract posts + comments
            posts, comments = extract_posts_and_comments(raw_data)
            print(f"📊 Extracted: {len(posts)} posts, {len(comments)} comments")
            
            # 3. AI clustering
            clustered_posts = await cluster_posts_batched(env, posts, batch_size=25)
            
            # 4. Save to Supabase
            await upsert_posts(env, clustered_posts, batch_size=50)
            if comments:
                await upsert_comments(env, comments, batch_size=100)
            
            # 5. Mark processed
            await env.PROCESSED_KEYS.put(f"done:{key}", "processed", {"expirationTtl": 604800})
            
            await log_event(env, f"✅ Processed: {key} ({len(posts)} posts, {len(comments)} comments)", "success")
            
        except Exception as e:
            await log_event(env, f"❌ Error: {str(e)}", "error", error_msg=str(e))

def extract_posts_and_comments(raw_data: List[Dict[str, Any]]) -> tuple:
    """Extract posts + comments from nested structure"""
    posts = []
    comments = []
    
    for item in raw_data:
        post_id = item.get("id")
        if not post_id:
            continue
        
        post = {
            "id": str(post_id),
            "title": str(item.get("title", ""))[:512],
            "text_ref": str(post_id) + "_text",  # Reference to R2
            "user_name": str(item.get("user", "anonymous"))[:100],
            "date": item.get("date"),
            "url": item.get("url", ""),
            "summary": "",
            "cluster_id": "general",
            "comment_count": 0
        }
        
        posts.append(post)
        
        # Extract comments
        for idx, comment in enumerate(item.get("comments", [])):
            comments.append({
                "id": f"{post_id}_comment_{idx}",
                "post_id": str(post_id),
                "text_ref": f"{post_id}_comment_{idx}_text",  # Reference to R2
                "user_name": str(comment.get("user", "anonymous"))[:100],
                "date": comment.get("date"),
                "url": comment.get("url", "")
            })
        
        post["comment_count"] = len(item.get("comments", []))
    
    return posts, comments
```

### `backend/src/ai_cluster.py` (AI Clustering)
```python
import json
from typing import List, Dict, Any

async def cluster_posts_batched(env, posts: List[Dict[str, Any]], batch_size: int = 25) -> List[Dict[str, Any]]:
    """Cluster posts using Workers AI + Llama"""
    enriched = []
    
    for batch_idx in range(0, len(posts), batch_size):
        batch_posts = posts[batch_idx : batch_idx + batch_size]
        
        # Build docs for clustering
        docs = []
        for idx, post in enumerate(batch_posts):
            docs.append({
                "idx": idx,
                "id": post["id"],
                "title": post["title"],
                "text_snippet": post.get("text_ref", "")[:250]
            })
        
        # AI Clustering Prompt
        cluster_prompt = f"""
        Classify these Stack Overflow posts into ONE category each.
        Categories: database, api-design, frontend, devops, security, performance, architecture, mobile
        
        Output JSON format: [{{"idx": 0, "cluster_id": "category", "relevance": 0.95}}, ...]
        
        Posts:
        {json.dumps(docs)}
        """
        
        try:
            cluster_result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
                "prompt": cluster_prompt,
                "max_tokens": 1024,
                "temperature": 0.1
            })
            
            clusters = json.loads(cluster_result.response)
        except:
            clusters = [{"idx": i, "cluster_id": "general", "relevance": 0.5} for i in range(len(batch_posts))]
        
        # AI Summarization
        for idx, post in enumerate(batch_posts):
            summary_prompt = f"Summarize in 1 sentence (max 100 chars):\n{post.get('text_ref', '')[:500]}"
            
            try:
                summary_result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
                    "prompt": summary_prompt,
                    "max_tokens": 50,
                    "temperature": 0.3
                })
                summary = summary_result.response.strip()
            except:
                summary = post.get("text_ref", "")[:100]
            
            cluster_info = next((c for c in clusters if c["idx"] == idx), {"cluster_id": "general", "relevance": 0.5})
            
            enriched.append({
                **post,
                "summary": summary,
                "cluster_id": cluster_info.get("cluster_id", "general"),
                "ai_relevance_score": cluster_info.get("relevance", 0.5)
            })
    
    return enriched
```

### `backend/src/supabase_client.py` (Database Operations)
```python
import json

async def upsert_posts(env, posts: list, batch_size: int = 50):
    """Save posts to Supabase"""
    if not posts:
        return
    
    url = f"{env.SUPABASE_URL}/rest/v1/posts"
    headers = {
        "Content-Type": "application/json",
        "apikey": env.SUPABASE_KEY,
        "Authorization": f"Bearer {env.SUPABASE_KEY}",
        "Prefer": "resolution=merge-duplicates"
    }
    
    for i in range(0, len(posts), batch_size):
        batch = posts[i:i + batch_size]
        
        payload = [
            {
                "id": p["id"],
                "title": p["title"],
                "text_ref": p["text_ref"],
                "user_name": p["user_name"],
                "date": p["date"],
                "url": p.get("url", ""),
                "summary": p.get("summary", ""),
                "cluster_id": p.get("cluster_id", "general"),
                "ai_relevance_score": p.get("ai_relevance_score", 0.5),
                "comment_count": p.get("comment_count", 0)
            }
            for p in batch
        ]
        
        resp = await fetch(url, {
            "method": "POST",
            "headers": headers,
            "body": json.dumps(payload)
        })
        
        if resp.status >= 400:
            print(f"Posts error: {await resp.text()}")

async def upsert_comments(env, comments: list, batch_size: int = 100):
    """Save comments to Supabase"""
    if not comments:
        return
    
    url = f"{env.SUPABASE_URL}/rest/v1/comments"
    headers = {
        "Content-Type": "application/json",
        "apikey": env.SUPABASE_KEY,
        "Authorization": f"Bearer {env.SUPABASE_KEY}",
        "Prefer": "resolution=merge-duplicates"
    }
    
    for i in range(0, len(comments), batch_size):
        batch = comments[i:i + batch_size]
        
        payload = [
            {
                "id": c["id"],
                "post_id": c["post_id"],
                "text_ref": c["text_ref"],
                "user_name": c["user_name"],
                "date": c["date"],
                "url": c.get("url", "")
            }
            for c in batch
        ]
        
        resp = await fetch(url, {
            "method": "POST",
            "headers": headers,
            "body": json.dumps(payload)
        })
        
        if resp.status >= 400:
            print(f"Comments error: {await resp.text()}")

async def log_event(env, event: str, status: str = "info", error_msg: str = ""):
    """Log to Supabase"""
    try:
        url = f"{env.SUPABASE_URL}/rest/v1/pipeline_logs"
        headers = {
            "Content-Type": "application/json",
            "apikey": env.SUPABASE_KEY,
            "Authorization": f"Bearer {env.SUPABASE_KEY}"
        }
        
        await fetch(url, {
            "method": "POST",
            "headers": headers,
            "body": json.dumps({
                "event": event,
                "status": status,
                "error_msg": error_msg
            })
        })
    except:
        pass
```

---

## 2️⃣ FRONTEND SCRIPTS (Astro)

### `frontend/src/pages/index.astro` (Home)
```astro
---
import { createClient } from '@supabase/supabase-js';
import Layout from '../layouts/Layout.astro';
import PostCard from '../components/PostCard.astro';
import CommentThread from '../components/CommentThread.astro';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const workerUrl = import.meta.env.PUBLIC_WORKER_URL;

const supabase = createClient(supabaseUrl, supabaseKey);

// Fetch posts
const { data: posts, error: postsError } = await supabase
  .from('posts')
  .select('*')
  .order('inserted_at', { ascending: false })
  .limit(50);

// Fetch comments
const { data: comments, error: commentsError } = await supabase
  .from('comments')
  .select('*');

// Map comments to posts
const commentsByPost = comments?.reduce((acc, comment) => {
  if (!acc[comment.post_id]) acc[comment.post_id] = [];
  acc[comment.post_id].push(comment);
  return acc;
}, {}) || {};
---

<Layout title="AI Stack Overflow">
  <div class="container">
    <header>
      <h1>🤖 AI Stack Overflow</h1>
      <p>Real-time Q&A with AI clustering & summarization</p>
    </header>

    <nav class="controls">
      <a href="/submit" class="btn btn-primary">➕ Ask Question</a>
      <button id="triggerBtn" class="btn btn-secondary">🔄 Process Queue</button>
    </nav>

    <div class="posts-grid">
      {posts?.map(post => (
        <PostCard 
          post={post} 
          comments={commentsByPost[post.id] || []}
        />
      ))}
    </div>
  </div>

  <style>
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    header { text-align: center; margin-bottom: 2rem; }
    .controls { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .posts-grid { display: grid; gap: 1.5rem; }
    .btn { padding: 0.75rem 1.5rem; border-radius: 8px; border: none; cursor: pointer; }
    .btn-primary { background: #0066ff; color: white; }
    .btn-secondary { background: #f0f0f0; }
  </style>

  <script define:vars={{ workerUrl }}>
    document.getElementById('triggerBtn')?.addEventListener('click', async () => {
      const res = await fetch(`${workerUrl}/run`);
      alert('Pipeline triggered! Processing posts...');
    });
  </script>
</Layout>
```

### `frontend/src/pages/submit.astro` (Submit Posts)
```astro
---
import Layout from '../layouts/Layout.astro';

const workerUrl = import.meta.env.PUBLIC_WORKER_URL;
---

<Layout title="Submit Question">
  <div class="container">
    <h1>Ask a Question</h1>
    
    <form id="submitForm">
      <div class="form-group">
        <label>Title *</label>
        <input type="text" name="title" required placeholder="What's your question?">
      </div>

      <div class="form-group">
        <label>Description *</label>
        <textarea name="text" required rows="6" placeholder="Provide details..."></textarea>
      </div>

      <div class="form-group">
        <label>URL (optional)</label>
        <input type="url" name="url" placeholder="https://example.com">
      </div>

      <div class="form-group">
        <label>Your Name</label>
        <input type="text" name="user" placeholder="Anonymous">
      </div>

      <div id="commentsSection">
        <h3>Add Comments (Optional)</h3>
        <button type="button" id="addCommentBtn" class="btn btn-secondary">+ Add Comment</button>
        <div id="commentsList"></div>
      </div>

      <button type="submit" class="btn btn-primary">📤 Submit</button>
    </form>

    <div id="result"></div>
  </div>

  <style>
    .container { max-width: 600px; margin: 0 auto; padding: 2rem; }
    .form-group { margin-bottom: 1.5rem; }
    label { display: block; font-weight: 600; margin-bottom: 0.5rem; }
    input, textarea { width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; }
    .btn { padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer; }
    .btn-primary { background: #0066ff; color: white; }
    .btn-secondary { background: #f0f0f0; }
  </style>

  <script define:vars={{ workerUrl }}>
    let commentCount = 0;

    document.getElementById('addCommentBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      commentCount++;
      const html = `
        <div class="comment-input" data-comment="${commentCount}">
          <input type="text" placeholder="Comment text" class="comment-text">
          <input type="url" placeholder="URL (optional)" class="comment-url">
          <input type="text" placeholder="Your name" class="comment-user">
          <button type="button" class="remove-comment btn btn-secondary">✕ Remove</button>
        </div>
      `;
      document.getElementById('commentsList').insertAdjacentHTML('beforeend', html);
      
      document.querySelector(`[data-comment="${commentCount}"] .remove-comment`).addEventListener('click', (e) => {
        e.target.closest('.comment-input').remove();
      });
    });

    document.getElementById('submitForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Collect form data
      const formData = new FormData(e.target);
      const post = {
        id: `post_${Date.now()}`,
        title: formData.get('title'),
        text: formData.get('text'),
        url: formData.get('url'),
        user: formData.get('user') || 'anonymous',
        date: new Date().toISOString(),
        comments: []
      };

      // Collect comments
      document.querySelectorAll('.comment-input').forEach(el => {
        const text = el.querySelector('.comment-text').value;
        if (text) {
          post.comments.push({
            text,
            url: el.querySelector('.comment-url').value,
            user: el.querySelector('.comment-user').value || 'anonymous',
            date: new Date().toISOString()
          });
        }
      });

      // Upload to worker
      const res = await fetch(`${workerUrl}/api/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([post])
      });

      const result = await res.json();
      document.getElementById('result').innerHTML = `<p>✅ Posted! Processing...</p>`;
      e.target.reset();
      setTimeout(() => location.href = '/', 2000);
    });
  </script>
</Layout>
```

### `frontend/src/components/PostCard.astro`
```astro
---
interface Props {
  post: any;
  comments: any[];
}

const { post, comments } = Astro.props;
---

<div class="post-card">
  <div class="post-header">
    <h2>{post.title}</h2>
    <span class="cluster">#{post.cluster_id}</span>
  </div>

  <p class="summary">{post.summary}</p>

  <div class="meta">
    <span>👤 {post.user_name}</span>
    <span>📅 {new Date(post.date).toLocaleDateString()}</span>
    <span>💬 {post.comment_count} comments</span>
    {post.url && <a href={post.url} target="_blank">🔗 Link</a>}
  </div>

  {comments.length > 0 && (
    <div class="comments">
      <h4>Comments:</h4>
      {comments.map(comment => (
        <div class="comment">
          <strong>{comment.user_name}</strong>: {comment.text_ref}
          {comment.url && <a href={comment.url} target="_blank">🔗</a>}
        </div>
      ))}
    </div>
  )}
</div>

<style>
  .post-card {
    border: 1px solid #eee;
    padding: 1.5rem;
    border-radius: 8px;
    background: #fafafa;
  }
  .post-header {
    display: flex;
    justify-content: space-between;
    align-items: start;
    margin-bottom: 1rem;
  }
  .post-header h2 {
    margin: 0;
    font-size: 1.3rem;
  }
  .cluster {
    background: #0066ff;
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 16px;
    font-size: 0.85rem;
  }
  .summary {
    color: #666;
    margin: 0.5rem 0 1rem;
  }
  .meta {
    font-size: 0.9rem;
    color: #999;
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .comments {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid #ddd;
  }
  .comment {
    margin: 0.5rem 0;
    padding: 0.5rem;
    background: white;
    border-radius: 4px;
    font-size: 0.9rem;
  }
</style>
```

---

## 3️⃣ SUPABASE SCHEMA

```sql
-- Posts table with AI fields + R2 references
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text_ref TEXT NOT NULL,              -- Reference to R2 object key
  user_name TEXT,
  date TIMESTAMPTZ,
  url TEXT,
  summary TEXT,
  cluster_id TEXT DEFAULT 'general',
  ai_relevance_score FLOAT DEFAULT 0.5,
  comment_count INTEGER DEFAULT 0,
  inserted_at TIMESTAMPTZ DEFAULT now()
);

-- Comments table with R2 references
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  text_ref TEXT NOT NULL,              -- Reference to R2 object key
  user_name TEXT,
  date TIMESTAMPTZ,
  url TEXT,
  inserted_at TIMESTAMPTZ DEFAULT now()
);

-- Pipeline logs
CREATE TABLE pipeline_logs (
  id BIGSERIAL PRIMARY KEY,
  event TEXT,
  status TEXT,
  error_msg TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "posts_read" ON posts FOR SELECT USING (true);
CREATE POLICY "posts_insert" ON posts FOR INSERT WITH CHECK (true);
CREATE POLICY "comments_read" ON comments FOR SELECT USING (true);
CREATE POLICY "comments_insert" ON comments FOR INSERT WITH CHECK (true);

-- Indexes
CREATE INDEX idx_posts_cluster ON posts(cluster_id);
CREATE INDEX idx_comments_post ON comments(post_id);
```

---

## 4️⃣ DEPLOYMENT SCRIPTS

### `scripts/deploy-all.sh`
```bash
#!/bin/bash

echo "🚀 Deploying Full Stack AI Stack Overflow..."

# Backend
echo "📦 Deploying Workers..."
cd backend
wrangler deploy
WORKER_URL=$(wrangler deploy --dry-run 2>&1 | grep "Deployed to" | awk '{print $4}')
echo "✅ Backend: $WORKER_URL"
cd ..

# Frontend env
cd frontend
echo "PUBLIC_WORKER_URL=$WORKER_URL" >> .env
echo "PUBLIC_SUPABASE_URL=$PUBLIC_SUPABASE_URL" >> .env
echo "PUBLIC_SUPABASE_ANON_KEY=$PUBLIC_SUPABASE_ANON_KEY" >> .env

# Build
npm run build

# Deploy to Pages
echo "📱 Deploying Astro to Pages..."
npx wrangler pages deploy dist --project-name=ai-stackoverflow

echo "✅ Full stack deployed!"
echo "Frontend: ai-stackoverflow.pages.dev"
echo "Backend: $WORKER_URL"
```

### `scripts/seed-data.json`
```json
[
  {
    "id": "post_001",
    "title": "How to scale PostgreSQL to 100k QPS?",
    "text": "We're running into CPU bottlenecks at 10k QPS. Using pgBouncer already. Should we shard? Use Vitess? What's the best approach?",
    "user": "alice",
    "url": "https://stackoverflow.com/questions/...",
    "date": "2026-01-23T10:00:00Z",
    "comments": [
      {
        "text": "pgBouncer with read replicas is the way. We handle 50k QPS easily.",
        "user": "bob",
        "url": "https://example.com",
        "date": "2026-01-23T10:15:00Z"
      },
      {
        "text": "Consider Vitess for horizontal scaling across multiple databases.",
        "user": "carol",
        "date": "2026-01-23T10:30:00Z"
      }
    ]
  }
]
```

### `scripts/upload-posts.sh`
```bash
#!/bin/bash

echo "📤 Uploading seed data..."

# Upload to R2
wrangler r2 object put data-pipeline/seed-posts.json --file scripts/seed-data.json

# Trigger processing
WORKER_URL="https://visa-1.YOUR_SUBDOMAIN.workers.dev"
curl -X GET "$WORKER_URL/run"

echo "✅ Data uploaded and queued!"
```

---

## 5️⃣ ENVIRONMENT FILES

### `frontend/.env`
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
PUBLIC_WORKER_URL=https://visa-1.YOUR_SUBDOMAIN.workers.dev
```

### `backend/wrangler.toml` (Reference)
```toml
name = "visa-1"
main = "src/index.py"
compatibility_date = "2026-01-22"
compatibility_flags = ["nodejs_compat", "python_workers"]

account_id = "your-cloudflare-account-id"

[[r2_buckets]]
binding = "MY_BUCKET"
bucket_name = "data-pipeline"

[[kv_namespaces]]
binding = "PROCESSED_KEYS"
id = "5efb3f36000f4319ab0e926229da7b9d"

[[queues.producers]]
binding = "PROCESS_QUEUE"
queue = "r2-process-queue"

[[queues.consumers]]
queue = "r2-process-queue"

[vars]
SUPABASE_URL = "https://your-project.supabase.co"
```

---

## 🚀 QUICK START

```bash
# Copy all to Cursor
# 1. Create folder structure
mkdir -p visa-1/{backend,frontend,scripts}/src

# 2. Copy backend files to backend/src/
# 3. Copy frontend files to frontend/src/
# 4. Copy wrangler.toml to backend/
# 5. Copy SQL to Supabase

# 6. Deploy
bash scripts/deploy-all.sh

# 7. Seed data
bash scripts/upload-posts.sh
```

**All scripts ready for Cursor implementation!** 🎉

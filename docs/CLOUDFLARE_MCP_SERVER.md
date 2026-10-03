# Cloudflare MCP Server Integration

> **Retired — do not deploy from this historical guide.** The old HTTP handler had no authentication while using privileged database/AI access. Its current source returns 410 and needs no secrets or resource bindings. This does not change any previously deployed instance; inventory and retire those with operator approval. See [the current security handoff](SECURITY_FIXES_2026-09-11.md).

This worker exposes a **Model Context Protocol (MCP)** server that allows AI agents to interact with your Visa platform directly.

## Features

- **Semantic Search**: Find relevant posts using vector search.
- **Analytics**: View post and cluster counts.
- **Clustering**: Manually trigger AI clustering jobs.

## Deployment

1. **Deploy the Worker**:
   ```bash
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   wrangler secret put CF_ACCOUNT_ID
   wrangler secret put CF_API_TOKEN
   wrangler secret put SUPABASE_URL  # If not set in toml
   
   wrangler deploy --config wrangler.mcp.toml
   ```

2. **Wait for Deployment**: Note the URL (e.g., `https://visa-mcp-server.your-subdomain.workers.dev`).

## Configuring Claude Desktop

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "visa-platform": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sse-client",
        "https://visa-mcp-server.your-subdomain.workers.dev/sse"
      ]
    }
  }
}
```
*Note: You may need a bridge client if direct SSE is not supported by your specific desktop setup, but the standard SSE client is recommended.*

## Available Tools

- `search_posts(query, limit)`: Semantic search for content.
- `get_analytics(days)`: View system stats.
- `trigger_clustering()`: Run the clustering pipeline.

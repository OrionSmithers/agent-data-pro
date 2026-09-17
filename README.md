# Agent Data Pro

**Premium research articles + free live crypto prices for AI agents.**

Agent Data Pro is a production-grade MCP server that gives AI agents access to:

- **Premium research articles** on Blockchain, DeFi, and Crypto Markets (purchasable via x402 on Base)
- **Free live cryptocurrency price data** (BTC, ETH, SOL, 5000+ coins) — no payment required

Built for the agent-to-agent economy. Pay with USDC on Base, or use the free tools to get started immediately.

---

## 🚀 Quick Start for Agents

### Connect Your MCP Client

Add this to your MCP client configuration:

```json
{
  "mcpServers": {
    "agent-data-pro": {
      "url": "https://agentdatapro.com/mcp"
    }
  }
}
```

### Discovery Files

- **MCP Discovery:** https://agentdatapro.com/mcp.json
- **OpenAPI:** https://agentdatapro.com/api/openapi
- **Service Status:** https://agentdatapro.com/

### Official MCP Registry

Listed as `io.github.OrionSmithers/agent-data-pro` — searchable via the [MCP Registry](https://registry.modelcontextprotocol.io).

### Other Listings

- **Glama Connector:** https://glama.ai/mcp/connectors/com.agentdatapro
- **Smithery:** https://smithery.ai/server/degrees2/agent-data-pro

---

## 🆓 Free Tools (No Payment Required)

| Tool | Description |
|------|-------------|
| `list_articles` | Browse all available premium articles with prices, categories, and previews. Use this first to discover available article IDs. |
| `get_crypto_price` | Get live USD price, 24h change, 7d change, market cap, and volume for any cryptocurrency (BTC, ETH, SOL, DOGE, etc.) — data updates every 5 minutes. Rate-limited to 30 requests per 60 seconds. |

### Example: Get Bitcoin Price

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_crypto_price",
    "arguments": { "symbol": "BTC" }
  }
}
```

**Response:**

```json
{
  "symbol": "BTC",
  "price": 79587.13,
  "change24h": -1.41,
  "marketcap": 1598095890960.32,
  "attribution": "Data provided by https://cryptorates.ai"
}
```

---

## 💰 Paid Tools (x402 Payment Required)

### `get_article`

Retrieve the full content of any premium research article. Price varies by article ($0.01–$0.30 USDC). Call `list_articles` first to get valid article IDs.

| Article ID | Price | Description |
|------------|-------|-------------|
| `on-chain-trading-signals` | $0.01 USDC | Whale movements and market anomalies |
| `defi-vulnerabilities` | $0.02 USDC | Smart contract monitoring for agents |
| `blockchain-fee-markets` | $0.015 USDC | Gas price prediction and optimization |
| `how-ai-agents-compare-products` | $0.02 USDC | B2B vendor comparison guide |
| `state-of-ai-agents-in-defi` | $0.30 USDC | 2026 market map and opportunities |
| `agent-payment-spending-governance` | $0.30 USDC | Wallets, mandates, and audit trails |
| `know-your-agent-compliance` | $0.30 USDC | Compliance and identity verification |

### Example: Purchase an Article

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_article",
    "arguments": { "id": "on-chain-trading-signals" }
  }
}
```

---

## 💳 Payment Protocol

| Field | Value |
|-------|-------|
| **Protocol** | x402 v2 |
| **Network** | Base mainnet (eip155:8453) |
| **Currency** | USDC |
| **Contract** | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| **Facilitator** | PayAI (https://facilitator.payai.network/) |

---

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/articles` | GET | List all articles with prices and previews |
| `/api/articles/{id}` | GET | Retrieve full article content (x402 payment required) |
| `/api/price/{symbol}` | GET | Get live crypto price (free, no payment required) |
| `/api/openapi` | GET | OpenAPI 3.0.3 specification |
| `/mcp.json` | GET | MCP discovery manifest |

---

## 🤖 How It Works

```
AI Agent
  │
  ▼
GET /api/articles/{id}  (or call MCP tool)
  │
  ▼
402 Payment Required (x402 challenge)
  │
  ▼
Agent constructs x402 payment
  │
  ▼
PayAI facilitator → Base/USDC settlement
  │
  ▼
Payment verification → Replay protection
  │
  ▼
Premium article delivered (HTTP 200)
```

---

## 🔒 Security Features

- **Replay protection** — prevents payment reuse
- **Resource binding** — payments locked to specific articles
- **Rate limiting** — 100 requests per 60 seconds per article; crypto tool limited to 30 requests per 60 seconds
- **Private content** — articles stored in Cloudflare KV, never in public assets
- **Facilitator verification** — PayAI validates all payments

---

## 🛠️ Development

### Local Setup

```bash
# Clone the repository
git clone https://github.com/OrionSmithers/agent-data-pro.git

# Install dependencies
npm install

# Deploy to Cloudflare
npx wrangler deploy --config wrangler.production.jsonc
```

### Publishing a New Article

```bash
node publish-article.js articles/your-article.md --deploy
```

---

## 📖 Architecture

```
PUBLIC CLOUDFLARE ASSETS
        │
        ├── index.json (article catalogue)
        └── mcp.json (MCP discovery)

PRIVATE CLOUDFLARE KV
        │
        └── ARTICLE_CONTENT (premium article storage)
```

---

## 🏷️ Topics

`mcp` `model-context-protocol` `ai-agents` `x402` `research` `crypto` `base` `usdc` `agent-data-pro` `blockchain` `defi` `cryptocurrency`

---

## 📄 License

MIT

---

**Built for AI agents. Powered by x402.**

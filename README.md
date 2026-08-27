markdown
# Agent Data Pro

Premium research articles for AI agents.

Pay via **x402 protocol** on **Base network** (USDC).

## 🚀 Quick Start

### Discovery
https://agentdatapro.com/mcp.json

text

### API
- `GET /api/articles` — List all available articles
- `GET /api/articles/{id}` — Get article content (requires x402 payment)

## 💳 Payment
- **Protocol:** x402 v2
- **Network:** Base mainnet (eip155:8453)
- **Currency:** USDC
- **Facilitator:** PayAI

## 📚 Available Articles

| Article | Price |
|---------|-------|
| on-chain-trading-signals | $0.01 USDC |
| defi-vulnerabilities | $0.02 USDC |
| blockchain-fee-markets | $0.015 USDC |
| how-ai-agents-compare-products | $0.02 USDC |
| state-of-ai-agents-in-defi | $0.30 USDC |
| agent-payment-spending-governance | $0.30 USDC |
| know-your-agent-compliance | $0.30 USDC |

## 🔧 Deployment

```bash
npx wrangler deploy --config wrangler.production.jsonc
📖 Documentation
OpenAPI: https://agentdatapro.com/api/openapi

MCP Discovery: https://agentdatapro.com/mcp.json

🏷️ Topics
mcp model-context-protocol ai-agents x402 research crypto

Made for AI agents.

text

---

## Step 4: Commit

| Field | What to Put |
|-------|-------------|
| **Commit message** | `Add README` |
| **Extended description** | Leave blank |
| **Branch** | `main` |

Click **Commit changes**.

---

## Step 5: Add to `awesome-mcp-servers`

Now that you have a README, go to:

https://github.com/punkpeye/awesome-mcp-servers

Click the pencil icon (✏️) on `README.md` and add:
Agent Data Pro — Premium research articles for AI agents with x402 payment on Base network.

text

Then click **Propose changes** → **Create pull request**.

---

**Let me know when the README is added and I'll confirm it's ready.**
domyt we want somethih moree descrptive ?
You're right. Let's make it more descriptive and professional — something that clearly explains what your service does and why it matters.

Updated README.md
markdown
# Agent Data Pro

**Premium research articles for AI agents.**
Pay via **x402 protocol** on **Base network** (USDC).

Agent Data Pro is a production-grade MCP (Model Context Protocol) server that allows AI agents to discover, purchase, and consume premium research articles autonomously. Built for the agent-to-agent economy, it combines micropayments with high-quality content.

---

## 🚀 Quick Start

### MCP Discovery
https://agentdatapro.com/mcp.json

text

### OpenAPI Documentation
https://agentdatapro.com/api/openapi

text

### Service Status
https://agentdatapro.com/

text

---

## 📚 Available Articles

| Article | Price |
|---------|-------|
| on-chain-trading-signals | $0.01 USDC |
| defi-vulnerabilities | $0.02 USDC |
| blockchain-fee-markets | $0.015 USDC |
| how-ai-agents-compare-products | $0.02 USDC |
| state-of-ai-agents-in-defi | $0.30 USDC |
| agent-payment-spending-governance | $0.30 USDC |
| know-your-agent-compliance | $0.30 USDC |

---

## 💳 Payment Protocol

- **Protocol:** x402 v2
- **Network:** Base mainnet (eip155:8453)
- **Currency:** USDC
- **Contract:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **Facilitator:** PayAI (https://facilitator.payai.network/)

---

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/articles` | GET | List all available articles with prices and previews |
| `/api/articles/{id}` | GET | Retrieve full article content (requires x402 payment) |
| `/api/openapi` | GET | OpenAPI 3.0.3 specification |
| `/mcp.json` | GET | MCP discovery manifest |

---

## 🤖 How It Works
AI Agent
│
▼
GET /api/articles/{id}
│
▼
402 Payment Required
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

text

---

## 🔒 Security Features

- **Replay protection** — prevents payment reuse
- **Resource binding** — payments locked to specific articles
- **Rate limiting** — 100 requests per 60 seconds per article
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
Publishing a New Article
bash
node publish-article.js articles/your-article.md --deploy
📖 Architecture
text
PUBLIC CLOUDFLARE ASSETS
        │
        ├── index.json (article catalogue)
        └── mcp.json (MCP discovery)

PRIVATE CLOUDFLARE KV
        │
        └── ARTICLE_CONTENT (premium article storage)
🏷️ Topics
mcp model-context-protocol ai-agents x402 research crypto base usdc agent-data-pro

📄 License
MIT

Built for AI agents. Powered by x402.

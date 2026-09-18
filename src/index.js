const { Hono } = require("hono");
const { paymentMiddleware } = require("@x402/hono");
const {
  x402ResourceServer,
  HTTPFacilitatorClient,
} = require("@x402/core/server");
const { ExactEvmScheme } = require("@x402/evm/exact/server");
const { facilitator } = require("@payai/facilitator");

const app = new Hono();

const PAY_TO = "0x7407C890Ec45e78e346Ca9b713fA6BbaC2B76F20";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const facilitatorClient = new HTTPFacilitatorClient(facilitator);

const resourceServer = new x402ResourceServer(facilitatorClient);

resourceServer.register("eip155:8453", new ExactEvmScheme());

// ============================================================
// PAYMENT REPLAY PROTECTION
// ============================================================

function getPaymentReplayKV(context) {
  return context.transportContext?.request?.adapter?.c?.env?.PAYMENT_REPLAY;
}

function getReplayKey(context) {
  const authorization = context.paymentPayload?.payload?.authorization;
  const resource = context.paymentPayload?.resource?.url;

  if (
    !authorization ||
    typeof authorization.from !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce) ||
    typeof resource !== "string"
  ) {
    return null;
  }

  return [
    "eip155:8453",
    encodeURIComponent(resource),
    authorization.from.toLowerCase(),
    authorization.nonce.toLowerCase(),
  ].join(":");
}

resourceServer.onBeforeVerify(async (context) => {
  const replayKV = getPaymentReplayKV(context);
  const replayKey = getReplayKey(context);

  if (!replayKV || !replayKey) {
    console.error("AGENTDATA_REPLAY_PROTECTION_UNAVAILABLE");
    return { abort: true, reason: "replay_protection_unavailable", message: "Payment replay protection is unavailable" };
  }

  if (await replayKV.get(replayKey)) {
    console.warn("AGENTDATA_PAYMENT_REPLAY_BLOCKED", replayKey);
    return { abort: true, reason: "payment_replayed", message: "Payment authorization has already been used" };
  }
});

resourceServer.onAfterSettle(async (context) => {
  const replayKV = getPaymentReplayKV(context);
  const replayKey = getReplayKey(context);

  if (!replayKV || !replayKey) {
    throw new Error("Replay protection state unavailable after settlement");
  }

  await replayKV.put(replayKey, "settled");
  console.log("AGENTDATA_PAYMENT_REPLAY_RECORDED", replayKey);
});

// ============================================================
// PAYMENT RESOURCE BINDING
// ============================================================

resourceServer.onBeforeVerify(async (context) => {
  const signedResource = context.paymentPayload?.resource?.url;
  const adapter = context.transportContext?.request?.adapter;
  const actualRequest = adapter?.getUrl?.();

  console.log("AGENTDATA_RESOURCE_BINDING_DEBUG", JSON.stringify({
    signedResource, actualRequest,
    path: adapter?.getPath?.(), method: adapter?.getMethod?.(),
    routePattern: context.transportContext?.request?.routePattern,
  }));

  if (!signedResource || !actualRequest) {
    return { abort: true, reason: "resource_binding_failed", message: "Unable to bind payment to requested resource" };
  }

  if (signedResource !== actualRequest) {
    console.error("AGENTDATA_RESOURCE_TAMPER_BLOCKED", JSON.stringify({ signedResource, actualRequest }));
    return { abort: true, reason: "resource_mismatch", message: "Payment is not valid for this resource" };
  }
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.onError((error, c) => {
  console.error("AGENTDATA_UNHANDLED_ERROR", error && error.stack ? error.stack : error);
  if (error && error.cause) {
    console.error("AGENTDATA_ERROR_CAUSE", error.cause && error.cause.stack ? error.cause.stack : error.cause);
  }
  return c.json({ error: "Internal Server Error" }, 500);
});

// ============================================================
// DYNAMIC X402 ROUTES
// ============================================================

let dynamicRoutesCache = null;

async function buildDynamicRoutes(env) {
  const indexResponse = await env.ASSETS.fetch(new Request("https://internal/index.json"));
  if (!indexResponse.ok) throw new Error("Catalogue not found");
  const index = await indexResponse.json();
  if (!Array.isArray(index.articles)) throw new Error("Catalogue is invalid");

  const routes = {};

  for (const article of index.articles) {
    if (!article || typeof article.id !== "string" || typeof article.price !== "number" || article.price <= 0) {
      console.error("AGENTDATA_INVALID_CATALOGUE_ARTICLE", JSON.stringify(article));
      continue;
    }
    routes[`GET /api/articles/${article.id}`] = {
      accepts: { scheme: "exact", price: `$${article.price}`, network: "eip155:8453", payTo: PAY_TO, asset: USDC_BASE },
      description: article.title || `Agent Data Pro article ${article.id}`,
      extensions: { bazaar: { info: { input: { type: "http", method: "GET" }, output: { type: "json" } } } }
    };
  }

  routes["GET /api/token/:address/safety"] = {
    accepts: { scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: PAY_TO, asset: USDC_BASE },
    description: "Check ERC-20 token safety on Base, Ethereum, or BSC — honeypot detection, taxes, and contract risks.",
    extensions: { bazaar: { info: { input: { type: "http", method: "GET", pathParams: { address: "0x4200000000000000000000000000000000000006" } }, output: { type: "json" } } } }
  };

  console.log("AGENTDATA_DYNAMIC_X402_ROUTES", JSON.stringify({ count: Object.keys(routes).length, routes: Object.keys(routes) }));

  return routes;
}

// ============================================================
// X402 MIDDLEWARE (registered BEFORE paid routes so it runs first)
// ============================================================

let x402Initialized = false;

app.use("/api/*", async (c, next) => {
  // Skip free routes
  if (c.req.path === "/api/price" || c.req.path.startsWith("/api/price/")) {
    return next();
  }
  if (c.req.path === "/api/articles" || c.req.path === "/api/articles/") {
    return next();
  }
  if (c.req.path === "/api/openapi") {
    return next();
  }

  // Rate limiting for article routes
  if (c.req.path.startsWith("/api/articles/")) {
    const id = c.req.param("id");
    const rateLimitKey = `/api/articles/${id}`;
    console.log("AGENTDATA_RATE_LIMITER_CHECK", { key: rateLimitKey });
    const result = await c.env.ARTICLE_RATE_LIMITER.limit({ key: rateLimitKey });
    console.log("AGENTDATA_RATE_LIMITER_RESULT", { success: result.success, key: rateLimitKey });
    if (!result.success) {
      console.warn("AGENTDATA_RATE_LIMITED", rateLimitKey);
      return c.json({ error: "Rate limit exceeded. Please slow down your requests.", retryAfter: 60 }, 429);
    }
  }

  // Initialize x402
  if (!x402Initialized) {
    console.log("AGENTDATA_X402_INIT: starting");
    try {
      await resourceServer.initialize();
      x402Initialized = true;
      console.log("AGENTDATA_X402_INIT: success");
    } catch (error) {
      console.error("AGENTDATA_X402_INIT: failed", error && error.stack ? error.stack : error);
      throw error;
    }
  }

  if (!dynamicRoutesCache) {
    dynamicRoutesCache = await buildDynamicRoutes(c.env);
  }

  const middleware = paymentMiddleware(dynamicRoutesCache, resourceServer, undefined, undefined, false);
  return middleware(c, next);
});

// ============================================================
// GLAMA DOMAIN VERIFICATION
// ============================================================

app.get("/.well-known/glama.json", async (c) => {
  return c.json({
    name: "Agent Data Pro",
    description: "Premium research articles for AI agents with x402 payment on Base network.",
    repository: "https://github.com/OrionSmithers/agent-data-pro",
    maintainers: [{ name: "OrionSmithers", email: "degrees2@yandex.com" }]
  });
});

// ============================================================
// PUBLIC ARTICLE CATALOGUE
// ============================================================

app.get("/index.json", async (c) => {
  const index = await c.env.ASSETS.fetch(new Request("https://internal/index.json"));
  if (!index.ok) return c.text("Not Found", 404);
  c.header("Content-Type", "application/json");
  return c.body(await index.arrayBuffer());
});

app.get("/mcp.json", async (c) => {
  const mcp = await c.env.ASSETS.fetch(new Request("https://internal/mcp.json"));
  if (!mcp.ok) return c.text("Not Found", 404);
  c.header("Content-Type", "application/json");
  return c.body(await mcp.arrayBuffer());
});

// ============================================================
// ICON ROUTES
// ============================================================

app.get("/icon-128.png", async (c) => {
  const icon = await c.env.ASSETS.fetch(new Request("https://internal/icon-128.png"));
  if (!icon.ok) return c.json({ error: "Not Found" }, 404);
  c.header("Content-Type", "image/png");
  return c.body(await icon.arrayBuffer());
});

app.get("/icon-64.png", async (c) => {
  const icon = await c.env.ASSETS.fetch(new Request("https://internal/icon-64.png"));
  if (!icon.ok) return c.json({ error: "Not Found" }, 404);
  c.header("Content-Type", "image/png");
  return c.body(await icon.arrayBuffer());
});

// ============================================================
// FREE ROUTES
// ============================================================

app.get("/api/price/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  try {
    const response = await fetch(`https://cryptorates.ai/v1/get/${symbol}`);
    if (!response.ok) {
      if (response.status === 404) return c.json({ error: `Coin symbol "${symbol}" not found` }, 404);
      throw new Error(`API returned ${response.status}`);
    }
    const data = await response.json();
    return c.json({
      symbol: data.symbol, name: data.name, rank: data.rank,
      price: data.price, volume24h: data.volume24h, marketcap: data.marketcap,
      supply: data.supply, change24h: data.change24h * 100,
      change7d: data.change7d * 100,
      lastUpdated: new Date(data.updated * 1000).toISOString(),
      attribution: "Data provided by https://cryptorates.ai"
    });
  } catch (error) {
    console.error("Crypto price error:", error);
    return c.json({ error: "Failed to fetch price data" }, 500);
  }
});

app.get("/api/articles", async (c) => {
  const index = await c.env.ASSETS.fetch(new Request("https://internal/index.json"));
  if (!index.ok) return c.json({ error: "Catalogue not found" }, 404);
  c.header("Content-Type", "application/json");
  return c.body(await index.arrayBuffer());
});

app.get("/api/openapi", (c) => {
  return c.json({
    openapi: "3.0.3",
    info: { title: "Agent Data Pro API", version: "1.0.0", description: "Agent-facing API for discovering and purchasing research articles using x402 payments." },
    servers: [{ url: "https://agentdatapro.com" }],
    paths: {
      "/api/articles": { get: { summary: "List available articles", description: "Returns the public article catalogue.", responses: { "200": { description: "Article catalogue", content: { "application/json": {} } } } } },
      "/api/articles/{id}": { get: { summary: "Purchase and retrieve an article", description: "Returns article content after successful x402 payment.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Article content", content: { "application/json": {} } }, "402": { description: "Payment Required" }, "404": { description: "Article not found" } } } },
      "/api/price/{symbol}": { get: { summary: "Get cryptocurrency price", description: "Free endpoint.", parameters: [{ name: "symbol", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Price data", content: { "application/json": {} } } } } },
      "/api/token/{address}/safety": { get: { summary: "Check token safety", description: "Requires x402 payment ($0.01 USDC).", parameters: [{ name: "address", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Token safety data", content: { "application/json": {} } }, "402": { description: "Payment Required" } } } }
    }
  });
});

// ============================================================
// MCP PROTOCOL ENDPOINT - FREE
// ============================================================

app.post("/mcp", async (c) => {
  try {
    const body = await c.req.json();
    const { jsonrpc, id, method, params } = body;

    if (method === "initialize") {
      return c.json({
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "Agent Data Pro", version: "1.0.0" }
        }
      });
    }

    if (method === "tools/list") {
      const tools = [];

      tools.push({
        name: "list_articles",
        description: "List all available premium research articles with their prices, categories, and previews. Free to call — no payment required. Use this first to discover available article IDs.",
        inputSchema: { type: "object", properties: {} }
      });

      tools.push({
        name: "get_article",
        description: "[x402 Payment Required] Retrieve the full content of a premium research article on Blockchain, DeFi, or Crypto Markets. Returns analysis, data, and actionable insights. Price varies by article ($0.01–$0.30 USDC). Requires x402 payment on Base network. Call list_articles first to get valid article IDs.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "The article ID to retrieve (e.g., 'on-chain-trading-signals', 'defi-vulnerabilities', 'know-your-agent-compliance'). Use list_articles to discover available IDs." }
          },
          required: ["id"]
        }
      });

      tools.push({
        name: "get_crypto_price",
        description: "Fetch current cryptocurrency price data including USD price, 24h change, 7d change, market cap, and 24h volume. Supports 5000+ coins including BTC, ETH, SOL, DOGE, XRP, ADA, AVAX, MATIC, and more. Data updates every 5 minutes from cryptorates.ai. Rate-limited to 30 requests per 60 seconds.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "Cryptocurrency symbol (uppercase). Examples: BTC, ETH, SOL, DOGE, XRP, ADA, AVAX, MATIC, DOT, LINK, UNI, ATOM, FTM, NEAR, ALGO, VET, ICP, FIL, EGLD, THETA, XTZ, RUNE, CRO, KCS, HNT, MKR, AAVE, SNX, CRV, CAKE, SUSHI, UST, LUNC, etc." }
          },
          required: ["symbol"]
        }
      });

      tools.push({
        name: "get_token_safety",
        description: "[x402 Payment Required] Check the safety of an ERC-20 token on Base (or Ethereum/BSC). Uses Honeypot.is to simulate buy/sell transactions and detect honeypots, taxes, and contract risks. Returns a risk score (0-100), verdict (safe/caution/risky/danger), and detailed warnings. Use this before buying or trading any token. Price: $0.01 USDC. Requires x402 payment on Base network.",
        inputSchema: {
          type: "object",
          properties: {
            address: { type: "string", description: "The ERC-20 token contract address (0x + 40 hex characters)." },
            chain: { type: "string", description: "Chain ID: 8453 (Base, default), 1 (Ethereum), or 56 (BSC).", default: "8453" }
          },
          required: ["address"]
        }
      });

      return c.json({ jsonrpc: "2.0", id, result: { tools } });
    }

    if (method === "tools/call") {
      const { name, arguments: args } = params;

      if (name === "list_articles") {
        const indexResponse = await c.env.ASSETS.fetch(new Request("https://internal/index.json"));
        const index = await indexResponse.json();
        return c.json({
          jsonrpc: "2.0", id,
          result: { content: [{ type: "text", text: JSON.stringify(index.articles, null, 2) }] }
        });
      }

      if (name === "get_crypto_price") {
        const symbol = args?.symbol?.toUpperCase();
        if (!symbol) {
          return c.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing required parameter: symbol" } });
        }
        try {
          const rateResult = await c.env.CRYPTO_RATE_LIMITER.limit({ key: "get_crypto_price" });
          if (!rateResult.success) {
            console.warn("AGENTDATA_CRYPTO_RATE_LIMITED");
            return c.json({ jsonrpc: "2.0", id, error: { code: -32000, message: "Rate limit exceeded. Please slow down your requests." } });
          }
        } catch (rateError) {
          console.error("CRYPTO_RATE_LIMITER_ERROR:", rateError.message);
        }
        try {
          const response = await fetch(`https://cryptorates.ai/v1/get/${symbol}`);
          if (!response.ok) {
            if (response.status === 404) {
              return c.json({ jsonrpc: "2.0", id, error: { code: -32602, message: `Coin symbol "${symbol}" not found` } });
            }
            throw new Error(`API returned ${response.status}`);
          }
          const data = await response.json();
          const resultText = `**${symbol} Price**\n\n` +
            `Price: $${data.price.toFixed(4)}\nName: ${data.name}\nRank: #${data.rank}\n` +
            `Market Cap: $${(data.marketcap / 1e9).toFixed(2)}B\n` +
            `24h Volume: $${(data.volume24h / 1e9).toFixed(2)}B\n` +
            `24h Change: ${(data.change24h * 100).toFixed(2)}%\n` +
            `7d Change: ${(data.change7d * 100).toFixed(2)}%\n\n` +
            `Data provided by https://cryptorates.ai`;
          return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: resultText }] } });
        } catch (error) {
          console.error("Crypto price error:", error);
          return c.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Failed to fetch crypto price data" } });
        }
      }

      if (name === "get_token_safety") {
        const address = args?.address?.toLowerCase();
        const chainId = args?.chain || "8453";
        if (!address) {
          return c.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing required parameter: address" } });
        }
        try {
          const rateResult = await c.env.CRYPTO_RATE_LIMITER.limit({ key: "get_token_safety" });
          if (!rateResult.success) {
            console.warn("AGENTDATA_TOKEN_SAFETY_RATE_LIMITED");
            return c.json({ jsonrpc: "2.0", id, error: { code: -32000, message: "Rate limit exceeded. Please slow down your requests." } });
          }
        } catch (rateError) {
          console.error("TOKEN_SAFETY_RATE_LIMITER_ERROR:", rateError.message);
        }
        try {
          const response = await fetch(
            `https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`
          );
          if (!response.ok) throw new Error(`Honeypot.is HTTP ${response.status}`);
          const data = await response.json();

          const summary = data.summary || {};
          const honeypotResult = data.honeypotResult || {};
          const simulationResult = data.simulationResult || {};
          const contractCode = data.contractCode || {};

          const isHoneypot = honeypotResult.isHoneypot === true;
          const riskLevel = summary.riskLevel !== undefined ? summary.riskLevel : null;
          const risk = summary.risk || "unknown";
          const flags = summary.flags || [];

          const buyTax = simulationResult.buyTax !== undefined ? simulationResult.buyTax * 100 : 0;
          const sellTax = simulationResult.sellTax !== undefined ? simulationResult.sellTax * 100 : 0;
          const transferTax = simulationResult.transferTax !== undefined ? simulationResult.transferTax * 100 : 0;
          const isOpenSource = contractCode.openSource === true;
          const hasProxyCalls = contractCode.hasProxyCalls === true;

          const warnings = [];
          if (isHoneypot) warnings.push("Honeypot detected — cannot sell");
          if (buyTax > 10) warnings.push(`High buy tax: ${buyTax.toFixed(1)}%`);
          if (sellTax > 10) warnings.push(`High sell tax: ${sellTax.toFixed(1)}%`);
          if (transferTax > 10) warnings.push(`High transfer tax: ${transferTax.toFixed(1)}%`);
          if (!isOpenSource) warnings.push("Contract source not verified");
          if (hasProxyCalls) warnings.push("Proxy contract — logic can be changed");

          let riskScore;
          if (riskLevel !== null) {
            riskScore = Math.max(0, 100 - riskLevel);
          } else {
            if (risk === "very_low") riskScore = 100;
            else if (risk === "low") riskScore = 85;
            else if (risk === "medium") riskScore = 60;
            else if (risk === "high") riskScore = 30;
            else if (risk === "very_high") riskScore = 10;
            else if (risk === "honeypot") riskScore = 0;
            else riskScore = 50;
          }
          if (isHoneypot) riskScore = 0;

          let verdict;
          if (riskScore >= 80) verdict = "safe";
          else if (riskScore >= 50) verdict = "caution";
          else if (riskScore >= 25) verdict = "risky";
          else verdict = "danger";

          const resultText = `**Token Safety: ${data.token?.symbol || "Unknown"}**\n\n` +
            `Address: \`${address}\`\n` +
            `Risk Score: **${riskScore}/100** (${verdict.toUpperCase()})\n\n` +
            `**Warnings:**\n${warnings.length > 0 ? warnings.map(w => `- ${w}`).join("\n") : "- None"}\n\n` +
            `Buy Tax: ${buyTax.toFixed(2)}% | Sell Tax: ${sellTax.toFixed(2)}%\n` +
            `Open Source: ${isOpenSource ? "Yes" : "No"}\n` +
            `Flags: ${flags.length > 0 ? flags.join(", ") : "None"}\n\n` +
            `Data provided by Honeypot.is`;

          return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: resultText }] } });
        } catch (error) {
          console.error("Token safety error:", error);
          return c.json({ jsonrpc: "2.0", id, error: { code: -32603, message: "Failed to fetch token safety data" } });
        }
      }

      if (name === "get_article") {
        const articleId = args?.id;
        if (!articleId) {
          return c.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing required parameter: id" } });
        }
        const content = await c.env.ARTICLE_CONTENT.get(articleId);
        if (content) {
          return c.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: content }] } });
        }
        return c.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Article not found" } });
      }

      return c.json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool call" } });
    }

    return c.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (error) {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
   }
});

// ============================================================
// PAID ROUTES (middleware above runs before these)
// ============================================================

app.get("/api/token/:address/safety", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const chainId = c.req.query("chain") || "8453";

  const supportedChains = { "8453": "base", "1": "ethereum", "56": "bsc" };
  const chainName = supportedChains[chainId];
  if (!chainName) {
    return c.json({ error: `Unsupported chain. Use 8453 (Base), 1 (Ethereum), or 56 (BSC).` }, 400);
  }

  if (!/^0x[a-f0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid token address. Must be 0x + 40 hex characters." }, 400);
  }

  try {
    const response = await fetch(
      `https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`
    );

    if (!response.ok) {
      console.error(`Honeypot.is HTTP ${response.status}`);
      return c.json({ error: "Service temporarily unavailable" }, 503);
    }

    const data = await response.json();

    const summary = data.summary || {};
    const honeypotResult = data.honeypotResult || {};
    const simulationResult = data.simulationResult || {};
    const contractCode = data.contractCode || {};

    const isHoneypot = honeypotResult.isHoneypot === true;
    const riskLevel = summary.riskLevel !== undefined ? summary.riskLevel : null;
    const risk = summary.risk || "unknown";
    const flags = summary.flags || [];

    const buyTax = simulationResult.buyTax !== undefined ? simulationResult.buyTax * 100 : 0;
    const sellTax = simulationResult.sellTax !== undefined ? simulationResult.sellTax * 100 : 0;
    const transferTax = simulationResult.transferTax !== undefined ? simulationResult.transferTax * 100 : 0;
    const isOpenSource = contractCode.openSource === true;
    const hasProxyCalls = contractCode.hasProxyCalls === true;

    const warnings = [];
    if (isHoneypot) warnings.push("Honeypot detected — cannot sell");
    if (buyTax > 10) warnings.push(`High buy tax: ${buyTax.toFixed(1)}%`);
    if (sellTax > 10) warnings.push(`High sell tax: ${sellTax.toFixed(1)}%`);
    if (transferTax > 10) warnings.push(`High transfer tax: ${transferTax.toFixed(1)}%`);
    if (!isOpenSource) warnings.push("Contract source not verified");
    if (hasProxyCalls) warnings.push("Proxy contract — logic can be changed");

    let riskScore;
    if (riskLevel !== null) {
      riskScore = Math.max(0, 100 - riskLevel);
    } else {
      if (risk === "very_low") riskScore = 100;
      else if (risk === "low") riskScore = 85;
      else if (risk === "medium") riskScore = 60;
      else if (risk === "high") riskScore = 30;
      else if (risk === "very_high") riskScore = 10;
      else if (risk === "honeypot") riskScore = 0;
      else riskScore = 50;
    }
    if (isHoneypot) riskScore = 0;

    let verdict;
    if (riskScore >= 80) verdict = "safe";
    else if (riskScore >= 50) verdict = "caution";
    else if (riskScore >= 25) verdict = "risky";
    else verdict = "danger";

    return c.json({
      token: { address, name: data.token?.name || "Unknown", symbol: data.token?.symbol || "Unknown", chainId, chainName },
      risk: { score: riskScore, verdict, warnings, riskLevel, riskLabel: risk },
      details: {
        honeypot: isHoneypot, buyTax, sellTax, transferTax,
        openSource: isOpenSource, proxy: hasProxyCalls,
        flags: flags, simulationSuccess: simulationResult.success !== false
      },
      attribution: "Security data provided by Honeypot.is (https://honeypot.is)"
    });

  } catch (error) {
    console.error("Token safety error:", error);
    return c.json({ error: "Failed to fetch token safety data", details: error.message }, 500);
  }
});

app.get("/api/articles/:id", async (c) => {
  const id = c.req.param("id");
  const indexResponse = await c.env.ASSETS.fetch(new Request("https://internal/index.json"));
  if (!indexResponse.ok) return c.json({ error: "Catalogue not found" }, 404);
  let index;
  try { index = await indexResponse.json(); } catch (error) {
    console.error("AGENTDATA_CATALOGUE_PARSE_ERROR", error && error.stack ? error.stack : error);
    return c.json({ error: "Catalogue is invalid" }, 500);
  }
  if (!Array.isArray(index.articles)) return c.json({ error: "Catalogue is invalid" }, 500);
  const articleInfo = index.articles.find((article) => article.id === id);
  if (!articleInfo) return c.json({ error: "Article not found" }, 404);
  const content = await c.env.ARTICLE_CONTENT.get(id);
  if (content === null) return c.json({ error: "Article content not found" }, 404);
  return c.json({ articleId: id, title: articleInfo.title, content });
});

// ============================================================
// SERVICE ROOT
// ============================================================

app.get("/", (c) => {
  return c.json({ service: "Agent Data Pro", status: "online", protocol: "x402" });
});

// ============================================================
// PAYAI LISTING HEALTH CHECK (CRON TRIGGER)
// ============================================================

async function checkPayaiListing(articleId) {
  const url = `https://facilitator.payai.network/discovery/listing-status?resource=https://agentdatapro.com/api/articles/${articleId}`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error(`PAYAI_CHECK_HTTP_ERROR ${articleId} status=${r.status}`);
      return { id: articleId, ok: false, reason: `http_${r.status}` };
    }
    const j = await r.json();
    return {
      id: articleId,
      listed: j.listed,
      hidden: j.hidden,
      hiddenReason: j.hiddenReason,
      probeStatus: j.lastProbe?.status,
      ok: j.listed === true && j.hidden === false,
    };
  } catch (err) {
    console.error(`PAYAI_CHECK_ERROR ${articleId} ${err.message}`);
    return { id: articleId, ok: false, reason: err.message };
  }
}

async function payaiHealthCheck(env) {
  console.log("PAYAI_CRON_CHECK: starting");

  let articleIds = [];
  try {
    const indexResponse = await fetch("https://agentdatapro.com/api/articles");
    const index = await indexResponse.json();
    articleIds = index.articles.map(a => a.id);
    console.log(`PAYAI_CRON_CHECK: found ${articleIds.length} articles`);
  } catch (err) {
    console.error(`PAYAI_CRON_CHECK: could not fetch catalogue: ${err.message}`);
    return;
  }

  const results = [];
  for (const id of articleIds) {
    const result = await checkPayaiListing(id);
    results.push(result);
    if (result.ok) {
      console.log(`PAYAI_CRON_CHECK: ${id} — OK (listed, probe=${result.probeStatus})`);
    } else {
      console.warn(`PAYAI_CRON_CHECK: ${id} — PROBLEM (listed=${result.listed}, hidden=${result.hidden}, reason=${result.hiddenReason || result.reason})`);
    }
  }

  const healthy = results.filter(r => r.ok).length;
  const unhealthy = results.length - healthy;

  console.log(`PAYAI_CRON_CHECK: complete — ${healthy} healthy, ${unhealthy} need attention`);

  if (unhealthy > 0) {
    console.warn(`PAYAI_CRON_CHECK: ${unhealthy} articles are hidden or missing.`);

    const problemList = results
      .filter(r => !r.ok)
      .map(r => `- ${r.id}: listed=${r.listed}, hidden=${r.hidden}, reason=${r.hiddenReason || r.reason}`)
      .join("\n");

    const emailBody = `PayAI Listing Health Check — Problems Detected

Date: ${new Date().toISOString()}

The following articles are hidden or missing from PayAI's Bazaar:

${problemList}

Action: Run pay-all-articles.js to relist them.

Log summary: ${healthy} healthy, ${unhealthy} need attention.`;

    try {
      await env.ALERT_EMAIL.send({
        to: "degrees2@yandex.com",
        from: "alerts@agentdatapro.com",
        subject: `PayAI Listing Alert: ${unhealthy} article(s) need attention`,
        text: emailBody
      });
      console.log("PAYAI_CRON_CHECK: alert email sent");
    } catch (emailError) {
      console.error("PAYAI_CRON_CHECK: failed to send alert email:", emailError.message);
    }
  }
}

export default {
  fetch: app.fetch,
  scheduled: async (event, env, ctx) => {
    ctx.waitUntil(payaiHealthCheck(env));
  },
};

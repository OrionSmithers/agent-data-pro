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

// ============================================================
// PayAI facilitator
// ============================================================

const facilitatorClient = new HTTPFacilitatorClient(facilitator);

// ============================================================
// x402 resource server
// ============================================================

const resourceServer = new x402ResourceServer(facilitatorClient);

resourceServer.register(
  "eip155:8453",
  new ExactEvmScheme()
);

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
    return {
      abort: true,
      reason: "replay_protection_unavailable",
      message: "Payment replay protection is unavailable",
    };
  }

  if (await replayKV.get(replayKey)) {
    console.warn("AGENTDATA_PAYMENT_REPLAY_BLOCKED", replayKey);
    return {
      abort: true,
      reason: "payment_replayed",
      message: "Payment authorization has already been used",
    };
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
  const signedResource =
    context.paymentPayload?.resource?.url;

  const adapter =
    context.transportContext?.request?.adapter;

  const actualRequest =
    adapter?.getUrl?.();

  console.log(
    "AGENTDATA_RESOURCE_BINDING_DEBUG",
    JSON.stringify({
      signedResource,
      actualRequest,
      path: adapter?.getPath?.(),
      method: adapter?.getMethod?.(),
      routePattern:
        context.transportContext?.request?.routePattern,
    })
  );

  if (!signedResource || !actualRequest) {
    return {
      abort: true,
      reason: "resource_binding_failed",
      message: "Unable to bind payment to requested resource",
    };
  }

  if (signedResource !== actualRequest) {
    console.error(
      "AGENTDATA_RESOURCE_TAMPER_BLOCKED",
      JSON.stringify({
        signedResource,
        actualRequest,
      })
    );

    return {
      abort: true,
      reason: "resource_mismatch",
      message: "Payment is not valid for this resource",
    };
  }
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

app.onError((error, c) => {
  console.error(
    "AGENTDATA_UNHANDLED_ERROR",
    error && error.stack ? error.stack : error
  );

  if (error && error.cause) {
    console.error(
      "AGENTDATA_ERROR_CAUSE",
      error.cause && error.cause.stack
        ? error.cause.stack
        : error.cause
    );
  }

  return c.json(
    {
      error: "Internal Server Error",
    },
    500
  );
});

// ============================================================
// PUBLIC ARTICLE CATALOGUE
// ============================================================

app.get("/index.json", async (c) => {
  const index = await c.env.ASSETS.fetch(
    new Request("https://internal/index.json")
  );

  if (!index.ok) {
    return c.text("Not Found", 404);
  }

  c.header("Content-Type", "application/json");

  return c.body(await index.arrayBuffer());
});

// ============================================================
// PUBLIC MCP DISCOVERY
// ============================================================

app.get("/mcp.json", async (c) => {
  const mcp = await c.env.ASSETS.fetch(
    new Request("https://internal/mcp.json")
  );

  if (!mcp.ok) {
    return c.text("Not Found", 404);
  }

  c.header("Content-Type", "application/json");

  return c.body(await mcp.arrayBuffer());
});

// ============================================================
// PUBLIC API DISCOVERY
// ============================================================

app.get("/api/articles", async (c) => {
  const index = await c.env.ASSETS.fetch(
    new Request("https://internal/index.json")
  );

  if (!index.ok) {
    return c.json(
      {
        error: "Catalogue not found",
      },
      404
    );
  }

  c.header("Content-Type", "application/json");

  return c.body(await index.arrayBuffer());
});

// ============================================================
// PUBLIC OPENAPI DESCRIPTION
// ============================================================

app.get("/api/openapi", (c) => {
  return c.json({
    openapi: "3.0.3",

    info: {
      title: "Agent Data Pro API",
      version: "1.0.0",
      description:
        "Agent-facing API for discovering and purchasing research articles using x402 payments.",
    },

    servers: [
      {
        url: "https://agentdatapro.com",
      },
    ],

    paths: {
      "/api/articles": {
        get: {
          summary: "List available articles",
          description:
            "Returns the public article catalogue. Article content is not included.",

          responses: {
            "200": {
              description: "Article catalogue",
              content: {
                "application/json": {},
              },
            },
          },
        },
      },

      "/api/articles/{id}": {
        get: {
          summary: "Purchase and retrieve an article",
          description:
            "Returns article content after successful x402 payment.",

          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: {
                type: "string",
              },
            },
          ],

          responses: {
            "200": {
              description: "Article content",
              content: {
                "application/json": {},
              },
            },

            "402": {
              description:
                "Payment Required. The response contains the x402 payment challenge.",
              content: {
                "application/json": {},
              },
            },

            "404": {
              description: "Article not found",
            },
          },
        },
      },
    },
  });
});

// ============================================================
// DYNAMIC X402 ROUTES
// ============================================================

let dynamicRoutesCache = null;

async function buildDynamicRoutes(env) {
  const indexResponse = await env.ASSETS.fetch(
    new Request("https://internal/index.json")
  );

  if (!indexResponse.ok) {
    throw new Error("Catalogue not found");
  }

  const index = await indexResponse.json();

  if (!Array.isArray(index.articles)) {
    throw new Error("Catalogue is invalid");
  }

  const routes = {};

  for (const article of index.articles) {
    if (
      !article ||
      typeof article.id !== "string" ||
      typeof article.price !== "number" ||
      article.price <= 0
    ) {
      console.error(
        "AGENTDATA_INVALID_CATALOGUE_ARTICLE",
        JSON.stringify(article)
      );

      continue;
    }

    routes[`GET /api/articles/${article.id}`] = {
      accepts: {
        scheme: "exact",
        price: `$${article.price}`,
        network: "eip155:8453",
        payTo: PAY_TO,
        asset: USDC_BASE,
      },

      description:
        article.title || `Agent Data Pro article ${article.id}`,
    };
  }

  console.log(
    "AGENTDATA_DYNAMIC_X402_ROUTES",
    JSON.stringify({
      count: Object.keys(routes).length,
      routes: Object.keys(routes),
    })
  );

  return routes;
}

// ============================================================
// DYNAMIC X402 MIDDLEWARE WITH RATE LIMITER
// ============================================================

let x402Initialized = false;

app.use("/api/articles/*", async (c, next) => {
  // Do not interfere with the public catalogue endpoint.
  if (
    c.req.path === "/api/articles" ||
    c.req.path === "/api/articles/"
  ) {
    return next();
  }

  // ============================================================
  // RATE LIMITER - Applied before x402 payment check
  // Only counts unpaid requests (before payment verification)
  // Key = article path only (no IP address)
  // 100 requests per 60 seconds per article
  // ============================================================

  const id = c.req.param("id");
  const rateLimitKey = `/api/articles/${id}`;

  console.log("AGENTDATA_RATE_LIMITER_CHECK", { key: rateLimitKey });

  const result = await c.env.ARTICLE_RATE_LIMITER.limit({
    key: rateLimitKey,
  });

  console.log("AGENTDATA_RATE_LIMITER_RESULT", { success: result.success, key: rateLimitKey });

  if (!result.success) {
    console.warn("AGENTDATA_RATE_LIMITED", rateLimitKey);
    return c.json(
      {
        error: "Rate limit exceeded. Please slow down your requests.",
        retryAfter: 60,
      },
      429
    );
  }

  // ----------------------------------------------------------
  // x402 Payment Middleware
  // ----------------------------------------------------------

  if (!x402Initialized) {
    console.log("AGENTDATA_X402_INIT: starting");

    try {
      await resourceServer.initialize();

      x402Initialized = true;

      console.log("AGENTDATA_X402_INIT: success");
    } catch (error) {
      console.error(
        "AGENTDATA_X402_INIT: failed",
        error && error.stack ? error.stack : error
      );

      throw error;
    }
  }

  if (!dynamicRoutesCache) {
    dynamicRoutesCache =
      await buildDynamicRoutes(c.env);
  }

  const middleware = paymentMiddleware(
    dynamicRoutesCache,
    resourceServer,
    undefined,
    undefined,
    false
  );

  // IMPORTANT:
  // Return the middleware result so Hono receives
  // the Response generated by x402.
  return middleware(c, next);
});

// ============================================================
// ARTICLE DELIVERY
// ============================================================

app.get("/api/articles/:id", async (c) => {
  const id = c.req.param("id");

  // ----------------------------------------------------------
  // Load public catalogue
  // ----------------------------------------------------------

  const indexResponse = await c.env.ASSETS.fetch(
    new Request("https://internal/index.json")
  );

  if (!indexResponse.ok) {
    return c.json(
      {
        error: "Catalogue not found",
      },
      404
    );
  }

  let index;

  try {
    index = await indexResponse.json();
  } catch (error) {
    console.error(
      "AGENTDATA_CATALOGUE_PARSE_ERROR",
      error && error.stack ? error.stack : error
    );

    return c.json(
      {
        error: "Catalogue is invalid",
      },
      500
    );
  }

  if (!Array.isArray(index.articles)) {
    return c.json(
      {
        error: "Catalogue is invalid",
      },
      500
    );
  }

  // ----------------------------------------------------------
  // Find article
  // ----------------------------------------------------------

  const articleInfo = index.articles.find(
    (article) => article.id === id
  );

  if (!articleInfo) {
    return c.json(
      {
        error: "Article not found",
      },
      404
    );
  }

  // ----------------------------------------------------------
  // Retrieve premium content from private KV
  // ----------------------------------------------------------

  const content =
    await c.env.ARTICLE_CONTENT.get(id);

  if (content === null) {
    return c.json(
      {
        error: "Article content not found",
      },
      404
    );
  }

  // ----------------------------------------------------------
  // Return paid article
  // ----------------------------------------------------------

  return c.json({
    articleId: id,
    title: articleInfo.title,
    content,
  });
});

// ============================================================
// SERVICE ROOT
// ============================================================

app.get("/", (c) => {
  return c.json({
    service: "Agent Data Pro",
    status: "online",
    protocol: "x402",
  });
});

export default app;

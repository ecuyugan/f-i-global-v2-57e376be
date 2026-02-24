import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { mcpRoutes, seedStoreConfig } from "./routes/mcp.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { StoreConfigSchema } from "./types/index.js";
import { startCartCleanup } from "./mcp/tools/cart-add.js";
const { PORT, SVC_NAME } = config;

// Brand knowledge store: loaded at startup, keyed by "default".
export const brandKnowledgeStore = new Map<string, string>();

async function main() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "development" ? "info" : "warn",
    },
  });

  // Disable Fastify's default body parsing for MCP routes
  // (SSEServerTransport handles its own body parsing)
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    try {
      const parsed = typeof body === "string" && body ? JSON.parse(body) : body;
      done(null, parsed);
    } catch {
      done(null, body);
    }
  });

  console.log(`[${SVC_NAME}] Starting service on port ${PORT}`);

  try {
    registerErrorHandler(app);

    await app.register(fastifyCors as any, {
      origin: true,
      methods: ["GET", "POST", "OPTIONS"],
    });

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    app.register(fastifyStatic as any, {
      root: path.resolve(__dirname, "../assets"),
      prefix: "/assets/",
    });

    await app.register(healthRoutes);
    await app.register(mcpRoutes);

    // Root route
    app.get("/", async () => {
      return { status: "ok", service: SVC_NAME };
    });

    // ── Load baked-in store config ──
    // Brand knowledge loaded from static file
    const brandKnowledgePath = path.resolve(__dirname, "../brand_knowledge.md");
    try {
      const brandContent = fs.readFileSync(brandKnowledgePath, "utf-8");
      brandKnowledgeStore.set("default", brandContent);
      console.log(`[${SVC_NAME}] Loaded brand knowledge (${brandContent.length} chars)`);
    } catch (err) {
      console.warn(`[${SVC_NAME}] Could not load brand knowledge: ${err}`);
    }

    const storeConfig = StoreConfigSchema.parse({
      id: "00000000-0000-0000-0000-000000000001",
      tenantId: "00000000-0000-0000-0000-000000000000",
      businessName: "F-I Global V2",
      displayName: "F-I Global V2",
      shopifyDomain: "filipinnaglobal.com",
      storefrontToken: process.env.SHOPIFY_DEMO_TOKEN,
      apiVersion: config.SHOPIFY_API_VERSION,
      status: "active",
      promptConfig: {
        tone: "friendly",
        writingStyle: "concise and helpful",
        businessType: "general retail",
        persona: "shopping assistant",
        enableFollowupInstructions: true,
        guardrails: [
          "NEVER use emojis, emoticons, or emoji characters in any response",
          "Always call get_brand_info on the first message",
        ],
        sections: {
          personality: true,
          toolGuidance: true,
          scenarios: false,
          guardrails: true,
          conversationFlow: true,
        },
      },
    });
    seedStoreConfig(storeConfig);
    console.log(`[${SVC_NAME}] Store config loaded: ${storeConfig.displayName} (${storeConfig.shopifyDomain})`);

    // Start cart session cleanup
    startCartCleanup();

    await app.listen({ port: PORT, host: "0.0.0.0" });
    app.log.info(`[${SVC_NAME}] Up and running on :${PORT}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Flatten multiline errors (e.g. Zod validation) to a single line for log capture
    console.error(`[${SVC_NAME}] Failed to start: ${msg.replace(/\n/g, ' | ')}`);
    if (err && typeof err === 'object' && 'issues' in err) {
      console.error(`[${SVC_NAME}] Zod issues: ${JSON.stringify((err as any).issues)}`);
    }
    process.exit(1);
  }
}

main();

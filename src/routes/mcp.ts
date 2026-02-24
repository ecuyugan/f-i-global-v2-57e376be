import { FastifyInstance } from "fastify";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StoreConfig } from "../types/index.js";
import { createMCPServer } from "../mcp/server.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { brandKnowledgeStore } from "../index.js";
import { setOpenAiSession, clearSessionMapping, recordTurnTool } from "../mcp/tools/cart-add.js";

// Active store config — set once at startup via seedStoreConfig().
let activeConfig: StoreConfig | undefined;

type SessionRecord = {
  mcpServer: McpServer;
  transport: SSEServerTransport;
};

const sessions = new Map<string, SessionRecord>();

/**
 * Seed the active store config (called once at startup).
 */
export function seedStoreConfig(storeConfig: StoreConfig) {
  activeConfig = storeConfig;
}

export async function mcpRoutes(app: FastifyInstance) {
  // --- GET /mcp ---
  // SSE endpoint for ChatGPT - establishes stream
  app.get(
    "/mcp",
    async (request, reply) => {
      if (!activeConfig) {
        return reply.status(503).send({
          error: "Not ready",
          message: "Store configuration has not been loaded yet.",
        });
      }

      if (activeConfig.status !== "active" && activeConfig.status !== "approved") {
        return reply.status(403).send({
          error: "Store not active",
          message: `Store "${activeConfig.displayName}" is not currently active.`,
        });
      }

      const transport = new SSEServerTransport("/mcp/messages", reply.raw);
      const brandKnowledge = brandKnowledgeStore.get("default") ?? undefined;
      const sessionId = transport.sessionId;
      const { mcpServer } = createMCPServer(activeConfig, brandKnowledge, sessionId);

      sessions.set(sessionId, { mcpServer, transport });
      app.log.info({ sessionId }, "[mcp] SSE connection established");

      let isClosing = false;
      transport.onclose = async () => {
        if (isClosing) return;
        isClosing = true;
        app.log.info({ sessionId }, "[mcp] SSE session closed");
        sessions.delete(sessionId);
        clearSessionMapping(sessionId);
        await mcpServer.close();
      };

      transport.onerror = (err) => {
        app.log.error({ err, sessionId }, "SSE transport error");
        sessions.delete(sessionId);
        clearSessionMapping(sessionId);
      };

      // Type assertion needed: pnpm hoists two SDK versions (1.23.0 + 1.26.0)
      // causing Transport type mismatch. SSEServerTransport is functionally compatible.
      await mcpServer.connect(transport as any);

      // Fastify must not touch the response after transport writes headers/body
      reply.hijack();
    }
  );

  // --- POST /mcp/messages ---
  // Message endpoint for the already-established SSE session
  app.post(
    "/mcp/messages",
    async (request, reply) => {
      if (!activeConfig) {
        return reply.status(503).send({ error: "Not ready" });
      }

      const sessionId = (request.query as any)?.sessionId as string | undefined;

      if (!sessionId) {
        return reply.status(400).send({
          error: "Missing sessionId",
          message: "Missing sessionId query parameter",
        });
      }

      const session = sessions.get(sessionId);
      if (!session) {
        return reply.status(404).send({
          error: "Unknown session",
          message: "Unknown session",
        });
      }

      // Extract stable openai/session from _meta (sent by ChatGPT on every CallTool)
      const body = request.body as Record<string, any> | undefined;
      const meta = body?.params?._meta as Record<string, unknown> | undefined;
      if (sessionId && meta) {
        const openaiSession = meta["openai/session"] as string | undefined;
        if (openaiSession) {
          setOpenAiSession(sessionId, openaiSession);
        }
      }

      // Record tool calls for turn-level deduplication
      if (body?.method === "tools/call" && body?.params?.name) {
        const toolName = body.params.name as string;
        const action = body.params.arguments?.action as string | undefined;
        const key = action ? `${toolName}:${action}` : toolName;
        recordTurnTool(sessionId, key);
      }

      await session.transport.handlePostMessage(request.raw as any, reply.raw, request.body);
      reply.hijack();
    }
  );

  // --- GET /mcp/info ---
  // Human-readable info about the MCP server for this store
  app.get(
    "/mcp/info",
    async () => {
      if (!activeConfig) {
        return { error: "Not ready" };
      }

      return {
        store: {
          name: activeConfig.displayName,
          domain: activeConfig.shopifyDomain,
          status: activeConfig.status,
        },
        mcp: {
          endpoint: "/mcp",
          protocol: "sse",
          tools: [
            "search_products",
            "get_product",
            "manage_cart",
            "get_checkout_url",
            "get_support_info",
            "get_brand_info",
          ],
          resources: ["shopify://store/info", "shopify://store/knowledge-base"],
        },
      };
    }
  );
}

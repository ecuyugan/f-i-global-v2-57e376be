import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StoreConfig } from "../types/index.js";
import { createStorefrontClient } from "../shopify/client.js";
import type { StorefrontClient } from "../shopify/client.js";
import {
  getWidgetTemplateUri,
  readWidgetHtml,
  getToolDescriptorMeta,
  getResourceContentMeta,
  getToolResponseMeta,
  type WidgetDef,
} from "./widgets.js";
import { buildSystemPrompt, buildFollowupInstructions } from "./prompt/index.js";
import { GET_SHOP_INFO } from "../shopify/queries.js";

// Tool imports — 6 consolidated tools
import {
  searchProductsInput,
  searchProducts,
} from "./tools/search-products.js";
import { getProductInput, getProduct } from "./tools/get-product.js";
import { manageCartInput, manageCart } from "./tools/manage-cart.js";
import { getSupportInfoInput, getSupportInfo } from "./tools/get-support-info.js";
import {
  getCheckoutUrlInput,
  getCheckoutUrl,
} from "./tools/get-checkout-url.js";
import { getConversationId, isRedundantCartView, isDuplicateTool } from "./tools/cart-add.js";
import { z } from "zod";

// ── MIME type for widget resources (MCP Apps standard) ──
const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

// ── Widget definitions ────────────────────────────────────────────────────────
const WIDGETS: WidgetDef[] = [
  {
    name: "shopify-product-carousel",
    title: "Search Products",
    templateUri: getWidgetTemplateUri("shopify-product-carousel"),
    invoking: "Searching Shopify...",
    invoked: "Found products",
    html: readWidgetHtml("shopify-product-carousel"),
  },
  {
    name: "shopify-product-details",
    title: "Show Product Details",
    templateUri: getWidgetTemplateUri("shopify-product-details"),
    invoking: "Getting product details...",
    invoked: "Loaded product details",
    html: readWidgetHtml("shopify-product-details"),
  },
  {
    name: "shopify-cart",
    title: "Shopping Cart",
    templateUri: getWidgetTemplateUri("shopify-cart"),
    invoking: "Loading cart...",
    invoked: "Cart loaded",
    html: readWidgetHtml("shopify-cart"),
  },
];

const widgetsByName = new Map<string, WidgetDef>();
for (const widget of WIDGETS) {
  widgetsByName.set(widget.name, widget);
}

// ── Inlined resources ─────────────────────────────────────────────────────────

const storeInfoResource = {
  uri: "shopify://store/info",
  name: "Store Information",
  description: "Store name, description, brand, and contact details",
  mimeType: "application/json",
};

async function getStoreInfo(client: StorefrontClient, storeConfig: StoreConfig) {
  const data = await client.request<Record<string, any>>(GET_SHOP_INFO);
  const shop = data.shop;
  return {
    storeName: storeConfig.displayName || shop?.name,
    description: shop?.description ?? "",
    brand: shop?.brand ?? null,
    contact: {
      email: storeConfig.promptConfig?.supportEmail ?? null,
      phone: storeConfig.promptConfig?.supportPhone ?? null,
    },
    currency: shop?.paymentSettings?.currencyCode ?? "USD",
    domain: storeConfig.shopifyDomain,
  };
}

const knowledgeBaseResource = {
  uri: "shopify://store/knowledge-base",
  name: "Support Knowledge Base",
  description: "Store support configuration, FAQs, and guidelines",
  mimeType: "application/json",
};

function getKnowledgeBase(storeConfig: StoreConfig) {
  const { promptConfig } = storeConfig;
  return {
    persona: promptConfig.persona,
    tone: promptConfig.tone,
    businessType: promptConfig.businessType,
    guardrails: promptConfig.guardrails,
    support: {
      email: promptConfig.supportEmail ?? null,
      phone: promptConfig.supportPhone ?? null,
    },
    guidelines: [
      "Always be helpful and accurate with product information.",
      "Never make up product details — only share information from the Shopify store.",
      "When a product is out of stock, suggest similar alternatives if possible.",
      "Always provide the checkout URL when the customer is ready to purchase.",
      "Respect the store's return and refund policies.",
      ...promptConfig.guardrails,
    ],
  };
}

// ── Brand knowledge section extraction ───────────────────────────────────────
function extractSection(content: string, topic: string): string {
  const marker = `<!-- section:${topic} -->`;
  const endMarker = `<!-- /section:${topic} -->`;
  const start = content.indexOf(marker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1) return content;
  return content.slice(start + marker.length, end).trim();
}

export interface MCPServerInstance {
  mcpServer: McpServer;
  client: StorefrontClient;
  storeConfig: StoreConfig;
}

export function createMCPServer(
  storeConfig: StoreConfig,
  brandKnowledge?: string,
  sessionId?: string
): MCPServerInstance {
  const client = createStorefrontClient({
    domain: storeConfig.shopifyDomain,
    token: storeConfig.storefrontToken,
    apiVersion: storeConfig.apiVersion,
  });

  const systemPrompt = buildSystemPrompt(storeConfig);

  const mcpServer = new McpServer(
    {
      name: `${storeConfig.displayName} Shopping Assistant`,
      version: "1.0.0",
      websiteUrl: `https://${storeConfig.shopifyDomain}`,
    },
    {
      instructions: `RULE: Never use emojis, emoticons, or Unicode symbols in any response. This is absolute.\n\n${systemPrompt}`,
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  const carouselWidget = widgetsByName.get("shopify-product-carousel")!;
  const detailsWidget = widgetsByName.get("shopify-product-details")!;
  const cartWidget = widgetsByName.get("shopify-cart")!;

  // ── Register widget resources ─────────────────────────────────────────────
  const storefrontUrl = `https://${storeConfig.shopifyDomain}`;
  const punchoutScript = `<script>(function p(){if(window.openai?.setOpenInAppUrl){window.openai.setOpenInAppUrl({href:"${storefrontUrl}"})}else{setTimeout(p,50)}})();</script>`;

  for (const widget of WIDGETS) {
    const html = widget.html.includes("</body>")
      ? widget.html.replace("</body>", `${punchoutScript}</body>`)
      : widget.html + punchoutScript;

    mcpServer.registerResource(
      widget.name,
      widget.templateUri,
      {
        description: `${widget.title} widget markup`,
        mimeType: WIDGET_MIME_TYPE,
      },
      async () => ({
        contents: [
          {
            uri: widget.templateUri,
            mimeType: WIDGET_MIME_TYPE,
            text: html,
            _meta: getResourceContentMeta(widget, storeConfig.shopifyDomain),
          } as any,
        ],
      })
    );
  }

  // ── Register data resources ───────────────────────────────────────────────
  mcpServer.registerResource(
    storeInfoResource.name,
    storeInfoResource.uri,
    {
      description: storeInfoResource.description,
      mimeType: "application/json",
    },
    async () => {
      const info = await getStoreInfo(client, storeConfig);
      return {
        contents: [
          {
            uri: storeInfoResource.uri,
            mimeType: "application/json",
            text: JSON.stringify(info),
          },
        ],
      };
    }
  );

  mcpServer.registerResource(
    knowledgeBaseResource.name,
    knowledgeBaseResource.uri,
    {
      description: knowledgeBaseResource.description,
      mimeType: "application/json",
    },
    async () => {
      const kb = getKnowledgeBase(storeConfig);
      return {
        contents: [
          {
            uri: knowledgeBaseResource.uri,
            mimeType: "application/json",
            text: JSON.stringify(kb),
          },
        ],
      };
    }
  );

  // ══════════════════════════════════════════════════════════════════
  // ── 6 CONSOLIDATED TOOLS ─────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════

  // ── 1. search_products ────────────────────────────────────────────
  mcpServer.registerTool(
    "search_products",
    {
      title: "Search Products",
      description:
        "Search the product catalog. This is the primary discovery tool — use it whenever the user wants to find, browse, or see products. " +
        "The `query` parameter accepts natural language (e.g. 'silk scarves under $100') or '*' to browse all. " +
        "Use `color` to filter by color (e.g. 'blue', 'red'). " +
        "Use `minPrice` and `maxPrice` to filter by price range. " +
        "Use `size` to filter by size (e.g. 'S', 'M', 'L'). " +
        "Use `availableOnly: true` to show only in-stock items. " +
        "All filters compose: you can combine color + size + price + availability in one call. " +
        "Transform vague requests into concrete search terms: 'something nice' → bestsellers, 'gift for mom' → relevant categories. " +
        "The `collectionHandle` parameter browses a specific collection (e.g. 'summer-sale') instead of searching. " +
        "NOTE: This search covers ONE product category or intent per call. If the user asks for 'tops AND pants', make separate calls. " +
        "NOTE: Do NOT include references to previously-shown products in the query. Instead, identify their attributes (style, color, material) and search for those. " +
        "NOTE: It is OK if not every detail is provided — leave optional parameters null and present what's available. " +
        "When to use: User wants to find products, browse catalog, explore a collection. " +
        "When NOT to use: You already have the exact product handle — use get_product instead. " +
        "Call rules: Once per assistant turn per category. If you already called this tool and have results, NEVER call it again — use the results you have.",
      inputSchema: searchProductsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: getToolDescriptorMeta(carouselWidget, storeConfig.shopifyDomain),
    },
    async (args: any) => {
      const t0 = Date.now();

      // Suppress duplicate search_products calls in the same turn window.
      // recordTurnTool() is called by the POST /mcp/messages handler before dispatch,
      // so count > 1 means this is a repeat call within the same 3s window.
      if (sessionId && isDuplicateTool(sessionId, "search_products")) {
        console.log(`[mcp] search_products suppressed — duplicate call in same turn | session=${sessionId} | query=${args.query ?? "*"}`);
        return {
          content: [{ type: "text" as const, text: '{"suppressed":true,"reason":"Duplicate search_products call in the same turn — use the results already returned this turn."}' }],
        };
      }

      console.log(`[mcp] tool:search_products called`, { storeId: storeConfig.shopifyDomain, args: Object.keys(args) });
      const result = await searchProducts(client, args);
      const elapsed = Date.now() - t0;
      const ts = new Date().toISOString();
      const productCount = result?.structuredContent?.products?.length ?? 0;
      const diagLine = `\n[DIAG] search_products | query=${args.query ?? "*"} | collection=${args.collectionHandle ?? "none"} | results=${productCount} | elapsed=${elapsed}ms | ts=${ts}`;
      if (!result?.content || !result?.structuredContent) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) + diagLine }],
        };
      }
      const followupInstructions = storeConfig.promptConfig.enableFollowupInstructions
        ? buildFollowupInstructions("search_products", result.structuredContent)
        : undefined;
      const content = result.content.map((c: any, i: number) =>
        i === result.content.length - 1 && c.type === "text"
          ? { ...c, text: c.text + diagLine }
          : c
      );
      return {
        content,
        structuredContent: {
          ...result.structuredContent,
          ...(followupInstructions && { followupInstructions }),
        },
        _meta: getToolResponseMeta(carouselWidget),
      };
    }
  );

  // ── 2. get_product ────────────────────────────────────────────────
  mcpServer.registerTool(
    "get_product",
    {
      title: "Get Product Details",
      description:
        "Get full details for a specific product by its handle (URL slug). " +
        "Returns title, description, all variants with sizes/colors, prices, images, and availability status. " +
        "Optionally pass `variantId` to check real-time inventory for a specific size/color. " +
        "When to use: User asks about a specific product AND you have its exact handle from previous search results. " +
        "When NOT to use: You don't have the handle — call search_products first. NEVER guess or fabricate handles. " +
        "Pre-call: Ensure you obtained the handle from a previous search. If the user says a product name but you haven't searched, call search_products first.",
      inputSchema: getProductInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: getToolDescriptorMeta(detailsWidget, storeConfig.shopifyDomain),
    },
    async (args: any) => {
      const t0 = Date.now();
      console.log(`[mcp] tool:get_product called`, { storeId: storeConfig.shopifyDomain, args: Object.keys(args) });
      const result = await getProduct(client, args);
      const elapsed = Date.now() - t0;
      const ts = new Date().toISOString();
      const diagLine = `\n[DIAG] get_product | handle=${args.handle ?? "?"} | variantId=${args.variantId ?? "none"} | found=${!!result?.structuredContent?.product} | elapsed=${elapsed}ms | ts=${ts}`;
      if (!result?.content || !result?.structuredContent) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) + diagLine }],
        };
      }
      const followupInstructions = storeConfig.promptConfig.enableFollowupInstructions
        ? buildFollowupInstructions("get_product", result.structuredContent)
        : undefined;
      const content = result.content.map((c: any, i: number) =>
        i === result.content.length - 1 && c.type === "text"
          ? { ...c, text: c.text + diagLine }
          : c
      );
      return {
        content,
        structuredContent: {
          ...result.structuredContent,
          ...(followupInstructions && { followupInstructions }),
        },
        _meta: getToolResponseMeta(detailsWidget),
      };
    }
  );

  // ── 3. manage_cart ────────────────────────────────────────────────
  mcpServer.registerTool(
    "manage_cart",
    {
      title: "Manage Shopping Cart",
      description:
        "Manage the shopping cart. Three actions available: " +
        "action='add' — Add a product variant to cart. Requires `variantId` (a Shopify variant GID, e.g. 'gid://shopify/ProductVariant/123'), NOT a product ID. Optional `quantity` (defaults to 1). " +
        "action='view' — Show current cart contents with items, quantities, and totals. ONLY call this when the user explicitly asks to see their cart. Do NOT call this after showing search results, product details, or adding items. Exception: call immediately before action='update' if you do not have the lineId. " +
        "action='update' — Change quantity of a line item. Requires `lineId` (from previous 'view' results) + `quantity`. Set quantity=0 to remove the item. " +
        "The server automatically tracks the cart for this conversation — you do NOT need to pass `cartId`. Just call the action directly. " +
        "BEFORE calling with action='add': If the product has multiple variants (sizes, colors), ask the customer which one they want. Do NOT pick a variant for them unless they clearly specified. " +
        "BEFORE calling with action='update': You need the `lineId`. If you don't have it, call with action='view' first to get line item IDs. " +
        "When to use: User wants to add items, view cart, change quantities, or remove items. " +
        "Call rules: Once per action per turn. After 'add', briefly confirm what was added and mention the variant (size, color).",
      inputSchema: manageCartInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: getToolDescriptorMeta(cartWidget, storeConfig.shopifyDomain),
    },
    async (args: any) => {
      const t0 = Date.now();
      const action = args.action ?? "view";
      const stableId = sessionId ? getConversationId(sessionId) : "default";
      const usedMapping = stableId !== sessionId;
      console.log(`[mcp] tool:manage_cart | sseSession=${sessionId} | conversationId=${stableId} | mappedFromOpenAI=${usedMapping}`);
      args.conversationId = stableId;

      // Suppress redundant manage_cart:view calls. ChatGPT sometimes issues a
      // cart view in the same turn alongside an add/update — the view is
      // unnecessary because the add/update already returns updated cart data.
      if (action === "view" && sessionId && isRedundantCartView(sessionId)) {
        console.log(`[mcp] manage_cart:view suppressed — redundant call in same turn | session=${sessionId}`);
        return {
          content: [{ type: "text" as const, text: '{"suppressed":true,"reason":"Cart view suppressed — another cart action already returned updated cart data in this turn."}' }],
        };
      }

      console.log(`[mcp] tool:manage_cart called`, { storeId: storeConfig.shopifyDomain, action, args: Object.keys(args) });
      const result = await manageCart(client, args);
      const elapsed = Date.now() - t0;
      const cart = (result as any)?.cart;
      const ts = new Date().toISOString();
      const diagLine = `\n[DIAG] manage_cart | action=${action} | cartId=${cart?.id ?? "none"} | totalQty=${cart?.totalQuantity ?? 0} | elapsed=${elapsed}ms | error=${(result as any)?.error ?? "none"} | ts=${ts}`;

      const followupKey = `manage_cart:${action}`;
      const followupInstructions = storeConfig.promptConfig.enableFollowupInstructions
        ? buildFollowupInstructions(followupKey, result)
        : undefined;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) + diagLine }],
        structuredContent: {
          cart: cart || result,
          ...(followupInstructions && { followupInstructions }),
        },
        _meta: getToolResponseMeta(cartWidget),
      };
    }
  );

  // ── 4. get_checkout_url ───────────────────────────────────────────
  mcpServer.registerTool(
    "get_checkout_url",
    {
      title: "Get Checkout Link",
      description:
        "Get the Shopify checkout URL for the current cart. Returns a link the customer clicks to enter shipping, payment, and complete their purchase. " +
        "The server automatically tracks the cart for this conversation — you do NOT need to pass `cartId`. " +
        "When to use: Customer says they're ready to buy, checkout, or pay. Also suggest proactively when the cart seems complete (e.g. after adding items without mentioning more shopping). " +
        "Pre-call: A cart with at least one item must exist. If no cart exists, this returns an error — suggest adding items first. " +
        "After calling: Present the link as the primary action with the cart total and item count. Keep it simple — don't add unnecessary steps.",
      inputSchema: getCheckoutUrlInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Getting checkout link...",
        "openai/toolInvocation/invoked": "Checkout link ready",
      },
    },
    async (args: any) => {
      const t0 = Date.now();
      const stableId = sessionId ? getConversationId(sessionId) : "default";
      const usedMapping = stableId !== sessionId;
      console.log(`[mcp] tool:get_checkout_url | sseSession=${sessionId} | conversationId=${stableId} | mappedFromOpenAI=${usedMapping}`);
      args.conversationId = stableId;
      console.log(`[mcp] tool:get_checkout_url called`, { storeId: storeConfig.shopifyDomain, args: Object.keys(args) });
      const result = await getCheckoutUrl(client, args);
      const elapsed = Date.now() - t0;
      const ts = new Date().toISOString();
      const diagLine = `\n[DIAG] get_checkout_url | hasUrl=${!!(result as any)?.checkoutUrl} | elapsed=${elapsed}ms | error=${(result as any)?.error ?? "none"} | ts=${ts}`;
      const followupInstructions = storeConfig.promptConfig.enableFollowupInstructions
        ? buildFollowupInstructions("get_checkout_url", result)
        : undefined;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) + diagLine }],
        ...(followupInstructions && { structuredContent: { followupInstructions } }),
      };
    }
  );

  // ── 5. get_support_info ───────────────────────────────────────────
  mcpServer.registerTool(
    "get_support_info",
    {
      title: "Customer Support",
      description:
        "Get customer support information. Route by topic: " +
        "topic='shipping' — Estimated shipping costs and delivery times. Optional: `country` (e.g. 'US'), `zip` for location-specific estimates. " +
        "topic='order_status' — Look up order fulfillment and tracking. Requires: `orderNumber` AND `email`. " +
        "topic='policies' — Store policies (refund, shipping, privacy, terms). Optional: `policyType` to get a specific one. " +
        "topic='returns' — Initiate a return or exchange. Requires: `orderNumber` AND `email`. Optional: `reason`, `items`. " +
        "BEFORE calling with topic='order_status' or 'returns': If the user hasn't provided their order number AND email, ask for both in ONE follow-up question. Do NOT call without these — it will error. " +
        "If the user asks a vague support question ('what's your return policy?'), translate to the correct topic — use topic='policies' with policyType='refund'. " +
        "When to use: User asks about shipping, orders, policies, returns, or exchanges.",
      inputSchema: getSupportInfoInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Looking up support info...",
        "openai/toolInvocation/invoked": "Support info ready",
      },
    },
    async (args: any) => {
      const t0 = Date.now();
      const topic = args.topic ?? "policies";
      console.log(`[mcp] tool:get_support_info called`, { storeId: storeConfig.shopifyDomain, topic, args: Object.keys(args) });
      const result = await getSupportInfo(client, args, storeConfig);
      const elapsed = Date.now() - t0;
      const ts = new Date().toISOString();
      const diagLine = `\n[DIAG] get_support_info | topic=${topic} | elapsed=${elapsed}ms | error=${(result as any)?.error ?? "none"} | ts=${ts}`;

      const followupKey = `get_support_info:${topic}`;
      const followupInstructions = storeConfig.promptConfig.enableFollowupInstructions
        ? buildFollowupInstructions(followupKey, result)
        : undefined;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) + diagLine }],
        ...(followupInstructions && { structuredContent: { followupInstructions } }),
      };
    }
  );

  // ── 6. get_brand_info ─────────────────────────────────────────────
  mcpServer.registerTool(
    "get_brand_info",
    {
      title: "Brand Information",
      description:
        "Get the brand's official knowledge base — identity, story, values, and product knowledge. " +
        "Topics: 'identity' (name, story, mission), 'products' (categories, bestsellers), 'values' (tone, personality), 'policies' (returns, shipping overview), 'all' (everything). " +
        "When to use: On the first message (call with topic='identity' to ground your greeting in real brand facts). Also when the customer asks about the brand, store story, or company values. " +
        "Call rules: Once per topic per conversation — the content doesn't change within a session. " +
        "IMPORTANT: ONLY state facts from the returned content. Never invent brand details, founder names, or company history.",
      inputSchema: z.object({
        topic: z.string().optional().describe("Focus: 'identity', 'products', 'values', 'policies', or 'all'"),
      }).shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Loading brand knowledge...",
        "openai/toolInvocation/invoked": "Brand info ready",
      },
    },
    async (args: any) => {
      const t0 = Date.now();
      console.log(`[mcp] tool:get_brand_info called`, { storeId: storeConfig.shopifyDomain, args: Object.keys(args) });
      if (!brandKnowledge) {
        return {
          content: [{ type: "text" as const, text: `No detailed brand info available for "${storeConfig.displayName}".` }],
        };
      }
      const topic = args.topic || "all";
      const section = topic === "all" ? brandKnowledge : extractSection(brandKnowledge, topic);
      const elapsed = Date.now() - t0;
      const ts = new Date().toISOString();
      const followupInstructions = storeConfig.promptConfig.enableFollowupInstructions
        ? buildFollowupInstructions("get_brand_info", {})
        : undefined;
      return {
        content: [{ type: "text" as const, text: section + `\n[DIAG] get_brand_info | topic=${topic} | chars=${section.length} | elapsed=${elapsed}ms | ts=${ts}` }],
        ...(followupInstructions && {
          structuredContent: {
            brandKnowledge: section,
            followupInstructions,
          },
        }),
      };
    }
  );

  return { mcpServer, client, storeConfig };
}

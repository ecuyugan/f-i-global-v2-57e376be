import { z } from "zod";
import type { StorefrontClient } from "../../shopify/client.js";
import { CART_CREATE, CART_LINES_ADD } from "../../shopify/mutations.js";
import type { Cart, CartLine, UserError } from "../../types/index.js";

// ── Inlined helpers from shopify/types.ts ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenEdges(connection: any): any[] {
  return connection?.edges?.map((e: any) => e.node) ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCartLine(raw: any): CartLine {
  return {
    id: raw.id,
    quantity: raw.quantity,
    merchandise: raw.merchandise,
    cost: raw.cost,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCart(raw: any): Cart {
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    totalQuantity: raw.totalQuantity,
    cost: raw.cost,
    lines: flattenEdges(raw.lines).map(parseCartLine),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseUserErrors(errors: any[] | undefined): UserError[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((e) => ({
    field: e.field ?? null,
    message: e.message,
    code: e.code,
  }));
}

// ── Cart session store ────────────────────────────────────────────────────────

// In-memory cart store: conversationId -> { cartId, lastAccessed }
const cartStore = new Map<string, { cartId: string; lastAccessed: number }>();

// Maps ephemeral SSE sessionId → stable openai/session conversation ID.
const sessionMapping = new Map<string, string>();

/** Store the openai/session for an SSE session. Called from route handler. */
export function setOpenAiSession(sseSessionId: string, openaiSession: string): void {
  sessionMapping.set(sseSessionId, openaiSession);
}

/** Get the stable conversation ID for a given SSE session. */
export function getConversationId(sseSessionId: string): string {
  return sessionMapping.get(sseSessionId) ?? sseSessionId;
}

/** Clean up mapping when SSE session closes. */
export function clearSessionMapping(sseSessionId: string): void {
  sessionMapping.delete(sseSessionId);
  clearTurnTracker(sseSessionId);
}

// ── Turn tracker ──────────────────────────────────────────────────────────────
// Tracks which tools have been called within the current conversational turn
// (time window) per session. Used to suppress redundant manage_cart:view calls.

const TURN_WINDOW_MS = 3000;
const turnTracker = new Map<string, { tools: Set<string>; timer: ReturnType<typeof setTimeout> }>();

export function recordTurnTool(sseSessionId: string, toolName: string): void {
  const existing = turnTracker.get(sseSessionId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.tools.add(toolName);
    existing.timer = setTimeout(() => turnTracker.delete(sseSessionId), TURN_WINDOW_MS);
  } else {
    const timer = setTimeout(() => turnTracker.delete(sseSessionId), TURN_WINDOW_MS);
    turnTracker.set(sseSessionId, { tools: new Set([toolName]), timer });
  }
}

export function isRedundantCartView(sseSessionId: string): boolean {
  const tracker = turnTracker.get(sseSessionId);
  if (!tracker) return false;
  for (const name of tracker.tools) {
    if (name !== "manage_cart:view") return true;
  }
  return false;
}

function clearTurnTracker(sseSessionId: string): void {
  const existing = turnTracker.get(sseSessionId);
  if (existing) {
    clearTimeout(existing.timer);
    turnTracker.delete(sseSessionId);
  }
}

const CART_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function getCartStore() {
  return cartStore;
}

/**
 * Start periodic cleanup of expired cart entries.
 * Call once at server startup.
 */
export function startCartCleanup() {
  setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of cartStore) {
      if (now - entry.lastAccessed > CART_TTL_MS) {
        cartStore.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      console.log(`[cart-cleanup] Removed ${removed} expired cart(s), ${cartStore.size} remaining`);
    }
  }, CLEANUP_INTERVAL_MS);
}

export const cartAddInput = z.object({
  variantId: z
    .string()
    .describe("Shopify variant GID to add, e.g. 'gid://shopify/ProductVariant/123'"),
  quantity: z.number().int().min(1).default(1).describe("Quantity to add"),
  cartId: z
    .string()
    .optional()
    .describe("Shopify cart GID from a previous cart response"),
  conversationId: z
    .string()
    .default("default")
    .describe("Conversation/session ID for cart association"),
});

/**
 * Resolve a cart ID from explicit arg or session fallback.
 * Tier 1: explicit cartId from client (widget or LLM)
 * Tier 2: session-key fallback (stable via openai/session mapping)
 */
export function resolveCartId(args: { cartId?: string; conversationId: string }): string | null {
  if (args.cartId) return args.cartId;
  const entry = cartStore.get(args.conversationId);
  if (entry) { entry.lastAccessed = Date.now(); return entry.cartId; }
  return null;
}

/**
 * Store a cartId under the session key.
 */
export function storeCartId(cartId: string, conversationId: string): void {
  cartStore.set(conversationId, { cartId, lastAccessed: Date.now() });
}

export const cartAddDef = {
  name: "cart_add",
  description:
    "Add a product variant to the shopping cart. Creates a new cart if one doesn't exist for this conversation. Returns the updated cart with all items and the checkout URL.",
  inputSchema: {
    type: "object" as const,
    properties: {
      variantId: { type: "string", description: "Shopify variant GID" },
      quantity: { type: "number", description: "Quantity to add (default 1)" },
      conversationId: { type: "string", description: "Conversation/session ID" },
    },
    required: ["variantId"],
  },
};

export async function cartAdd(
  client: StorefrontClient,
  input: z.infer<typeof cartAddInput>
) {
  const parsed = cartAddInput.parse(input);
  const existingCartId = resolveCartId(parsed);

  if (existingCartId) {
    let data: Record<string, any>;
    try {
      data = await client.request<Record<string, any>>(CART_LINES_ADD, {
        cartId: existingCartId,
        lines: [{ merchandiseId: parsed.variantId, quantity: parsed.quantity }],
      });
    } catch {
      return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now. Please try again." };
    }

    const errors = parseUserErrors(data.cartLinesAdd?.userErrors);
    if (errors.length > 0) {
      cartStore.delete(parsed.conversationId);
      return createNewCart(client, parsed);
    }

    return {
      source: "storefront_api" as const,
      cart: parseCart(data.cartLinesAdd.cart),
    };
  }

  return createNewCart(client, parsed);
}

async function createNewCart(
  client: StorefrontClient,
  parsed: z.infer<typeof cartAddInput>
) {
  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(CART_CREATE, {
      input: {
        lines: [{ merchandiseId: parsed.variantId, quantity: parsed.quantity }],
      },
    });
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now. Please try again." };
  }

  const errors = parseUserErrors(data.cartCreate?.userErrors);
  if (errors.length > 0) {
    return {
      source: "storefront_api" as const,
      error: "Failed to create cart",
      userErrors: errors,
    };
  }

  const cart = parseCart(data.cartCreate.cart);
  storeCartId(cart.id, parsed.conversationId);
  return {
    source: "storefront_api" as const,
    cart,
  };
}

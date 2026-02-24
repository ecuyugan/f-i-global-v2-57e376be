import { z } from "zod";
import type { StorefrontClient } from "../../shopify/client.js";
import { CART_LINES_UPDATE, CART_LINES_REMOVE } from "../../shopify/mutations.js";
import { cartAdd, parseCart, parseUserErrors, resolveCartId, isRedundantCartView } from "./cart-add.js";

// ── Inlined cartView ──────────────────────────────────────────────────────────

const CART_QUERY = /* GraphQL */ `
  query GetCart($cartId: ID!) {
    cart(id: $cartId) {
      id
      checkoutUrl
      totalQuantity
      createdAt
      updatedAt
      cost {
        subtotalAmount { amount currencyCode }
        totalAmount { amount currencyCode }
        totalTaxAmount { amount currencyCode }
      }
      lines(first: 50) {
        edges {
          node {
            id
            quantity
            merchandise {
              ... on ProductVariant {
                id
                title
                product { title handle }
                price { amount currencyCode }
                image { url altText }
                selectedOptions { name value }
              }
            }
            cost {
              totalAmount { amount currencyCode }
              amountPerQuantity { amount currencyCode }
              compareAtAmountPerQuantity { amount currencyCode }
            }
          }
        }
      }
    }
  }
`;

async function cartView(
  client: StorefrontClient,
  input: { cartId?: string; conversationId: string }
) {
  const cartId = resolveCartId(input);

  if (!cartId) {
    return {
      source: "storefront_api" as const,
      cart: null,
      message: "No cart exists yet. Add items to create one.",
    };
  }

  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(CART_QUERY, { cartId });
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now." };
  }

  if (!data.cart) {
    return {
      source: "storefront_api" as const,
      cart: null,
      message: "Cart expired. Add items to create a new one.",
    };
  }

  return {
    source: "storefront_api" as const,
    cart: parseCart(data.cart),
  };
}

// ── Inlined cartUpdate ────────────────────────────────────────────────────────

async function cartUpdate(
  client: StorefrontClient,
  input: { lineId: string; quantity: number; cartId?: string; conversationId: string }
) {
  const cartId = resolveCartId(input);

  if (!cartId) {
    return {
      source: "storefront_api" as const,
      error: "No cart exists. Add items first.",
    };
  }

  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(CART_LINES_UPDATE, {
      cartId,
      lines: [{ id: input.lineId, quantity: input.quantity }],
    });
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now." };
  }

  const errors = parseUserErrors(data.cartLinesUpdate?.userErrors);
  if (errors.length > 0) {
    return {
      source: "storefront_api" as const,
      error: "Failed to update cart",
      userErrors: errors,
    };
  }

  return {
    source: "storefront_api" as const,
    cart: parseCart(data.cartLinesUpdate.cart),
  };
}

// ── Inlined cartRemove ────────────────────────────────────────────────────────

async function cartRemove(
  client: StorefrontClient,
  input: { lineIds: string[]; cartId?: string; conversationId: string }
) {
  const cartId = resolveCartId(input);

  if (!cartId) {
    return {
      source: "storefront_api" as const,
      error: "No cart exists. Nothing to remove.",
    };
  }

  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(CART_LINES_REMOVE, {
      cartId,
      lineIds: input.lineIds,
    });
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now." };
  }

  const errors = parseUserErrors(data.cartLinesRemove?.userErrors);
  if (errors.length > 0) {
    return {
      source: "storefront_api" as const,
      error: "Failed to remove items from cart",
      userErrors: errors,
    };
  }

  return {
    source: "storefront_api" as const,
    cart: parseCart(data.cartLinesRemove.cart),
  };
}

// ── manage_cart dispatcher ────────────────────────────────────────────────────

export const manageCartInput = z.object({
  action: z
    .enum(["add", "view", "update"])
    .describe(
      "Cart action: 'add' = add a variant to cart, 'view' = show cart contents, 'update' = change quantity (set quantity=0 to remove)"
    ),
  variantId: z
    .string()
    .optional()
    .describe("Shopify variant GID (required for action='add'), e.g. 'gid://shopify/ProductVariant/123'"),
  quantity: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Quantity: for 'add' defaults to 1, for 'update' set to 0 to remove the item"),
  lineId: z
    .string()
    .optional()
    .describe("Cart line item ID (required for action='update'), from previous cart_view results"),
  cartId: z
    .string()
    .optional()
    .describe("Shopify cart GID from a previous cart response (e.g. 'gid://shopify/Cart/...'). Pass this to operate on an existing cart."),
  conversationId: z
    .string()
    .default("default")
    .describe("Conversation/session ID for cart association"),
});

export async function manageCart(
  client: StorefrontClient,
  input: z.infer<typeof manageCartInput>
) {
  const parsed = manageCartInput.parse(input);

  switch (parsed.action) {
    case "add": {
      if (!parsed.variantId) {
        return {
          source: "storefront_api" as const,
          error: "variantId is required for action='add'",
        };
      }
      return cartAdd(client, {
        variantId: parsed.variantId,
        quantity: parsed.quantity ?? 1,
        cartId: parsed.cartId,
        conversationId: parsed.conversationId,
      });
    }

    case "view": {
      if (isRedundantCartView(parsed.conversationId)) {
        return { source: "storefront_api" as const, cart: null, suppressed: true };
      }
      return cartView(client, {
        cartId: parsed.cartId,
        conversationId: parsed.conversationId,
      });
    }

    case "update": {
      if (!parsed.lineId) {
        return {
          source: "storefront_api" as const,
          error: "lineId is required for action='update'",
        };
      }
      const quantity = parsed.quantity ?? 1;
      if (quantity === 0) {
        return cartRemove(client, {
          lineIds: [parsed.lineId],
          cartId: parsed.cartId,
          conversationId: parsed.conversationId,
        });
      }
      return cartUpdate(client, {
        lineId: parsed.lineId,
        quantity,
        cartId: parsed.cartId,
        conversationId: parsed.conversationId,
      });
    }

    default:
      return {
        source: "storefront_api" as const,
        error: `Unknown action: ${parsed.action}`,
      };
  }
}

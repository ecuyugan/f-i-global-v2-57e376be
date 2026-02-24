import { z } from "zod";
import type { StorefrontClient } from "../../shopify/client.js";
import { resolveCartId } from "./cart-add.js";

export const getCheckoutUrlInput = z.object({
  cartId: z
    .string()
    .optional()
    .describe("Shopify cart GID from a previous cart response"),
  conversationId: z
    .string()
    .default("default")
    .describe("Conversation/session ID"),
});

export const getCheckoutUrlDef = {
  name: "get_checkout_url",
  description:
    "Get the Shopify checkout URL for the current cart. The customer can use this link to complete their purchase with shipping and payment.",
  inputSchema: {
    type: "object" as const,
    properties: {
      conversationId: { type: "string", description: "Conversation/session ID" },
    },
    required: [],
  },
};

const CART_CHECKOUT_QUERY = /* GraphQL */ `
  query GetCartCheckout($cartId: ID!) {
    cart(id: $cartId) {
      id
      checkoutUrl
      totalQuantity
      cost {
        totalAmount { amount currencyCode }
      }
    }
  }
`;

export async function getCheckoutUrl(
  client: StorefrontClient,
  input: z.infer<typeof getCheckoutUrlInput>
) {
  const parsed = getCheckoutUrlInput.parse(input);
  const cartId = resolveCartId(parsed);

  if (!cartId) {
    return {
      source: "storefront_api" as const,
      error: "No cart exists. Add items before checking out.",
      checkoutUrl: null,
    };
  }

  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(CART_CHECKOUT_QUERY, { cartId });
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now. Please try again.", checkoutUrl: null };
  }

  if (!data.cart) {
    return {
      source: "storefront_api" as const,
      error: "Cart expired. Please add items again.",
      checkoutUrl: null,
    };
  }

  return {
    source: "storefront_api" as const,
    checkoutUrl: data.cart.checkoutUrl,
    totalQuantity: data.cart.totalQuantity,
    totalAmount: data.cart.cost?.totalAmount,
  };
}

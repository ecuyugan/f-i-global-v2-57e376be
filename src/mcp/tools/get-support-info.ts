import { z } from "zod";
import type { StorefrontClient } from "../../shopify/client.js";
import type { StoreConfig } from "../../types/index.js";
import { GET_SHOP_POLICIES } from "../../shopify/queries.js";

// ── Inlined getShippingEstimate ───────────────────────────────────────────────

async function getShippingEstimate(
  _client: StorefrontClient,
  input: { country: string; zip?: string },
  _storeConfig?: StoreConfig
) {
  return {
    source: "knowledge_base" as const,
    country: input.country,
    zip: input.zip,
    message:
      "Exact shipping rates are calculated at checkout based on your location and cart contents. " +
      "You can proceed to checkout to see available shipping options and costs.",
    tip: "Use the get_checkout_url tool to generate a checkout link where shipping rates will be displayed.",
  };
}

// ── Inlined getOrderStatus ────────────────────────────────────────────────────

async function getOrderStatus(
  _client: StorefrontClient,
  input: { orderNumber: string; email: string }
) {
  return {
    source: "knowledge_base" as const,
    orderNumber: input.orderNumber,
    message:
      "For security, order status is available through your order confirmation email " +
      "or by visiting the store's order status page. Check your email for a link from the store, " +
      "or contact support with your order number and email address for assistance.",
  };
}

// ── Inlined getStorePolicies ──────────────────────────────────────────────────

async function getStorePolicies(
  client: StorefrontClient,
  input: { type: "refund" | "shipping" | "privacy" | "terms" | "all" }
) {
  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(GET_SHOP_POLICIES);
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to retrieve store policies right now. Please try again." };
  }
  const shop = data.shop;
  const policies: Record<string, any> = {};

  if (input.type === "all" || input.type === "refund") {
    policies.refund = shop.refundPolicy ?? { message: "No refund policy published" };
  }
  if (input.type === "all" || input.type === "shipping") {
    policies.shipping = shop.shippingPolicy ?? { message: "No shipping policy published" };
  }
  if (input.type === "all" || input.type === "privacy") {
    policies.privacy = shop.privacyPolicy ?? { message: "No privacy policy published" };
  }
  if (input.type === "all" || input.type === "terms") {
    policies.terms = shop.termsOfService ?? { message: "No terms of service published" };
  }

  return {
    source: "storefront_api" as const,
    policies,
  };
}

// ── Inlined initiateReturn ────────────────────────────────────────────────────

async function initiateReturn(
  _client: StorefrontClient,
  input: {
    orderNumber: string;
    email: string;
    reason?: string;
    items?: Array<{ productName: string; quantity: number }>;
  },
  storeConfig?: StoreConfig
) {
  const supportEmail = storeConfig?.promptConfig?.supportEmail;

  return {
    source: "knowledge_base" as const,
    orderNumber: input.orderNumber,
    returnRequest: {
      status: "initiated",
      items: input.items ?? [],
      reason: input.reason,
    },
    instructions: [
      "Your return request has been noted.",
      supportEmail
        ? `Please email ${supportEmail} with your order number (#${input.orderNumber}) to complete the return process.`
        : `Please contact the store's customer support with your order number (#${input.orderNumber}) to complete the return process.`,
      "Have your order confirmation email ready for reference.",
      "Returns are subject to the store's return policy. Use the get_store_policies tool to review the refund policy.",
    ],
  };
}

// ── get_support_info dispatcher ───────────────────────────────────────────────

export const getSupportInfoInput = z.object({
  topic: z
    .enum(["shipping", "order_status", "policies", "returns"])
    .describe(
      "Support topic: 'shipping' = estimated costs/delivery, 'order_status' = track an order, 'policies' = store policies, 'returns' = initiate a return"
    ),
  country: z.string().optional().describe("Country code for shipping estimate, e.g. 'US', 'GB'"),
  zip: z.string().optional().describe("ZIP/postal code for shipping estimate"),
  orderNumber: z.string().optional().describe("Order number (required for order_status and returns)"),
  email: z.string().optional().describe("Customer email (required for order_status and returns)"),
  policyType: z
    .enum(["refund", "shipping", "privacy", "terms", "all"])
    .optional()
    .describe("Which policy to retrieve (default: all)"),
  reason: z.string().optional().describe("Reason for return"),
  items: z
    .array(
      z.object({
        productName: z.string(),
        quantity: z.number().int().min(1).default(1),
      })
    )
    .optional()
    .describe("Items to return"),
});

export async function getSupportInfo(
  client: StorefrontClient,
  input: z.infer<typeof getSupportInfoInput>,
  storeConfig?: StoreConfig
) {
  const parsed = getSupportInfoInput.parse(input);

  switch (parsed.topic) {
    case "shipping": {
      return getShippingEstimate(
        client,
        { country: parsed.country ?? "US", zip: parsed.zip },
        storeConfig
      );
    }

    case "order_status": {
      if (!parsed.orderNumber || !parsed.email) {
        return {
          source: "knowledge_base" as const,
          error: "orderNumber and email are required for topic='order_status'",
        };
      }
      return getOrderStatus(client, {
        orderNumber: parsed.orderNumber,
        email: parsed.email,
      });
    }

    case "policies": {
      return getStorePolicies(client, {
        type: parsed.policyType ?? "all",
      });
    }

    case "returns": {
      if (!parsed.orderNumber || !parsed.email) {
        return {
          source: "knowledge_base" as const,
          error: "orderNumber and email are required for topic='returns'",
        };
      }
      return initiateReturn(
        client,
        {
          orderNumber: parsed.orderNumber,
          email: parsed.email,
          reason: parsed.reason,
          items: parsed.items,
        },
        storeConfig
      );
    }

    default:
      return {
        source: "knowledge_base" as const,
        error: `Unknown topic: ${parsed.topic}`,
      };
  }
}

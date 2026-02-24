import { z } from "zod";
import type { StorefrontClient } from "../../shopify/client.js";
import { GET_PRODUCT } from "../../shopify/queries.js";
import type { Product } from "../../types/index.js";

// ── Inlined helpers from shopify/types.ts ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenEdges(connection: any): any[] {
  return connection?.edges?.map((e: any) => e.node) ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseProduct(raw: any): Product {
  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    description: raw.description ?? "",
    descriptionHtml: raw.descriptionHtml,
    vendor: raw.vendor,
    productType: raw.productType,
    tags: raw.tags ?? [],
    availableForSale: raw.availableForSale ?? false,
    priceRange: {
      minVariantPrice: raw.priceRange?.minVariantPrice,
    },
    featuredImage: raw.featuredImage,
    images: flattenEdges(raw.images),
    variants: flattenEdges(raw.variants).map((v: any) => {
      const { compareAtPrice, ...rest } = v;
      return rest;
    }),
  };
}

// ── Inlined checkInventory ────────────────────────────────────────────────────

const VARIANT_QUERY = /* GraphQL */ `
  query GetVariant($id: ID!) {
    node(id: $id) {
      ... on ProductVariant {
        id
        title
        availableForSale
        price { amount currencyCode }
        selectedOptions { name value }
        product { title handle }
      }
    }
  }
`;

async function checkInventory(
  client: StorefrontClient,
  input: { variantId: string }
) {
  const data = await client.request<Record<string, any>>(VARIANT_QUERY, {
    id: input.variantId,
  });

  if (!data.node) {
    return {
      source: "storefront_api" as const,
      error: `Variant "${input.variantId}" not found`,
      available: false,
    };
  }

  return {
    source: "storefront_api" as const,
    variant: data.node,
    available: data.node.availableForSale ?? false,
    quantityAvailable: data.node.quantityAvailable ?? null,
  };
}

// ── Tool ──────────────────────────────────────────────────────────────────────

export const getProductInput = z.object({
  handle: z.string().describe("Product handle (URL slug), e.g. 'classic-leather-jacket'"),
  variantId: z.string().optional().describe("Optional variant GID to check real-time inventory for a specific size/color"),
});

export const getProductDef = {
  name: "get_product",
  description:
    "Get full details for a specific product by its handle. Returns title, description, all variants with prices, images, and availability.",
  inputSchema: {
    type: "object" as const,
    properties: {
      handle: { type: "string", description: "Product handle (URL slug)" },
    },
    required: ["handle"],
  },
};

export async function getProduct(
  client: StorefrontClient,
  input: z.infer<typeof getProductInput>
) {
  const parsed = getProductInput.parse(input);
  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(GET_PRODUCT, { handle: parsed.handle });
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now." };
  }

  if (!data.product) {
    return {
      source: "storefront_api" as const,
      error: `Product with handle "${parsed.handle}" not found`,
      product: null,
    };
  }

  const product = parseProduct(data.product);
  const variantCount = Array.isArray(product.variants) ? product.variants.length : 0;

  let inventoryInfo: Record<string, any> | undefined;
  if (parsed.variantId) {
    try {
      const invResult = await checkInventory(client, { variantId: parsed.variantId });
      if (!(invResult as any).error) {
        inventoryInfo = invResult as Record<string, any>;
      }
    } catch {
      // Inventory check is best-effort; don't fail the whole request
    }
  }

  const diagLine = `\n[DIAG] get_product | handle=${parsed.handle} | title=${product.title} | variants=${variantCount} | available=${product.availableForSale} | inventoryChecked=${!!inventoryInfo} | ts=${new Date().toISOString()}`;

  return {
    content: [
      {
        type: "text" as const,
        text: `Showing details for ${product.title}.` + diagLine,
      },
    ],
    structuredContent: {
      widgetId: "shopify-product-details",
      product: product,
      shopUrl: `https://${client.domain}`,
      source: "storefront_api",
      ...(inventoryInfo && { inventory: inventoryInfo }),
    },
  };
}

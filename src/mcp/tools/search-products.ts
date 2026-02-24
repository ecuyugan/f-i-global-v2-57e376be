import { z } from "zod";
import type { StorefrontClient } from "../../shopify/client.js";
import {
  SEARCH_PRODUCTS,
  LIST_PRODUCTS,
  BROWSE_COLLECTION,
  LIST_COLLECTIONS,
} from "../../shopify/queries.js";
import type { Product, Collection, SearchResult } from "../../types/index.js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseSearchResults(raw: any): SearchResult {
  const search = raw.search;
  return {
    products: flattenEdges(search).map(parseProduct),
    totalCount: search?.totalCount ?? 0,
    hasNextPage: search?.pageInfo?.hasNextPage ?? false,
    endCursor: search?.pageInfo?.endCursor ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseProductsList(raw: any): SearchResult {
  const products = raw.products;
  return {
    products: flattenEdges(products).map(parseProduct),
    totalCount: flattenEdges(products).length,
    hasNextPage: products?.pageInfo?.hasNextPage ?? false,
    endCursor: products?.pageInfo?.endCursor ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCollection(raw: any): Collection {
  return {
    id: raw.id,
    handle: raw.handle,
    title: raw.title,
    description: raw.description ?? "",
    image: raw.image,
    products: raw.products ? flattenEdges(raw.products).map(parseProduct) : [],
  };
}

// ── Inlined browseCollection ─────────────────────────────────────────────────

const browseCollectionInput = z.object({
  handle: z.string(),
  limit: z.number().int().min(1).max(20).default(10),
  cursor: z.string().optional(),
  sortKey: z
    .enum(["BEST_SELLING", "CREATED", "PRICE", "TITLE", "COLLECTION_DEFAULT"])
    .default("BEST_SELLING"),
  reverse: z.boolean().default(false),
});

async function browseCollection(
  client: StorefrontClient,
  input: z.infer<typeof browseCollectionInput>
) {
  const parsed = browseCollectionInput.parse(input);
  let data: Record<string, any>;
  try {
    data = await client.request<Record<string, any>>(BROWSE_COLLECTION, {
      handle: parsed.handle,
      first: parsed.limit,
      after: parsed.cursor,
      sortKey: parsed.sortKey,
      reverse: parsed.reverse,
    });
  } catch {
    return { source: "storefront_api" as const, error: true, message: "Unable to reach the store right now. Please try again." };
  }

  if (!data.collection) {
    let allData: Record<string, any>;
    try {
      allData = await client.request<Record<string, any>>(LIST_COLLECTIONS, { first: 20 });
    } catch {
      return { source: "storefront_api" as const, error: `Collection "${parsed.handle}" not found`, availableCollections: [] };
    }
    const collections = flattenEdges(allData.collections).map((c: any) => ({
      handle: c.handle,
      title: c.title,
    }));
    return {
      source: "storefront_api" as const,
      error: `Collection "${parsed.handle}" not found`,
      availableCollections: collections,
    };
  }

  const collection = parseCollection(data.collection);
  return {
    source: "storefront_api" as const,
    collection: {
      ...collection,
      hasNextPage: data.collection.products?.pageInfo?.hasNextPage ?? false,
      endCursor: data.collection.products?.pageInfo?.endCursor ?? null,
    },
  };
}

// ── Search tool ───────────────────────────────────────────────────────────────

export const searchProductsInput = z.object({
  query: z.string().describe("Natural language search query, e.g. 'blue running shoes'. Use '*' or leave broad to browse all products."),
  limit: z.number().int().min(1).max(20).default(6).describe("Number of results to return"),
  cursor: z.string().optional().describe("Pagination cursor from a previous search"),
  collectionHandle: z.string().optional().describe("Browse a specific collection by handle (e.g. 'summer-sale'). When provided, returns products from that collection instead of searching."),
  sortKey: z
    .enum(["BEST_SELLING", "CREATED", "PRICE", "TITLE", "COLLECTION_DEFAULT"])
    .optional()
    .describe("Sort order when browsing a collection"),
  reverse: z.boolean().optional().describe("Reverse sort order when browsing a collection"),
  availableOnly: z.boolean().optional().default(false).describe("When true, only return products currently in stock (availableForSale=true). Use for queries like 'what's in stock' or 'what can I buy'."),
  size: z.string().optional().describe("Filter products by size (e.g. 'XS', 'S', 'M', 'L', 'XL'). Only returns products that have a variant in this size that is available for sale."),
  color: z.string().optional().describe(
    "Filter products by color (e.g. 'blue', 'red', 'black'). " +
    "Matches variant color options and product tags. Case-insensitive."
  ),
  minPrice: z.number().optional().describe(
    "Minimum price filter in store currency (e.g. 50). Only returns products with min variant price >= this value."
  ),
  maxPrice: z.number().optional().describe(
    "Maximum price filter in store currency (e.g. 100). Only returns products with min variant price <= this value."
  ),
  _stateRef: z.string().optional().describe(
    "Internal widget state reference from a previous manage_cart response `id` field. " +
    "Pass this so the product widget can maintain continuity."
  ),
});

export const searchProductsDef = {
  name: "search_products",
  description:
    "Search for products in the store using natural language. Returns matching products with prices, images, and availability.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Natural language search query" },
      limit: { type: "number", description: "Number of results (1-20, default 10)" },
      cursor: { type: "string", description: "Pagination cursor" },
    },
    required: ["query"],
  },
};

// Queries that indicate the user wants to browse all products, not search
const BROWSE_PATTERNS = /^(\*|all|all products|everything|browse|shop|catalog|what do you have|what's available|show me|inventory)$/i;

/** Post-filter: keep only products that have a variant matching the requested size and in stock. */
function filterBySize(products: any[], size: string): any[] {
  const sizeUpper = size.toUpperCase().trim();
  return products.filter((p: any) => {
    const variants = p.variants ?? [];
    return variants.some((v: any) => {
      const sizeOption = (v.selectedOptions ?? []).find(
        (opt: any) => opt.name.toLowerCase() === "size"
      );
      if (!sizeOption || !v.availableForSale) return false;
      const val = sizeOption.value.toUpperCase().trim();
      return val === sizeUpper || val.startsWith(sizeUpper + " ");
    });
  });
}

/** Post-filter: keep only products whose variant color option or tags match the requested color. */
function filterByColor(products: any[], color: string): any[] {
  const colorLower = color.toLowerCase().trim();
  return products.filter((p: any) => {
    const variants = p.variants ?? [];
    const hasColorVariant = variants.some((v: any) =>
      (v.selectedOptions ?? []).some(
        (opt: any) =>
          ["color", "colour"].includes(opt.name.toLowerCase()) &&
          opt.value.toLowerCase().includes(colorLower)
      )
    );
    if (hasColorVariant) return true;
    const tags: string[] = p.tags ?? [];
    return tags.some((t: string) => t.toLowerCase().includes(colorLower));
  });
}

/** Post-filter: keep only products within the given price range (based on minVariantPrice). */
function filterByPrice(products: any[], min?: number, max?: number): any[] {
  return products.filter((p: any) => {
    const price = parseFloat(p.priceRange?.minVariantPrice?.amount ?? "0");
    if (min !== undefined && price < min) return false;
    if (max !== undefined && price > max) return false;
    return true;
  });
}

export async function searchProducts(
  client: StorefrontClient,
  input: z.infer<typeof searchProductsInput>
) {
  const parsed = searchProductsInput.parse(input);

  // ── Collection browse mode ──────────────────────────────────────
  if (parsed.collectionHandle) {
    const collectionResult = await browseCollection(client, {
      handle: parsed.collectionHandle,
      limit: parsed.limit,
      cursor: parsed.cursor,
      sortKey: parsed.sortKey ?? "BEST_SELLING",
      reverse: parsed.reverse ?? false,
    });

    if ((collectionResult as any).error) {
      const errResult = collectionResult as any;
      const textMsg = errResult.error;
      const diagLine = `\n[DIAG] search_products | mode=collection | handle=${parsed.collectionHandle} | error=${errResult.error} | ts=${new Date().toISOString()}`;
      return {
        content: [{ type: "text" as const, text: textMsg + diagLine }],
        structuredContent: {
          widgetId: "shopify-product-carousel",
          products: [],
          shopUrl: `https://${client.domain}`,
          totalCount: 0,
          hasNextPage: false,
          source: "storefront_api",
          availableCollections: errResult.availableCollections,
          ...(parsed._stateRef && { cartId: parsed._stateRef }),
        },
      };
    }

    const collection = (collectionResult as any).collection;
    let products = collection.products ?? [];
    const rawCount = products.length;
    if (parsed.availableOnly) {
      products = products.filter((p: any) => p.availableForSale);
    }
    if (parsed.size) {
      products = filterBySize(products, parsed.size);
    }
    if (parsed.color) {
      products = filterByColor(products, parsed.color);
    }
    if (parsed.minPrice !== undefined || parsed.maxPrice !== undefined) {
      products = filterByPrice(products, parsed.minPrice, parsed.maxPrice);
    }
    if (products.length > parsed.limit) {
      products = products.slice(0, parsed.limit);
    }
    const totalCount = products.length;
    const filterSummary = JSON.stringify({
      availableOnly: parsed.availableOnly,
      size: parsed.size || null,
      color: parsed.color || null,
      minPrice: parsed.minPrice ?? null,
      maxPrice: parsed.maxPrice ?? null,
    });
    const diagLine = `\n[DIAG] search_products | mode=collection | handle=${parsed.collectionHandle} | raw=${rawCount} | final=${totalCount} | filters=${filterSummary} | ts=${new Date().toISOString()}`;
    const textMsg = totalCount > 0
      ? `Showing ${totalCount} product${totalCount !== 1 ? "s" : ""} from the "${collection.title}" collection.`
      : `The "${collection.title}" collection is empty.`;

    return {
      content: [{ type: "text" as const, text: textMsg + diagLine }],
      structuredContent: {
        widgetId: "shopify-product-carousel",
        products,
        shopUrl: `https://${client.domain}`,
        totalCount,
        hasNextPage: collection.hasNextPage ?? false,
        endCursor: collection.endCursor ?? null,
        source: "storefront_api",
        collectionTitle: collection.title,
        ...(parsed._stateRef && { cartId: parsed._stateRef }),
      },
    };
  }

  // ── Standard search mode ────────────────────────────────────────
  const isBrowseQuery = BROWSE_PATTERNS.test(parsed.query.trim());

  const hasFilters = parsed.availableOnly || parsed.size || parsed.color ||
    parsed.minPrice !== undefined || parsed.maxPrice !== undefined;
  const fetchLimit = hasFilters ? Math.max(parsed.limit, 20) : parsed.limit;

  let result;

  try {
    if (isBrowseQuery) {
      const data = await client.request<Record<string, any>>(LIST_PRODUCTS, {
        first: fetchLimit,
        after: parsed.cursor,
      });
      result = parseProductsList(data);
    } else {
      const data = await client.request<Record<string, any>>(SEARCH_PRODUCTS, {
        query: parsed.query,
        first: fetchLimit,
        after: parsed.cursor,
      });
      result = parseSearchResults(data);

      if (result.products.length === 0 && !parsed.cursor) {
        const fallbackData = await client.request<Record<string, any>>(LIST_PRODUCTS, {
          first: fetchLimit,
        });
        const fallbackResult = parseProductsList(fallbackData);
        if (fallbackResult.products.length > 0) {
          result = fallbackResult;
        }
      }
    }
  } catch {
    return {
      content: [{ type: "text" as const, text: "Unable to reach the store right now. Please try again." }],
      structuredContent: { widgetId: "shopify-product-carousel", products: [], shopUrl: `https://${client.domain}`, totalCount: 0, hasNextPage: false, source: "storefront_api", error: true },
    };
  }

  const rawCount = result.products.length;

  if (parsed.availableOnly) {
    result.products = result.products.filter((p: any) => p.availableForSale);
  }
  if (parsed.size) {
    result.products = filterBySize(result.products, parsed.size);
  }
  if (parsed.color) {
    result.products = filterByColor(result.products, parsed.color);
  }
  if (parsed.minPrice !== undefined || parsed.maxPrice !== undefined) {
    result.products = filterByPrice(result.products, parsed.minPrice, parsed.maxPrice);
  }

  if (result.products.length > parsed.limit) {
    result.products = result.products.slice(0, parsed.limit);
  }
  result.totalCount = result.products.length;

  const textMsg = result.products.length > 0
    ? `Found ${result.totalCount} product${result.totalCount !== 1 ? "s" : ""}.`
    : "No products found matching your search.";

  const filterSummary = JSON.stringify({
    availableOnly: parsed.availableOnly,
    size: parsed.size || null,
    color: parsed.color || null,
    minPrice: parsed.minPrice ?? null,
    maxPrice: parsed.maxPrice ?? null,
  });
  const diagLine = `\n[DIAG] search_products | raw=${rawCount} | final=${result.products.length} | hasNext=${result.hasNextPage} | query=${parsed.query} | filters=${filterSummary} | ts=${new Date().toISOString()}`;

  return {
    content: [
      {
        type: "text" as const,
        text: textMsg + diagLine,
      },
    ],
    structuredContent: {
      widgetId: "shopify-product-carousel",
      products: result.products,
      shopUrl: `https://${client.domain}`,
      totalCount: result.totalCount,
      hasNextPage: result.hasNextPage,
      endCursor: result.endCursor,
      source: "storefront_api",
      ...(parsed._stateRef && { cartId: parsed._stateRef }),
    },
  };
}

import { GraphQLClient } from "graphql-request";

export interface StorefrontClientOptions {
  domain: string;
  token: string;
  apiVersion?: string;
  /** Use private token header (required for password-protected stores) */
  privateToken?: boolean;
  logger?: { info: (...args: unknown[]) => void };
}

export interface StorefrontClient {
  request: <T = unknown>(
    query: string,
    variables?: Record<string, unknown>
  ) => Promise<T>;
  domain: string;
}

export function createStorefrontClient(
  options: StorefrontClientOptions
): StorefrontClient {
  const { domain: rawDomain, token, apiVersion = "2025-01", logger } = options;
  const domain = rawDomain.replace(/^https?:\/\//, "");
  const isPrivate = options.privateToken ?? token.startsWith("shpss_");
  const endpoint = `https://${domain}/api/${apiVersion}/graphql.json`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (isPrivate) {
    // Private tokens work on password-protected stores
    headers["Shopify-Storefront-Private-Token"] = token;
    headers["Shopify-Storefront-Buyer-IP"] = "0.0.0.0";
  } else {
    headers["X-Shopify-Storefront-Access-Token"] = token;
  }

  const client = new GraphQLClient(endpoint, { headers });

  return {
    domain,
    async request<T = unknown>(
      query: string,
      variables?: Record<string, unknown>
    ): Promise<T> {
      const start = Date.now();
      const response = await client.rawRequest<T>(query, variables);

      const cost = response.headers?.get?.("X-Shopify-API-Cost");
      const duration = Date.now() - start;

      if (logger) {
        logger.info(
          {
            domain,
            duration_ms: duration,
            shopify_api_cost: cost ?? "unknown",
            private: isPrivate,
          },
          "Shopify Storefront API request"
        );
      }

      return response.data;
    },
  };
}

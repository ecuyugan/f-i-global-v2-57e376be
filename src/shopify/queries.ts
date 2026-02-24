export const SEARCH_PRODUCTS = /* GraphQL */ `
  query SearchProducts($query: String!, $first: Int = 10, $after: String) {
    search(query: $query, types: [PRODUCT], first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          ... on Product {
            id
            handle
            title
            description
            vendor
            productType
            tags
            availableForSale
            priceRange {
              minVariantPrice { amount currencyCode }
            }
            featuredImage { url altText width height }
            images(first: 5) {
              edges { node { url altText width height } }
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                  selectedOptions { name value }
                  image { url altText }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_PRODUCT = /* GraphQL */ `
  query GetProduct($handle: String!) {
    product(handle: $handle) {
      id
      handle
      title
      description
      descriptionHtml
      vendor
      productType
      tags
      availableForSale
      priceRange {
        minVariantPrice { amount currencyCode }
      }
      featuredImage { url altText width height }
      images(first: 10) {
        edges { node { url altText width height } }
      }
      variants(first: 50) {
        edges {
          node {
            id
            title
            availableForSale
            price { amount currencyCode }
            selectedOptions { name value }
            image { url altText }
          }
        }
      }
    }
  }
`;

export const BROWSE_COLLECTION = /* GraphQL */ `
  query BrowseCollection(
    $handle: String!
    $first: Int = 10
    $after: String
    $sortKey: ProductCollectionSortKeys = BEST_SELLING
    $reverse: Boolean = false
  ) {
    collection(handle: $handle) {
      id
      handle
      title
      description
      image { url altText width height }
      products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            handle
            title
            description
            vendor
            productType
            availableForSale
            priceRange {
              minVariantPrice { amount currencyCode }
            }
            featuredImage { url altText width height }
            variants(first: 3) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const LIST_COLLECTIONS = /* GraphQL */ `
  query ListCollections($first: Int = 20) {
    collections(first: $first) {
      edges {
        node {
          id
          handle
          title
          description
          image { url altText width height }
        }
      }
    }
  }
`;

export const LIST_PRODUCTS = /* GraphQL */ `
  query ListProducts($first: Int = 10, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          handle
          title
          description
          vendor
          productType
          tags
          availableForSale
          priceRange {
            minVariantPrice { amount currencyCode }
          }
          featuredImage { url altText width height }
          images(first: 5) {
            edges { node { url altText width height } }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                availableForSale
                price { amount currencyCode }
                selectedOptions { name value }
                image { url altText }
              }
            }
          }
        }
      }
    }
  }
`;

export const GET_PRODUCT_BY_ID = /* GraphQL */ `
  query GetProductById($id: ID!) {
    node(id: $id) {
      ... on Product {
        id
        handle
        title
        description
        vendor
        productType
        availableForSale
        variants(first: 50) {
          edges {
            node {
              id
              title
              availableForSale
              price { amount currencyCode }
              selectedOptions { name value }
            }
          }
        }
      }
    }
  }
`;

export const GET_SHOP_INFO = /* GraphQL */ `
  query GetShopInfo {
    shop {
      name
      description
      brand {
        logo { image { url altText } }
        colors { primary { background foreground } secondary { background foreground } }
      }
      paymentSettings {
        currencyCode
        acceptedCardBrands
      }
    }
  }
`;

export const GET_SHOP_POLICIES = /* GraphQL */ `
  query GetShopPolicies {
    shop {
      privacyPolicy { title handle body url }
      refundPolicy { title handle body url }
      shippingPolicy { title handle body url }
      termsOfService { title handle body url }
    }
  }
`;

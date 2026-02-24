FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src src
COPY assets assets
COPY brand_knowledge.md ./

RUN npm run build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist dist
COPY --from=build /app/assets assets
COPY --from=build /app/brand_knowledge.md ./

ENV PORT=8000
EXPOSE 8000

USER node

CMD ["sh", "-c", "if [ -n \"$RAILWAY_PUBLIC_DOMAIN\" ]; then export BASE_URL=${BASE_URL:-https://$RAILWAY_PUBLIC_DOMAIN}; fi; node dist/index.js"]

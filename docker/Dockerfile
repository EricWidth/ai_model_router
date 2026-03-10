FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/web/public ./src/web/public
COPY --from=builder /app/examples ./examples
EXPOSE 8080
CMD ["node", "dist/src/index.js"]

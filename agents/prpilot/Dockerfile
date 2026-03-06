# Stage 1: build
FROM node:25-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# Stage 2: runtime
FROM node:25-alpine AS runtime

ENV NODE_ENV=production

ARG GH_VERSION=2.87.3

WORKDIR /app

# Install system packages and gh CLI
RUN apk add --no-cache git lynx && \
    wget -qO /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" && \
    tar -xf /tmp/gh.tar.gz -C /tmp && \
    mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh && \
    rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_amd64"

# Install prod deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Non-root user
RUN addgroup -S prpilot && adduser -S -G prpilot prpilot
USER prpilot

EXPOSE 3000

CMD ["node", "dist/main.js"]

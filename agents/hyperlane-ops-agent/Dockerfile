FROM node:20-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl docker.io \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/ops-agent

COPY ops-agent/package.json ./package.json
COPY ops-agent/tsconfig.json ./tsconfig.json
COPY ops-agent/vitest.config.ts ./vitest.config.ts
COPY ops-agent/src ./src
COPY ops-agent/extensions ./extensions

RUN npm install
RUN npm run build

WORKDIR /workspace

ENV OPS_AGENT_PORT=8787
ENV OPS_AGENT_CWD=/workspace

EXPOSE 8787

CMD ["node", "/workspace/ops-agent/dist/server.js"]

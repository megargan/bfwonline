FROM node:24-bookworm-slim
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter @bfw/server...
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node", "--experimental-strip-types", "apps/server/src/main.ts"]

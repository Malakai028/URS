FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS base
WORKDIR /game

FROM base AS build
COPY . .
RUN npm ci --ignore-scripts && npm run build && npm prune --omit=dev --ignore-scripts

FROM base AS runtime
ENV NODE_ENV=production DATABASE_FILE=/game/data/ure.sqlite
COPY --from=build /game/node_modules ./node_modules
COPY --from=build /game/package.json .
COPY --from=build /game/apps/server ./apps/server
COPY --from=build /game/packages ./packages
COPY --from=build /game/docs/reference ./docs/reference
COPY --from=build /game/scripts/toolchain/sqlite-snapshot.mjs ./scripts/toolchain/sqlite-snapshot.mjs
COPY --from=build /game/dist ./dist
RUN mkdir -p data && chown node:node data && chmod 700 data
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","apps/server/start.ts"]

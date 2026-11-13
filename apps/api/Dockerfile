FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @toce/api... 

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @toce/api build
# @toce/shared se publica como TypeScript para web y móvil; para la API se compila a JS.
RUN pnpm --filter @toce/shared exec tsc -p tsconfig.build.json \
  && cd packages/shared && node -e "const f='package.json',p=JSON.parse(require('fs').readFileSync(f));p.main=p.types='./dist/index.js';p.exports={'.':'./dist/index.js'};require('fs').writeFileSync(f,JSON.stringify(p,null,2))"

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules node_modules
COPY --from=deps /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/drizzle apps/api/drizzle
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node", "dist/server.js"]

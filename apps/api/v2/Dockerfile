FROM node:20-alpine AS build

ARG DATABASE_DIRECT_URL
ARG DATABASE_URL

WORKDIR /calcom

RUN set -eux;
RUN ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3

# Ensure Yarn 3 is used per packageManager field
RUN corepack enable && corepack prepare yarn@3.4.1 --activate

ENV NODE_ENV="production"
ENV NODE_OPTIONS="--max-old-space-size=8192"
ENV DATABASE_DIRECT_URL=${DATABASE_DIRECT_URL}
ENV DATABASE_URL=${DATABASE_URL}

COPY . .

RUN yarn install --immutable

# Build prisma schema and make sure that it is linked to v2 node_modules
RUN yarn workspace @calcom/api-v2 run generate-schemas
RUN rm -rf apps/api/v2/node_modules
RUN yarn install --immutable

RUN yarn workspace @calcom/api-v2 run build

# Cloud Run defaults to port 8080; app will bind to process.env.PORT
EXPOSE 8080

CMD [ "yarn", "workspace", "@calcom/api-v2", "start:prod"]

FROM node:14.15.2-alpine AS base

COPY . .

RUN apk update \
    && apk add --no-cache ca-certificates \
    && yarn install --frozen-lockfile --no-cache \
    && yarn build \
    && rm -rf src \
    && rm -rf node_modules \
    && yarn install --production \
    && yarn cache clean

USER node

ENTRYPOINT ["node", "-r", "dotenv/config", "dist/src/index.js", "dotenv_config_path=/conf/config.env"]

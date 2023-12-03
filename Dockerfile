FROM --platform=linux/amd64 node:16-alpine as yarn-install

WORKDIR /usr/src/app
COPY package.json yarn.lock ./
RUN apk update && \
    apk upgrade && \
    apk add --no-cache --virtual dependencies git python3 build-base && \
    yarn --frozen-lockfile --no-cache && \
    apk del dependencies && \
    yarn cache clean

FROM --platform=linux/amd64 node:16-alpine
WORKDIR /usr/src/app
RUN apk update && \
    apk upgrade && \
    apk add ca-certificates libc6-compat && \
    ln -s /lib/libc.musl-x86_64.so.1 /lib/ld-linux-x86-64.so.2

COPY --from=yarn-install /usr/src/app/node_modules /usr/src/app/node_modules

COPY . .
RUN yarn build

EXPOSE 8008
CMD yarn start

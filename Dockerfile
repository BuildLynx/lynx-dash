# Build stage
FROM node:22 AS build
WORKDIR /src
COPY Services/lynx-dash/ ./
COPY lynx-sdk-typescript/ /lynx-sdk-typescript/
# The dash links the SDK (portal:), so it must be built here rather than taken from a local dist/
RUN cd /lynx-sdk-typescript && npm ci && npm run build

RUN corepack enable
RUN yarn install

RUN yarn run web:build:prod

# Release stage
FROM caddy:2.5.2-alpine
WORKDIR /src
COPY --from=build /src/web/.webpack ./

EXPOSE 8080

COPY <<EOF /entrypoint.sh
# Optionally override the default layout with one provided via bind mount
mkdir -p /lichtblick
touch /lichtblick/default-layout.json
index_html=\$(cat index.html)
replace_pattern='/*LICHTBLICK_SUITE_DEFAULT_LAYOUT_PLACEHOLDER*/'
replace_value=\$(cat /lichtblick/default-layout.json)
echo "\${index_html/"\$replace_pattern"/\$replace_value}" > index.html

# Continue executing the CMD
exec "\$@"
EOF

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
CMD ["caddy", "file-server", "--listen", ":8080"]

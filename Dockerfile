# Image de production : Node 20 sur Alpine, aucune dépendance à installer.
FROM node:20-alpine

# Les données (dont la clé de signature) vivent hors de l'image.
VOLUME ["/data"]
ENV FM_DATA_DIR=/data \
    NODE_ENV=production \
    PORT=4173

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY docs ./docs
COPY README.md LICENSE CHANGELOG.md ./

# Utilisateur non privilégié
RUN addgroup -S mtn && adduser -S mtn -G mtn && mkdir -p /data && chown -R mtn:mtn /data
USER mtn

EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4173/api/status > /dev/null || exit 1

CMD ["node", "server/index.mjs"]

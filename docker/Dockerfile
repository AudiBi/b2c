# Images de production. Cibles : api, migrate, web.
#   docker build -f docker/Dockerfile --target api -t b2c-api .
#   docker build -f docker/Dockerfile --target web --build-arg VITE_COMPANY_SLUG=ma-societe --build-arg SITE_URL=https://exemple.com -t b2c-web .
# Normalement construites par docker/compose.prod.yml (voir docs/DEPLOYMENT.md).

# Cible de l'image finale quand la plateforme ne permet pas de choisir une cible (Render) : IMAGE_TARGET=api-render, web-render, migrate…
# Sans variable : « web », comme avant (docker compose indique toujours sa cible explicitement).
ARG IMAGE_TARGET=web

# ---------------------------------------------------------------------------------------------
# Construction : installe tout, compile le package partagé, le client Prisma et l'API
# ---------------------------------------------------------------------------------------------
FROM node:25-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN npm ci
COPY packages packages
COPY prisma prisma
COPY apps apps
RUN npm run build

# ---------------------------------------------------------------------------------------------
# Migrations et amorçage : tâche ponctuelle (rôle de migration), jamais exposée
# ---------------------------------------------------------------------------------------------
FROM build AS migrate
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && npx tsx prisma/seed.ts"]

# ---------------------------------------------------------------------------------------------
# API : dépendances de production seulement, utilisateur sans privilège
# ---------------------------------------------------------------------------------------------
FROM node:25-alpine AS api
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
RUN npm ci --omit=dev -w @b2c/api -w @b2c/shared && npm cache clean --force
# Client Prisma généré à la construction (le CLI Prisma n'est pas dans l'image d'exécution)
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/dist-esm packages/shared/dist-esm
COPY --from=build /app/apps/api/dist apps/api/dist
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3100)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

# ---------------------------------------------------------------------------------------------
# Site : fichiers statiques pré-rendus servis par nginx (qui termine aussi le HTTPS)
# ---------------------------------------------------------------------------------------------
FROM build AS web-build
ARG VITE_COMPANY_SLUG
ARG VITE_BRAND_NAME
ARG SITE_URL
ARG ADMIN_URL
# Référencement (facultatif) : codes de vérification des outils pour webmasters et coordonnées publiées dans les données structurées
ARG SEO_GOOGLE_SITE_VERIFICATION
ARG SEO_BING_SITE_VERIFICATION
ARG SEO_ORGANIZATION_JSON
RUN test -n "$VITE_COMPANY_SLUG" && test -n "$SITE_URL" && test -n "$ADMIN_URL"
ENV VITE_COMPANY_SLUG=$VITE_COMPANY_SLUG VITE_BRAND_NAME=$VITE_BRAND_NAME SITE_URL=$SITE_URL VITE_ADMIN_URL=$ADMIN_URL     SEO_GOOGLE_SITE_VERIFICATION=$SEO_GOOGLE_SITE_VERIFICATION SEO_BING_SITE_VERIFICATION=$SEO_BING_SITE_VERIFICATION SEO_ORGANIZATION_JSON=$SEO_ORGANIZATION_JSON
RUN npm -w @b2c/web run build

# Panel d'administration : application monopage séparée du site (autre adresse, autres cookies, jamais référencée)
FROM build AS admin-build
ARG VITE_COMPANY_SLUG
ARG VITE_BRAND_NAME
ARG SITE_URL
RUN test -n "$VITE_COMPANY_SLUG" && test -n "$SITE_URL"
ENV VITE_COMPANY_SLUG=$VITE_COMPANY_SLUG VITE_BRAND_NAME=$VITE_BRAND_NAME VITE_SITE_URL=$SITE_URL
RUN npm -w @b2c/admin run build

# Un seul nginx, deux noms de domaine : le site (SERVER_NAME) et le panel (ADMIN_SERVER_NAME)
FROM nginx:1.27-alpine AS web
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/nginx/admin.conf.template /etc/nginx/templates/admin.conf.template
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/admin-security-headers.conf /etc/nginx/admin-security-headers.conf
COPY --from=web-build /app/apps/web/dist/client /usr/share/nginx/html
COPY --from=admin-build /app/apps/admin/dist /usr/share/nginx/admin
EXPOSE 80 443

# ---------------------------------------------------------------------------------------------
# Render (voir render.yaml et docs/RENDER.md)
# ---------------------------------------------------------------------------------------------
# API : comme « api », mais démarre en root pour rendre le disque monté inscriptible, puis abaisse les privilèges (su-exec)
FROM api AS api-render
USER root
RUN apk add --no-cache su-exec
COPY docker/render/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh
ENTRYPOINT ["api-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]

# Site et panel : nginx en HTTP sur $PORT (Render termine le HTTPS) ; le site et le panel partagent le même service
FROM nginx:1.27-alpine AS web-render
COPY docker/nginx/render.conf.template /etc/nginx/templates/00-site.conf.template
COPY docker/nginx/render-admin.conf.template /etc/nginx/templates/10-admin.conf.template
COPY docker/nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY docker/nginx/admin-security-headers.conf /etc/nginx/admin-security-headers.conf
COPY --from=web-build /app/apps/web/dist/client /usr/share/nginx/html
COPY --from=admin-build /app/apps/admin/dist /usr/share/nginx/admin
EXPOSE 10000

# Image finale par défaut : la cible demandée par IMAGE_TARGET
FROM ${IMAGE_TARGET} AS final

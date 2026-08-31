FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into the JS bundle at build time (Next.js requirement for
# NEXT_PUBLIC_* vars). Defaults to localhost so local `docker compose
# up --build` keeps working unchanged. Override via --build-arg or
# docker-compose.yml's build.args for a real deploy.
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
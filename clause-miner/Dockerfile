# Clause-mining pipeline Cloud Run Job image (docs/CLAUSE-MINING-PIPELINE.md §2, §8).
#
# node:22-bookworm (NOT slim/alpine): the conversion stage shells out to
# LibreOffice headless (`soffice --headless --convert-to docx`) plus the
# fallback ladder (antiword for real .doc, wpd2text from libwpd-tools for
# WordPerfect) — §8. None of this is installable in any Functions runtime,
# which is why this is a Cloud Run Job and not functions-backfill.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    antiword \
    libwpd-tools \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage selection via the STAGE env var (see src/main.ts).
# The Job has 8 GiB; Node's default old-space cap (~2 GB) OOM'd the identity
# stage's in-memory signature/pair working set. Leave headroom for buffers.
ENV NODE_OPTIONS=--max-old-space-size=6144
ENTRYPOINT ["node", "lib/main.js"]

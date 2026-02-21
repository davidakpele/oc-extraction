# ─────────────────────────────────────────────
# OCR Extraction Engine - Dockerfile
# ─────────────────────────────────────────────
FROM node:20-bookworm-slim

LABEL maintainer="OCR Extraction Engine"
LABEL description="Local OCR + PDF extraction microservice"

# ── System dependencies ──────────────────────────────────────
# Tesseract OCR + English language data
# Ghostscript + poppler-utils for PDF rendering
# GraphicsMagick for pdf2pic
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    ghostscript \
    poppler-utils \
    graphicsmagick \
    libvips-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Optional: additional Tesseract language packs ─────────────
# Uncomment to add Hindi, Gujarati, etc.:
# RUN apt-get update && apt-get install -y tesseract-ocr-hin tesseract-ocr-guj

# ── App setup ────────────────────────────────────────────────
WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --omit=dev
RUN npm install cors
# Copy source
COPY . .

# Create storage directories
RUN mkdir -p /app/storage/uploads /app/storage/artifacts /app/logs

# ── Environment defaults ─────────────────────────────────────
ENV NODE_ENV=production
ENV PORT=3001
ENV UPLOAD_DIR=/app/storage/uploads
ENV ARTIFACTS_DIR=/app/storage/artifacts
ENV LOG_DIR=/app/logs

# ── Expose ───────────────────────────────────────────────────
EXPOSE 3001

# ── Health check ─────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# ── Entrypoint ───────────────────────────────────────────────
CMD ["node", "src/index.js"]
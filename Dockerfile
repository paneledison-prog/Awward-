# The Playwright image ships Chromium plus the system libraries it needs, which
# is the bulk of the work in containerising a browser-driven service. The tag
# must track the playwright-core version in package.json: a mismatch leaves the
# browser revision the library expects missing at runtime.
FROM mcr.microsoft.com/playwright:v1.55.1-noble AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Browsers are already in the image; re-downloading them would double its size.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --no-audit --no-fund

# Build needs devDependencies (TypeScript, Tailwind); the runtime does not, so
# production dependencies are resolved separately rather than shipping ~200MB of
# build tooling in the final image.
FROM mcr.microsoft.com/playwright:v1.55.1-noble AS proddeps
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev --no-audit --no-fund

FROM mcr.microsoft.com/playwright:v1.55.1-noble AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.55.1-noble AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=3000

COPY --from=proddeps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/extension ./extension
COPY package.json next.config.mjs ./

# Screenshots are written at runtime, so they cannot live under public/ — Next
# serves that from a manifest fixed at build time. pwuser must own the directory
# it writes into.
ENV SCREENSHOT_DIR=/app/.screenshots
RUN mkdir -p /app/.screenshots && chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Binds 0.0.0.0: `next start` reachable only on loopback inside the container
# would fail every platform health check, with the app itself running fine.
#
# Invoked directly rather than through `npm run`. The logs show roughly five
# seconds between the machine starting and npm even printing its banner, all of
# it before Next begins booting — pure overhead on every cold start, and this
# app scales to zero, so every first request pays it. `exec` keeps the server
# as PID 1 so it receives SIGTERM directly and shuts down cleanly.
CMD ["sh", "-c", "exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]

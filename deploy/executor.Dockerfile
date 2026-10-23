# The fill executor runs a real browser, which is why it cannot be a Worker.
# It sits on the same network as the sites you fill into, and talks to the
# broker with its own executor credentials.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
ENV NODE_ENV=production

# Only the executor and its one dependency. Playwright's browsers are already in
# the base image, so nothing is downloaded at runtime.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund playwright@1.49.1
COPY fill-executor.mjs ./

# A browser needs a writable /tmp and a non-root user for the sandbox to behave.
RUN mkdir -p /tmp/playwright && chown -R pwuser:pwuser /app /tmp/playwright
USER pwuser

ENV HEADLESS=1
CMD ["node", "fill-executor.mjs"]

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./package.json

# same Playwright version the GitHub job uses, with its matching Chromium + system libraries
RUN npm install \
    && npx playwright install --with-deps chromium

COPY tools/ ./tools/
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]

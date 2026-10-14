# Tutorial-video recorder: Playwright + Chromium + ffmpeg, all inside the image.
# node_modules lives in the image (/opt/pw), never in the OneDrive-synced repo.
FROM mcr.microsoft.com/playwright:v1.55.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Playwright library version must match the image tag above.
WORKDIR /opt/pw
RUN npm init -y >/dev/null && npm install --no-audit --no-fund playwright@1.55.0 \
 && ln -s /opt/pw/node_modules /node_modules

# Scripts are bind-mounted here at run time (see README.md).
WORKDIR /work/tutorials

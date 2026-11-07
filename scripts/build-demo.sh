#!/usr/bin/env bash
# Statische Portfolio-Demo: Website + Verwaltung ohne Backend.
# Alle /api-Aufrufe beantwortet public/demo/mock-api.js im Browser mit
# erfundenen Daten. Ergebnis: dist-demo/ (auf Vercel als statische Seite).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
rm -rf dist-demo
cp -r public dist-demo
cat > dist-demo/vercel.json <<'JSON'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": true,
  "trailingSlash": false,
  "redirects": [
    { "source": "/preise", "destination": "/#preise", "permanent": true },
    { "source": "/kontakt", "destination": "/#kontakt", "permanent": true }
  ],
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ] },
    { "source": "/demo/media/(.*)", "headers": [
      { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
    ] },
    { "source": "/admin/(.*)", "headers": [ { "key": "X-Robots-Tag", "value": "noindex" } ] },
    { "source": "/admin", "headers": [ { "key": "X-Robots-Tag", "value": "noindex" } ] }
  ]
}
JSON
echo "dist-demo/ ready"

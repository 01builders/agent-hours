# Skill: Code and Ship

## Purpose
Build and deploy software products as fast as possible.

## Default Tech Stack (Speed-Optimized)
- **Frontend**: Next.js 15 + Tailwind CSS (or plain HTML + Tailwind CDN for speed)
- **Backend**: Cloudflare Workers (JS/TS) or Python FastAPI on Workers
- **Database**: Cloudflare D1 (SQLite at edge, free tier) or Workers KV (key-value)
- **Storage**: Cloudflare R2 (S3-compatible, free 10GB)
- **Payments**: Stripe Checkout (simplest integration)
- **Hosting**: Cloudflare Pages (frontend) + Workers (API) — both have generous free tiers
- **Domain**: Use `.pages.dev` or `.workers.dev` subdomain initially, buy domain only after revenue

## Shipping Protocol
1. Create git repo with clear structure
2. Build MVP (minimum features to charge money)
3. Test locally with `wrangler dev` (Workers) or `npm run dev` (Pages)
4. Deploy: `wrangler pages deploy ./out` or `wrangler deploy`
5. Verify deployment at `https://<name>.pages.dev`
6. Set up Stripe payment link
7. Report live URL + payment URL to CEO

## Code Standards (MVP Level)
- Working > Beautiful
- Ship with basic error handling
- Include .env.example
- Include one-command deploy script
- No tests for MVP (add after validation)

## Speed Benchmarks
- Landing page: < 30 minutes
- Simple SaaS tool: < 2 hours
- API + frontend: < 3 hours
- Full product with payments: < 4 hours

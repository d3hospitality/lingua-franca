# Lingua Franca

G2 smart glasses language learning app — explore languages and translations through the Even Realities G2 AR interface.

## Claude Skills

| Skill | What it does here |
|---|---|
| **g2-app-scaffold** | Scaffolds new G2-optimized views and routes for the glasses UI |
| **g2-container-layout** | Layouts content within G2 glasses display constraints |
| **vercel-api-proxy** | Sets up Vercel serverless proxy endpoints for translation APIs |
| **dev-log-writer** | Generates structured dev log entries for session work |
| **claudemd-generator** | Creates and updates CLAUDE.md project context files |
| **command-launcher** | Builds .command launcher scripts for common workflows |

## Quick Start

```bash
# Start dev server
npm run dev

# Or open directly
open index.html

# Build for production
npm run build

# Deploy to Vercel
vercel --prod
```

<!-- out-of-path CI proof: this README-only change must reach mergeStateStatus CLEAN and merge WITHOUT --admin, confirming the un-filtered check-fixture gate (96791fb, #18) no longer hangs on PRs that touch zero filtered paths. First independent post-merge proof. -->

# Deploying Recipes

1. Copy the repo to the box.
2. `cp .env.example .env` and fill in the values.
3. Make sure the `studioos-lan-edge` Docker network exists (created by the Studio OS stack), then `docker compose up -d --build`.
4. Copy `deploy/recipes.caddy` into the fronting Caddy's `sites/` directory and reload Caddy.
5. Add a DNS A record for `recipes.matchapman.dev` pointing at the box's LAN IP.

# Favourites, per person

Date: 2026-11-25
Size: a small change.

## Intent

The recipe box is now shared: sign-in means every request knows who is making it. Mat wants each
person to be able to star the recipes they like, and to browse the other person's stars from the
Library's Filters sheet — "what shall we cook tonight, show me what she likes". Favourites are a
browsing aid, not a planning tool: nothing else consumes them yet.

## Goals

- Anyone signed in can star and unstar any recipe, for themselves.
- Everyone's stars are visible to everyone else who can sign in; the Filters sheet can narrow the
  Library to one person's favourites, or several.
- People appear by name rather than by email address.
- Favourites survive a restore from a Drive backup.

## Non-goals

- Named collections or lists ("Sunday dinners"). One flat star per person per recipe.
- Private favourites. The whole point is browsing each other's.
- Feeding favourites into the meal planner or the menu feature. That may come with the third
  feature; it is deliberately not designed for here.
- A profile screen, avatars, or any editing of a person's name.

## Anti-goals

- A star tap must not make a recipe look edited. Recipes have an `updatedAt` and an edit history
  people read; favouriting is not an edit of the recipe.
- Losing a week of stars to a restore.

## Constraints

- `allowed_emails(email, added_at)` is the list of people; sign-in authorises on it alone, and
  `req.email` is the signed-in address. The allowlist is keyed by email on purpose — you invite
  someone by typing their address — so favourites key on email too. (Google's own guidance prefers
  the immutable `sub` claim as a user key; that ship sailed when the allowlist was built, and for a
  two-person household the trade is not worth revisiting.)
- The Library filters server-side through query parameters on `GET /api/recipes`: `search`, repeated
  `brand`, repeated `tag`. A `Facets` payload drives the Filters sheet with counts per brand and tag.
- `server/src/backup/fingerprint.ts` decides what triggers a nightly upload, and its comment states
  the rule: anything user-meaningful added later must be added to it.
- Next migration number is `009`.

## Approaches

1. **A `favourites` table, filtered server-side** — chosen. Favourites become another query
   parameter and another facet, which is the pattern every existing filter already follows.
2. **Fetch all favourites and filter in the browser** — rejected. Fewer server changes, but the
   Library would then have two different mechanisms for the same job, and the facet counts would
   have to be computed twice, in two places, from two sources.
3. **A JSON array on the recipe row** — rejected. No new table, but a star tap would rewrite the
   recipe, bump `updatedAt`, and fold one person's taste into the recipe's own record. It breaks the
   first anti-goal outright.

## The design

**Schema** — migration `009_favourites.sql`:

- `favourites(email TEXT NOT NULL, recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL, PRIMARY KEY (email, recipe_id))`, plus an index on `recipe_id` for the
  per-recipe lookup. `foreign_keys` is already `ON`, so deleting a recipe takes its stars with it.
- `allowed_emails` gains `display_name TEXT` (nullable: someone can be on the list before they ever
  sign in).

**Names.** The sign-in route already verifies a Google ID token. The verifier returns the `name`
claim alongside the email when Google sends it, and the route writes it to `display_name` on every
successful sign-in, so a changed Google name catches up by itself. Google documents `name` as never
guaranteed, so everywhere a name is shown falls back to the part of the address before the `@`,
capitalised. No new scope and no Google Cloud change: the claim is already in the credential the
button returns.

**Starring.** `PUT /api/recipes/:id/favourite` and `DELETE /api/recipes/:id/favourite`, both acting
on `req.email` only — there is no way to star on someone else's behalf. Both are idempotent.

**Reading.** `RecipeSummary` and the full recipe gain `favouritedBy: string[]` (addresses, sorted).
The heart is filled when that array contains your own address; the Library can also show that
someone else has starred it. `GET /api/recipes` accepts a repeated `favourite=<email>` parameter,
matching `brand` and `tag`, and returns recipes starred by **any** of the addresses given. The
`Facets` payload gains `people: { email, name, count }[]`, listing everyone on the allowlist with
how many recipes they have starred, so the Filters sheet can render the section without a second
request.

**Removing a person.** Removing an address from the allowlist already deletes that person's
sessions. It now deletes their favourites too: access ends completely, and a filter chip for someone
who is no longer allowed in would be a ghost.

**Backup.** Favourites join the fingerprint, as `email + recipe_id` pairs, sorted. Starring
something therefore triggers that night's upload. `display_name` stays out: it is cosmetic and comes
back at the next sign-in, and a name change should not cost an upload.

**The screens.** A heart on each Library card and on the recipe page, tapping it toggles your own.
The Filters sheet grows a "Favourites" section listing each person by name with their count,
alongside the existing Brand and Tag sections, and the existing filter behaviour (several ticked
means any of them) carries over unchanged.

## Left to the builder

- Exactly where the heart sits on the Library card and the recipe page, and what it looks like
  unstarred — follow the app's existing icon treatment in `web/src/components/Icons.tsx`.
- Whether the Library shows *whose* stars a recipe has when the filter is off, or only your own.
  Either is fine; do not invent a new visual language for it.
- Whether an unstar needs a confirmation. It does not.

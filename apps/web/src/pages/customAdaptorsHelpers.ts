/**
 * Pure helpers for the Custom Adaptors page CreateModal.
 *
 * Extracted to its own module so the slug-resolution rules can be unit-
 * tested without spinning up React Testing Library. The page component
 * imports these and uses them in its submit handler.
 *
 * Why this lives here: the CreateModal previously read `slug` from React
 * closure when submitting, but `setSlug(displaySlug)` enqueued earlier in
 * the same handler hadn't applied yet — so the API got `{ slug: '' }` and
 * 400'd on the SlugRegex Zod check, even though the user could see the
 * auto-derived slug right above the Create button. The bug was invisible
 * unless the user manually edited the slug field.
 *
 * `resolveCreatePayload` does the resolution synchronously from the inputs
 * the handler already has — no closure dependency, no React state — so a
 * test can prove the auto-derived path produces a valid slug.
 */

/** Normalise a free-text adaptor name into a SlugRegex-valid slug. */
export function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
}

/**
 * Resolve the {name, slug} payload to send to the create API given the
 * modal's current input state. Returns null when either field would be
 * empty after trimming — the caller treats this as "do nothing".
 *
 * `slugDirty=false` means the user has not manually edited the slug and we
 * should auto-derive it from the name. `slugDirty=true` honours whatever
 * the user typed (after lowercase normalisation by the input handler).
 */
export function resolveCreatePayload(args: {
  name: string;
  slug: string;
  slugDirty: boolean;
}): { name: string; slug: string } | null {
  const finalName = args.name.trim();
  const finalSlug = (args.slugDirty ? args.slug : toSlug(args.name)).trim();
  if (!finalName || !finalSlug) return null;
  return { name: finalName, slug: finalSlug };
}

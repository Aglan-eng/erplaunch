/**
 * Pull a human-readable section label out of an adaptor schema given a
 * wizard section key like "r2r.entities". Falls back to undefined when the
 * schema is malformed or the section isn't declared on this adaptor; the
 * caller treats undefined as "use the default SECTION_CONTEXT lookup".
 */
export function findSectionLabel(
  schema: { flows?: Array<{ sections?: Array<{ id?: string; label?: string }> }> } | null | undefined,
  sectionKey: string,
): string | undefined {
  if (!schema || !Array.isArray(schema.flows)) return undefined;
  const parts = sectionKey.split('.');
  const targetSectionId = parts.slice(1).join('.');
  if (!targetSectionId) return undefined;
  for (const flow of schema.flows) {
    if (!Array.isArray(flow.sections)) continue;
    for (const section of flow.sections) {
      if (section?.id === targetSectionId && typeof section.label === 'string') {
        return section.label;
      }
    }
  }
  return undefined;
}

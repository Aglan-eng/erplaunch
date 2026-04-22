/**
 * Rule engine evaluate function.
 * Takes answers + license + phases and returns conflicts/warnings/infos.
 */
export function evaluate(input) {
  const { answers, license, phases } = input;
  const conflicts = [];
  const warnings = [];
  const infos = [];

  // Basic validation rules
  if (license && license.edition === 'STARTER') {
    const advancedModules = (license.modules || []).filter(m =>
      ['ADVANCED_REVENUE', 'MANUFACTURING', 'DEMAND_PLANNING'].includes(m)
    );
    if (advancedModules.length > 0) {
      conflicts.push({
        id: 'license-edition-module-mismatch',
        severity: 'BLOCK',
        type: 'LICENSE',
        questionIds: [],
        message: `Starter edition does not support modules: ${advancedModules.join(', ')}`,
        resolution: 'Upgrade to Mid-Market or Premium edition, or remove the listed modules.',
      });
    }
  }

  // Multi-subsidiary check
  if (answers?.r2r_multi_subsidiary === true && !(license?.modules || []).includes('ONEWORLD')) {
    warnings.push({
      id: 'multi-sub-needs-oneworld',
      severity: 'WARN',
      type: 'LICENSE',
      questionIds: ['r2r_multi_subsidiary'],
      message: 'Multi-subsidiary setup requires OneWorld module.',
      resolution: 'Add OneWorld module to the license profile.',
    });
  }

  return { conflicts, warnings, infos };
}

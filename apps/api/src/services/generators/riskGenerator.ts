export interface RiskData {
  clientName: string;
  conflicts: any[];
  warnings: any[];
}

export function generateRiskRegister(data: RiskData): string {
  const { clientName, conflicts, warnings } = data;
  const now = new Date().toLocaleDateString();

  let md = `# Implementation Risk Register\n`;
  md += `**Project:** ${clientName}\n`;
  md += `**Date:** ${now}\n\n`;

  md += `## 1. Executive Risk Summary\n`;
  md += `Total Critical Conflicts: **${conflicts.length}**\n`;
  md += `Total Operational Warnings: **${warnings.length}**\n\n`;

  md += `## 2. Risk Detail Table\n\n`;
  md += `| ID | Severity | Category | Description | Mitigation Strategy |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  conflicts.forEach((c, idx) => {
    md += `| C-${idx + 1} | CRITICAL | ${c.type} | ${c.message} | Requires Immediate Resolution: ${c.resolution} |\n`;
  });

  warnings.forEach((w, idx) => {
    md += `| W-${idx + 1} | MODERATE | ${w.type} | ${w.message} | Advise Stakeholders: ${w.resolution} |\n`;
  });

  if (conflicts.length === 0 && warnings.length === 0) {
    md += `| - | - | - | No implementation risks detected at this time. | N/A |\n`;
  }

  md += `\n## 3. Risk Assessment Matrix\n`;
  md += `*   **Critical**: Blocks configuration generation or Go-Live.\n`;
  md += `*   **Moderate**: Functional gaps that may require process workarounds.\n`;

  return md;
}

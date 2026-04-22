import type { BusinessProfileAnswers, LicenseProfile, Phase } from '@ofoq/shared';

export interface RuleInput {
  answers: BusinessProfileAnswers;
  license: LicenseProfile;
  phases: Phase[];
}

export interface ConflictResult {
  id: string;
  severity: 'BLOCK' | 'WARN' | 'INFO';
  type: 'LICENSE_GAP' | 'PHASE_DEPENDENCY' | 'CONFIG_CONFLICT' | 'DATA_WARNING';
  questionIds: string[];
  message: string;
  resolution: string;
}

export interface RuleOutput {
  conflicts: ConflictResult[]; // BLOCK — wizard cannot proceed
  warnings: ConflictResult[];  // WARN — can proceed, should address
  infos: ConflictResult[];     // INFO — good to know
}

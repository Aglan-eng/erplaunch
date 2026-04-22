export type QuestionId = string; // e.g. "r2r.entities.multiEntity"

export type InputType =
  | 'BOOLEAN'       // Yes/No toggle
  | 'SINGLE_SELECT' // Radio / dropdown
  | 'MULTI_SELECT'  // Checkbox group
  | 'TEXT'          // Free text
  | 'NUMBER'        // Numeric input
  | 'TABLE'         // Dynamic row table
  | 'DATE';         // Date picker

export interface QuestionOption {
  value: string;
  label: string;
  description: string;
}

export interface Question {
  id: QuestionId;
  flow: 'R2R' | 'P2P' | 'O2C' | 'PRODUCTION' | 'RETURNS';
  section: string;
  order: number;
  inputType: InputType;
  options?: QuestionOption[];
  required: boolean;
  label: string;
  helpTitle: string;
  helpBody: string;
  exampleText: string;
  /** NetSuite-specific implementation note for the consultant:
   *  what this answer creates in NS, what to watch out for, licensing impact, etc. */
  consultantNote?: string;
  dependsOn?: {
    questionId: QuestionId;
    value: unknown;
  };
}

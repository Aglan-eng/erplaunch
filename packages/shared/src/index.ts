// Types
export * from './types/index.js';

// Zod Schemas
export * from './schemas/index.js';

// Question Types
export * from './questions/types.js';

// Question Data
export { r2rQuestions } from './questions/r2r.js';
export { p2pQuestions } from './questions/p2p.js';
export { o2cQuestions } from './questions/o2c.js';
export { mfgQuestions } from './questions/mfg.js';
export { rtnQuestions } from './questions/rtn.js';

// All questions combined
import { r2rQuestions } from './questions/r2r.js';
import { p2pQuestions } from './questions/p2p.js';
import { o2cQuestions } from './questions/o2c.js';
import { mfgQuestions } from './questions/mfg.js';
import { rtnQuestions } from './questions/rtn.js';

export const allQuestions = [
  ...r2rQuestions,
  ...p2pQuestions,
  ...o2cQuestions,
  ...mfgQuestions,
  ...rtnQuestions,
];

// Mappings
export * from './mapping/index.js';

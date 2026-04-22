# Ofoq NetSuite Accelerator Constitution

## Core Principles

### I. Spec-Driven Development (Global)
Every feature implementation must follow the Spec-Kit SDD workflow:
1. Establish Constitution (this file).
2. Create Specification (Functional & User Stories).
3. Create Implementation Plan (Technical Design).
4. Generate Tasks (Actionable Breakdown).
5. Implement & Verify.

### II. Type-Safe Monorepo Architecture
- **Strict TypeScript**: All logic must be written in TypeScript with strict mode enabled.
- **Shared Packages First**: Common logic, schemas, and types must reside in `packages/shared`.
- **Atomic Dependencies**: Use workspace protocols (`workspace:*`) for inter-package dependencies.

### III. Test-Driven Development (TDD)
- **Mandatory Testing**: Write tests for core logic in `packages/shared` and business logic in `apps/api` before implementation.
- **Fail First**: Ensure tests fail before writing implementation code.
- **Coverage Goal**: Maintain 80%+ test coverage across the repository.

### IV. Performance & UX
- **Performance Budget**: Initial load time < 2s for the Wizard application.
- **Minimal Bundle**: Avoid unnecessary client-side dependencies; leverage tree-shaking.
- **Lighthouse Scores**: All UI surfaces must aim for Lighthouse scores > 90.

### V. Design Consistency
- **Design Tokens**: Use predefined CSS variables and design tokens for styling.
- **Component Reuse**: Build reusable components in `packages/shared` when applicable across multiple apps.

## Governance
- This Constitution supersedes ad-hoc development practices.
- Any deviation from these principles must be documented and justified in the implementation plan.
- All Pull Requests must be audited for compliance with these principles.

**Version**: 1.0.0 | **Ratified**: 2026-04-13 | **Last Amended**: 2026-04-13

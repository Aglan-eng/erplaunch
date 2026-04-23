# Ofoq NetSuite Accelerator (POC v0.2)

A production-grade configuration accelerator designed to automate the gap between business discovery and technical implementation for NetSuite.

## 🚀 Key Features

*   **Intelligent Questionnaire**: Domain-specific workstreams for R2R, P2P, O2C, Manufacturing, and Returns.
*   **Rule Engine**: Real-time evaluation of licensing gaps, configuration conflicts, and requirement dependencies.
*   **Automatic Generation**:
    *   **BRD**: Professional Markdown & Styled HTML Requirements Document.
    *   **SDF Manifest**: Automated `features.xml` generation.
    *   **SDF Objects**: Advanced mapping of business answers to Custom Record and Field definitions.
    *   **SuiteScript**: Scaffolding of standard User Event scripts tailored to the client profile.
*   **Progress Dashboard**: Visual tracking of workstream completeness and implementation lifecycle stages.

## 🛠 Tech Stack

*   **Monorepo**: Turbo (pnpm workspaces)
*   **Frontend**: React (Vite), Tailwind CSS, Lucide, Framer Motion
*   **Backend**: Fastify (Node.js), Zod, JWT
*   **Database**: LibSQL (SQLite)
*   **Rule Testing**: Vitest

## 📦 Getting Started

### 1. Installation
```bash
pnpm install
```

### 2. Development Startup
This command starts both the API (port 3000) and the Web (port 5173) servers.
```bash
pnpm dev
```

### 3. Build & Production
```bash
pnpm run build
```

## 🏗 System Architecture

*   `apps/web`: The React-based implementation wizard.
*   `apps/api`: Fastify server handling persistence, rules, and artifact generation.
*   `packages/shared`: Shared types, Zod schemas, and core Domain Questions.
*   `packages/rule-engine`: Decoupled logic for validating implementation consistency.
*   `packages/adaptor-sdk`: Platform-agnostic SPI — any ERP adapter implements `PlatformAdaptor`. Includes a pure declarative rule evaluator. See [`docs/adaptor-spi.md`](docs/adaptor-spi.md).
*   `packages/adaptor-registry`: Process-wide registry that loads built-in adapters at boot.
*   `packages/adaptor-netsuite` / `packages/adaptor-odoo`: Built-in adapters. Firm-authored custom adapters live in the DB via the [Custom Adaptor Wizard](apps/web/src/pages/CustomAdaptorsPage.tsx).

## 📄 Artifacts Location
All generated packages are stored in: `apps/api/outputs/[JOB_ID]/`

## 🛤 Roadmap (Sprint 3+)
*   Multi-consultant collaboration with real-time presence.
*   Puppeteer-based PDF export for the BRD.
*   Bi-directional sync with NetSuite SDF via CLI integration.

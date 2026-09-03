# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Node codex metadata (`*.node.json`) for all nodes so they surface with categories
  and documentation links inside n8n.
- GitHub Actions CI (lint + build) and npm publish workflow with provenance.

### Changed

- Migrated the build/lint toolchain to `@n8n/node-cli` (flat ESLint config,
  `n8n-node build`/`dev`/`lint`/`release`). Standardised on Node 22 LTS.

### Fixed

- Resolved all `@n8n/community-nodes` strict-mode lint findings:
  - use `NodeConnectionTypes.Main` instead of `'main'` string literals;
  - declare `usableAsTool` on the action node (trigger nodes must not set it);
  - add light/dark themed icons to all nodes and the credential;
  - wrap re-thrown execute() errors in `NodeApiError`;
  - route authenticated API calls through `httpRequestWithAuthentication`;
  - surface (instead of swallow) non-404 failures when deleting a webhook
    subscription on trigger deactivation.
- Fraction dropdown fallback now shows English display names; the option values
  stay in the provider's wording so the filter keeps matching.
- Corrected `repository.url` to the actual public repository — npm requires an
  exact match to generate a provenance statement.
- README now links the English API documentation (the old `/api/doc` URL
  returned HTTP 500).
- Dropped the leading SPDX comment from `LICENSE.md` so GitHub detects MIT.

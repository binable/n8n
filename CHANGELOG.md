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
  - route authenticated API calls through `httpRequestWithAuthentication`.

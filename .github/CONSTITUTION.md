# mcp-auto-expose Project Constitution

## Principles

1. Spec-First: no code is written without an approved spec in `specs/`.
2. Source of truth: `docs/documentation.txt` is the governing document.
3. Logs always to stderr; stdout reserved for JSON-RPC.
4. UTF-8 without BOM in all files.
5. TypeScript strict in all packages.

## Contribution process

- Propose change → update spec in `specs/` → open PR with spec first.
- Code only after spec approval.
- TDD: red test → implementation → green test → commit.

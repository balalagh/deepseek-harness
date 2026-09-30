---
description: "Package map for the admission-data domain: the local data-service host row and the model-facing admission query tools that read through it."
kind: "package-group"
---

# gaokao/ — the admission-data domain

English | [中文](README.zh.md)

## Summary

The `gaokao/` group carries one deployment's admission-guidance data plane: a host row that launches and supervises a local Python data service, and the model-facing tools that answer admission questions from deployment data. Use it when a deployment must answer 高考 or 艺术类高考 questions from its own data: the host row owns the service process and its health check, while each tool package owns one query surface and its model-visible contract. Data itself never lives in this group — a service reads its own database, and a dataset-backed tool reads a file its deployment configures.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package README owns the exhaustive contract.

| Package | Role | ctx key |
|---|---|---|
| [`gaokao-api/`](gaokao-api/README.md) | Launches, health-checks, and owns a local FastAPI data service through `ctx.subprocess`, reusing an already-answering service instead of taking it over | none (spawns a child process) |
| [`tool-gaokao-query/`](tool-gaokao-query/README.md) | Exposes the 高考 query tools over that service's HTTP endpoints | registers on `ctx.tools` |
| [`tool-art-query/`](tool-art-query/README.md) | Exposes the 艺术类高考 query tools over a deployment-supplied dataset file | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Tool catalog](../../docs/tool-catalog.md) — the generated schemas of every tool in the group.
- [Adding a tool](../../docs/cookbook/adding-a-tool.md) — the tool contract both tool packages follow.
- [Webhook group](../webhook/README.md) — the other verified-external-input surface a deployment may compose beside these tools.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The service-versus-dataset split is deliberate: `gaokao-api` hosts a database-backed service, while `tool-art-query` reads a snapshot file, because its source is a workbook rather than a queryable store. The reasoning and the rejected alternative are in [the art-query tool package Agent Note](../../.agents/notes/implemented/feature/2026-09-30-art-query-tool-package.md).

</details>

# Security Policy

## Supported versions

This project follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
A security fix is released as a **patch** version bump on every branch it applies to —
for example a fix found in `3.1.0` ships as `3.1.1`, and the equivalent fix on the
previous major ships as e.g. `2.1.1`. It never ships as a minor or major bump unless the
fix itself requires a breaking change to the public API, in which case that will be
called out explicitly in the advisory and the release notes.

| Version | Branch  | Supported          |
| ------- | ------- | ------------------- |
| 3.x     | `v3.x`  | Yes — current major |
| 2.x     | `v2.x`  | Yes — security fixes only, no new features |
| 1.x     | —       | No |
| 0.x     | —       | No |

When a new major version is released, the oldest currently-supported major stops
receiving fixes. `npm install prisma-entity-framework` always resolves to the highest
supported version; installing a specific `2.x` release still works but will not receive
further updates once 2.x support ends.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

This repository has [GitHub private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
enabled — go to the **Security** tab and select **Report a vulnerability**. This opens a
private draft advisory that only you and the maintainers can see, and keeps the
discussion and the eventual fix tied to a single record.

If you would rather not use GitHub, email **security@didactika.org** with:

- The affected version (or branch/commit) — `3.x` and `2.x` are both in scope, older
  versions are not.
- Steps to reproduce, or a proof of concept.
- What you think the impact is (what an attacker could do with it).

## What to expect

- Acknowledgement within a few days.
- We will let you know once a fix is available on the affected branch(es), or if we
  assess the report as not a vulnerability, with the reasoning.
- Please give us reasonable time to release a fix before disclosing publicly. This is a
  small team maintaining the project alongside other work, not a company with a
  dedicated security team.

## Scope

This policy covers the code in this repository, on the `v3.x` and `v2.x` branches.

- **Third-party dependencies**: report those upstream. [Dependabot security
  updates](https://docs.github.com/en/code-security/dependabot/dependabot-security-updates/about-dependabot-security-updates)
  are enabled on this repo, so known vulnerable dependencies are picked up and patched
  automatically as they're published.
- **Your own Prisma schema, database configuration, or how you deploy an application
  built on this framework** is outside this policy's scope — that's the operator's
  responsibility, the same way it would be for Prisma Client itself.

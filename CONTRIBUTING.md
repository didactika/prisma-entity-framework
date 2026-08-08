# Contributing

Thanks for taking the time to contribute. By contributing to prisma-entity-framework,
you agree to follow the organization's [Code of Conduct](https://github.com/didactika/.github/blob/main/CODE_OF_CONDUCT.md).

## Before you start

- **Small fix (typo, broken link, obvious bug)**: open a pull request directly.
- **Anything larger (new feature, behavior change, refactor)**: open an issue first and
  describe what you want to do. It saves everyone the time of building a pull request on
  an approach that would not be accepted.
- **Security vulnerability**: do not open a public issue. See [SECURITY.md](SECURITY.md).

## Branches

This project keeps one long-lived branch per supported major version, instead of a
single `main`:

- **`v3.x`** — current major, default branch. New features and fixes land here.
- **`v2.x`** — previous major, maintenance only. Security fixes and critical bug fixes
  get backported here as their own pull request; it does not receive new features.

Open your pull request against the branch that matches the version you're fixing —
`v3.x` unless you were explicitly asked to backport to `v2.x`. Both branches are
protected: at least one maintainer approval and a passing CI run are required before
merge, and history cannot be rewritten or force-pushed.

Name your own working branch after what it does, git-flow-style: `feature/upsert-by-filter`,
`fix/mysql-json-path`, `hotfix/mongo-replica-timeout`, `docs/testing-guide`,
`chore/bump-prisma`. It gets deleted once merged; the long-lived branches are only
`v3.x` and `v2.x`.

## Code style

There is no automated linter or formatter configured yet — follow the conventions
already used in the file you're editing (naming, module layout, how types are
expressed). The codebase is TypeScript throughout; keep new code fully typed rather than
falling back to `any`.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`feat: add updateByFilter`, `fix: mongo replica set timeout`, `docs: ...`,
`chore(deps): ...`. GitHub Releases are generated from merged pull requests, so a
correctly-typed, scoped title is what makes that generated changelog readable.

## Testing

- `npm test` runs the default (SQLite) unit + integration suite.
- `npm run test:unit` / `npm run test:integration` run one or the other.
- `npm run test:mysql`, `test:postgresql`, `test:mongodb` run the integration suite
  against that database via Docker Compose (`docker compose up -d <service>` first, or
  let the script start it for you).
- `npm run test:all-databases` runs the full matrix.

Add or update tests for any change in behavior. CI runs this same matrix — SQLite,
MySQL, PostgreSQL and MongoDB — on every pull request and it must pass before merge.
That check used to only run at publish time, after the code had already been merged;
it now runs where it can actually block a bad change.

## Documentation

If a change affects the public API, update the relevant file under [`docs/`](docs) and
the [README](README.md) quick start / feature list so they stay in sync with the code.

## Dependency and GitHub Actions updates

Please do not open pull requests that only bump npm packages, the lockfile, or GitHub
Actions versions. Those are opened automatically by Dependabot (see
[`.github/dependabot.yml`](.github/dependabot.yml)) and are reviewed by maintainers only
— we close manually-opened dependency-only PRs from outside collaborators to avoid
duplicate work and merge races with the bot.

Dependabot runs weekly against `v3.x` and keeps a 7-day cooldown before opening a PR for
a new release of a dependency, unless a critical vulnerability requires a maintainer to
update sooner by hand. Major version bumps are not opened automatically; those are
evaluated manually since they can carry breaking changes.

## Pull request review

- CI (build and the full database test matrix — type errors fail the build, since `tsup`
  emits declarations from the same TypeScript compiler) must pass before a maintainer
  reviews the change — the branch ruleset blocks merging otherwise.
- A maintainer will review, request changes if needed, and merge once approved. Response
  times are best-effort; this is a small team, not a company with an SLA.

## Release process

Maintainers only: bump `version` in `package.json` and add the corresponding entry to
`CHANGELOG.md` in the pull request. Once that lands on `v3.x` (or `v2.x` for a
maintenance release) and CI passes, a version tag and the npm publish happen
automatically — there is no manual `npm publish` step.

## License

By contributing, you agree that your contribution is licensed under this repository's
[MIT license](LICENSE).

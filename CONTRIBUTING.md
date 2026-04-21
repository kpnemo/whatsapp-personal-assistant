# Contributing

Thanks for considering a contribution. This repo is designed to be **read before run**.

## Quick start

```bash
git clone https://github.com/<owner>/whatsapp-personal-assistant.git
cd whatsapp-personal-assistant
pnpm install
cp .env.example .env
bash scripts/first-run.sh
pnpm dev
```

Requires Node 22+ and pnpm 9+.

## Before you open a PR

- Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. All must pass.
- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `security:`, etc.).
- Target `main`. One logical change per PR.
- By contributing, you agree your work is released under the repo's [MIT license](LICENSE).

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for the long-form guide: branch policy, test expectations, how to add a new json-render block type, and how to add a new `/wpa:<command>`.

## Reporting issues

- Bugs → [Issues](../../issues)
- Questions → [Discussions → Q&A](../../discussions)
- Security → private advisory (see [`SECURITY.md`](SECURITY.md))

All contributors and participants are expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

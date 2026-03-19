[![CI](https://github.com/parkersteele-admin/ogs-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/parkersteele-admin/ogs-portal/actions/workflows/ci.yml)

# OGS Portal

**Stack:** React + Vite, Firebase (Auth, Firestore, Hosting, Functions, Storage)

## Repository And App Roots

- Git root: this folder (`OGS-Portal`)
- App root: `OGS-portal-app`
- Run git commands from the git root.
- Run npm/firebase build and deploy commands from `OGS-portal-app` unless using root GitHub Actions.

## Setup Instructions

*To be added: step-by-step setup for local, GitHub, and Firebase workflows.*

## Branch Strategy

```
main   ← production deploy (app.ohiogassupply.com)
  ↑
dev    ← staging/preview deploy
```

## Deploy Flow

- GitHub Actions only uses workflows in `.github/workflows` at the git root.
- `main` triggers production deploy workflow.
- `dev` triggers staging deploy workflow.
- Do not duplicate workflow files under `OGS-portal-app/.github/workflows`.

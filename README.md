[![CI](https://github.com/parkersteele-admin/ogs-portal/actions/workflows/ci.yml/badge.svg)](https://github.com/parkersteele-admin/ogs-portal/actions/workflows/ci.yml)

# OGS Portal

**Stack:** React + Vite, Firebase (Auth, Firestore, Hosting, Functions, Storage)

## Setup Instructions

*To be added: step-by-step setup for local, GitHub, and Firebase workflows.*

## Branch Strategy

```
main      ← production only (protected, PR + review required)
  ↑
staging   ← pre-production (merges from develop)
  ↑
develop   ← active development branch
```

## Branch Strategy Diagram

```
          ┌─────────────┐
          │   main      │
          └─────▲───────┘
                │
          ┌─────┴───────┐
          │  staging    │
          └─────▲───────┘
                │
          ┌─────┴───────┐
          │  develop    │
          └─────────────┘
```

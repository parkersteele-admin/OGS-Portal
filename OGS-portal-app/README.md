# OGS Portal

[![CI](https://github.com/parkersteele-admin/OGS-Portal/actions/workflows/ci.yml/badge.svg)](https://github.com/parkersteele-admin/OGS-Portal/actions/workflows/ci.yml)

Multi-portal web application built with React, TypeScript, Vite, and Firebase.

## Working Directory Rules

- This folder (`OGS-portal-app`) is the app root.
- The git root is one level above (`OGS-Portal`).
- Run app commands (`npm run dev`, `npm run build`, `firebase ...`) from this folder.
- Run git branch/commit/merge commands from the git root folder.

## Development

```bash
npm install
npm run dev
```

## Firebase App Check

App Check (reCAPTCHA v3) blocks unauthorized clients from hitting Firebase services.

### New developer setup

1. Copy `.env.example` to `.env.local` and fill in `VITE_FIREBASE_*` values.
2. Leave `VITE_APPCHECK_DEBUG_TOKEN` **blank** on first run — the SDK will auto-generate a debug token and print it to the browser console:
   ```
   App Check debug token: <your-token-here>
   ```
3. Register that token in the Firebase console:
   **Firebase console → App Check → Apps → your app → Manage debug tokens → Add token**
4. Paste the token into `.env.local`:
   ```
   VITE_APPCHECK_DEBUG_TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   ```
5. Each developer needs their own debug token. **Never commit a real token.**

### Production setup

1. Register a reCAPTCHA v3 site key at <https://www.google.com/recaptcha/admin>
   - Type: **Score-based (v3)**
   - Domain: `ohiogassupply.com`
2. Add the site key to the production environment secret `VITE_RECAPTCHA_SITE_KEY`.
3. Register the app in **Firebase console → App Check → Apps** using the same reCAPTCHA v3 site key.

### Enforcement checklist

- [ ] Firestore: Firebase console → App Check → Firestore → **Enforce**
- [ ] Storage: Firebase console → App Check → Storage → **Enforce**
- [ ] Functions: Firebase console → App Check → Functions → **Enforce**
- [ ] Verify debug tokens are registered for all active developers
- [ ] Confirm `VITE_RECAPTCHA_SITE_KEY` is set in CI/CD production secrets

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check + production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest unit tests |
| `npm run preview` | Preview production build |

---

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

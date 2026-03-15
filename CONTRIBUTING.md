# Contributing to OGS Portal

## Branch Naming
- **Feature branches:** `feature/description` (e.g., `feature/user-auth`)
- **Bug fix branches:** `fix/description` (e.g., `fix/login-error`)

## Commit Message Format
- Use: `type(scope): message`
- Examples:
  - `feat(auth): add login flow`
  - `fix(payments): correct Stripe webhook`
  - `docs(readme): update setup instructions`

## Pull Request Template

---
**Checklist:**
- [ ] PR title follows commit message format
- [ ] Description explains the change
- [ ] Linked to relevant issue (if applicable)
- [ ] All tests pass
- [ ] CI checks pass
- [ ] At least one reviewer assigned
---

## Branch Protection Rules

### main
- Require pull request before merging
- Require at least 1 approving review
- Dismiss stale reviews on new commits
- Require status checks to pass (CI/CD)
- Restrict direct pushes

### staging
- Require pull request before merging
- Require CI checks to pass

See GitHub repository settings → Branch protection rules for details.

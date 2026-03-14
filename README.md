## Project: OGS Portal

### Stack
React + Vite
Firebase (Auth, Firestore, Hosting, Functions, Storage)

### Setup Instructions
_Coming soon_

### Branch Strategy

```mermaid
graph TD
	develop((develop))
	staging((staging))
	main((main))
	develop --> staging
	staging --> main
```

**Branch details:**
- **main**: production only, protected, requires PR + review
- **staging**: pre-production, merges from develop
- **develop**: active development branch

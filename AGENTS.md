# Agent Guide (cal.com)

This is the upstream Cal.com monorepo.

## Important Context

`BBI-K8` currently deploys Cal.com using a published container image. Changes here will not impact the running platform unless you build/push a custom image and update the GitOps config.

## Tooling

- Package manager: Yarn (monorepo workspaces)
- Build system: Turbo

## Common Commands (from package scripts)

```bash
yarn install
yarn dev:all
yarn build
```

## Secrets

- Do not commit `.env` files or credentials.


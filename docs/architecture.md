# Architecture

The project uses Next.js App Router with TypeScript. Feature-Sliced Design directories
under `src/` provide boundaries for future work: `entities`, `features`, `widgets`,
`shared`, and `pages`. Route composition lives in `src/app`.

The debate engine should remain independent of UI and provider adapters. Server-side
actions or route handlers will connect it to the application shell.

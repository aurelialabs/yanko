// Vitest runs modules directly instead of through Next.js' server/client graph.
// The real `server-only` package remains installed for application builds; this
// test-only alias lets server modules be unit-tested in a Node environment.
export {};

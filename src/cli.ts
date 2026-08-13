#!/usr/bin/env node
// npx entry point: start the production server on 127.0.0.1:4517 serving the
// built frontend. State files (projects.json, .auth-token) live in the cwd.
process.env.NODE_ENV ??= 'production'

// Dynamic imports keep the env assignment above ahead of config evaluation;
// the bare export marks the file as a module so top-level await is legal.
export {}

const { buildServer } = await import('./server/index.js')
const { HOST, PORT } = await import('./shared/config.js')

const app = await buildServer()
await app.listen({ host: HOST, port: PORT })
app.log.info(`dashboard: http://${HOST}:${PORT}/?token=${app.authToken}`)

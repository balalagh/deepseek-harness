/**
 * Stand-in for the real uvicorn service: one mode per launch outcome the
 * launcher plugin must tell apart. Run under plain Node by the tests.
 * @param argv[2] - port to listen on (serve mode).
 * @param argv[3] - `serve` (answer /health), `fail` (exit 7 after one stderr line), or `hang` (stay alive, never listen).
 */

import { createServer } from 'node:http'

const [port, mode] = process.argv.slice(2)

if (mode === 'fail') {
  process.stderr.write('boom: fixture cannot bind')
  process.exit(7)
} else if (mode === 'hang') {
  setInterval(() => {}, 1000)
} else {
  createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"status":"ok"}')
  }).listen(Number(port), '127.0.0.1')
}

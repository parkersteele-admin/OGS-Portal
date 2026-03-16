import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { cwd } from 'node:process'

const root = join(cwd(), 'dist')
const indexPath = join(root, 'index.html')
const port = Number(process.env.PORT || 8080)

const mimeByExt = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

function sendFile(res, filePath) {
  const ext = extname(filePath).toLowerCase()
  const contentType = mimeByExt[ext] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType })
  createReadStream(filePath).pipe(res)
}

const server = createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0]
  const safePath = normalize(urlPath).replace(/^\/+/, '')
  const candidate = join(root, safePath)

  if (
    existsSync(candidate) &&
    statSync(candidate).isFile()
  ) {
    sendFile(res, candidate)
    return
  }

  // SPA fallback so client-side routes resolve to index.html
  if (existsSync(indexPath)) {
    sendFile(res, indexPath)
    return
  }

  res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('dist/index.html not found. Run npm run build first.')
})

server.listen(port, '0.0.0.0', () => {
  console.log(`Static server listening on http://0.0.0.0:${port}`)
})

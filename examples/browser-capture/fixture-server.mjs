// Minimal, dependency-free static file server for the RFC-0004 browser-capture
// example fixture. Binds to 127.0.0.1 only (never 0.0.0.0), serves only files under
// ./fixture, and serves nothing else on the network.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "fixture");
const port = Number(process.env.PORT ?? 4173);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const server = createServer(async (req, res) => {
  const requestedPath = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
  const safeRelativePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(fixtureDir, safeRelativePath);

  if (!filePath.startsWith(fixtureDir)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  try {
    const contents = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
    res.end(contents);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Fixture server listening at http://127.0.0.1:${port}`);
});

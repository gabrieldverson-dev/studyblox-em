import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActiveReviewError, DEFAULT_GEMINI_MODEL, generateActiveReview } from './lib/generate-quiz-service.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 64 * 1024;

// Carrega .env.local e .env apenas no servidor, sem sobrescrever variáveis já definidas no ambiente
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile(path.join(__dirname, '.env.local'));
loadEnvFile(path.join(__dirname, '.env'));

const ALLOWED_STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/p1.txt', 'p1.txt'],
  ['/p2.txt', 'p2.txt'],
  ['/p3.txt', 'p3.txt'],
  ['/p4.txt', 'p4.txt'],
  ['/firebase-config.js', 'firebase-config.js'],
  ['/princesa.jpg', 'princesa.jpg']
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new ActiveReviewError('Corpo da requisição excede o limite permitido.', 413, 'PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new ActiveReviewError('Corpo JSON inválido.', 400, 'INVALID_JSON'));
      }
    });
    req.on('error', () => reject(new ActiveReviewError('Erro ao ler a requisição.', 400, 'READ_ERROR')));
  });
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Método não permitido. Use GET.', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        service: 'aprova-estudos-api',
        aiConfigured: Boolean(String(process.env.GEMINI_API_KEY || '').trim()),
        defaultModel: String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL
      });
      return;
    }

    if (pathname === '/api/generate-quiz') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { Allow: 'POST, OPTIONS', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        sendJson(res, 405, { error: 'Método não permitido. Use POST.', code: 'METHOD_NOT_ALLOWED' });
        return;
      }
      try {
        const body = await readJsonBody(req);
        const result = await generateActiveReview({
          body,
          apiKey: process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL
        });
        sendJson(res, 200, result);
      } catch (err) {
        if (err instanceof ActiveReviewError) {
          sendJson(res, err.status, { error: err.message, code: err.code });
        } else {
          sendJson(res, 500, { error: 'Erro interno ao gerar a revisão ativa.', code: 'INTERNAL_ERROR' });
        }
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    const staticRel = ALLOWED_STATIC_FILES.get(pathname);
    if (!staticRel) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    try {
      const fullPath = path.join(__dirname, staticRel);
      const data = await fs.readFile(fullPath);
      const ext = path.extname(staticRel).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 8788;
  const server = createAppServer();
  server.listen(port, () => {
    console.log(`Aprova Estudos rodando em http://localhost:${port}`);
    if (!process.env.GEMINI_API_KEY) {
      console.warn('[aviso] GEMINI_API_KEY não definida no ambiente. Defina-a em .env ou nas variáveis de ambiente para usar /api/generate-quiz.');
    }
  });
}

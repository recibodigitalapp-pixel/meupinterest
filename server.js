'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'juneba';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');
const INDEX_FILE = path.join(ROOT, 'index.html');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const sessions = new Map();
const loginAttempts = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ALLOWED_MIME = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/gif', '.gif'], ['image/webp', '.webp'], ['image/avif', '.avif'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'], ['video/quicktime', '.mov']
]);
const MIME_BY_EXT = new Map(Array.from(ALLOWED_MIME, ([mime, ext]) => [ext, mime]));

function sendJson(res, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(body);
}

function equalSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readJson(req, maximumBytes = 12 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximumBytes) {
        reject(new Error('Corpo da solicitação muito grande.'));
        req.resume();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > maximumBytes) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Dados inválidos.')); }
    });
    req.on('error', reject);
  });
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return '';
}

function authorized(req) {
  const token = cookieValue(req, 'mural_session');
  const expiresAt = sessions.get(token);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) { sessions.delete(token); return false; }
  return true;
}

function readPosts() {
  try {
    const data = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function writePosts(posts) {
  const temporary = `${POSTS_FILE}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(posts, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, POSTS_FILE);
}

function safeDecodedHeader(value) {
  try { return decodeURIComponent(String(value || '')); }
  catch { return ''; }
}

function cleanFileName(value) {
  const leaf = path.basename(String(value || '').replaceAll('\\', '/'));
  const safe = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return safe || 'arquivo';
}

function cleanTitle(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
}

function requestUpload(req, res) {
  if (!authorized(req)) {
    req.resume();
    return sendJson(res, 401, { error: 'Sua sessão expirou. Entre novamente para publicar.' });
  }
  const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
  const extension = ALLOWED_MIME.get(mime);
  if (!extension) {
    req.resume();
    return sendJson(res, 415, { error: 'Formato não aceito. Use JPG, PNG, GIF, WEBP, AVIF, MP4, WEBM ou MOV.' });
  }
  const statedLength = Number(req.headers['content-length'] || 0);
  if (statedLength > MAX_UPLOAD_BYTES) {
    req.resume();
    return sendJson(res, 413, { error: 'Cada arquivo pode ter até 250 MB.' });
  }

  const originalName = cleanFileName(safeDecodedHeader(req.headers['x-file-name']));
  const suppliedTitle = cleanTitle(safeDecodedHeader(req.headers['x-post-title']));
  const title = suppliedTitle || originalName.replace(/\.[^.]+$/, '') || originalName;
  const filename = `${crypto.randomBytes(18).toString('hex')}${extension}`;
  const filepath = path.join(UPLOAD_DIR, filename);
  const output = fs.createWriteStream(filepath, { flags: 'wx', mode: 0o600 });
  let bytes = 0;
  let tooLarge = false;
  let requestEnded = false;
  let answered = false;

  const fail = (status, message) => {
    if (answered) return;
    answered = true;
    fs.rm(filepath, { force: true }, () => sendJson(res, status, { error: message }));
  };

  output.on('error', (error) => {
    if (tooLarge) return;
    console.error('Falha ao gravar upload:', error.message);
    req.resume();
    fail(500, 'Não foi possível salvar o arquivo.');
  });
  output.on('drain', () => { if (!tooLarge) req.resume(); });
  req.on('data', (chunk) => {
    if (tooLarge || answered) return;
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES) {
      tooLarge = true;
      output.destroy();
      req.resume();
      return;
    }
    if (!output.write(chunk)) req.pause();
  });
  req.on('aborted', () => {
    output.destroy();
    fs.rm(filepath, { force: true }, () => {});
  });
  req.on('error', () => {
    output.destroy();
    fs.rm(filepath, { force: true }, () => {});
  });
  req.on('end', () => {
    requestEnded = true;
    if (tooLarge) return fail(413, 'Cada arquivo pode ter até 250 MB.');
    if (answered) return;
    if (bytes === 0) return fail(400, 'O arquivo está vazio. Escolha outro arquivo.');
    output.end();
  });
  output.on('finish', () => {
    if (!requestEnded || answered) return;
    try {
      const post = {
        id: crypto.randomBytes(12).toString('hex'),
        title,
        originalName,
        mime,
        size: bytes,
        mediaUrl: `/media/${filename}`,
        createdAt: new Date().toISOString()
      };
      const posts = readPosts();
      posts.unshift(post);
      writePosts(posts);
      answered = true;
      sendJson(res, 201, { post });
    } catch (error) {
      console.error('Falha ao registrar upload:', error.message);
      fail(500, 'O arquivo foi recebido, mas não foi possível registrar o pin.');
    }
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");

  let url;
  try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return sendJson(res, 400, { error: 'Endereço inválido.' }); }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(INDEX_FILE).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/api/posts') {
    const posts = readPosts().map(({ id, title, originalName, mime, size, mediaUrl, createdAt }) => ({ id, title, originalName, mime, size, mediaUrl, createdAt }));
    return sendJson(res, 200, { posts });
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    return sendJson(res, 200, { authenticated: authorized(req) });
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    return (async () => {
      if (!OWNER_PASSWORD) {
        req.resume();
        return sendJson(res, 503, { error: 'O envio ainda não foi configurado pelo proprietário. O mural está disponível apenas para visualização.' });
      }
      const address = req.socket.remoteAddress || 'unknown';
      const attempts = loginAttempts.get(address) || { count: 0, since: Date.now() };
      if (Date.now() - attempts.since > 15 * 60 * 1000) { attempts.count = 0; attempts.since = Date.now(); }
      if (attempts.count >= 8) return sendJson(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' });
      let input;
      try { input = await readJson(req); }
      catch (error) { return sendJson(res, 400, { error: error.message }); }
      const valid = equalSecret(input.username || '', OWNER_USERNAME) && equalSecret(input.password || '', OWNER_PASSWORD);
      if (!valid) {
        attempts.count++;
        loginAttempts.set(address, attempts);
        return sendJson(res, 401, { error: 'Nome ou senha incorretos.' });
      }
      loginAttempts.delete(address);
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, Date.now() + SESSION_TTL_MS);
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return sendJson(res, 200, { authenticated: true }, { 'Set-Cookie': `mural_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}` });
    })();
  }

  if (req.method === 'POST' && url.pathname === '/api/uploads') return requestUpload(req, res);

  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const filename = url.pathname.slice('/media/'.length);
    if (!/^[a-f0-9]{36}\.(jpg|png|gif|webp|avif|mp4|webm|mov)$/.test(filename)) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
    const filepath = path.join(UPLOAD_DIR, filename);
    fs.stat(filepath, (error, stat) => {
      if (error || !stat.isFile()) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
      const mime = MIME_BY_EXT.get(path.extname(filename)) || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(filepath).pipe(res);
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const token = cookieValue(req, 'mural_session');
    sessions.delete(token);
    return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': 'mural_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  return sendJson(res, 404, { error: 'Não encontrado.' });
});

server.listen(PORT, HOST, () => {
  console.log(`Mural disponível em http://${HOST}:${PORT}`);
  console.log('Os uploads ficam na pasta data/uploads ao lado deste servidor.');
});


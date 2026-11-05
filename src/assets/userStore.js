/**
 * 登录态与账号管理（对接后端 /api/auth/*）。
 *
 * 改造前这里是一张纯浏览器本地的用户表：口令明文存在 localStorage，
 * 登录只做 `user.password !== password` 的字符串比对，改一行 localStorage
 * 就能变成管理员。现在改成：
 *
 *   - 账号表在后端 backend/data/users.json，口令只存 bcrypt 哈希
 *   - 登录成功拿 JWT，放 Authorization 头（见 services/DataService.js）
 *   - 前端只缓存"令牌 + 用户资料快照"，不缓存任何凭据
 *
 * 令牌放 sessionStorage：刷新同一标签页仍有效，新开标签页或换设备要重新登录。
 * restoreSession 保持同步（App.vue 在 data() 里就要结果），过期判断在前端解
 * 析 exp 完成，真正的权威校验仍由后端在每个请求上做。
 */
const SESSION_KEY = 'mine_eco_session';

function readSession() {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    return value === null ? null : JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function writeSession(value) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch (error) {
    /* 隐私模式或存储受限时忽略，退回未登录状态 */
  }
}

function removeSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (error) {
    /* ignore */
  }
  // 早期版本把会话写在 localStorage，升级后统一清掉，避免跨会话自动登录
  try {
    localStorage.removeItem('mine_eco_current_user');
    localStorage.removeItem('mine_eco_users');
    localStorage.removeItem('mine_eco_token');
  } catch (error) {
    /* ignore */
  }
}

/** 解析 JWT 载荷。不验签——验签是后端的事，这里只看是否过期。 */
function decodePayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split('')
        .map(char => '%' + ('00' + char.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

/** 令牌是否仍然可用：存在、能解析、且未过期（留 30 秒余量） */
export function tokenIsValid(token) {
  const payload = decodePayload(token);
  if (!payload || !payload.exp) return false;
  return payload.exp * 1000 > Date.now() + 30 * 1000;
}

export function getToken() {
  const session = readSession();
  if (!session || !tokenIsValid(session.token)) return '';
  return session.token;
}

export function getCurrentUser() {
  const session = readSession();
  return session ? session.user || null : null;
}

export function setCurrentUser(user, token) {
  const previous = readSession();
  writeSession({
    token: token || (previous ? previous.token : ''),
    user
  });
  return user;
}

export function clearCurrentUser() {
  removeSession();
}

/**
 * 刷新页面后恢复会话。同步返回缓存里的用户，令牌过期则直接清掉。
 *
 * 缓存里的角色/状态可能是旧的（管理员在这段时间里改过），所以拿到结果后
 * 还会在后台打一次 /api/auth/me 校正；校正失败说明账号已停用或被删，
 * 直接把会话清掉，下一次交互就会退回登录页。
 */
export function restoreSession() {
  const session = readSession();
  if (!session || !session.user || !tokenIsValid(session.token)) {
    removeSession();
    return null;
  }

  refreshSession().catch(() => { /* 网络不通时先沿用缓存，不打断使用 */ });
  return session.user;
}

/** 用当前令牌拉一次最新资料，覆盖本地快照 */
export async function refreshSession() {
  const token = getToken();
  if (!token) {
    removeSession();
    return null;
  }
  const response = await fetch('/api/auth/me', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  if (response.status === 401 || response.status === 403) {
    removeSession();
    return null;
  }
  if (!response.ok) {
    throw new Error(`读取账号信息失败：HTTP ${response.status}`);
  }
  const data = await response.json();
  setCurrentUser(data.user, token);
  return data.user;
}

/* ============================== 登录 / 注册 ============================== */

export async function authenticate(identifier, password) {
  let response;
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identifier, password })
    });
  } catch (error) {
    return { ok: false, message: '无法连接后端服务，请确认服务已启动' };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, message: data.error || '账号或密码不正确' };
  }
  setCurrentUser(data.user, data.token);
  return { ok: true, user: data.user, token: data.token };
}

export async function registerUser(payload) {
  let response;
  try {
    response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        username: payload.username,
        password: payload.password,
        displayName: payload.displayName,
        email: payload.email,
        mobile: payload.mobile
        // role 不传：自助注册一律是普通用户，服务端也会忽略这个字段
      })
    });
  } catch (error) {
    return { ok: false, message: '无法连接后端服务，请确认服务已启动' };
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, message: data.error || '注册失败' };
  }
  return { ok: true, user: data.user };
}

export async function logout() {
  const token = getToken();
  clearCurrentUser();
  if (!token) return { ok: true };
  try {
    // 无状态令牌，服务端无需清理；这个调用只是留一条退出记录
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch (error) {
    /* 退出不依赖网络 */
  }
  return { ok: true };
}

export async function changePassword(oldPassword, newPassword) {
  const token = getToken();
  let response;
  try {
    response = await fetch('/api/auth/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ oldPassword, newPassword })
    });
  } catch (error) {
    return { ok: false, message: '无法连接后端服务，请确认服务已启动' };
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, message: data.error || '修改密码失败' };
  return { ok: true };
}

/* ============================== 账号管理（管理员） ============================== */

async function callAdmin(path, options = {}) {
  const token = getToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `请求失败：HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function getUsers() {
  const data = await callAdmin('/api/auth/users');
  return data.users || [];
}

export async function createUser(payload) {
  try {
    const data = await callAdmin('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return { ok: true, user: data.user };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export async function updateUser(id, patch) {
  try {
    const data = await callAdmin(`/api/auth/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    // 改的是自己：把最新资料写回本地会话，避免界面还显示旧角色
    if (data.self && data.user) setCurrentUser(data.user);
    return { ok: true, user: data.user };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export async function deleteUser(id) {
  try {
    await callAdmin(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export function roleLabel(role) {
  return role === 'admin' ? '管理员' : '普通用户';
}

export function statusLabel(status) {
  return status === 'disabled' ? '已停用' : '正常';
}

export function formatUserTime(value) {
  if (!value) return '暂无记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

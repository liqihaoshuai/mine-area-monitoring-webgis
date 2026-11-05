//  导入axios
import axios from 'axios';
import { getToken, clearCurrentUser } from '../assets/userStore.js';

// 创建一个 axios 实例，用于发送请求
const apiClient = axios.create({
  // 同源相对路径：开发时由 Vite 代理到后端，生产时 Flask 直接托管 dist
  baseURL: '/',
  // 超时设置（毫秒）
  timeout: 30000,
  // 设置请求头
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  // 允许跨域携带凭证
  withCredentials: false
});

// 添加请求拦截器
apiClient.interceptors.request.use(
  config => {
    // 后端除 /api/auth/login|register 外全部要求令牌，这里统一挂上去
    const token = getToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  error => {
    // 请求错误处理
    console.error('请求错误:', error);
    return Promise.reject(error);
  }
);

// 添加响应拦截器
apiClient.interceptors.response.use(
  response => {
    // 对响应数据做处理
    return response;
  },
  error => {
    // 令牌过期或被停用：清掉本地会话并通知外层退回登录页。
    // 用自定义事件而不是直接调路由，避免这里反向依赖 router。
    const status = error.response ? error.response.status : 0;
    if (status === 401 || status === 403) {
      clearCurrentUser();
      window.dispatchEvent(new CustomEvent('mine-auth-expired'));
    }
    // 如果是跨域错误，提供更具体的错误信息
    if (error.message.includes('Network Error') || !error.response) {
      console.error('可能是跨域问题或服务器未响应');
    }
    return Promise.reject(error);
  }
);

/**
 * 给图片类地址补上令牌。
 *
 * Leaflet 的 <img>/canvas 直接发请求，带不了自定义请求头，后端因此对
 * preview/download/png 这几条路径额外接受 ?token= 查询参数。
 */
export function withToken(url) {
  if (!url) return url;
  const token = getToken();
  if (!token) return url;
  const stamp = `token=${encodeURIComponent(token)}`;
  if (String(url).indexOf('token=') >= 0) return url;
  return String(url) + (String(url).indexOf('?') >= 0 ? '&' : '?') + stamp;
}

// 定义一个用于获取数据的函
export default {
  getResults(params = {}) {
    return apiClient.get('/api/results', { params });
  },
  getEvaluationRecords(params = {}) {
    return apiClient.get('/api/evaluation-records', { params });
  },
  /** 长时序趋势表：Sen 斜率 + Mann-Kendall 检验（读后端注册表，不重算栅格） */
  getTrend(params = {}) {
    return apiClient.get('/api/trend', { params });
  },
  /** 逐像元趋势显著性图：对同一指标的多期栅格叠起来算 Sen+MK */
  processTrend(payload) {
    return apiClient.post('/api/process_trend', payload, { timeout: 300000 });
  },
  /** 趋势图预览地址：趋势结果按 trend_<指标> 注册，路径必须带指标名 */
  trendPreviewUrl(params = {}) {
    const metric = String(params.metric || 'RSEI').toLowerCase();
    const query = Object.keys(params)
      .filter(key => key !== 'metric')
      .filter(key => params[key] !== undefined && params[key] !== '')
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    // baseURL 现在是 '/'，直接拼会得到 '//api/...'（协议相对地址，会被解析成主机名 api），
    // 这里先去掉结尾斜杠，得到 '/api/...' 这样的同源相对路径。
    const base = String(apiClient.defaults.baseURL || '').replace(/\/+$/, '');
    return withToken(`${base}/api/results/trend_${metric}/preview${query ? '?' + query : ''}`);
  },
  getMineStats(metric, params = {}) {
    return apiClient.get(`/api/results/${metric}/mine-stats`, { params });
  },
  getMineRasterConfig() {
    return apiClient.get('/api/mine-raster/config');
  },
  processMineRasters(payload) {
    return apiClient.post('/api/mine-raster/process', payload);
  },
  processMineTerrain(payload) {
    return apiClient.post('/api/mine-raster/terrain', payload);
  },
  getProcessedMineRasters(year, mineId) {
    return apiClient.get('/api/mine-raster/processed', {
      params: { year, mine_id: mineId },
    });
  },
  process_rsei(rasterPath, year, mineAreaPath = '', nameField = '', mineId = '', processedRasterPath = '') {
    return apiClient.post('/api/process_rsei', {
      raster_path: rasterPath,
      sensor: 'landsat89',
      year,
      mine_id: mineId || undefined,
      processed_raster_path: processedRasterPath || undefined,
      mine_area_path: mineAreaPath || undefined,
      name_field: nameField || undefined,
    });
  },
  process_fvc(rasterPath, sensor = 'landsat89', year = null, mineAreaPath = '', nameField = '', mineId = '', processedRasterPath = '') {
    return apiClient.post('/api/process_fvc', {
      raster_path: rasterPath,
      sensor,
      year,
      mine_id: mineId || undefined,
      processed_raster_path: processedRasterPath || undefined,
      mine_area_path: mineAreaPath || undefined,
      name_field: nameField || undefined,
    });
  },
  process_vri(imagePathEarly, imagePathLate, sensor = 'landsat89', year = null, baselineYear = null, mineAreaPath = '', nameField = '', mineId = '', processedEarlyPath = '', processedLatePath = '') {
    return apiClient.post('/api/process_vri', {
      image_path_early: imagePathEarly,
      image_path_late: imagePathLate,
      sensor,
      year,
      baseline_year: baselineYear,
      mine_id: mineId || undefined,
      processed_raster_path_early: processedEarlyPath || undefined,
      processed_raster_path_late: processedLatePath || undefined,
      mine_area_path: mineAreaPath || undefined,
      name_field: nameField || undefined,
    });
  },
  process_ndmi(rasterPath, sensor = 'landsat89', year = null, mineAreaPath = '', nameField = '', mineId = '', processedRasterPath = '') {
    return apiClient.post('/api/process_ndmi', {
      image_path: rasterPath,
      sensor,
      year,
      mine_id: mineId || undefined,
      processed_raster_path: processedRasterPath || undefined,
      mine_area_path: mineAreaPath || undefined,
      name_field: nameField || undefined,
    });
  },
  process_ndsi(rasterPath, sensor = 'landsat89', year = null, mineAreaPath = '', nameField = '', mineId = '', processedRasterPath = '') {
    return apiClient.post('/api/process_ndsi', {
      image_path: rasterPath,
      sensor,
      year,
      mine_id: mineId || undefined,
      processed_raster_path: processedRasterPath || undefined,
      mine_area_path: mineAreaPath || undefined,
      name_field: nameField || undefined,
    });
  },
};

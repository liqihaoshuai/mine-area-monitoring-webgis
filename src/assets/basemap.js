import L from 'leaflet';
import config from './config.js';

/**
 * 底图（影像 + 注记）统一入口。
 *
 * 天地图的浏览器端 key 有配额，用超了会整片返回 429「该tk已限流」，
 * 瓦片全部失败。原来的写法是「任意一张瓦片 tileerror → imagery.remove()」，
 * 一旦赶上限流就永久丢底图，缩回去也不会再回来。
 *
 * 这里的行为：
 *   1. 先用天地图；单张失败只计数，连续失败到阈值才判定「底图不可用」；
 *   2. 不可用时切到 Esri World Imagery（无需 key、同为 EPSG:3857，位置对得上）；
 *   3. 备用底图若也连续失败，标记为 degraded 并广播状态，界面给出明确提示；
 *   4. 每 60 秒探测一次天地图，恢复后自动切回；也可调用 retryBasemaps() 手动重试；
 *   5. 天地图/Esri 都只到 18 级，超出后由 Leaflet 放大上一级瓦片（maxNativeZoom），
 *      避免「放大到 19 级就整片空白」。
 */

// 天地图浏览器端 key：换 key 只改 assets/config.js 里的 tdtToken
export const TDT_TOKEN = config.tdtToken || 'b1d544a40894bb694f07402387b87510';

const SUBS = ['0', '1', '2', '3', '4', '5', '6', '7'];
// 两家底图的最高原生层级：18。超过就放大，别再请求不存在的瓦片。
const NATIVE_MAX = 18;
const MAX_ZOOM = 19;

export const TDT_IMG_URL = tk =>
  `https://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk=${tk}`;
export const TDT_CVA_URL = tk =>
  `https://t{s}.tianditu.gov.cn/DataServer?T=cva_w&x={x}&y={y}&l={z}&tk=${tk}`;

// 兜底底图：Esri 公开瓦片，不需要 key
export const ESRI_IMG_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_LABEL_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

// 连续失败多少张就判定不可用（限流时基本每张都失败，几张就够判断）
const FAIL_LIMIT = 5;
// 多久探测一次天地图是否恢复
const PROBE_MS = 60000;
// 底图状态广播：App.vue 收到后在页面上给提示（而不是让用户对着白底图猜）
export const BASEMAP_STATUS_EVENT = 'webgis:basemap-status';

const instances = new Set();

/** 手动重试所有底图（界面上的「重试」按钮调用） */
export function retryBasemaps() {
  instances.forEach(item => item.retry());
}

function emitStatus(status) {
  try {
    window.dispatchEvent(new CustomEvent(BASEMAP_STATUS_EVENT, { detail: status }));
  } catch (error) {
    /* 事件广播失败不影响底图 */
  }
}

export function createBasemap(map, options = {}) {
  const token = options.token || TDT_TOKEN;
  const opacity = options.opacity;
  const onSwap = typeof options.onSwap === 'function' ? options.onSwap : () => {};
  const imageryPane = options.imageryPane || null;
  const annotationPane = options.annotationPane || null;
  let annotationWanted = options.annotation !== false;

  const paneOf = pane => (pane ? { pane } : {});
  const baseOptions = {
    subdomains: SUBS,
    maxNativeZoom: NATIVE_MAX,
    maxZoom: MAX_ZOOM,
  };

  const tdtImg = () => {
    const layer = L.tileLayer(TDT_IMG_URL(token), Object.assign({}, baseOptions, {
      attribution: '© 天地图',
    }, paneOf(imageryPane)));
    layer._webgisBasemap = true;
    return layer;
  };
  const tdtLabel = () => {
    const layer = L.tileLayer(TDT_CVA_URL(token), Object.assign({}, baseOptions, {
      attribution: '© 天地图',
    }, paneOf(annotationPane)));
    layer._webgisBasemap = true;
    return layer;
  };
  const esriImg = () => {
    const layer = L.tileLayer(ESRI_IMG_URL, Object.assign({}, baseOptions, {
      attribution: '© Esri World Imagery',
    }, paneOf(imageryPane)));
    layer._webgisBasemap = true;
    return layer;
  };
  const esriLabel = () => {
    const layer = L.tileLayer(ESRI_LABEL_URL, Object.assign({}, baseOptions, {
      attribution: '© Esri',
    }, paneOf(annotationPane)));
    layer._webgisBasemap = true;
    return layer;
  };

  let imagery = tdtImg();
  let annotation = tdtLabel();
  let fails = 0;
  let fallbackFails = 0;
  let fallback = false;
  let degraded = false;
  let probeTimer = null;
  let destroyed = false;

  if (opacity !== undefined && imagery.setOpacity) imagery.setOpacity(opacity);

  const showAnnotation = () => {
    if (!annotationWanted) return;
    if (!map.hasLayer(annotation)) annotation.addTo(map);
    annotation.bringToFront();
  };

  const hideAnnotation = () => {
    if (map.hasLayer(annotation)) map.removeLayer(annotation);
  };

  function notify(reason) {
    const status = {
      fallback,
      degraded,
      provider: fallback ? 'esri' : 'tianditu',
      reason: reason || '',
    };
    onSwap(imagery, annotation, status);
    emitStatus(status);
  }

  // 每次换图层都要重新挂事件：否则切换后的 Esri 图层失败也没人数
  function watch(layer) {
    layer.on('tileerror', () => {
      if (destroyed) return;
      if (!fallback) {
        fails += 1;
        if (fails >= FAIL_LIMIT) useFallback('天地图瓦片加载失败（多为 key 配额限流）');
      } else {
        fallbackFails += 1;
        if (!degraded && fallbackFails >= FAIL_LIMIT) {
          degraded = true;
          notify('备用影像也加载失败，请检查网络或更换天地图 key');
          startProbe();
        }
      }
    });
    layer.on('tileload', () => {
      if (fallback) fallbackFails = 0; else fails = 0;
    });
  }

  function useFallback(reason) {
    if (fallback || destroyed) return;
    fallback = true;
    degraded = false;
    fallbackFails = 0;
    if (map.hasLayer(imagery)) map.removeLayer(imagery);
    if (map.hasLayer(annotation)) map.removeLayer(annotation);
    imagery = esriImg();
    annotation = esriLabel();
    watch(imagery);
    if (opacity !== undefined && imagery.setOpacity) imagery.setOpacity(opacity);
    imagery.addTo(map);
    showAnnotation();
    notify(reason);
    startProbe();
  }

  function restore() {
    if (!fallback || destroyed) return;
    fallback = false;
    degraded = false;
    fails = 0;
    fallbackFails = 0;
    if (map.hasLayer(imagery)) map.removeLayer(imagery);
    if (map.hasLayer(annotation)) map.removeLayer(annotation);
    imagery = tdtImg();
    annotation = tdtLabel();
    watch(imagery);
    if (opacity !== undefined && imagery.setOpacity) imagery.setOpacity(opacity);
    imagery.addTo(map);
    showAnnotation();
    notify('');
    stopProbe();
  }

  // 用一张固定存在的小瓦片判断天地图是否恢复（限流解除后能正常返回）
  function probeOnce() {
    if (destroyed) return;
    const probe = new Image();
    probe.onload = () => { if (fallback) restore(); };
    probe.onerror = () => {};
    probe.src = `https://t0.tianditu.gov.cn/DataServer?T=img_w&x=1&y=0&l=1&tk=${token}&_=${Date.now()}`;
  }

  function startProbe() {
    if (probeTimer) return;
    probeTimer = setInterval(probeOnce, PROBE_MS);
  }

  function stopProbe() {
    if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
  }

  watch(imagery);
  imagery.addTo(map);

  const api = {
    get imagery() { return imagery; },
    get annotation() { return annotation; },
    setAnnotation(visible) {
      annotationWanted = !!visible;
      if (annotationWanted) showAnnotation(); else hideAnnotation();
    },
    setOpacity(value) {
      if (imagery.setOpacity) imagery.setOpacity(value);
    },
    /** 手动重试：优先探测天地图，恢复就切回；没恢复就继续用备用底图 */
    retry() {
      if (destroyed) return;
      if (fallback) {
        probeOnce();
        // 天地图还没恢复也把备用瓦片重新拉一遍（清掉之前的错误状态）
        if (imagery.redraw) imagery.redraw();
        return;
      }
      fails = 0;
      if (imagery.redraw) imagery.redraw();
    },
    // 供「本页自带地图」的模块临时停用主地图底图（如变化监测页把主地图藏起来时），
    // 避免它继续请求瓦片，白耗配额
    suspend() {
      if (map && map.hasLayer(imagery)) map.removeLayer(imagery);
      if (map && map.hasLayer(annotation)) map.removeLayer(annotation);
    },
    resume() {
      if (destroyed) return;
      if (map && !map.hasLayer(imagery)) imagery.addTo(map);
      if (annotationWanted) showAnnotation();
    },
    destroy() {
      destroyed = true;
      instances.delete(api);
      stopProbe();
      if (map && map.hasLayer(imagery)) map.removeLayer(imagery);
      if (map && map.hasLayer(annotation)) map.removeLayer(annotation);
    },
  };

  instances.add(api);
  return api;
}

export default createBasemap;

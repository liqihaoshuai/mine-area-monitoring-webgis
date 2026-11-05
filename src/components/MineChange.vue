<template>
  <div class="change-page">
    <div ref="mapBox" class="change-map"></div>

    <div class="ctrl-panel">
      <div class="ctrl-title">变化监测</div>

      <div class="ctrl-row">
        <span class="ctrl-label">数据源</span>
        <el-radio-group v-model="sensor" size="small" @change="reloadAll">
          <el-radio-button
            v-for="item in sensors"
            :key="item.value"
            :label="item.value"
            :disabled="isRsei && item.value === 'sentinel2'"
          >
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <div class="ctrl-row">
        <span class="ctrl-label">图层</span>
        <el-select v-model="metric" size="small" class="mini-select" @change="onMetricChange">
          <el-option
            v-for="item in metrics"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          ></el-option>
        </el-select>
      </div>

      <div class="ctrl-row">
        <span class="ctrl-label">模式</span>
        <el-radio-group v-model="mode" size="small" @change="onModeChange">
          <el-radio-button value="single">单年</el-radio-button>
          <el-radio-button value="swipe">卷帘</el-radio-button>
          <el-radio-button value="diff" :disabled="isImagery">变化监测</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 单年 + 时间轴 -->
      <template v-if="mode === 'single'">
        <div class="ctrl-row">
          <el-button
            size="small"
            :type="playing ? 'danger' : 'success'"
            :icon="playing ? 'VideoPause' : 'VideoPlay'"
            @click="togglePlay"
          >{{ playing ? '停止' : '时间轴播放' }}</el-button>
          <span class="year-badge">{{ currentYear }} 年</span>
          <span v-if="loading" class="loading-text">加载中…</span>
        </div>
        <div class="year-chips">
          <span
            v-for="year in years"
            :key="year"
            :class="['chip', year === currentYear ? 'is-active' : '']"
            @click="selectYear(year)"
          >{{ year }}</span>
        </div>
      </template>

      <!-- 卷帘 -->
      <template v-else-if="mode === 'swipe'">
        <div class="ctrl-row">
          <span class="ctrl-label">左 / 右</span>
          <el-select v-model="swipeLeftYear" size="small" class="tiny-select" @change="renderSwipe">
            <el-option v-for="year in years" :key="'l' + year" :label="String(year)" :value="year"></el-option>
          </el-select>
          <span class="vs">vs</span>
          <el-select v-model="swipeRightYear" size="small" class="tiny-select" @change="renderSwipe">
            <el-option v-for="year in years" :key="'r' + year" :label="String(year)" :value="year"></el-option>
          </el-select>
        </div>
        <div class="ctrl-row">
          <span class="ctrl-label">分割</span>
          <el-slider
            v-model="swipePos"
            :min="0"
            :max="100"
            :show-tooltip="false"
            class="swipe-slider"
            @input="applySwipeClip"
          ></el-slider>
          <span class="year-badge">{{ swipePos }}%</span>
        </div>
      </template>

      <!-- 变化监测 -->
      <template v-else>
        <div class="ctrl-row">
          <span class="ctrl-label">期间</span>
          <el-select v-model="diffFrom" size="small" class="tiny-select" @change="renderDiff">
            <el-option v-for="year in years" :key="'f' + year" :label="String(year)" :value="year"></el-option>
          </el-select>
          <span class="vs">→</span>
          <el-select v-model="diffTo" size="small" class="tiny-select" @change="renderDiff">
            <el-option v-for="year in years" :key="'t' + year" :label="String(year)" :value="year"></el-option>
          </el-select>
        </div>
        <div v-if="diffRows.length" class="diff-table">
          <div v-for="row in diffRows" :key="row.mine_id" class="diff-line">
            <span class="diff-mine">{{ row.label }}</span>
            <span class="diff-improve">变好 {{ row.stats.net_improve_ratio }}%</span>
            <span class="diff-degrade">明显变差 {{ row.stats.ratio['明显变差'] }}%</span>
          </div>
        </div>
      </template>

      <!-- 图例：真彩色影像没有色标 -->
      <div v-if="isImagery" class="legend image-hint">真彩色影像 · 矿区范围</div>
      <div v-else-if="mode !== 'diff'" class="legend">
        <div class="legend-bar" :style="legendStyle"></div>
        <div class="legend-scale">
          <span>{{ legendMin }}</span>
          <span>{{ legendMax }}</span>
        </div>
      </div>
      <div v-else class="legend legend-classes">
        <span v-for="item in diffClasses" :key="item.value" class="legend-item">
          <i :style="{ background: item.color }"></i>{{ item.label }}
        </span>
      </div>

      <div v-if="errorText" class="ctrl-error">{{ errorText }}</div>
    </div>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import config from '../assets/config.js';
import { readAnnotationVisible } from '../assets/preferences.js';
import { changeImageLayer } from './changeImageLayer.js';
import { createBasemap } from '../assets/basemap.js';
import { withToken } from '../services/DataService.js';
import { getToken } from '../assets/userStore.js';

// 变化监测走 Flask 的 PNG 接口，不经过 GeoServer
const API_BASE = window.location.origin;   // 同源：开发走 Vite 代理，生产同端口

export default {
  name: 'MineChange',
  data() {
    return {
      map: null,
      years: [],
      metrics: [],
      sensors: [],
      mines: [],
      diffClasses: [],
      sensor: 'landsat89',
      metric: 'RSEI',
      mode: 'single',
      currentYear: null,
      playing: false,
      playTimer: null,
      swipeLeftYear: null,
      swipeRightYear: null,
      swipePos: 50,
      // 注记层单独记一份引用：本页是独立 Leaflet 实例，主系统的开关管不到这里
      annotationLayer: null,
      annotationVisible: readAnnotationVisible(),
      diffFrom: null,
      diffTo: null,
      diffRows: [],
      overlays: [],
      clippedLayers: [],
      loading: false,
      errorText: '',
      cache: {},
      // 排障开关：?changeLayer=image 退回旧的大图 ImageOverlay 渲染
      useImageOverlay: new URLSearchParams(window.location.search).get('changeLayer') === 'image',
    };
  },
  computed: {
    currentMetric() {
      return this.metrics.find(item => item.value === this.metric) || {};
    },
    // RSEI 依赖 Landsat 热红外反演，哨兵二号没有 RSEI 成果，切过去只会是空图层
    isRsei() {
      return this.metric === 'RSEI';
    },
    // 真彩色影像作为独立对比项：只是把该年的矿区影像铺上来，没有色标也没有差值
    isImagery() {
      return this.metric === 'IMAGERY';
    },
    legendStyle() {
      const colors = (this.currentMetric.colors || []).join(', ');
      return colors
        ? { background: `linear-gradient(90deg, ${colors})` }
        : { background: '#eee' };
    },
    legendMin() {
      return this.currentMetric.vmin === null || this.currentMetric.vmin === undefined
        ? '' : this.currentMetric.vmin;
    },
    legendMax() {
      return this.currentMetric.vmax === null || this.currentMetric.vmax === undefined
        ? '' : this.currentMetric.vmax;
    },
  },
  mounted() {
    this.initMap();
    this.loadMeta();
    // 本页是独立地图，App 的主地图仍然挂在下面（同尺寸、同位置）。
    // 只要它露出一点边（内边距变化、窗口缩放），就会出现"外面那圈影像不动"的错觉，
    // 干脆在本页把主地图隐藏，离开时恢复。
    this.toggleMainMap(false);
    // 页头「清除图层」按钮广播事件：本页用的是独立 Leaflet 实例，主地图清不到这里
    window.addEventListener('webgis:clear-overlays', this.clearAllOverlays);
    // 页头「注记 开/关」广播事件：同理，主地图的注记层不在本页
    window.addEventListener('webgis:annotation-toggle', this.handleAnnotationToggle);
  },
  beforeUnmount() {
    this.toggleMainMap(true);
    window.removeEventListener('webgis:clear-overlays', this.clearAllOverlays);
    window.removeEventListener('webgis:annotation-toggle', this.handleAnnotationToggle);
    this.stopPlay();
    if (this.basemap) {
      this.basemap.destroy();
      this.basemap = null;
    }
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  },
  methods: {
    initMap() {
      this.map = markRaw(L.map(this.$refs.mapBox, {
        center: [39.67, 118.75],
        zoom: 12,
        zoomControl: true,
        attributionControl: false,
      }));

      // 底图走统一模块：天地图 key 限流（429）时自动切 Esri 影像，恢复后再切回。
      // 旧实现在任意一张瓦片 tileerror 时就直接 imagery.remove()，一旦限流底图就永久消失，
      // 而且缩回去也不会再回来。
      this.basemap = markRaw(createBasemap(this.map, {
        annotation: this.annotationVisible,
        onSwap: (imagery, annotation) => {
          this.annotationLayer = markRaw(annotation);
          this.applyAnnotation(this.annotationVisible);
        },
      }));
      this.annotationLayer = markRaw(this.basemap.annotation);

      // 缩放/平移交给 GridLayer 自己处理（与 WMS 图层同一条通道）；
      // 这里只处理容器尺寸变化，尺寸变了要重新量一遍，否则瓦片会错位
      this.map.on('resize', this.handleResize);
      this.applySwipeClip();

      // 进页面时容器可能还没完成布局，Leaflet 会把尺寸记成 0，之后所有图层都会错位
      this.$nextTick(() => {
        if (!this.map) return;
        this.map.invalidateSize();
        setTimeout(() => { if (this.map) this.map.invalidateSize(); }, 260);
      });
    },
    /** 显示 / 隐藏 App 主地图（只在本页生效） */
    toggleMainMap(visible) {
      const el = document.getElementById('mapContainer');
      if (el) el.style.visibility = visible ? '' : 'hidden';
      // 主地图藏起来后它仍会继续请求底图瓦片，白白消耗天地图配额，这里让它暂停
      try {
        window.dispatchEvent(new CustomEvent(visible ? 'webgis:basemap-resume' : 'webgis:basemap-suspend'));
      } catch (error) {
        // 广播失败不影响主流程
      }
    },
    /** 容器尺寸变化：重新量一次地图尺寸，瓦片由 GridLayer 自行重排 */
    handleResize() {
      if (!this.map) return;
      this.map.invalidateSize({ pan: false });
      this.applySwipeClip();
    },
    handleAnnotationToggle(event) {
      const visible = event && event.detail ? !!event.detail.visible : true;
      this.applyAnnotation(visible);
    },
    applyAnnotation(visible) {
      this.annotationVisible = visible;
      if (this.basemap) {
        this.basemap.setAnnotation(visible);
        return;
      }
      const layer = this.annotationLayer;
      if (!layer || !this.map) return;
      if (visible) {
        if (!this.map.hasLayer(layer)) layer.addTo(this.map);
        layer.bringToFront();
      } else if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
    },
    loadMeta() {
      this.apiBase = API_BASE;
      fetch(this.url('/api/mine-view/meta'), { headers: this.authHeaders() })
        .then(response => response.json())
        .then(data => {
          this.years = data.years || [];
          // 真彩色影像作为独立对比项，和五个指标并列放在「指标」下拉里
          this.metrics = (data.metrics || []).concat([
            { value: 'IMAGERY', label: '真彩色影像', colors: [], vmin: null, vmax: null },
          ]);
          this.sensors = data.sensors || [];
          this.mines = data.mines || [];
          this.diffClasses = data.diff_classes || [];
          const last = this.years[this.years.length - 1];
          this.currentYear = last || null;
          this.swipeLeftYear = this.years[0] || null;
          this.swipeRightYear = last || null;
          this.diffFrom = this.years[0] || null;
          this.diffTo = last || null;
          this.renderSingle();
        })
        .catch(error => {
          this.errorText = '读取变化监测元数据失败：' + error.message;
        });
    },
    url(path) {
      return `${this.apiBase}${path}`;
    },
    /**
     * /api/* 现在都要令牌。这里没有走 axios，手工带上 Authorization。
     * 图片类地址（L.imageOverlay / changeImageLayer）带不了请求头，
     * 由 url() 之外的 addMineOverlays 用 withToken() 拼 ?token=。
     */
    authHeaders() {
      const token = getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    clearOverlays() {
      if (!this.map) return;
      this.overlays.forEach(layer => this.map.removeLayer(layer));
      this.overlays = [];
      this.clippedLayers = [];
    },
    /** 页头「清除图层」：清掉叠加图层与分析结果，控件状态保留 */
    clearAllOverlays() {
      this.clearOverlays();
      this.diffRows = [];
      this.errorText = '';
    },
    fitToMines(layers) {
      const boxes = layers.map(item => L.latLngBounds(item.bounds));
      if (!boxes.length) return;
      let box = boxes[0];
      boxes.slice(1).forEach(item => { box = box.extend(item); });
      this.map.fitBounds(box, { padding: [40, 40] });
    },
    addMineOverlays(layers, pane, opacity, clip) {
      const created = [];
      layers.forEach(item => {
        // 默认走 256px 画布瓦片，和「矿区查看」的 WMS 图层一样由 GridLayer 负责缩放动画，
        // 不再让一张 2000×2000 的大图在缩放时整体重采样。
        // 加 ?changeLayer=image 可退回旧的 ImageOverlay 实现（对比/排障用）。
        const layer = this.useImageOverlay
          ? L.imageOverlay(withToken(this.url(item.url)), item.bounds, {
            pane: pane || 'overlayPane',
            opacity: opacity === undefined ? 0.85 : opacity,
            interactive: false,
          })
          : changeImageLayer(withToken(this.url(item.url)), item.bounds, {
            pane: pane || 'overlayPane',
            opacity: opacity === undefined ? 0.85 : opacity,
            interactive: false,
            hasClip: !!clip,
            clipStart: clip ? this.swipePos / 100 : 0,
          });
        layer.addTo(this.map);
        this.overlays.push(layer);
        if (clip) this.clippedLayers.push(layer);
        created.push(layer);
      });
      return created;
    },
    /** 取某年的真彩色底图图层（本地裁剪影像的 RGB） */
    fetchImagery(year) {
      const key = `${year}|${this.sensor}|img`;
      if (this.cache[key]) return Promise.resolve(this.cache[key]);
      const url = this.url(`/api/mine-view/imagery?year=${year}&sensor=${this.sensor}`);
      return fetch(url, { headers: this.authHeaders() })
        .then(response => response.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          this.cache[key] = data.layers || [];
          return this.cache[key];
        });
    },
    fetchLayers(year) {
      const key = `${year}|${this.metric}|${this.sensor}`;
      if (this.cache[key]) return Promise.resolve(this.cache[key]);
      const url = this.url(`/api/mine-view/layers?year=${year}&metric=${this.metric}&sensor=${this.sensor}`);
      return fetch(url, { headers: this.authHeaders() })
        .then(response => response.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          this.cache[key] = data.layers || [];
          return this.cache[key];
        });
    },
    renderSingle(fit) {
      if (!this.currentYear) return;
      this.loading = true;
      this.errorText = '';
      // 选「真彩色影像」时只取该年的矿区影像，不再叠加任何指标分级图
      const request = this.isImagery
        ? this.fetchImagery(this.currentYear)
        : this.fetchLayers(this.currentYear);
      const opacity = this.isImagery ? 1 : 0.9;
      request
        .then(layers => {
          this.clearOverlays();
          this.addMineOverlays(layers, 'overlayPane', opacity);
          if (fit !== false) this.fitToMines(layers);
        })
        .catch(error => { this.errorText = error.message; })
        .finally(() => { this.loading = false; });
    },
    renderSwipe() {
      if (!this.swipeLeftYear || !this.swipeRightYear) return;
      this.loading = true;
      this.errorText = '';
      const request = year => (
        this.isImagery ? this.fetchImagery(year) : this.fetchLayers(year)
      );
      const opacity = this.isImagery ? 1 : 0.85;
      Promise.all([request(this.swipeLeftYear), request(this.swipeRightYear)])
        .then(([left, right]) => {
          this.clearOverlays();
          // 左年铺在下层，右年铺在上层并逐图裁切 —— 分割线落在每个矿区内部，
          // 这样同一个矿区左右两半分别是两年的图，才有真正的卷帘对比。
          this.addMineOverlays(left, 'overlayPane', opacity);
          this.addMineOverlays(right, 'overlayPane', opacity, true);
          this.applySwipeClip();
          this.fitToMines(right.length ? right : left);
        })
        .catch(error => { this.errorText = error.message; })
        .finally(() => { this.loading = false; });
    },
    applySwipeClip() {
      if (!this.map) return;
      // 逐个图层裁切：分割线落在每个矿区内部（而不是整屏中线），
      // 左右两半正好是两年的图。瓦片层只改 clip-path，不重绘，拖动时不闪。
      const fraction = this.swipePos / 100;
      this.clippedLayers.forEach(layer => {
        if (layer && typeof layer.setClip === 'function') {
          layer.setClip(fraction);
        } else if (layer && layer.getElement) {
          // 旧的 ImageOverlay 兜底实现
          const element = layer.getElement();
          if (!element) return;
          const clip = `inset(0 0 0 ${this.swipePos}%)`;
          element.style.clipPath = clip;
          element.style.webkitClipPath = clip;
        }
      });
    },
    renderDiff() {
      if (!this.diffFrom || !this.diffTo) return;
      // 真彩色影像没有差值口径：万一还停在该模式，直接回单年
      if (this.isImagery) {
        this.mode = 'single';
        this.renderSingle();
        return;
      }
      this.loading = true;
      this.errorText = '';
      const url = this.url(
        `/api/mine-view/diff?y1=${this.diffFrom}&y2=${this.diffTo}` +
        `&metric=${this.metric}&sensor=${this.sensor}`
      );
      fetch(url, { headers: this.authHeaders() })
        .then(response => response.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          const layers = data.layers || [];
          this.diffRows = layers;
          this.clearOverlays();
          this.addMineOverlays(layers, 'overlayPane', 0.9);
          this.fitToMines(layers);
        })
        .catch(error => { this.errorText = error.message; })
        .finally(() => { this.loading = false; });
    },
    onModeChange() {
      this.stopPlay();
      this.clearOverlays();
      if (this.mode === 'single') this.renderSingle();
      else if (this.mode === 'swipe') this.renderSwipe();
      else this.renderDiff();
    },
    onMetricChange() {
      // 选 RSEI 时把数据源拉回 Landsat：否则哨兵二号 + RSEI 会得到空图层
      if (this.isRsei && this.sensor !== 'landsat89') {
        this.sensor = 'landsat89';
      }
      // 真彩色影像没有差值，切到它时回到单年
      if (this.isImagery && this.mode === 'diff') {
        this.mode = 'single';
      }
      this.reloadAll();
    },
    reloadAll() {
      this.stopPlay();
      this.cache = {};
      this.diffRows = [];
      if (this.mode === 'single') this.renderSingle();
      else if (this.mode === 'swipe') this.renderSwipe();
      else this.renderDiff();
    },
    selectYear(year) {
      this.currentYear = year;
      this.renderSingle(false);
    },
    togglePlay() {
      if (this.playing) {
        this.stopPlay();
        return;
      }
      if (this.years.length < 2) return;
      this.mode = 'single';
      this.playing = true;
      let index = Math.max(0, this.years.indexOf(this.currentYear));
      this.playTimer = setInterval(() => {
        index = (index + 1) % this.years.length;
        this.currentYear = this.years[index];
        this.renderSingle(false);
      }, 1300);
    },
    stopPlay() {
      if (this.playTimer) {
        clearInterval(this.playTimer);
        this.playTimer = null;
      }
      this.playing = false;
    },
  },
};
</script>

<style scoped>
.change-page {
  /* 往外扩 20px，正好吃掉 el-main 的默认内边距：
     否则地图四周会露出一圈 App 的主地图（拖动本页地图时那圈影像不动，看着像"被固定"） */
  position: absolute;
  top: -20px;
  left: -20px;
  width: calc(100% + 40px);
  height: calc(100% + 40px);
  overflow: hidden;
}
.change-map {
  position: absolute;
  inset: 0;
  background: #eef2f6;
}
.ctrl-panel {
  /* 与「评价指标」模块的 .metric-panel 同一套右侧定位：
     右边缘距可视区 40px，left 用 --viewport-width 计算（不含滚动条，且不受 transform 祖先影响） */
  position: fixed;
  top: 100px;
  left: calc(var(--viewport-width, 100vw) - 360px);
  width: 320px;
  box-sizing: border-box;
  padding: 14px 16px 16px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 10px;
  box-shadow: 0 6px 22px rgba(31, 45, 61, 0.18);
  z-index: 500;
}
.ctrl-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
  text-align: center;
}
.ctrl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.ctrl-label {
  flex: 0 0 48px;
  font-size: 12px;
  color: #606266;
}
.mini-select {
  width: 190px;
}
.tiny-select {
  width: 84px;
}
.vs {
  font-size: 12px;
  color: #909399;
}
.year-badge {
  font-size: 13px;
  font-weight: 600;
  color: #2b6f9c;
}
.loading-text {
  font-size: 12px;
  color: #909399;
}
.year-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  padding: 2px 9px;
  font-size: 12px;
  color: #606266;
  background: #f2f4f7;
  border-radius: 10px;
  cursor: pointer;
  user-select: none;
}
.chip.is-active {
  color: #fff;
  background: #409eff;
}
.swipe-slider {
  flex: 1;
  margin: 0 6px;
}
.image-hint {
  font-size: 12px;
  color: #606266;
  text-align: center;
  padding: 4px 0 2px;
}
.diff-table {
  margin: 4px 0 8px;
  padding: 8px 10px;
  background: #f7f9fc;
  border-radius: 6px;
  font-size: 12px;
}
.diff-line {
  display: flex;
  gap: 10px;
  line-height: 20px;
}
.diff-mine {
  width: 52px;
  color: #303133;
}
.diff-improve {
  color: #1a9850;
}
.diff-degrade {
  color: #c45656;
}
.legend {
  margin-top: 6px;
}
.legend-bar {
  height: 10px;
  border-radius: 5px;
  border: 1px solid #e4e7ed;
}
.legend-scale {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #909399;
  margin-top: 2px;
}
.legend-classes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: #606266;
}
.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.legend-item i {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
}
.ctrl-error {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: #c45656;
  background: #fef0f0;
  border-radius: 4px;
}
@media (max-width: 900px) {
  .ctrl-panel {
    left: 12px;
    right: 12px;
    width: auto;
  }
}
</style>

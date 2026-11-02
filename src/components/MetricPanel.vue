<template>
  <div class="metric-panel">
    <div class="panel-title">{{ meta.title }}</div>
    <el-select
      v-if="meta.hasSensor"
      v-model="sensor"
      size="small"
      style="width: 150px; margin-bottom: 10px;"
      @change="clearResult"
    >
      <el-option
        v-for="item in sensorOptions"
        :key="item.id"
        :label="item.optionLabel"
        :value="item.id"
      ></el-option>
    </el-select>
    <el-select v-model="mineId" size="small" style="width: 150px; margin-bottom: 10px;" placeholder="选择矿区" @change="clearResult">
      <el-option
        v-for="item in mineOptions"
        :key="item.id"
        :label="item.name"
        :value="item.id"
      ></el-option>
    </el-select>
    <el-select v-model="year" size="small" style="width: 150px; margin-bottom: 10px;" placeholder="选择年份" @change="clearResult">
      <el-option v-for="item in yearOptions" :key="item" :label="String(item)" :value="item"></el-option>
    </el-select>
    <el-button :loading="loading" :disabled="loading" @click="query" style="width: 150px;">计算 {{ meta.code }}</el-button>
    <p v-if="resultText" class="metric-result">{{ resultText }}</p>
  </div>
</template>

<script>
import config from '../assets/config.js';
import { publishWMSLayer, describeRequestError } from '../assets/utils.js';
import DataService from '../services/DataService.js';
import { useAppStore } from '../stores/app';

// 五个指标页原本是五份几乎相同的组件（仅标题、接口、结果文案不同），
// 这里用一张配置表合并，路由通过 props 传 metric 即可。
const METRICS = {
  FVC: {
    code: 'FVC', title: 'FVC 植被覆盖度', hasSensor: true,
    meanKey: 'fvc_mean', digits: 2, unit: '%', baseline: false,
  },
  NDMI: {
    code: 'NDMI', title: 'NDMI 湿度指数', hasSensor: true,
    meanKey: 'ndmi_mean', digits: 4, unit: '', baseline: false,
  },
  NDSI: {
    code: 'NDSI', title: 'NDSI 裸土指数', hasSensor: true,
    meanKey: 'ndsi_mean', digits: 4, unit: '', baseline: false,
  },
  RSEI: {
    code: 'RSEI', title: 'RSEI 生态指数', hasSensor: false,
    meanKey: 'rsei_mean', digits: 4, unit: '', baseline: false,
  },
  VRI: {
    code: 'VRI', title: 'VRI 植被恢复指数', hasSensor: true,
    meanKey: 'vri_mean', digits: 4, unit: '', baseline: true,
  },
};

export default {
  name: 'MetricPanel',
  props: {
    metric: { type: String, required: true, validator: value => value in METRICS },
  },
  computed: {
    meta() {
      return METRICS[this.metric];
    },
    map() {
      return useAppStore().map;
    },
    earliestYear() {
      const years = (this.yearOptions || []).map(Number).filter(Number.isFinite);
      return years.length ? Math.min(...years) : null;
    },
  },
  data() {
    return {
      config,
      sensor: config.sensorIds()[0],
      mineId: config.mineIds()[0],
      year: config.latestYear(),
      yearOptions: config.availableYears(),
      mineOptions: config.mines,
      sensorOptions: config.sensors,
      loading: false,
      resultText: '',
    };
  },
  methods: {
    clearResult() {
      this.resultText = '';
    },
    /** 取当期原始影像路径（Sentinel-2 / Landsat 按当前数据源） */
    rasterPath(targetYear) {
      return this.sensor === 'sentinel2'
        ? config.sentinelVriRaster(targetYear)
        : config.landsatVriRaster(targetYear);
    },
    async query() {
      this.resultText = '';
      if (this.loading) return;
      const meta = this.meta;
      const code = meta.code;

      let baselineYear = null;
      if (meta.baseline) {
        baselineYear = Number(this.earliestYear);
        if (!Number.isFinite(baselineYear)) {
          this.$message.warning('没有可用的基准年份。');
          return;
        }
        if (baselineYear >= Number(this.year)) {
          this.$message.warning(`最早年份 ${baselineYear} 不早于评价年份 ${this.year}，无法计算 VRI。`);
          return;
        }
      }

      this.loading = true;
      const loadingMsg = this.$message({ type: 'info', message: `正在计算 ${code}...`, duration: 0 });
      try {
        const area = config.mineAreaPath;
        const nameField = config.mineNameField;
        let response;
        if (code === 'FVC') {
          response = await DataService.process_fvc(this.rasterPath(this.year), this.sensor, this.year, area, nameField, this.mineId);
        } else if (code === 'NDMI') {
          response = await DataService.process_ndmi(this.rasterPath(this.year), this.sensor, this.year, area, nameField, this.mineId);
        } else if (code === 'NDSI') {
          response = await DataService.process_ndsi(this.rasterPath(this.year), this.sensor, this.year, area, nameField, this.mineId);
        } else if (code === 'RSEI') {
          // RSEI 只用 Landsat，页面不提供数据源选择
          response = await DataService.process_rsei(config.landsatVriRaster(this.year), this.year, area, nameField, this.mineId);
        } else {
          response = await DataService.process_vri(
            this.rasterPath(baselineYear), this.rasterPath(this.year),
            this.sensor, this.year, baselineYear, area, nameField, this.mineId,
          );
        }

        if (response.data.error) {
          this.$message.error('处理失败：' + response.data.error);
          return;
        }
        const result = response.data.result || {};
        const stats = result.stats || {};
        const publish = result.publish || {};
        if (!publish.layer_name) {
          this.$message.warning(`处理完成，但后端未返回 ${code} 已发布图层名称。`);
          return;
        }

        const raw = response.data[meta.meanKey];
        const mean = Number((raw != null ? raw : stats.mean) || 0);
        const sensorLabel = this.sensor === 'sentinel2' ? 'Sentinel-2' : 'Landsat 8/9';
        const mineText = this.mineId.replace('mine', '矿区');
        const unitText = meta.unit || '';
        const value = mean.toFixed(meta.digits);
        this.resultText = meta.baseline
          ? `${this.year}年${mineText}的${code}均值为 ${value}${unitText}（${sensorLabel}数据计算；对比最早年份${baselineYear}）`
          : `${this.year}年${mineText}的${code}均值为 ${value}${unitText}（${sensorLabel}数据计算）`;

        publishWMSLayer(this.map, publish.wms_url || config.geoServerWMS, publish.layer_name);
        this.$message.success(`${code} 计算完成，均值 ${value}${unitText}，图层已发布并加载。`);
      } catch (error) {
        this.$message.error(describeRequestError(error, '请求失败，请检查后端服务。'));
      } finally {
        this.loading = false;
        if (loadingMsg) loadingMsg.close();
      }
    },
  },
};
</script>

<style scoped>
.metric-panel {
  width: 300px;
  max-width: calc(100vw - 32px);
  min-height: 0;
  box-sizing: border-box;
  padding: 16px 18px 18px;
  background: rgba(255, 255, 255, 0.95);
  position: fixed;
  left: calc(var(--viewport-width, 100vw) - 340px);
  top: 100px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.85);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(31, 45, 61, 0.22);
  z-index: 5;
}
.metric-panel .panel-title {
  margin: 0 0 14px;
  color: #303133;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;
}
.metric-panel .el-select,
.metric-panel .el-button {
  display: block;
  width: 100% !important;
  margin: 0 auto 10px;
}
.metric-panel .el-button {
  min-height: 36px;
  margin-bottom: 0;
}
.metric-panel .metric-result {
  max-height: 72px;
  margin: 12px 0 0;
  padding: 8px 10px;
  overflow: auto;
  color: #2f6f4e;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  text-align: left;
  word-break: break-word;
  background: #f0f9f3;
  border: 1px solid #cce8d5;
  border-radius: 4px;
}
.metric-panel p {
  max-height: 72px;
  margin: 12px 0 0;
  overflow: auto;
  color: #606266;
  font-size: 12px;
  line-height: 1.5;
  text-align: left;
  word-break: break-word;
}
@media (max-width: 600px) {
  .metric-panel {
    right: 12px;
    left: 12px;
    width: auto;
    max-width: none;
  }
}
</style>

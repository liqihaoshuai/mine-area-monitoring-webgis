<template>
  <div class="evaluate-panel">
    <!-- 顶部工具条：左侧筛选、右侧操作，与专题图展示页的工具栏同一套视觉语言 -->
    <div class="panel-toolbar">
      <div class="toolbar-group">
        <span class="toolbar-label">矿区</span>
        <el-select v-model="selectedMine" placeholder="请选择矿区" class="toolbar-select toolbar-select-mine" @change="handleMineChange">
          <el-option
            v-for="item in mineOptions"
            :key="item.id"
            :label="item.name"
            :value="item.name"
          ></el-option>
        </el-select>

        <span class="toolbar-label">数据源</span>
        <el-select v-model="selectedSensor" placeholder="数据源" class="toolbar-select">
          <el-option
            v-for="item in sensorOptions"
            :key="item.id"
            :label="item.label"
            :value="item.id"
          ></el-option>
        </el-select>

        <el-button class="toolbar-btn" @click="showChartAnalysis">
          {{ chartDialogVisible ? '收起图形分析' : '图形分析' }}
        </el-button>
      </div>

      <div class="toolbar-group toolbar-group-right">
        <span class="toolbar-hint">共 {{ currentTableData.length }} 条评价记录</span>
        <el-button type="primary" class="toolbar-btn" @click="openAddDialog">添加</el-button>
      </div>
    </div>

    <!-- 表格 -->
    <div v-if="showTable" class="table-wrap">
      <el-table :data="currentTableData" class="result-table" height="100%">
        <!-- 年份前置：查看结果时先看到"这是哪一年"，再横向读指标值 -->
        <el-table-column prop="year" label="年份" min-width="80" align="center" fixed></el-table-column>
        <el-table-column prop="FVC" label="植被覆盖度FVC(%)" min-width="110" align="center"></el-table-column>
        <el-table-column prop="VRI" label="植被恢复指数VRI" min-width="110" align="center"></el-table-column>
        <el-table-column prop="NDMI" label="土壤湿度指数NDMI" min-width="120" align="center"></el-table-column>
        <el-table-column prop="NDSI" label="裸土指数NDSI" min-width="110" align="center"></el-table-column>
        <el-table-column prop="RSEI" label="遥感生态指数RSEI" min-width="120" align="center"></el-table-column>
        <el-table-column prop="environmentalCoordination" label="环境协调性" min-width="100" align="center"></el-table-column>
        <el-table-column prop="Soilpollution" label="土壤污染" min-width="90" align="center"></el-table-column>
        <el-table-column prop="sensor" label="数据源" min-width="100" align="center">
          <template #default="scope">
            {{ scope.row.sensor === 'sentinel2' ? 'Sentinel-2' : (scope.row.sensor === 'landsat89' ? 'Landsat 8/9' : '—') }}
          </template>
        </el-table-column>
        <el-table-column prop="restorationGrade" label="修复等级" min-width="90" align="center"></el-table-column>
        <el-table-column prop="totalScore" label="综合得分" min-width="90" align="center"></el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="scope">
            <el-button size="small" type="danger" @click="deleteRow(scope.$index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 图形分析：内嵌在结果表下方，随表格内容自然下移，不再浮层遮挡右侧操作列 -->
    <div v-if="chartDialogVisible" v-loading="chartLoading" class="chart-panel">
      <div class="chart-panel-head">
        <span class="chart-panel-title">图形分析</span>
        <el-button
          type="text"
          icon="Close"
          class="chart-panel-close"
          @click="chartDialogVisible = false"
        >关闭</el-button>
      </div>
      <div class="chart-container">
        <div v-if="!chartLoading && !hasChartData" class="chart-empty">
          当前矿区与数据源下还没有评价结果，请先点击「添加」录入数据。
        </div>
        <div class="chart-main" :class="{ 'chart-hidden': !hasChartData }">
          <div ref="trendChart" class="chart-canvas"></div>
        </div>
        <div class="chart-side" :class="{ 'chart-hidden': !hasChartData }">
          <div ref="gradeChart" class="chart-canvas chart-canvas-sm"></div>
        </div>
      </div>
    </div>

    <!--
      添加信息抽屉：从窗口右缘滑入，占满高度。
      不用居中对话框——这个表单有 13 个字段 + 赋权明细，弹在窗口正中会同时压住结果表
      和地图，也是之前"一下在中间崩出来一个小界面"的来源。
      append-to-body：抽屉要挂到 body 下才能相对视口定位（父级有 overflow:hidden）。
    -->
    <el-drawer
      v-model="dialogVisible"
      title="添加评价信息"
      direction="rtl"
      size="640px"
      :modal="false"
      modal-penetrable
      modal-class="evaluate-drawer-scrim"
      :with-header="false"
      append-to-body
      class="evaluate-drawer"
      :class="{ 'is-draft-loaded': draftApplied }"
      @close="cacheFormDraft"
    >
      <div class="drawer-root">
        <header class="drawer-head">
          <div class="drawer-head-main">
            <h2 class="drawer-title">添加评价信息</h2>
            <p class="drawer-subtitle">
              {{ selectedMine || '未选择矿区' }} · {{ currentSensorLabel }}
              <template v-if="form.year"> · {{ form.year }} 年</template>
            </p>
          </div>
          <button type="button" class="drawer-close" aria-label="关闭" @click="dialogVisible = false">×</button>
        </header>

        <el-form ref="form" :model="form" :rules="rules" label-width="0" class="drawer-form">
          <div class="drawer-scroll-body">

            <!-- 五个指标：标签 / 指标值 / 权重 三列严格对齐 -->
            <section class="form-section">
              <div class="section-head">
                <h3 class="section-title">评价指标</h3>
                <span class="section-hint">指标值可手动填写，也可按年份自动回填</span>
              </div>

              <div class="metric-grid">
                <div class="grid-row grid-head">
                  <span class="grid-col-label head">指标</span>
                  <span class="grid-col head">指标值</span>
                  <span class="grid-col head">权重</span>
                </div>
                <div
                  v-for="metric in metricFields"
                  :key="metric.key"
                  class="grid-row"
                >
                  <label class="grid-col-label" :for="`metric-${metric.key}`">
                    {{ metric.label }}
                    <span v-if="metric.unit" class="label-unit">({{ metric.unit }})</span>
                  </label>
                  <el-form-item class="grid-col-item" :prop="metric.key" label-width="0">
                    <el-input
                      :id="`metric-${metric.key}`"
                      v-model.number="form[metric.key]"
                      type="number"
                      step="0.01"
                      :placeholder="metric.placeholder"
                    ></el-input>
                  </el-form-item>
                  <el-form-item class="grid-col-item" :prop="metric.key + 'Weight'" label-width="0">
                    <el-input
                      v-model.number="form[metric.key + 'Weight']"
                      type="number"
                      step="0.0001"
                      placeholder="请输入权重"
                    ></el-input>
                  </el-form-item>
                </div>
              </div>
            </section>

            <!-- 定性项与年份：标签在上、控件在下，三项并排，避免三个全宽下拉各占一行 -->
            <section class="form-section">
              <div class="section-head">
                <h3 class="section-title">评价属性</h3>
              </div>
              <div class="attr-grid">
                <div class="attr-field">
                  <label class="attr-label">与周边环境协调性</label>
                  <el-form-item class="attr-item" prop="environmentalCoordination" label-width="0">
                    <el-select v-model="form.environmentalCoordination" placeholder="请选择">
                      <el-option label="极好" value="极好"></el-option>
                      <el-option label="好" value="好"></el-option>
                      <el-option label="适中" value="适中"></el-option>
                      <el-option label="差" value="差"></el-option>
                    </el-select>
                  </el-form-item>
                </div>

                <div class="attr-field">
                  <label class="attr-label">土壤污染</label>
                  <el-form-item class="attr-item" prop="Soilpollution" label-width="0">
                    <el-select v-model="form.Soilpollution" placeholder="请选择">
                      <el-option label="严重" value="严重"></el-option>
                      <el-option label="适中" value="适中"></el-option>
                      <el-option label="轻微" value="轻微"></el-option>
                      <el-option label="无污染" value="无污染"></el-option>
                    </el-select>
                  </el-form-item>
                </div>

                <div class="attr-field">
                  <label class="attr-label">评价年份</label>
                  <el-form-item class="attr-item" prop="year" label-width="0">
                    <el-select
                      v-model="form.year"
                      placeholder="请选择评价年份"
                      @change="onYearChange"
                    >
                      <el-option v-for="year in yearOptions" :key="year" :label="String(year)" :value="String(year)"></el-option>
                    </el-select>
                  </el-form-item>
                </div>
              </div>
            </section>

            <!-- 赋权方法：AHP 主观 / 熵权法客观 / 组合赋权，三档并存供论文对比 -->
            <section class="form-section weight-scheme">
              <div class="section-head">
                <h3 class="section-title">赋权方法</h3>
                <el-button size="small" text type="primary" class="section-link" @click="weightDetailVisible = !weightDetailVisible">
                  {{ weightDetailVisible ? '收起赋权过程' : '查看赋权过程' }}
                </el-button>
              </div>

              <div class="weight-scheme-head">
                <el-radio-group v-model="weightMethod" size="small" @change="onWeightMethodChange">
                  <el-radio-button
                    v-for="item in weightMethods"
                    :key="item.key"
                    :value="item.key"
                  >{{ item.short }}</el-radio-button>
                </el-radio-group>
                <span v-if="weightMethod === 'COMBINED'" class="alpha-inline">
                  <span class="alpha-label">α</span>
                  <el-input-number
                    v-model="alpha"
                    :min="0"
                    :max="1"
                    :step="0.1"
                    :precision="1"
                    size="small"
                    controls-position="right"
                    @change="onWeightMethodChange"
                  />
                </span>

                <!-- 权重和实时校验：和单选组同排，不用滚到底才能看到是否通过 -->
                <span class="weight-sum-line">
                  <span :class="['weight-sum', weightCheck.ok ? 'is-ok' : 'is-bad']">
                    权重和 {{ weightSumText }}
                  </span>
                  <span :class="['weight-sum-tip', weightCheck.ok ? 'is-ok' : 'is-bad']">
                    {{ weightCheck.ok ? '校验通过' : weightCheck.firstIssue }}
                  </span>
                </span>
              </div>

              <!-- 基准年口径说明：VRI 相对自身无变化，权重转让给 FVC -->
              <p v-if="isBaselineYearSelected" class="baseline-note">
                <span class="baseline-badge">基准年</span>
                {{ baselineNote }}
              </p>

              <div v-if="weightDetailVisible" class="weight-detail">
                <!-- AHP 的一致性检验是主观赋权能否成立的关键证据 -->
                <div class="weight-detail-block">
                  <div class="weight-detail-title">AHP 一致性检验</div>
                  <div class="weight-detail-grid">
                    <span>λmax</span><b>{{ ahpDetail.lambdaMax }}</b>
                    <span>CI</span><b>{{ ahpDetail.ci }}</b>
                    <span>RI (n=5)</span><b>{{ ahpDetail.ri }}</b>
                    <span>CR</span>
                    <b :class="ahpDetail.passed ? 'is-ok' : 'is-bad'">{{ ahpDetail.cr }}</b>
                    <span>结论</span>
                    <b :class="ahpDetail.passed ? 'is-ok' : 'is-bad'">
                      {{ ahpDetail.passed ? 'CR < 0.1，判断矩阵通过一致性检验' : 'CR ≥ 0.1，判断矩阵需重新构建' }}
                    </b>
                  </div>
                </div>
                <!-- 熵权法把"区分度"变成权重的过程，逐项列出便于核查 -->
                <div class="weight-detail-block">
                  <div class="weight-detail-title">熵权法（样本 {{ entropyDetail.sampleSize }} 条）</div>
                  <table class="weight-detail-table">
                    <thead>
                      <tr><th>指标</th><th>得分均值</th><th>标准差</th><th>信息熵 e</th><th>差异系数 d</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in entropyRows" :key="row.key">
                        <td>{{ row.label }}</td>
                        <td>{{ row.mean }}</td>
                        <td>{{ row.std }}</td>
                        <td>{{ row.entropy }}</td>
                        <td>{{ row.divergence }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-if="entropyDetail.note" class="weight-detail-note">{{ entropyDetail.note }}</div>
                </div>
                <!-- 三档权重并排，方便直接看出差异 -->
                <div class="weight-detail-block">
                  <div class="weight-detail-title">三档权重对照</div>
                  <table class="weight-detail-table">
                    <thead>
                      <tr><th>指标</th><th>AHP</th><th>熵权法</th><th>组合</th></tr>
                    </thead>
                    <tbody>
                      <tr v-for="row in weightCompareRows" :key="row.key">
                        <td>{{ row.label }}</td>
                        <td>{{ row.ahp }}</td>
                        <td>{{ row.entropy }}</td>
                        <td>{{ row.combined }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <div class="action-row">
              <el-button :loading="loadingMetrics" @click="loadEvaluationMetrics">按年份自动回填指标</el-button>
              <span class="action-hint">年份选好后可自动带出该矿区当年的指标值</span>
            </div>
          </div>
        </el-form>

        <footer class="drawer-foot">
          <div class="footer-result">
            <span class="footer-result-label">修复等级</span>
            <span :class="['footer-grade-value', gradeClass]">{{ form.restorationGrade || '待计算' }}</span>
            <span v-if="form.totalScore !== null && form.totalScore !== ''" class="footer-score">
              综合得分 {{ form.totalScore }}
            </span>
          </div>
          <div class="footer-actions">
            <el-button @click="validateAndCalculate">计算综合评价</el-button>
            <el-button @click="dialogVisible = false">取消</el-button>
            <el-button type="primary" @click="handleSubmit">确定</el-button>
          </div>
        </footer>
      </div>
    </el-drawer>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import { useAppStore } from '../stores/app';
import DataService from '../services/DataService.js';
import config from '../assets/config.js';
import { publishWMSLayer } from '../assets/utils.js';
// echarts 5 是纯 ESM 包，index.js 里只有 export * 而没有 export default，
// 用默认导入拿到的是 undefined（webpack 会警告 "export 'default' was not found"），
// 会导致下方 drawCharts() 在 `if (!echarts) return` 处静默返回、图表画不出来。
import * as echartsLib from '../assets/echarts.js';
// 赋权计算层：AHP 判断矩阵 + 一致性检验、熵权法、组合赋权，三档并存
import {
  WEIGHT_METHODS,
  DEFAULT_ALPHA,
  INDICATORS as WEIGHT_INDICATORS,
  computeWeightSchemes,
  weightsOfScheme,
  baselineYearOf,
  isBaselineYear,
  transferBaselineWeight,
  baselineRuleText,
  toFormWeightFields,
  fromFormWeightFields,
  validateWeightInput,
} from '../assets/weights.js';
import { loadEvalDataset, collectMineNames } from '../assets/evalData.js';

export default {
  data() {
    return {
      showTable: true,
      dialogVisible: false,
      chartDialogVisible: false,
      chartLoading: false,
      chartRows: [],
      trendChart: null,
      gradeChart: null,
      chartResizeHandler: null,
      form: {
        FVC: null,
        FVCWeight: null,
        VRI: null,
        VRIWeight: null,
        NDMI: null,
        NDMIWeight: null,
        NDSI: null,
        NDSIWeight: null,
        RSEI: null,
        RSEIWeight: null,
        environmentalCoordination: "",
        Soilpollution: "",
        year: "",
        restorationGrade: "",
        totalScore: null,
        // 赋权方法快照：AHP / ENTROPY / COMBINED，以及当时的权重
        weightMethod: "",
        weights: {},
        metricLayers: {},
        metricMeans: {}
      },
      metricMessages: {},
      // 五个指标的表格化配置：单位单独拎出来，标签列不再被 "(%)" 撑长导致参差不齐
      metricFields: [
        { key: 'FVC', label: '植被覆盖度 FVC', unit: '%', placeholder: '如 28.30' },
        { key: 'VRI', label: '植被恢复指数 VRI', unit: '', placeholder: '如 0.146' },
        { key: 'NDMI', label: '土壤湿度指数 NDMI', unit: '', placeholder: '如 -0.018' },
        { key: 'NDSI', label: '裸土指数 NDSI', unit: '', placeholder: '如 -0.254' },
        { key: 'RSEI', label: '遥感生态指数 RSEI', unit: '', placeholder: '如 0.527' },
      ],
      yearOptions: config.availableYears().map(item => String(item)),
      mineOptions: config.mines,
      sensorOptions: config.sensors,
      mineAreaPath: config.mineAreaPath || '',
      mineNameField: config.mineNameField || 'name',
      loadingMetrics: false,
      // 表单草稿：抽屉取消关闭时保留已填内容，下次打开自动恢复。
      formDraft: null,
      // 本次打开是否恢复了草稿，抽屉头部据此提示"已恢复上次填写"
      draftApplied: false,
      // 上一次的基准年状态：只有状态翻转时才改写权重，避免覆盖用户手调的值
      lastBaselineState: null,
      // ===== 赋权方法 =====
      // AHP 主观 / 熵权法客观 / 组合赋权三档并存，记录里存 weightMethod + weights 快照
      weightMethod: 'AHP',
      alpha: DEFAULT_ALPHA,
      weightMethods: WEIGHT_METHODS,
      weightDetailVisible: false,
      // 熵权法与组合权重依赖样本，按"当前矿区 + 数据源"的已有记录算
      weightSchemes: null,
      metricConfig: {
        FVC: { label: 'FVC', resultKey: 'fvc' },
        VRI: { label: 'VRI', resultKey: 'vri' },
        NDMI: { label: 'NDMI', resultKey: 'ndmi' },
        NDSI: { label: 'NDSI', resultKey: 'ndsi' },
        // RSEI 依赖地表温度 LST，Sentinel-2 无热红外波段，只能用 Landsat。
        RSEI: { label: 'RSEI', resultKey: 'rsei', fixedSensor: 'landsat89' },
      },
      rules: {
        FVC: [{ required: true, message: '请输入FVC', trigger: 'blur' }],
        FVCWeight: [{ required: true, message: '请输入权重', trigger: 'blur' }],
        VRI: [{ required: true, message: '请输入VRI', trigger: 'blur' }],
        VRIWeight: [{ required: true, message: '请输入权重', trigger: 'blur' }],
        NDMI: [{ required: true, message: '请输入NDMI', trigger: 'blur' }],
        NDMIWeight: [{ required: true, message: '请输入权重', trigger: 'blur' }],
        NDSI: [{ required: true, message: '请输入NDSI', trigger: 'blur' }],
        NDSIWeight: [{ required: true, message: '请输入权重', trigger: 'blur' }],
        RSEI: [{ required: true, message: '请输入RSEI', trigger: 'blur' }],
        RSEIWeight: [{ required: true, message: '请输入权重', trigger: 'blur' }],
        environmentalCoordination: [{ required: true, message: '请选择环境协调性', trigger: 'change' }],
        Soilpollution: [{ required: true, message: '请选择土壤污染', trigger: 'change' }],
        year: [{ required: true, message: '请选择年份', trigger: 'change' }]
      }
    };
  },
  setup() {
    return { appStore: useAppStore() };
  },
  computed: {
    getSelectedMine() { return this.appStore.selectedMine; },
    getSelectedSensor() { return this.appStore.getSelectedSensor; },
    getTableData() { return this.appStore.getTableData; },
    selectedMine: {
      get() {
        return this.getSelectedMine;
      },
      set(value) {
        this.setSelectedMine(value);
      }
    },
    // 数据源与 store 双向绑定，切换后结果表自动跟着切换
    selectedSensor: {
      get() {
        return this.getSelectedSensor;
      },
      set(value) {
        this.setSelectedSensor(value);
      }
    },
    currentTableData() {
      return this.getTableData;
    },
    // 抽屉副标题里的数据源名称：sentinel2 → Sentinel-2
    currentSensorLabel() {
      const id = this.selectedSensor;
      const hit = (this.sensorOptions || []).find(item => item.id === id);
      return hit ? hit.label : (id || '未选择数据源');
    },
    // 底部"修复等级"按档位着色，一眼能看出好坏
    gradeClass() {
      const grade = String(this.form.restorationGrade || '');
      if (grade === '优秀') return 'is-excellent';
      if (grade === '良好') return 'is-good';
      if (grade === '中等') return 'is-medium';
      if (grade === '较差') return 'is-poor';
      return 'is-empty';
    },
    // 是否存在可绘制的年份数据，直接由结果表推导，避免依赖异步更新的 chartRows
    hasChartData() {
      const rows = this.currentTableData || [];
      return rows.some(row => String((row && row.year) || '').trim() !== '');
    },
    // ===== 赋权相关 =====
    // 熵权法和组合赋权需要样本；样本取当前「矿区 + 数据源」的已录记录。
    weightSample() {
      const rows = this.currentTableData || [];
      const dataset = loadEvalDataset();
      const mineNames = collectMineNames(dataset);
      const list = [];
      mineNames.forEach(mine => {
        config.sensorIds().forEach(sensor => {
          (dataset[`${mine}_${sensor}`] || []).forEach(row => {
            list.push(Object.assign({}, row, { mine, sensor, year: Number(row.year) }));
          });
        });
      });
      // 种子数据不够时用当前表格补，保证永远有样本可算
      rows.forEach(row => {
        list.push(Object.assign({}, row, {
          mine: this.selectedMine,
          sensor: this.selectedSensor,
          year: Number(row.year),
        }));
      });
      return list;
    },
    weightSchemesComputed() {
      const schemes = computeWeightSchemes(this.weightSample, this.alpha);
      return schemes;
    },
    currentScheme() {
      const schemes = this.weightSchemesComputed;
      if (this.weightMethod === 'ENTROPY') return schemes.entropy;
      if (this.weightMethod === 'COMBINED') return schemes.combined;
      return schemes.ahp;
    },
    ahpDetail() {
      const ahp = this.weightSchemesComputed.ahp;
      return {
        lambdaMax: ahp.lambdaMax,
        ci: ahp.ci,
        ri: ahp.ri,
        cr: ahp.cr,
        passed: ahp.passed,
      };
    },
    entropyDetail() {
      const entropy = this.weightSchemesComputed.entropy;
      return {
        sampleSize: entropy.sampleSize,
        note: entropy.note,
      };
    },
    entropyRows() {
      const entropy = this.weightSchemesComputed.entropy;
      return WEIGHT_INDICATORS.map(item => {
        const detail = (entropy.detail && entropy.detail[item.key]) || {};
        return {
          key: item.key,
          label: item.label,
          mean: detail.mean === null || detail.mean === undefined ? '—' : detail.mean,
          std: detail.std === null || detail.std === undefined ? '—' : detail.std,
          entropy: detail.entropy === undefined ? '—' : detail.entropy,
          divergence: detail.divergence === undefined ? '—' : detail.divergence,
        };
      });
    },
    weightCompareRows() {
      const schemes = this.weightSchemesComputed;
      return WEIGHT_INDICATORS.map(item => ({
        key: item.key,
        label: item.label,
        ahp: schemes.ahp.weights[item.key],
        entropy: schemes.entropy.weights[item.key],
        combined: schemes.combined.weights[item.key],
      }));
    },
    // 表单里当前填的权重，转成 { FVC: 0.2, ... } 供校验
    formWeights() {
      return fromFormWeightFields(this.form);
    },
    weightCheck() {
      const result = validateWeightInput(this.formWeights);
      return {
        ok: result.ok,
        sum: result.sum,
        firstIssue: result.issues.length ? result.issues[0].text : '',
        issues: result.issues,
      };
    },
    weightSumText() {
      const sum = this.weightCheck.sum;
      if (!Number.isFinite(sum)) return '—';
      // 通过时只保留一位小数（1.0 才是人读的量级）；不通过时给三位，
      // 否则"显示 1.0 却标红"会让人以为校验抽风。
      return this.weightCheck.ok ? sum.toFixed(1) : sum.toFixed(3);
    },
    // ===== 基准年口径 =====
    // 最早的一年是 VRI 的基准年：相对自身没有变化值，权重转给 FVC
    // （与 backend/shared/gen_eval_seed.py 的 WEIGHTS_BASELINE 一致）
    baselineYear() {
      return baselineYearOf(this.yearOptions);
    },
    isBaselineYearSelected() {
      return isBaselineYear(this.form.year, this.yearOptions);
    },
    baselineNote() {
      return this.isBaselineYearSelected ? baselineRuleText(this.baselineYear) : '';
    },
  },
  watch: {
    // 面板展开后触发首次绘制（替代原 el-dialog 的 @opened）
    chartDialogVisible(visible) {
      if (visible) {
        this.renderChartPanel();
      }
    },
    // 面板展开状态下切换矿区或数据源，图表需按新数据重绘
    selectedMine() {
      this.refreshChartIfOpen();
    },
    selectedSensor() {
      this.refreshChartIfOpen();
    },
    currentTableData() {
      this.refreshChartIfOpen();
    },
  },
  mounted() {
  },
  beforeUnmount() {
    this.disposeCharts();
    if (this.chartResizeHandler) {
      window.removeEventListener('resize', this.chartResizeHandler);
      this.chartResizeHandler = null;
    }
  },
  methods: {
    setSelectedMine(mine) { this.appStore.setSelectedMine(mine); },
    setSelectedSensor(sensor) { this.appStore.setSelectedSensor(sensor); },
    deleteTableData(index) { this.appStore.deleteTableData(index); },
    resetFormData() { this.appStore.resetFormData(); },
    addTableData() { this.appStore.addTableData(); },
    handleMineChange(mine) {
      // 更新当前选中的矿区
      this.appStore.setSelectedMine(mine);
      console.log('已切换到矿区:', mine);
      console.log('当前矿区数据:', this.currentTableData);
    },
    openAddDialog() {
      // 打开抽屉时恢复上次填写的内容，取消关闭不会丢失数据。
      this.dialogVisible = true;
      const hasDraft = !!(this.formDraft && Object.keys(this.formDraft).length);
      if (hasDraft) {
        this.form = { ...this.form, ...this.formDraft };
      }
      this.draftApplied = hasDraft;
      // 草稿可能停在基准年/常规年，按当前年份重算一次基准年状态，
      // 再决定权重该不该走"份额转移"。恢复草稿时用 silent，避免把用户手调过的权重冲掉。
      this.lastBaselineState = null;
      this.syncBaselineYear({ silent: hasDraft });
      // 表单里若还没有权重，按当前档位预填，避免从空的 5 个框开始
      this.applySchemeWeights({ silent: true });
      this.$nextTick(() => {
        if (this.$refs.form) this.$refs.form.clearValidate();
      });
    },
    // 把当前档位的权重写进表单
    applySchemeWeights(options = {}) {
      // 基准年先按"份额转移"改写：VRI 权重置 0，份额给 FVC
      const raw = weightsOfScheme(this.weightSchemesComputed, this.weightMethod);
      const weights = this.isBaselineYearSelected ? transferBaselineWeight(raw) : raw;
      const fields = toFormWeightFields(weights);
      const next = { ...this.form };
      // silent 模式只在字段为空时填，避免覆盖用户手工调过的值
      let changed = false;
      Object.keys(fields).forEach(key => {
        const current = next[key];
        const isEmpty = current === null || current === undefined || current === '';
        if (options.silent && !isEmpty) return;
        if (next[key] !== fields[key]) changed = true;
        next[key] = fields[key];
      });
      if (changed) this.form = next;
      return changed;
    },
    onWeightMethodChange() {
      this.applySchemeWeights();
      // 权重变了，原来的综合分与等级就失效了，需要重新算
      if (this.form.restorationGrade) {
        this.calculateRestorationGrade();
      }
      if (!this.weightCheck.ok) {
        this.$message.warning(this.weightCheck.firstIssue);
      }
    },
    // 关闭对话框时把当前内容存为草稿，下次打开自动恢复。
    cacheFormDraft() {
      this.formDraft = { ...this.form };
    },
    showChartAnalysis() {
      // 图形分析现在是表格下方的内嵌面板，展开后由 chartDialogVisible 的
      // watcher 触发绘制（不再依赖 el-dialog 的 @opened 事件）。
      this.chartDialogVisible = !this.chartDialogVisible;
      if (this.chartDialogVisible) {
        this.chartLoading = true;
      } else {
        // 收起时销毁图表实例，避免残留实例持有已移除的 DOM
        this.disposeCharts();
      }
    },
    renderChartPanel() {
      this.chartLoading = true;
      // 面板刚插入 DOM 时容器宽高可能尚未就绪，连续两帧后再绘制。
      const draw = () => {
        this.$nextTick(() => {
          this.renderCharts();
        });
      };
      this.$nextTick(draw);
      setTimeout(draw, 120);
    },
    // 从当前「矿区 + 数据源」的结果表构造图表数据，年份数量可任意增减
    buildChartModel() {
      const rows = this.currentTableData || [];
      if (!rows.length) return { years: [], series: [], gradeLabels: [] };

      // 年份去重后按数值升序排列，保证 x 轴从早到晚
      const yearMap = new Map();
      rows.forEach(row => {
        const year = String(row.year || '').trim();
        if (!year || yearMap.has(year)) return;
        yearMap.set(year, row);
      });
      const years = Array.from(yearMap.keys()).sort((a, b) => Number(a) - Number(b));
      const records = years.map(year => yearMap.get(year));

      const metrics = [
        // FVC 在结果表里按百分数录入（表头即「植被覆盖度FVC(%)」，28 表示 28%），
        // 而 VRI/NDMI/NDSI/RSEI 都是 -1~1 的指数。直接画在一起会相差几十倍，
        // 折线全被压成贴着 0 的直线，所以这里把 FVC 折算成小数（28% → 0.28）统一量纲。
        { key: 'FVC', name: '植被覆盖度FVC', toFraction: true },
        { key: 'VRI', name: '植被恢复指数VRI' },
        { key: 'NDMI', name: '土壤湿度指数NDMI' },
        { key: 'NDSI', name: '裸土指数NDSI' },
        { key: 'RSEI', name: '遥感生态指数RSEI' },
      ];
      const series = metrics.map(metric => ({
        name: metric.name,
        data: records.map(row => {
          const value = Number(row[metric.key]);
          if (!Number.isFinite(value)) return null;
          // 百分数除以 100；若该条记录的 FVC 已经录成小数（≤1）则原样使用，
          // 避免把 0.28 这种本来就正确的值再缩小 100 倍。
          if (metric.toFraction && Math.abs(value) > 1) {
            // 顺带收敛到 4 位小数，避免 28.33333/100 这类浮点尾数带进图表
            return Number((value / 100).toFixed(4));
          }
          return value;
        }),
      }));

      // 修复等级按年份逐条取值，与趋势图 x 轴一一对应
      const gradeLabels = records.map(row => String(row.restorationGrade || '').trim() || '暂无');

      return { years, series, gradeLabels };
    },
    renderCharts() {
      // 无论后续是否出错都要关闭 loading，避免弹窗一直转圈
      try {
        this.drawCharts();
      } catch (error) {
        console.error('图形分析渲染失败:', error);
        this.$message.error('图形渲染失败，请检查结果表数据。');
      } finally {
        this.chartLoading = false;
      }
    },
    drawCharts() {
      const echarts = echartsLib;
      if (!echarts) {
        // 以前这里直接 return，图表库加载异常时完全没有反馈，
        // 界面上只会看到空弹窗，排查起来很困难。
        console.error('ECharts 未正确加载：echartsLib 为空值');
        this.$message.error('图表库加载失败，无法生成图形分析。');
        return;
      }
      const model = this.buildChartModel();
      this.chartRows = model.years;

      this.disposeCharts();
      if (!model.years.length) return;

      // 容器若还没拿到宽高（例如弹窗刚打开动画未结束），
      // echarts.init 会得到 0x0 的画布而无法绘制，这里直接跳过，
      // 待尺寸就绪后由 resize 逻辑补画。
      const trendEl = this.$refs.trendChart;
      const gradeEl = this.$refs.gradeChart;
      if (!trendEl || !gradeEl || !trendEl.clientWidth || !gradeEl.clientWidth) return;

      const mineLabel = String(this.selectedMine || '');

      // 左：五项指标年度折线
      this.trendChart = markRaw(echarts.init(trendEl));
      this.trendChart.setOption({
        title: {
          text: `${mineLabel} 指标年度变化`,
          left: 'center',
          top: 6,
          textStyle: { fontSize: 16, fontWeight: 'normal', color: '#303133' },
        },
        tooltip: {
          trigger: 'axis',
          // FVC 由百分数除 100 得来（28.33333 → 0.2833333），默认会把浮点尾数全部显示出来，
          // 这里统一保留 4 位小数并去掉末尾多余的 0（0.2800 → 0.28）。
          // 想改精度只需调整下面的 toFixed(4)。
          formatter: params => {
            const format = value => {
              if (!Number.isFinite(value)) return '—';
              return String(Number(Number(value).toFixed(4)));
            };
            const head = params && params.length ? `${params[0].axisValue} 年` : '';
            const rows = (params || []).map(
              item => `${item.marker}${item.seriesName}：${format(item.value)}`
            );
            return [head].concat(rows).join('<br/>');
          },
        },
        legend: {
          data: model.series.map(item => item.name),
          // 五个指标名称较长，放顶部会与居中标题重叠，改为底部单行横排
          left: 'center',
          bottom: 4,
          itemWidth: 18,
          itemHeight: 9,
          itemGap: 12,
          textStyle: { fontSize: 12 },
        },
        grid: { left: 82, right: 32, top: 48, bottom: 100 },
        xAxis: {
          type: 'category',
          data: model.years,
          name: '年份',
          nameLocation: 'middle',
          nameGap: 40,
          nameTextStyle: { fontSize: 15 },
          // 图表变窄后仍要逐年显示，字号收小到 12 并禁止自动抽稀
          axisLabel: { fontSize: 12, interval: 0, hideOverlap: false },
          axisTick: { alignWithLabel: true },
        },
        yAxis: {
          type: 'value',
          name: '指标值',
          // 五项指标统一到同一量纲：FVC 已折算成 0~1 小数，
          // 而 NDMI/NDSI 等指数本身就在 -1~1，所以纵轴固定为 -1~1。
          min: -1,
          max: 1,
          interval: 0.5,
          nameGap: 24,
          nameTextStyle: { fontSize: 15 },
          axisLabel: { fontSize: 13 },
        },
        series: model.series.map(item => ({
          name: item.name,
          type: 'line',
          data: item.data,
          connectNulls: true,
          symbolSize: 9,
          lineStyle: { width: 2.5 },
        })),
      });

      // 修复等级四档对应的分值：分值越高柱越高，优秀在最上方
      const gradeScoreMap = { '较差': 1, '中等': 2, '良好': 3, '优秀': 4 };
      const scoreOfGrade = label => gradeScoreMap[String(label || '').trim()] || 0;

      // 右：修复等级柱状，年份与左侧一致
      this.gradeChart = markRaw(echarts.init(gradeEl));
      this.gradeChart.setOption({
        title: {
          // top 调小让标题上移到图表顶端，fontSize 放大
          text: `${mineLabel} 生态评估年度变化`,
          left: 'center',
          top: 6,
          textStyle: { fontSize: 17, fontWeight: 'normal', color: '#303133' },
        },
        tooltip: {
          trigger: 'axis',
          formatter: params => {
            const item = params && params[0];
            if (!item) return '';
            const raw = model.gradeLabels[item.dataIndex] || '暂无';
            return `${item.axisValue} 年<br/>修复等级：${raw}`;
          },
        },
        // top 由 46 加大到 100，把绘图区整体下压，
        // 使纵坐标名称「修复等级」与上方标题拉开距离
        grid: { left: 76, right: 16, top: 100, bottom: 64 },
        xAxis: {
          type: 'category',
          data: model.years,
          name: '年份',
          nameLocation: 'middle',
          nameGap: 40,
          nameTextStyle: { fontSize: 15 },
          // interval: 0 强制逐年显示，配合加宽的绘图区，8 个年份不会再隔一个显示
          axisLabel: { fontSize: 12, interval: 0, hideOverlap: false, margin: 8 },
          axisTick: { alignWithLabel: true },
        },
        yAxis: {
          // 用数值轴而不是类目轴：高度直接表示等级高低，优秀最高、位于最上方。
          // 原来的类目轴是 ['优秀','良好','适中','较差']，不但方向相反，
          // 而且「适中」与判定逻辑实际产出的「中等」对不上，中等的年份画不出柱。
          type: 'value',
          min: 0,
          max: 4.5,
          interval: 1,
          name: '修复等级',
          nameGap: 28,
          // 右对齐，使「修复等级」的右边缘与「中等」「优秀」等刻度文字对齐。
          // 默认是居中对齐，轴名右边缘会伸到刻度文字右侧约 38px，看起来是错开的。
          nameTextStyle: { fontSize: 15, color: '#606266', align: 'right' },
          axisLabel: {
            fontSize: 13,
            formatter: value => ({ 1: '较差', 2: '中等', 3: '良好', 4: '优秀' }[value] || ''),
          },
          // 等级轴上这些横向虚线没有参考价值，去掉
          splitLine: { show: false },
        },
        series: [
          {
            type: 'bar',
            barWidth: '46%',
            itemStyle: { color: '#f0a83c' },
            // 柱顶直接标出等级文字，避免只靠高度猜
            label: {
              show: true,
              position: 'top',
              fontSize: 13,
              color: '#b06d0a',
              formatter: params => model.gradeLabels[params.dataIndex] || '',
            },
            data: model.gradeLabels.map(label => scoreOfGrade(label)),
          },
        ],
      });

      if (!this.chartResizeHandler) {
        this.chartResizeHandler = () => {
          if (this.trendChart) this.trendChart.resize();
          if (this.gradeChart) this.gradeChart.resize();
        };
        window.addEventListener('resize', this.chartResizeHandler);
      }

      // 兜底：若本次因容器尺寸不足未初始化，延迟再试一次
      if (!this.trendChart || !this.gradeChart) {
        setTimeout(() => {
          if (this.chartDialogVisible && (!this.trendChart || !this.gradeChart)) {
            this.renderCharts();
          }
        }, 300);
      }
    },
    disposeCharts() {
      if (this.trendChart) {
        this.trendChart.dispose();
        this.trendChart = null;
      }
      if (this.gradeChart) {
        this.gradeChart.dispose();
        this.gradeChart = null;
      }
    },
    // 弹窗已打开时，数据变化后延迟重绘（等待 DOM 更新完成）
    refreshChartIfOpen() {
      if (!this.chartDialogVisible) return;
      this.$nextTick(() => {
        this.renderCharts();
      });
    },
    resetForm() {
      this.form = {
        FVC: null,
        FVCWeight: null,
        VRI: null,
        VRIWeight: null,
        NDMI: null,
        NDMIWeight: null,
        NDSI: null,
        NDSIWeight: null,
        RSEI: null,
        RSEIWeight: null,
        environmentalCoordination: "",
        Soilpollution: "",
        year: "",
        restorationGrade: "",
        totalScore: null,
        weightMethod: "",
        weights: {},
        metricLayers: {},
        metricMeans: {}
      };
      // 清空后立刻按当前档位把权重填回来，下一个矿区/年份不必重新手填
      // 年份已清空，基准年状态一并重置，避免沿用上一年的口径
      this.lastBaselineState = null;
      this.applySchemeWeights();
    },
    mapToScore(value, ranges) {
      for (const range of ranges) {
        if (value >= range.inMin && value <= range.inMax) {
          return this.mapRangeToScore(value, range.inMin, range.inMax, range.outMin, range.outMax);
        }
      }
      return 0; // 默认值
    },
    mapRangeToScore(value, inMin, inMax, outMin, outMax) {
      let score = ((value - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin;
      return parseFloat(score.toFixed(2)); // 返回数字类型
    },
    mapFVCToScore(index) {
      const ranges = [
        { inMin: 0, inMax: 10, outMin: 0, outMax: 20 },
        { inMin: 10, inMax: 30, outMin: 21, outMax: 40 },
        { inMin: 30, inMax: 50, outMin: 41, outMax: 60 },
        { inMin: 50, inMax: 70, outMin: 61, outMax: 80 },
        { inMin: 70, inMax: 100, outMin: 81, outMax: 100 }
      ];
      return this.mapToScore(index, ranges);
    },
    mapVRIToScore(index) {
      const ranges = [
        { inMin: -1, inMax: -0.3, outMin: 0, outMax: 40 },
        { inMin: -0.3, inMax: 0.3, outMin: 41, outMax: 60 },
        { inMin: 0.3, inMax: 0.7, outMin: 61, outMax: 80 },
        { inMin: 0.7, inMax: 1, outMin: 80, outMax: 100 }
      ];
      return this.mapToScore(index, ranges);
    },
    mapNDMIToScore(index) {
      const ranges = [
        { inMin: -1, inMax: -0.3, outMin: 0, outMax: 40 },
        { inMin: -0.3, inMax: 0.3, outMin: 41, outMax: 60 },
        { inMin: 0.3, inMax: 0.7, outMin: 61, outMax: 80 },
        { inMin: 0.7, inMax: 1, outMin: 80, outMax: 100 }
      ];
      return this.mapToScore(index, ranges);
    },
    mapNDSIToScore(index) {
      // NDSI专用评分方法，值越低分数越高
      if (index <= -0.5) {
        return 100;  // NDSI <= -0.5 得100分
      } else if (index <= 0) {
        return 80 - ((index + 0.5) / 0.5) * 20;  // NDSI -0.5~0 得80-100分
      } else if (index <= 0.5) {
        return 60 - (index / 0.5) * 20;  // NDSI 0~0.5 得40-60分
      } else {
        return 40;  // NDSI > 0.5 得40分
      }
    },
    mapRSEIToScore(index) {
      const ranges = [
        { inMin: 0.8, inMax: 1, outMin: 90, outMax: 100 },
        { inMin: 0.6, inMax: 0.8, outMin: 70, outMax: 90 },
        { inMin: 0.3, inMax: 0.6, outMin: 61, outMax: 70 },
        { inMin: 0, inMax: 0.3, outMin: 0, outMax: 60 }
      ];
      return this.mapToScore(index, ranges);
    },
    calculateRestorationGrade() {
      // 检查所有必要参数是否都已输入
      const requiredFields = ['NDMI', 'NDMIWeight', 'NDSI', 'NDSIWeight', 'FVC', 'FVCWeight', 'VRI', 'VRIWeight', 'RSEI', 'RSEIWeight'];
      const allFieldsEntered = requiredFields.every(field => 
        this.form[field] !== null && this.form[field] !== undefined && this.form[field] !== ''
      );
      
      // 如果不是所有字段都已输入，则不计算等级
      if (!allFieldsEntered) {
        this.form.restorationGrade = "";
        this.form.totalScore = null;
        return false;
      }

      // 权重闸门：原来这里直接加权求和，5 个权重加起来 1.5 也照算不误。
      // 现在必须先过校验，否则结论本身没有意义。
      const check = this.weightCheck;
      if (!check.ok) {
        this.form.restorationGrade = "";
        this.form.totalScore = null;
        this.$message.error(check.firstIssue);
        return false;
      }

      const score = this.mapFVCToScore(this.form.FVC) * this.form.FVCWeight
                  + this.mapVRIToScore(this.form.VRI) * this.form.VRIWeight
                  + this.mapNDMIToScore(this.form.NDMI) * this.form.NDMIWeight
                  + this.mapNDSIToScore(this.form.NDSI) * this.form.NDSIWeight
                  + this.mapRSEIToScore(this.form.RSEI) * this.form.RSEIWeight;

      this.form.totalScore = Number(score.toFixed(2));
      if (score >= 80) {
        this.form.restorationGrade = "优秀";
      } else if (score >= 70) {
        this.form.restorationGrade = "良好";
      } else if (score >= 60) {
        this.form.restorationGrade = "中等";
      } else {
        this.form.restorationGrade = "较差";
      }
      // 记录赋权方法快照，论文里要按方法分组对照
      this.form.weightMethod = this.weightMethod;
      this.form.weights = { ...this.formWeights };
      return true;
    },
    async calculateMetricAndRecord(metric) {
      const item = this.metricConfig[metric];
      const year = Number(this.form.year);
      if (!item || !Number.isInteger(year) || year < 1900 || year > 2100) return false;

      // VRI 基准期固定为可用年份中最早的一年，与 VRI 计算面板保持一致。
      const baselineYear = metric === 'VRI'
        ? (config.availableYears()
            .map(Number)
            .filter(value => Number.isFinite(value) && value < year)
            .sort((a, b) => a - b)[0] || null)
        : null;
      if (metric === 'VRI' && baselineYear === null) {
        this.metricMessages[metric] = `${item.label} ${year} 年没有更早的可用基准年份`;
        return false;
      }
      let response;
      try {
        // RSEI 固定用 Landsat（需热红外波段），其余指标跟随所选数据源。
        const inputSensor = item.fixedSensor || this.selectedSensor;
        const rasterPath = inputSensor === 'sentinel2'
          ? config.sentinelRaster(year)
          : config.landsatRaster(year);
        const earlyPath = inputSensor === 'sentinel2'
          ? config.sentinelVriRaster(baselineYear)
          : config.landsatVriRaster(baselineYear);
        const latePath = inputSensor === 'sentinel2'
          ? config.sentinelVriRaster(year)
          : config.landsatVriRaster(year);

        const mineId = String(this.selectedMine || '').replace('矿区', 'mine');
        if (metric === 'FVC') {
          response = await DataService.process_fvc(rasterPath, inputSensor, year, this.mineAreaPath, this.mineNameField, mineId);
        } else if (metric === 'VRI') {
          response = await DataService.process_vri(earlyPath, latePath, inputSensor, year, baselineYear, this.mineAreaPath, this.mineNameField, mineId);
        } else if (metric === 'NDMI') {
          response = await DataService.process_ndmi(rasterPath, inputSensor, year, this.mineAreaPath, this.mineNameField, mineId);
        } else if (metric === 'NDSI') {
          response = await DataService.process_ndsi(rasterPath, inputSensor, year, this.mineAreaPath, this.mineNameField, mineId);
        } else if (metric === 'RSEI') {
          response = await DataService.process_rsei(config.landsatVriRaster(year), year, this.mineAreaPath, this.mineNameField, mineId);
        } else {
          response = await DataService.getMineStats(item.resultKey, {
          sensor: inputSensor,
          year,
          baseline_year: baselineYear || undefined,
          mine_id: mineId,
          mine_area_path: this.mineAreaPath || undefined,
          name_field: this.mineNameField || undefined
        });
        }

        const computed = response.data && response.data.result;
        if (computed && computed.mine_stats && computed.mine_stats.stats && computed.mine_stats.stats[mineId]) {
          const mineStats = computed.mine_stats.stats[mineId];
          if (mineStats.available && Number.isFinite(Number(mineStats.mean))) {
            this.form[metric] = Number(Number(mineStats.mean).toFixed(4));
            this.form.metricMeans[metric] = Number(mineStats.mean);
            this.form.metricLayers[metric] = computed.publish || {};
            this.metricMessages[metric] = `${item.label} ${year} 年已计算、统计并记录`;
            return true;
          }
        }

        response = await DataService.getMineStats(item.resultKey, {
          sensor: inputSensor,
          year,
          baseline_year: baselineYear || undefined,
          mine_id: mineId,
          mine_area_path: this.mineAreaPath || undefined,
          name_field: this.mineNameField || undefined
        });
        const payload = response.data || {};
        const stats = payload.mine_stats && payload.mine_stats.stats;
        const mineStats = stats && stats[mineId];
        if (!mineStats || !mineStats.available || !Number.isFinite(Number(mineStats.mean))) {
          this.metricMessages[metric] = '暂无该年度矿区统计值（请先计算该指标并配置矿区面数据）';
          return false;
        }

        const value = Number(mineStats.mean);
        this.form[metric] = Number(value.toFixed(4));
        this.form.metricMeans[metric] = value;
        this.form.metricLayers[metric] = payload.result && payload.result.publish;
        this.metricMessages[metric] = `${item.label} ${year} 年已自动回填`;
        return true;
      } catch (error) {
        const detail = error.response && error.response.data && error.response.data.error;
        this.metricMessages[metric] = detail || '暂无该年度结果，请先完成指标计算';
        return false;
      }
    },
    async recordAllMetrics() {
      const metrics = ['FVC', 'VRI', 'NDMI', 'NDSI', 'RSEI'];
      for (const metric of metrics) await this.calculateMetricAndRecord(metric);
    },
    async loadEvaluationMetrics() {
      if (!this.form.year || !this.selectedMine) return;
      this.loadingMetrics = true;
      try {
        await this.recordAllMetrics();
        this.calculateRestorationGrade();
      } finally {
        this.loadingMetrics = false;
      }
    },
    // 年份切换：先按新年份重置基准年口径（权重、VRI 占位），再自动回填指标
    async onYearChange() {
      this.syncBaselineYear();
      await this.loadEvaluationMetrics();
    },
    /**
     * 年份切换后、以及打开抽屉恢复草稿后调用：
     * - 基准年：权重按 transferBaselineWeight 改写（VRI 0，份额给 FVC），VRI 记 0
     * - 非基准年：权重恢复成当前赋权档位的原值
     * 只在"基准年状态发生变化"时改写权重，避免覆盖用户手工调过的数。
     */
    syncBaselineYear(options = {}) {
      const isBase = this.isBaselineYearSelected;
      const wasBase = this.lastBaselineState;
      if (wasBase === isBase) return false;
      this.lastBaselineState = isBase;
      // 基准年 VRI 恒为 0（相对自身无变化），非基准年清掉这个占位值
      if (isBase) {
        this.form.VRI = 0;
      } else if (Number(this.form.VRI) === 0 && this.form.VRI !== null) {
        // 从基准年切回来时把 0 清掉，交给自动回填或用户重新填
        this.form.VRI = null;
      }
      // 基准年时 VRI 权重必须是 0，这是硬规则（后端种子数据也是这么存的），
      // 草稿里手调过的旧权重不能带过来；非基准年则保留草稿里的手调值。
      this.applySchemeWeights({ silent: !!options.silent && !isBase });
      return true;
    },
    hasPublishedLayer(metric) {
      const layer = this.form.metricLayers[metric];
      return !!(layer && layer.layer_name);
    },
    publishMetricLayer(metric) {
      const item = this.metricConfig[metric];
      const layer = this.form.metricLayers[metric];
      const publish = layer || {};
      if (!publish.layer_name) {
        this.$message.error(`${item.label} 缺少后端返回的已发布图层名称，无法加载专题图。`);
        return;
      }
      const added = publishWMSLayer(this.appStore.map, publish.wms_url || config.geoServerWMS, publish.layer_name);
      if (added) this.$message.success(`${item.label} 专题图层已加载`);
    },
    handleSubmit() {
      // 检查是否已经计算了修复等级
      if (!this.form.restorationGrade) {
        this.$message.warning('请先计算修复等级');
        return;
      }

      // 入库前再校验一次权重：等级可能是切换档位之前算的，和当前权重对不上就不能落库
      const check = this.weightCheck;
      if (!check.ok) {
        this.$message.error(check.firstIssue);
        return;
      }
      
      this.$refs.form.validate(valid => {
        if (valid) {
          // 更新 store 中的表单数据
          this.appStore.updateFormData(this.form);
          
          // 计算修复等级
          this.calculateLocalRestorationGrade();
          this.recordAllMetrics();
          
          // 将数据添加到表格并重置表单
          this.appStore.addTableData();
          this.appStore.resetFormData();
          this.formDraft = null;
          
          // 关闭对话框
          this.dialogVisible = false;
          
          // 重置本地表单
          this.resetForm();
        }
      });
    },
    // 使用本地方法计算修复等级，然后更新到store
    calculateLocalRestorationGrade() {
      // 先使用本地方法计算
      this.calculateRestorationGrade();
      
      // 然后更新到store
      this.appStore.updateFormData({
        restorationGrade: this.form.restorationGrade
      });
    },
    deleteRow(index) {
      // 删除对应矿区的表格数据
      this.appStore.deleteTableData(index);
    },
    validateAndCalculate() {
      this.$refs.form.validate(valid => {
        if (valid) {
          this.calculateRestorationGrade();
        } else {
          this.$message.error('请填写完整的信息');
        }
      });
    }
  }
};
</script>

<style scoped>
/* ===== 模块外壳 =====
   与「专题图展示」用同一套铺满策略：吃掉 el-main 的 20px 内边距，
   让本面板直接贴到窗口四边，底图不再从右侧和下方漏出来。 */
.evaluate-panel {
  position: absolute;
  top: -20px;
  left: -20px;
  width: calc(100% + 40px);
  height: calc(100% + 40px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  /* 顶部留白交给吸顶工具条自己撑，否则滚动时表格会从面板 padding 里露出来 */
  padding: 0 24px 20px;
  background-color: #eef1f6;
  /* 图表展开后内容会超过一屏，整块纵向滚动；工具条吸顶不跟着走 */
  overflow-x: hidden;
  overflow-y: auto;
  z-index: 10;
}

/* ===== 顶部工具条 ===== */
.panel-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex: none;
  padding: 18px 0 14px;
  margin-bottom: 4px;
  background-color: #eef1f6;
  border-bottom: 1px solid #dfe4ec;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

/* 标签与控件之间用 10px 间距 + 同高对齐，不再挤在一起 */
.toolbar-label {
  font-size: 13px;
  line-height: 32px;
  color: #5c6b7f;
  white-space: nowrap;
}

.toolbar-select {
  width: 148px;
}

.toolbar-select-mine {
  width: 180px;
}

.toolbar-btn {
  margin-left: 4px !important;
}

.toolbar-group-right {
  flex: none;
  gap: 12px;
}

.toolbar-hint {
  font-size: 12px;
  color: #8b97a8;
  white-space: nowrap;
}

/* ===== 结果表 ===== */
.table-wrap {
  flex: 1 1 auto;
  /* 图表展开后表格至少保留几行，剩下的交给外层滚动，避免只剩一行还能拖 */
  min-height: 240px;
  margin-top: 14px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(31, 45, 61, 0.08);
}

.result-table {
  width: 100%;
}

/* 表格内容居中 */
.el-table td,
.el-table th {
  text-align: center !important;
}

/* ===== 图形分析 ===== */
.chart-panel {
  flex: 0 0 auto;
  /* 不用 max-height 百分比裁切：图表容器高度写死，避免 canvas 比容器高被切掉 */
  overflow: hidden;
  margin-top: 14px;
  padding: 12px 16px 16px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background-color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.chart-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}

.chart-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.chart-panel-close {
  padding: 0;
  font-size: 13px;
  color: #909399;
}

.chart-container {
  position: relative;
  display: flex;
  align-items: stretch;
  gap: 20px;
  width: 100%;
  min-height: 360px;
}

.chart-main {
  flex: 1;
  min-width: 0;
}

.chart-side {
  flex: none;
  width: 420px;
}

/* 无数据时隐藏图表区域，但保留 DOM 节点以便后续直接重绘 */
.chart-hidden {
  visibility: hidden;
}

.chart-canvas {
  width: 100%;
  height: 360px;
}

.chart-canvas-sm {
  height: 360px;
}

.chart-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #909399;
  font-size: 15px;
  text-align: center;
}
</style>

<style>
/* ===================================================================
   添加评价抽屉（append-to-body 挂到 body 下，脱离组件作用域，
   所以这些规则必须写在非 scoped 的全局块里）
   =================================================================== */

/* 无遮罩 + 可穿透：抽屉从右缘滑入，地图仍然可以拖动缩放 */
.el-drawer.evaluate-drawer {
  width: 640px;
  max-width: 100vw;
  background: #ffffff;
  border-left: 1px solid #e3e8ef;
  box-shadow: -8px 0 28px rgba(23, 36, 53, 0.14);
  border-radius: 0;
}

/* 抽屉内部由 .drawer-root 自己排版，这里去掉默认 padding 与滚动 */
.el-drawer.evaluate-drawer .el-drawer__body {
  padding: 0;
  display: flex;
  overflow: hidden;
}

/* ===== 抽屉骨架：头 / 滚动区 / 底栏 ===== */
.evaluate-drawer .drawer-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: #fff;
}

.evaluate-drawer .drawer-head {
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid #eef1f6;
}

.evaluate-drawer .drawer-head-main {
  min-width: 0;
}

.evaluate-drawer .drawer-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  color: #1f2c3d;
}

/* 副标题交代"这次加的是哪个矿区/数据源/年份"，避免填完不知道落到哪 */
.evaluate-drawer .drawer-subtitle {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #8b97a8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.evaluate-drawer .drawer-close {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 20px;
  line-height: 24px;
  color: #96a1b1;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.evaluate-drawer .drawer-close:hover {
  color: #4a586b;
  background: #f2f4f8;
}

/* 表单本体不做滚动，滚动交给内部的 .drawer-scroll-body */
.evaluate-drawer .drawer-form {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.evaluate-drawer .drawer-scroll-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px 24px 20px;
}

/* ===== 表单分段 ===== */
.evaluate-drawer .form-section + .form-section {
  margin-top: 22px;
}

.evaluate-drawer .section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.evaluate-drawer .section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #35455c;
}

.evaluate-drawer .section-hint {
  font-size: 12px;
  color: #9aa5b4;
}

.evaluate-drawer .section-link {
  padding: 0;
  font-size: 12px;
}

/* ===== 网格：标签 / 控件严格对齐 =====
   之前是 158px 标签列 + 10px gap + align-items:start，
   标签的 line-height:32px 和 32px 高的输入框在视觉上错开半行，
   且标签紧贴控件。这里改成固定标签列 + 20px 列间距 + 垂直居中。 */
.evaluate-drawer .metric-grid {
  border: 1px solid #e8ecf3;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.evaluate-drawer .grid-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  column-gap: 20px;
  padding: 11px 16px;
  border-bottom: 1px solid #f0f3f8;
}

.evaluate-drawer .grid-row:last-child {
  border-bottom: none;
}

.evaluate-drawer .grid-row:not(.grid-head):hover {
  background: #fafbfe;
}

.evaluate-drawer .grid-head {
  background: #f6f8fb;
  padding-top: 9px;
  padding-bottom: 9px;
  border-bottom: 1px solid #e8ecf3;
}

/* 标签自身不再撑行高，垂直居中交给 grid 的 align-items:center */
.evaluate-drawer .grid-col-label {
  font-size: 13px;
  line-height: 1.45;
  color: #4d5b6d;
  overflow-wrap: break-word;
}

.evaluate-drawer .grid-col-label.head {
  font-size: 12px;
  color: #98a3b3;
}

.evaluate-drawer .grid-col.head {
  font-size: 12px;
  color: #98a3b3;
}

/* 单位弱化显示，标签列不再因为 "(%)" 而参差不齐 */
.evaluate-drawer .label-unit {
  margin-left: 2px;
  font-size: 12px;
  color: #a4aebc;
}

/* ===== 评价属性：三个下拉并排，标签在上、控件在下 ===== */
.evaluate-drawer .attr-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px 16px;
}

.evaluate-drawer .attr-field {
  min-width: 0;
}

.evaluate-drawer .attr-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: #5c6b7f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.evaluate-drawer .attr-item {
  margin-bottom: 0;
  display: block;
}

.evaluate-drawer .attr-item .el-form-item__content {
  margin-left: 0 !important;
  line-height: 1.4;
}

.evaluate-drawer .attr-item .el-select {
  width: 100%;
}

.evaluate-drawer .attr-item .el-select__wrapper {
  display: flex;
  align-items: center;
  height: 32px;
  padding-top: 0;
  padding-bottom: 0;
}

.evaluate-drawer .attr-item .el-form-item__error {
  padding-top: 3px;
  font-size: 11px;
}

/* 表单项去掉默认的下边距和 label 占位，撑满所在列 */
.evaluate-drawer .grid-col-item {
  margin-bottom: 0;
  display: block;
  min-width: 0;
}

.evaluate-drawer .grid-col-item .el-form-item__content {
  margin-left: 0 !important;
  line-height: 1.4;
  min-width: 0;
}

.evaluate-drawer .grid-col-item .el-input,
.evaluate-drawer .grid-col-item .el-select {
  width: 100%;
}

/* 32px 高的控件里文字统一垂直居中 */
.evaluate-drawer .grid-col-item .el-input__inner,
.evaluate-drawer .grid-col-item .el-select__wrapper {
  height: 32px;
  line-height: 32px;
}

.evaluate-drawer .grid-col-item .el-select__wrapper {
  display: flex;
  align-items: center;
  padding-top: 0;
  padding-bottom: 0;
}

.evaluate-drawer .grid-col-item .el-form-item__error {
  padding-top: 3px;
  white-space: nowrap;
}

/* ===== 赋权方法 ===== */
.evaluate-drawer .weight-scheme-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.evaluate-drawer .alpha-inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.evaluate-drawer .alpha-label {
  font-size: 13px;
  color: #5c6b7f;
}

.evaluate-drawer .alpha-inline .el-input-number {
  width: 96px;
}

/* 权重和：与单选组同排右对齐，数值与结论之间留出明确间距（不再是 "1.0000校验通过"） */
.evaluate-drawer .weight-sum-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding-left: 12px;
  font-size: 12px;
}

.evaluate-drawer .weight-sum {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.evaluate-drawer .weight-sum-tip {
  color: #909399;
}

.evaluate-drawer .is-ok {
  color: #1a9850;
}

.evaluate-drawer .is-bad {
  color: #d73027;
}

/* 基准年口径说明：VRI 权重转让给 FVC 的提示条 */
.evaluate-drawer .baseline-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 10px 0 0;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.55;
  color: #7a5a1e;
  background: #fdf8ec;
  border: 1px solid #f3e3bf;
  border-radius: 6px;
}

.evaluate-drawer .baseline-badge {
  flex: none;
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
  color: #8a6414;
  background: #f7e7bd;
  border-radius: 4px;
}

.evaluate-drawer .weight-detail {
  margin-top: 12px;
  padding: 12px 14px;
  max-height: 300px;
  overflow-y: auto;
  background: #fafbfd;
  border: 1px solid #eaeef4;
  border-radius: 8px;
}

.evaluate-drawer .weight-detail-block + .weight-detail-block {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #eaeef4;
}

.evaluate-drawer .weight-detail-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #35455c;
}

.evaluate-drawer .weight-detail-grid {
  display: grid;
  grid-template-columns: 72px 1fr 72px 1fr;
  gap: 6px 12px;
  font-size: 12px;
  color: #4d5b6d;
}

.evaluate-drawer .weight-detail-grid span {
  color: #98a3b3;
}

.evaluate-drawer .weight-detail-grid b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.evaluate-drawer .weight-detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.evaluate-drawer .weight-detail-table th,
.evaluate-drawer .weight-detail-table td {
  padding: 5px 8px;
  border-bottom: 1px solid #eef1f6;
  text-align: right;
}

.evaluate-drawer .weight-detail-table th:first-child,
.evaluate-drawer .weight-detail-table td:first-child {
  text-align: left;
}

.evaluate-drawer .weight-detail-table th {
  color: #98a3b3;
  font-weight: 500;
}

.evaluate-drawer .weight-detail-note {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: #e6a23c;
}

/* ===== 抽屉内操作行 ===== */
.evaluate-drawer .action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed #e4e9f1;
}

.evaluate-drawer .action-row .el-button {
  margin-left: 0;
}

.evaluate-drawer .action-hint {
  font-size: 12px;
  line-height: 1.4;
  color: #9aa5b4;
  text-align: right;
}

/* ===== 抽屉底栏：修复等级结果 + 取消/确定 ===== */
.evaluate-drawer .drawer-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: #fbfcfe;
  border-top: 1px solid #eef1f6;
}

.evaluate-drawer .footer-result {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
  color: #8b97a8;
}

.evaluate-drawer .footer-result-label {
  white-space: nowrap;
}

.evaluate-drawer .footer-grade-value {
  font-size: 15px;
  font-weight: 600;
  color: #4d5b6d;
}

.evaluate-drawer .footer-grade-value.is-excellent {
  color: #1a9850;
}

.evaluate-drawer .footer-grade-value.is-good {
  color: #3f8f3f;
}

.evaluate-drawer .footer-grade-value.is-medium {
  color: #d08809;
}

.evaluate-drawer .footer-grade-value.is-poor {
  color: #d73027;
}

.evaluate-drawer .footer-grade-value.is-empty {
  color: #a4aebc;
  font-weight: 500;
}

.evaluate-drawer .footer-score {
  color: #8b97a8;
  white-space: nowrap;
}

.evaluate-drawer .footer-actions {
  display: flex;
  flex: none;
  gap: 10px;
}

.evaluate-drawer .footer-actions .el-button {
  margin-left: 0;
  min-width: 84px;
}

/* 轻量蒙层：只压暗一点点，用来标记"这个抽屉是当前焦点"。
   容器本身带 pointer-events:none（见 .el-modal-drawer.is-penetrable），
   所以背景色照常渲染，地图却仍然可以拖动缩放。 */
.el-modal-drawer.evaluate-drawer-scrim {
  background: rgba(23, 36, 53, 0.16);
  transition: opacity 0.2s ease;
}
</style>
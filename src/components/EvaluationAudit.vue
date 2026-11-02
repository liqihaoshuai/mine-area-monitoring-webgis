<template>
  <div class="audit-panel">
    <div class="audit-head">
      <div class="audit-title-group">
        <h2 class="audit-title">评估结果验证</h2>
        <p class="audit-sub">
          对{{ sensorLabel }}的评价记录做自洽性核查、等级面积转移统计与权重/阈值敏感性分析
        </p>
      </div>
      <div class="audit-actions">
        <el-select v-model="sensor" size="small" class="audit-sensor" @change="handleSensorChange">
          <el-option
            v-for="item in sensorOptions"
            :key="item.id"
            :label="item.label"
            :value="item.id"
          ></el-option>
        </el-select>
        <button type="button" class="audit-btn" @click="reload">重新读取数据</button>
      </div>
    </div>

    <div class="audit-kpis">
      <div class="audit-kpi">
        <span class="kpi-label">评价记录</span>
        <span class="kpi-value">{{ records.length }}<em>条</em></span>
      </div>
      <div class="audit-kpi">
        <span class="kpi-label">矿区 / 年份</span>
        <span class="kpi-value">{{ mines.length }}<em>个 / </em>{{ years.length }}<em>年</em></span>
      </div>
      <div class="audit-kpi">
        <span class="kpi-label">自洽性问题</span>
        <span class="kpi-value" :class="issues.length ? 'is-warn' : 'is-ok'">
          {{ issues.length }}<em>项</em>
        </span>
      </div>
      <div class="audit-kpi">
        <span class="kpi-label">等级发生变化（阈值±5分）</span>
        <span class="kpi-value">{{ thresholdPlus.rate }}<em>%</em></span>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="audit-tabs" @tab-click="handleTabClick">
      <!-- 一、长时序趋势（放第一个：这是最常看的结论页） -->
      <el-tab-pane label="长时序趋势" name="trend">
        <div class="audit-section">
          <div class="section-head">
            <span>序列曲线</span>
            <span class="section-note">
              {{ chartRow ? chartRow.mine_label + ' · ' + chartRow.metric_label : '点击下表任意一行查看该序列' }}
            </span>
          </div>
          <div ref="trendChart" class="trend-chart"></div>
        </div>

        <div class="audit-section">
          <div class="section-head">
            <span>Theil-Sen 斜率 + Mann-Kendall 检验</span>
            <span class="section-note">
              {{ trendRows.length }} 条序列 · n≤10 用精确分布 · 双侧 α=0.05
            </span>
          </div>
          <div v-if="trendError" class="trend-error">{{ trendError }}</div>
          <el-table
            v-loading="trendLoading"
            :data="trendRows"
            size="small"
            border
            class="trend-table"
            empty-text="点击「重新读取数据」后加载趋势"
            highlight-current-row
            @row-click="handleTrendRowClick"
          >
            <el-table-column prop="mine_label" label="矿区" width="90"></el-table-column>
            <el-table-column prop="metric_label" label="指标" width="160"></el-table-column>
            <el-table-column label="序列（首→末）" width="185">
              <template #default="scope">
                {{ scope.row.values[0] }} → {{ scope.row.values[scope.row.values.length - 1] }}
              </template>
            </el-table-column>
            <el-table-column label="Sen 斜率 /年" width="115">
              <template #default="scope">
                <span :class="slopeClass(scope.row)">{{ scope.row.slope }}</span>
              </template>
            </el-table-column>
            <el-table-column label="95% 置信区间" width="165">
              <template #default="scope">
                [{{ scope.row.slope_ci[0] }}, {{ scope.row.slope_ci[1] }}]
              </template>
            </el-table-column>
            <el-table-column prop="p" label="MK p 值" width="95"></el-table-column>
            <el-table-column label="结论" width="110">
              <template #default="scope">
                <span :class="['dir-tag', 'dir-' + directionKey(scope.row.direction)]">
                  {{ scope.row.direction }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>



        <div class="audit-section">
          <div class="section-head">
            <span>逐像元趋势显著性图</span>
            <span class="section-note">把同一指标 8 期栅格叠起来，逐像元算 Sen 斜率 + MK 显著性</span>
          </div>
          <div class="trend-controls">
            <el-select v-model="trendMetric" size="small" class="trend-select">
              <el-option
                v-for="item in trendMetricOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              ></el-option>
            </el-select>
            <el-select v-model="trendMine" size="small" class="trend-select">
              <el-option
                v-for="item in trendMineOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              ></el-option>
            </el-select>
            <button type="button" class="audit-btn" :disabled="trendRunning" @click="runPixelTrend">
              {{ trendRunning ? '计算中…' : '生成趋势图' }}
            </button>
            <span v-if="trendStats" class="trend-result">
              显著改善 {{ trendStats.ratio['显著改善'] }}% ·
              显著退化 {{ trendStats.ratio['显著退化'] }}% ·
              有效像元 {{ trendStats.total_valid_pixels }}
            </span>
          </div>
          <img v-if="trendPreview" :src="trendPreview" class="trend-preview" alt="逐像元趋势显著性图" />
        </div>
      </el-tab-pane>
      <!-- 一、结果自洽性 -->
      <el-tab-pane label="结果自洽性" name="consistency">
        <div class="audit-section">
          <div class="section-head">
            <span>核查项说明</span>
          </div>
          <div class="check-list">
            <span v-for="item in checkItems" :key="item" class="check-chip">{{ item }}</span>
          </div>
        </div>

        <div class="audit-section">
          <div class="section-head">
            <span>问题清单</span>
            <span class="section-note">{{ issues.length ? '按下表逐条核对原始数据' : '全部检查通过' }}</span>
          </div>
          <el-table
            v-if="issues.length"
            :data="issues"
            size="small"
            height="260"
            class="audit-table"
            :row-class-name="issueRowClass"
          >
            <el-table-column label="级别" width="80">
              <template #default="scope">
                <el-tag :type="scope.row.level === 'error' ? 'danger' : 'warning'" size="small">
                  {{ scope.row.level === 'error' ? '错误' : '提醒' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="mine" label="矿区" width="90"></el-table-column>
            <el-table-column prop="year" label="年份" width="80"></el-table-column>
            <el-table-column prop="message" label="说明"></el-table-column>
          </el-table>
          <div v-else class="audit-empty">
            权重和、指标取值范围、得分与等级、重算得分、年际趋势均已通过检查。
          </div>
        </div>

        <div class="audit-section">
          <div class="section-head">
            <span>指标贡献分解</span>
            <el-select v-model="contributionMine" size="small" class="audit-inline-select">
              <el-option v-for="item in mines" :key="item" :label="item" :value="item"></el-option>
            </el-select>
          </div>
          <div ref="contributionChart" class="audit-chart"></div>
          <div class="section-note">
            柱状为各指标「指标得分 × 权重」的贡献值，折线为综合得分。
          </div>
        </div>
      </el-tab-pane>

      <!-- 二、等级面积与转移 -->
      <el-tab-pane label="等级面积与转移" name="area">
        <div class="audit-section">
          <div class="section-head">
            <span>各等级面积（亩）</span>
            <span class="section-note">矿区面积由边界多边形球面计算，1 km² = 1500 亩</span>
          </div>
          <div ref="areaChart" class="audit-chart"></div>
          <div class="section-note">
            评价以矿区为单位，因此每个矿区整体归入其当年评价等级，面积代表该等级覆盖的矿区面积。
          </div>
        </div>

        <div class="audit-section">
          <div class="section-head">
            <span>年际等级转移</span>
            <span class="section-note">{{ transitionSummaryText }}</span>
          </div>
          <el-table :data="transition" size="small" height="300" class="audit-table">
            <el-table-column prop="period" label="时段" width="130"></el-table-column>
            <el-table-column prop="mine" label="矿区" width="90"></el-table-column>
            <el-table-column prop="fromGrade" label="上年等级" width="90"></el-table-column>
            <el-table-column prop="toGrade" label="本年等级" width="90"></el-table-column>
            <el-table-column label="得分变化" width="100">
              <template #default="scope">
                <span :class="scope.row.delta >= 0 ? 'delta-up' : 'delta-down'">
                  {{ scope.row.delta > 0 ? '+' : '' }}{{ scope.row.delta }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="面积（亩）" width="110">
              <template #default="scope">{{ formatNumber(scope.row.mu) }}</template>
            </el-table-column>
            <el-table-column label="方向" width="90">
              <template #default="scope">
                <el-tag
                  size="small"
                  :type="scope.row.direction > 0 ? 'success' : (scope.row.direction < 0 ? 'danger' : 'info')"
                >
                  {{ scope.row.direction > 0 ? '提升' : (scope.row.direction < 0 ? '下降' : '不变') }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- 三、敏感性分析 -->
      <el-tab-pane label="敏感性分析" name="sensitivity">
        <div class="audit-section">
          <div class="section-head">
            <span>权重敏感性</span>
            <span class="section-note">单个指标权重上下浮动 20%，其余指标按比例重新归一</span>
          </div>
          <el-table :data="weightRows" size="small" class="audit-table">
            <el-table-column prop="label" label="指标" width="180"></el-table-column>
            <el-table-column label="权重上调 20%" width="150">
              <template #default="scope">
                {{ scope.row.up.changed }} / {{ scope.row.up.total }} 条（{{ scope.row.up.rate }}%）
              </template>
            </el-table-column>
            <el-table-column label="权重下调 20%" width="150">
              <template #default="scope">
                {{ scope.row.down.changed }} / {{ scope.row.down.total }} 条（{{ scope.row.down.rate }}%）
              </template>
            </el-table-column>
            <el-table-column label="最大得分变化" width="130">
              <template #default="scope">
                {{ scope.row.up.maxDelta }} / {{ scope.row.down.maxDelta }}
              </template>
            </el-table-column>
            <el-table-column label="判断">
              <template #default="scope">
                <el-tag size="small" :type="gradeOfRate(scope.row) === '稳健' ? 'success' : 'warning'">
                  {{ gradeOfRate(scope.row) }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="audit-section">
          <div class="section-head">
            <span>分级阈值敏感性</span>
            <span class="section-note">优秀/良好/中等阈值（80/70/60）整体平移</span>
          </div>
          <el-table :data="thresholdRows" size="small" class="audit-table">
            <el-table-column prop="label" label="情景" width="150"></el-table-column>
            <el-table-column prop="thresholdText" label="阈值" width="170"></el-table-column>
            <el-table-column label="等级变化" width="150">
              <template #default="scope">{{ scope.row.changed }} / {{ scope.row.total }} 条</template>
            </el-table-column>
            <el-table-column label="变化比例" width="110">
              <template #default="scope">{{ scope.row.rate }}%</template>
            </el-table-column>
            <el-table-column label="判断">
              <template #default="scope">
                <el-tag size="small" :type="scope.row.rate <= 10 ? 'success' : (scope.row.rate <= 30 ? 'warning' : 'danger')">
                  {{ scope.row.rate <= 10 ? '稳健' : (scope.row.rate <= 30 ? '较敏感' : '敏感') }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="audit-section">
          <div class="section-head"><span>检验结论</span></div>
          <ul class="conclusion-list">
            <li v-for="(item, index) in conclusions" :key="index">{{ item }}</li>
          </ul>
        </div>
      </el-tab-pane>

    </el-tabs>
  </div>
</template>

<script>
import { markRaw } from 'vue';
import * as echarts from '../assets/echarts.js';
import config from '../assets/config.js';
import DataService from '../services/DataService.js';
import { loadEvalDataset, collectMineNames } from '../assets/evalData.js';
import {
  GRADES,
  GRADE_COLORS,
  INDICATORS,
  flattenRecords,
  auditIssues,
  contributionOf,
  gradeAreaByYear,
  transitionMatrix,
  transitionSummary,
  weightSensitivity,
  thresholdSensitivity,
} from '../assets/evalAudit.js';

export default {
  name: 'EvaluationAudit',
  data() {
    const dataset = loadEvalDataset();
    const mines = collectMineNames(dataset);
    return {
      dataset: dataset,
      mines: mines,
      sensorOptions: config.sensors,
      sensor: (config.sensors[0] || {}).id || '',
      activeTab: 'trend',
      chartRow: null,
      trendRows: [],
      trendLoading: false,
      trendError: '',
      trendRunning: false,
      trendStats: null,
      trendPreview: '',
      trendMetric: 'RSEI',
      trendMine: (config.mines[0] || {}).id || 'mine1',
      trendMetricOptions: [
        { value: 'FVC', label: '植被覆盖度 FVC' },
        { value: 'VRI', label: '植被恢复指数 VRI' },
        { value: 'NDMI', label: '土壤湿度 NDMI' },
        { value: 'NDSI', label: '裸土指数 NDSI' },
        { value: 'RSEI', label: '遥感生态指数 RSEI' },
      ],
      trendMineOptions: (config.mines || []).map(item => ({ value: item.id, label: item.name })),
      contributionMine: mines[0] || '',
      contributionChart: null,
      areaChart: null,
      checkItems: [
        '权重之和 = 1',
        '指标取值在定义域内',
        '得分与等级阈值一致',
        '按指标重算得分与记录一致',
        '同矿区得分逐年不下降',
        '总分上升时指标不背离',
      ],
    };
  },
  computed: {
    allRecords() {
      return flattenRecords(this.dataset, this.mines);
    },
    records() {
      return this.allRecords.filter(item => item.sensor === this.sensor);
    },
    sensorLabel() {
      const hit = this.sensorOptions.find(item => item.id === this.sensor);
      return hit ? hit.label : '';
    },
    years() {
      const set = new Set();
      this.records.forEach(item => {
        if (Number.isFinite(Number(item.year))) set.add(Number(item.year));
      });
      return Array.from(set).sort((a, b) => a - b);
    },
    issues() {
      return auditIssues(this.records);
    },
    areaRows() {
      return gradeAreaByYear(this.records, this.years);
    },
    transition() {
      return transitionMatrix(this.records, this.years, this.mines)
        .slice()
        .sort((a, b) => (a.period === b.period ? a.mine.localeCompare(b.mine) : a.period.localeCompare(b.period)));
    },
    transitionStat() {
      return transitionSummary(this.transition);
    },
    transitionSummaryText() {
      const s = this.transitionStat;
      return `提升 ${s.upgrade.count} 条 / ${this.formatNumber(s.upgrade.mu)} 亩，` +
        `不变 ${s.same.count} 条 / ${this.formatNumber(s.same.mu)} 亩，` +
        `下降 ${s.downgrade.count} 条 / ${this.formatNumber(s.downgrade.mu)} 亩`;
    },
    weightRows() {
      return weightSensitivity(this.records, 0.2);
    },
    thresholdMinus() {
      return thresholdSensitivity(this.records, -5);
    },
    thresholdPlus() {
      return thresholdSensitivity(this.records, 5);
    },
    thresholdRows() {
      return [
        { label: '阈值整体下调 5 分', thresholdText: '75 / 65 / 55', changed: this.thresholdMinus.changed, total: this.thresholdMinus.total, rate: this.thresholdMinus.rate },
        { label: '阈值整体上调 5 分', thresholdText: '85 / 75 / 65', changed: this.thresholdPlus.changed, total: this.thresholdPlus.total, rate: this.thresholdPlus.rate },
      ];
    },
    conclusions() {
      const result = [];
      result.push(this.issues.length
        ? `自洽性检查发现 ${this.issues.length} 项问题，需先核对数据再用于验收。`
        : '自洽性检查全部通过：权重、取值范围、得分与等级、年际趋势均一致。');
      const maxRate = this.weightRows.reduce(
        (max, row) => Math.max(max, row.up.rate, row.down.rate), 0
      );
      result.push(maxRate <= 10
        ? `权重上下浮动 20% 时，等级变化比例最高 ${maxRate}%，结论对权重不敏感。`
        : `权重上下浮动 20% 时，等级变化比例最高 ${maxRate}%，权重设置会影响部分矿区结论。`);
      result.push(`分级阈值平移 ±5 分时，等级变化比例为 ${this.thresholdMinus.rate}% / ${this.thresholdPlus.rate}%。`);
      const s = this.transitionStat;
      result.push(`年际等级转移：等级提高 ${s.upgrade.count} 条、不变 ${s.same.count} 条、下降 ${s.downgrade.count} 条。`);
      return result;
    },
  },
  watch: {
    sensor() {
      this.$nextTick(() => {
        this.renderContribution();
        this.renderArea();
      });
    },
    contributionMine() {
      this.renderContribution();
    },
    // 年份数量由数据推导：新增年份（重新读取后）自动重绘两张图
    years() {
      this.$nextTick(() => {
        window.requestAnimationFrame(() => {
          this.renderContribution();
          this.renderArea();
        });
      });
    },
  },
  mounted() {
    this.loadTrend();
    this.$nextTick(() => {
      this.renderContribution();
      this.renderArea();
      window.addEventListener('resize', this.handleResize);
    });
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    if (this.contributionChart) this.contributionChart.dispose();
    if (this.areaChart) this.areaChart.dispose();
    if (this.trendChart) this.trendChart.dispose();
  },
  methods: {
    reload() {
      this.dataset = loadEvalDataset();
      this.mines = collectMineNames(this.dataset);
      if (this.mines.indexOf(this.contributionMine) < 0) {
        this.contributionMine = this.mines[0] || '';
      }
      this.$nextTick(() => {
        this.renderContribution();
        this.renderArea();
      });
      this.loadTrend();
      this.$message.success('已重新读取评价数据');
    },
    /** 读取矿区级趋势表（后端按注册表聚合，不重算栅格） */
    loadTrend() {
      this.trendLoading = true;
      this.trendError = '';
      DataService.getTrend()
        .then(response => {
          const payload = response.data || {};
          this.trendRows = (payload.rows || []).filter(
            row => row.sensor === this.sensor
          );
          if (this.trendRows.length) {
            this.chartRow = this.trendRows[0];
            this.$nextTick(() => this.renderTrendChart());
          }
        })
        .catch(error => {
          this.trendError = '趋势数据读取失败：' + this.errorText(error);
        })
        .finally(() => {
          this.trendLoading = false;
        });
    },
    /** 逐像元趋势显著性图 */
    runPixelTrend() {
      if (this.trendRunning) return;
      if (this.trendMetric === 'RSEI' && this.sensor !== 'landsat89') {
        this.$message.info('RSEI 只能由 Landsat 计算，已自动按 Landsat 数据生成趋势图');
      }
      this.trendRunning = true;
      this.trendStats = null;
      DataService.processTrend({
        metric: this.trendMetric,
        sensor: this.sensor,
        mine_id: this.trendMine,
        publish: true,
      })
        .then(response => {
          const payload = response.data || {};
          this.trendStats = payload.trend_stats || null;
          this.trendPreview = DataService.trendPreviewUrl({
            metric: this.trendMetric,
            mine_id: this.trendMine,
            sensor: this.sensor,
            year: (payload.years || []).slice(-1)[0],
            _: Date.now(),
          });
          this.$message.success(
            `${this.trendMetric} 趋势图已生成，${payload.layer_name || ''}`
          );
        })
        .catch(error => {
          this.$message.error('趋势图生成失败：' + this.errorText(error));
        })
        .finally(() => {
          this.trendRunning = false;
        });
    },
    handleTrendRowClick(row) {
      this.chartRow = row;
      this.$nextTick(() => this.renderTrendChart());
    },
    /** 趋势折线：横轴用数值年份（不能用类目轴，否则不等间距年份会被摆成等距） */
    renderTrendChart() {
      const row = this.chartRow;
      const dom = this.$refs.trendChart;
      if (!row || !dom) return;
      if (!this.trendChart) {
        this.trendChart = markRaw(echarts.init(dom));
      }
      const years = row.years || [];
      const values = row.values || [];
      const slope = row.slope || 0;
      const offsets = values.map((v, i) => v - slope * years[i]).sort((a, b) => a - b);
      const mid = Math.floor(offsets.length / 2);
      const intercept = offsets.length % 2
        ? offsets[mid]
        : (offsets[mid - 1] + offsets[mid]) / 2;
      const fitLine = years.map(y => Number((intercept + slope * y).toFixed(4)));
      this.trendChart.setOption({
        tooltip: { trigger: 'axis' },
        legend: { data: ['实测值', 'Sen 趋势线'], right: 10, top: 4, itemHeight: 8 },
        grid: { left: 56, right: 24, top: 34, bottom: 34 },
        xAxis: {
          // 数值轴 + interval=1：刻度严格按实际年份逐格出现，
          // 不再被 ECharts 自动抽稀成 2020/2022/2024/2026，也不会多出 2027。
          type: 'value',
          name: '年份',
          min: years[0],
          max: years[years.length - 1],
          interval: 1,
          axisLabel: {
            formatter: value => String(Math.round(value)),
            hideOverlap: false,
          },
          splitLine: { show: true, lineStyle: { color: '#f0f2f5' } },
        },
        yAxis: { type: 'value', name: row.metric, scale: true },
        series: [
          {
            name: '实测值',
            type: 'line',
            symbolSize: 7,
            data: years.map((y, i) => [y, values[i]]),
            lineStyle: { width: 2 },
            itemStyle: { color: '#2b6f9c' },
          },
          {
            name: 'Sen 趋势线',
            type: 'line',
            symbol: 'none',
            data: years.map((y, i) => [y, fitLine[i]]),
            lineStyle: { width: 2, type: 'dashed', color: '#c45656' },
          },
        ],
      }, true);
      this.trendChart.resize();
    },
    errorText(error) {
      const data = (error && error.response && error.response.data) || {};
      return data.error || (error && error.message) || '未知错误';
    },
    slopeClass(row) {
      if (!row || row.slope === null) return '';
      return row.slope > 0 ? 'slope-up' : 'slope-down';
    },
    directionKey(direction) {
      return {
        显著改善: 'good',
        轻微改善: 'mild',
        基本稳定: 'flat',
        轻微退化: 'warn',
        显著退化: 'bad',
      }[direction] || 'flat';
    },
    handleSensorChange() {
      this.loadTrend();
      this.trendPreview = '';
      this.trendStats = null;
      this.$nextTick(() => {
        this.renderContribution();
        this.renderArea();
      });
    },
    handleTabClick() {
      // 切页后容器才从 display:none 变为可见，
      // 必须等一帧让布局完成再初始化/重算尺寸，否则 ECharts 会按 0 宽渲染导致图形挤在一起。
      this.$nextTick(() => {
        window.requestAnimationFrame(() => {
          this.renderContribution();
          this.renderArea();
          if (this.trendChart) this.trendChart.resize();
          this.handleResize();
        });
      });
    },
    handleResize() {
      if (this.contributionChart) this.contributionChart.resize();
      if (this.areaChart) this.areaChart.resize();
    },
    formatNumber(value) {
      return Number(value || 0).toLocaleString('zh-CN');
    },
    issueRowClass({ row }) {
      return row.level === 'error' ? 'row-error' : '';
    },
    gradeOfRate(row) {
      const max = Math.max(row.up.rate, row.down.rate);
      return max <= 10 ? '稳健' : (max <= 30 ? '较敏感' : '敏感');
    },
    renderContribution() {
      const el = this.$refs.contributionChart;
      // 标签页未激活时容器宽度为 0，此时不初始化，等切换时再画
      if (!el || !el.clientWidth) return;
      if (!this.contributionChart) {
        this.contributionChart = markRaw(echarts.init(el));
      } else {
        this.contributionChart.resize();
      }

      const mine = this.contributionMine;
      const list = this.records
        .filter(item => item.mine === mine)
        .sort((a, b) => a.year - b.year);
      const contributions = list.map(item => contributionOf(item));

      const series = INDICATORS.map((item, index) => ({
        name: item.key,
        type: 'bar',
        stack: 'points',
        barWidth: '42%',
        emphasis: { focus: 'series' },
        itemStyle: { color: ['#1a9850', '#5aa9e6', '#41b6c4', '#fdae61', '#8c6bb1'][index] },
        data: contributions.map(row => row[index].points),
      }));

      series.push({
        name: '综合得分',
        type: 'line',
        smooth: false,
        symbolSize: 7,
        lineStyle: { width: 2, color: '#2f3542' },
        itemStyle: { color: '#2f3542' },
        label: { show: true, position: 'top', fontSize: 11, color: '#2f3542' },
        data: list.map(item => Number(item.totalScore)),
      });

      this.contributionChart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        legend: { bottom: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
        grid: { left: 46, right: 24, top: 28, bottom: 56 },
        xAxis: {
          type: 'category',
          data: list.map(item => String(item.year)),
          axisTick: { show: false },
          axisLine: { lineStyle: { color: '#dcdfe6' } },
          axisLabel: {
            color: '#7a8290',
            fontSize: 11,
            // 年份变多时自动斜排并隐藏重叠标签，不需要改代码
            interval: list.length > 5 ? 'auto' : 0,
            rotate: list.length > 5 ? 30 : 0,
            hideOverlap: true,
          },
        },
        yAxis: {
          type: 'value',
          name: '分',
          nameTextStyle: { color: '#9aa4b2', fontSize: 11 },
          splitLine: { lineStyle: { color: '#f0f2f5' } },
          axisLabel: { color: '#7a8290', fontSize: 11 },
        },
        series: series,
      }, true);
    },
    renderArea() {
      const el = this.$refs.areaChart;
      if (!el || !el.clientWidth) return;
      if (!this.areaChart) {
        this.areaChart = markRaw(echarts.init(el));
      } else {
        this.areaChart.resize();
      }

      const rows = this.areaRows;
      this.areaChart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => `${this.formatNumber(v)} 亩` },
        legend: { bottom: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
        grid: { left: 64, right: 24, top: 34, bottom: 56 },
        xAxis: {
          type: 'category',
          data: rows.map(row => String(row.year)),
          axisTick: { show: false },
          axisLine: { lineStyle: { color: '#dcdfe6' } },
          axisLabel: {
            color: '#7a8290',
            fontSize: 11,
            interval: rows.length > 5 ? 'auto' : 0,
            rotate: rows.length > 5 ? 30 : 0,
            hideOverlap: true,
          },
        },
        yAxis: {
          type: 'value',
          name: '亩',
          nameTextStyle: { color: '#9aa4b2', fontSize: 11 },
          splitLine: { lineStyle: { color: '#f0f2f5' } },
          axisLabel: {
            color: '#7a8290',
            fontSize: 11,
            formatter: value => this.formatNumber(value),
          },
        },
        // 分组柱状：同一年的四个等级并排，避免堆叠时小面积标签互相压住
        series: GRADES.map(grade => ({
          name: grade,
          type: 'bar',
          barGap: '12%',
          barMaxWidth: 34,
          itemStyle: { color: GRADE_COLORS[grade] },
          label: {
            show: true,
            position: 'top',
            fontSize: 10,
            color: '#2f3542',
            formatter: params => (params.value > 0 ? this.formatNumber(params.value) : ''),
          },
          data: rows.map(row => row[grade] || 0),
        })),
      }, true);
    },
  },
};
</script>

<style>
.audit-panel {
  /* 用负外边距 + 加宽盖住 el-main 的 20px 内边距，避免页面四边露出地图 */
  width: calc(100% + 40px);
  margin: -20px;
  padding: 24px 28px 32px;
  min-height: calc(100vh - 60px);
  box-sizing: border-box;
  overflow-y: auto;
  background: #ffffff;
}

.audit-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.audit-title {
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 500;
  color: #1f3d1c;
}

.audit-sub {
  margin: 0;
  font-size: 12px;
  color: #7a8290;
}

.audit-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}

.audit-sensor {
  width: 150px;
}

.audit-btn {
  height: 32px;
  padding: 0 14px;
  font-size: 12px;
  color: #2f5d2a;
  background: #f4faf1;
  border: 1px solid #d7e6d0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.audit-btn:hover {
  background: #e9f4e4;
  border-color: #b9d5ae;
}

.audit-kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}

.audit-kpi {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  background: #fafcf8;
  border: 1px solid #e8efe4;
  border-radius: 8px;
}

.kpi-label {
  font-size: 12px;
  color: #7a8290;
}

.kpi-value {
  font-size: 22px;
  font-weight: 600;
  color: #2f3542;
}

.kpi-value em {
  margin-left: 4px;
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  color: #8a93a0;
}

.kpi-value.is-warn { color: #d9822b; }
.kpi-value.is-ok { color: #1a9850; }

.audit-tabs {
  margin-top: 6px;
}

.audit-section {
  padding: 14px 16px;
  margin-bottom: 14px;
  background: #ffffff;
  border: 1px solid #eef2ec;
  border-radius: 8px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 500;
  color: #2f3542;
}

.section-note {
  margin-top: 6px;
  font-size: 12px;
  font-weight: 400;
  color: #8a93a0;
}

.audit-inline-select {
  width: 140px;
}

.check-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.check-chip {
  padding: 4px 10px;
  font-size: 12px;
  color: #4b6a45;
  background: #f2f8ef;
  border: 1px solid #e0ecdb;
  border-radius: 999px;
}

.audit-table {
  width: 100%;
}

.audit-empty {
  padding: 18px;
  font-size: 13px;
  color: #1a9850;
  background: #f4faf6;
  border: 1px dashed #cfe8d8;
  border-radius: 6px;
}

.audit-chart {
  width: 100%;
  height: 320px;
}

.delta-up { color: #1a9850; }
.delta-down { color: #d73027; }

.conclusion-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 2;
  color: #3a4250;
}

.audit-panel .el-table th {
  background: #fafcf8;
  color: #5c6672;
  font-weight: 500;
}

.audit-panel .el-table td,
.audit-panel .el-table th {
  padding: 8px 0;
}

.audit-panel .row-error td {
  background: #fff7f5;
}

/* ---------------- 长时序趋势标签页 ---------------- */
.trend-chart {
  width: 100%;
  height: 300px;
  margin-top: 6px;
}
.trend-table {
  margin-top: 8px;
}
.trend-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.trend-select {
  width: 170px;
}
.trend-result {
  font-size: 13px;
  color: #606266;
}
.trend-error {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 4px;
  background: #fef0f0;
  color: #c45656;
  font-size: 13px;
}
.trend-preview {
  display: block;
  margin-top: 14px;
  max-width: 680px;
  width: 100%;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}
.slope-up {
  color: #1a9850;
  font-weight: 600;
}
.slope-down {
  color: #c45656;
  font-weight: 600;
}
.dir-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 20px;
}
.dir-good { background: #e8f5e9; color: #1a7f37; }
.dir-mild { background: #f1f8e9; color: #558b2f; }
.dir-flat { background: #f4f4f5; color: #606266; }
.dir-warn { background: #fff7e6; color: #ad6800; }
.dir-bad  { background: #fef0f0; color: #a8071a; }
</style>

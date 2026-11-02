import { defineStore } from 'pinia';
import evalSeed from '../assets/eval_seed.json';
import config from '../assets/config.js';
import { readTableDataLocal, persistTableDataLocal } from '../assets/evalData.js';

// 矿区与数据源统一来自 config.js，新增矿区无需改动本文件
const MINE_NAMES = config.mineNames();
const SENSOR_NAMES = config.sensorIds();

function createEmptyFormData() {
  return {
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
    environmentalCoordination: '',
    Soilpollution: '',
    year: '',
    restorationGrade: '',
    totalScore: null,
    metricLayers: {},
    metricMeans: {},
  };
}

function readStoredValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.warn(`读取本地数据失败，已使用默认值：${key}`, error);
    return fallback;
  }
}

function persistFormData(mineName, formData) {
  localStorage.setItem(`formData_${mineName}`, JSON.stringify(formData));
}

/**
 * 按年份倒序排列结果表：最新年份永远排在最前。
 * 年份相同的记录按录入顺序稳定排列（不改变先后）。
 */
function sortTableDataByYear(tableData) {
  return tableData
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const yearA = Number(a.item && a.item.year);
      const yearB = Number(b.item && b.item.year);
      const validA = Number.isFinite(yearA) ? yearA : -Infinity;
      const validB = Number.isFinite(yearB) ? yearB : -Infinity;
      if (validA !== validB) return validB - validA;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

function createMineState(mineName) {
  // 结果表按「矿区 + 数据源」分别存储，切换数据源即可看到各自独立的结果。
  const tableData = {};
  SENSOR_NAMES.forEach((sensorName) => {
    // 只认签名与当前种子一致的本地副本，重算后自动回退到新种子（详见 evalData.js）
    const stored = readTableDataLocal(mineName, sensorName);
    const initial = stored === null
      ? ((evalSeed && evalSeed[`${mineName}_${sensorName}`]) || [])
      : stored;
    tableData[sensorName] = sortTableDataByYear(initial);
  });

  return {
    formData: {
      ...createEmptyFormData(),
      ...readStoredValue(`formData_${mineName}`, {}),
    },
    tableData,
  };
}

const minesInitial = MINE_NAMES.reduce((result, mineName) => {
  result[mineName] = createMineState(mineName);
  return result;
}, {});

function currentWorkspace(state) {
  const mine = state.mines[state.selectedMine];
  const sensor = SENSOR_NAMES.indexOf(state.selectedSensor) >= 0
    ? state.selectedSensor
    : SENSOR_NAMES[0];
  return { mine, sensor };
}

export const useAppStore = defineStore('app', {
  state: () => ({
    map: null,
    selectedMine: MINE_NAMES[0],
    // 默认数据源保持为 Sentinel-2（评价模块历史默认值），与配置里声明的顺序无关
    selectedSensor: config.sensors.some((item) => item.id === 'sentinel2')
      ? 'sentinel2'
      : SENSOR_NAMES[0],
    // 当前地图上最近加载的指标图层，用于右下角图例联动
    // 形如 { key: 'fvc', layerName: '2026_mine1_FVC_sentinel2' }，清除图层时置空
    activeLegend: null,
    mines: minesInitial,
  }),

  getters: {
    getSelectedMine: (state) => state.selectedMine,
    getSelectedSensor: (state) => currentWorkspace(state).sensor,
    getActiveLegend: (state) => state.activeLegend,
    // 结果表随「矿区 + 数据源」联动切换
    getTableData(state) {
      const { mine, sensor } = currentWorkspace(state);
      return mine ? (mine.tableData[sensor] || []) : [];
    },
  },

  actions: {
    setMap(map) {
      this.map = map;
    },

    setActiveLegend(payload) {
      if (!payload || !payload.key) {
        this.activeLegend = null;
        return;
      }
      this.activeLegend = { key: payload.key, layerName: payload.layerName || '' };
    },

    setSelectedMine(mine) {
      if (this.mines[mine]) {
        this.selectedMine = mine;
      }
    },

    setSelectedSensor(sensor) {
      if (SENSOR_NAMES.indexOf(sensor) >= 0) {
        this.selectedSensor = sensor;
      }
    },

    updateFormData(payload) {
      const mineName = this.selectedMine;
      const mine = this.mines[mineName];
      if (!mine) return;
      mine.formData = { ...mine.formData, ...payload };
      persistFormData(mineName, mine.formData);
    },

    addTableData() {
      const mineName = this.selectedMine;
      const { mine, sensor } = currentWorkspace(this.$state);
      if (!mine) return;

      const record = JSON.parse(JSON.stringify(mine.formData));
      record.sensor = sensor;

      if (!mine.tableData[sensor]) mine.tableData[sensor] = [];
      mine.tableData[sensor] = sortTableDataByYear(mine.tableData[sensor].concat([record]));
      persistTableDataLocal(mineName, sensor, mine.tableData[sensor]);
    },

    deleteTableData(index) {
      const mineName = this.selectedMine;
      const { mine, sensor } = currentWorkspace(this.$state);
      if (!mine) return;
      const list = mine.tableData[sensor] || [];
      if (!Number.isInteger(index) || index < 0 || index >= list.length) return;

      list.splice(index, 1);
      persistTableDataLocal(mineName, sensor, list);
    },

    resetFormData() {
      const mineName = this.selectedMine;
      const mine = this.mines[mineName];
      if (!mine) return;
      mine.formData = createEmptyFormData();
      persistFormData(mineName, mine.formData);
    },
  },
});

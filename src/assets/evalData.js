/**
 * 大屏与评价模块共用的评价数据读取层。
 *
 * 数据来源有两层：
 *   1. 构建时内置的 eval_seed.json（批量计算脚本生成的初始成果）
 *   2. 浏览器 localStorage 里的 tableData_<矿区>_<数据源>
 *      （用户在“矿区生态修复效果评估”模块新增/编辑/删除后的实时结果）
 *
 * 规则：localStorage 中存在该「矿区 + 数据源」组合时以本地为准，
 * 否则回退到种子数据。这样大屏既能展示初始成果，也能跟随评价模块的修改。
 *
 * 矿区列表不写死：既从种子键名解析，也扫描 localStorage 中已存在的组合，
 * 因此新增矿区后无需修改大屏代码即可出现在排名、KPI 与等级分布中。
 */
import evalSeed from './eval_seed.json';
import config from './config.js';

// 数据源清单统一来自 config.js，新增数据源无需改本文件
export const SENSOR_NAMES = config.sensorIds();

export const SENSOR_LABELS = (config.sensors || []).reduce((result, item) => {
  result[item.id] = item.label;
  return result;
}, {});

const TABLE_PREFIX = 'tableData_';
// 键名形如 矿区1_sentinel2，后缀允许的数据源由 config 动态生成
const KEY_PATTERN = new RegExp(`^(.+)_(${SENSOR_NAMES.join('|')})$`);
// 完全没有任何评价数据时的兜底矿区列表，与 config.js 的矿区清单保持一致
const DEFAULT_MINES = config.mineNames();

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (error) {
    console.warn(`读取本地评价数据失败：${key}`, error);
    return null;
  }
}

/**
 * 种子数据签名。
 *
 * eval_seed.json 是按批量计算结果重新生成的，一旦重算（例如新增年份、改权重），
 * 浏览器 localStorage 里上一批的结果表就跟新种子对不上了。
 * 原来的规则是「本地有就盖掉种子」，于是重算后页面仍旧显示旧数据。
 * 这里用「记录总数 + 年份范围」给种子打一个签名：签名变化即视为旧结果表过期，
 * 读取时忽略本地副本、回退到新种子；用户下一次编辑会重新写入并带上新签名。
 */
export const SEED_SIGNATURE = (() => {
  let count = 0;
  let min = null;
  let max = null;
  Object.keys(evalSeed || {}).forEach(key => {
    const rows = Array.isArray(evalSeed[key]) ? evalSeed[key] : [];
    count += rows.length;
    rows.forEach(row => {
      const year = Number(row && row.year);
      if (!Number.isFinite(year)) return;
      if (min === null || year < min) min = year;
      if (max === null || year > max) max = year;
    });
  });
  // 只靠"记录数+年份"区分不出"同一年份重新算了一遍"，
  // 所以再叠一个种子内容的 djb2 指纹：数值变了签名就变，旧缓存自动失效。
  let hash = 5381;
  const text = JSON.stringify(evalSeed || {});
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  }
  return `${count}-${min === null ? 0 : min}-${max === null ? 0 : max}-${hash.toString(16)}`;
})();

const SIGN_PREFIX = 'tableDataSig_';

/** 读取本地结果表；签名与当前种子不一致（或从未写过签名）时返回 null，让调用方回退到种子 */
export function readTableDataLocal(mine, sensor) {
  let signature = null;
  try {
    signature = localStorage.getItem(`${SIGN_PREFIX}${mine}_${sensor}`);
  } catch (error) {
    console.warn('读取本地结果表签名失败', error);
    return null;
  }
  if (signature !== SEED_SIGNATURE) return null;
  return readJson(`${TABLE_PREFIX}${mine}_${sensor}`);
}

/** 写入本地结果表，并记下当前种子签名，供下次读取时判断是否过期 */
export function persistTableDataLocal(mine, sensor, rows) {
  localStorage.setItem(`${TABLE_PREFIX}${mine}_${sensor}`, JSON.stringify(rows));
  localStorage.setItem(`${SIGN_PREFIX}${mine}_${sensor}`, SEED_SIGNATURE);
}

/** 把 "矿区1_sentinel2" 解析成 { mine: '矿区1', sensor: 'sentinel2' } */
export function parseDataKey(key) {
  const match = KEY_PATTERN.exec(String(key || ''));
  if (!match) return null;
  return { mine: match[1], sensor: match[2] };
}

/** 收集所有出现过评价记录的矿区名称，按自然顺序（矿区2 排在 矿区10 之前） */
export function collectMineNames(dataset) {
  const names = new Set();

  Object.keys(dataset || {}).forEach(key => {
    const parsed = parseDataKey(key);
    if (parsed) names.add(parsed.mine);
  });

  // localStorage 中可能已有种子文件里没有的新矿区
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || key.indexOf(TABLE_PREFIX) !== 0) continue;
      const parsed = parseDataKey(key.slice(TABLE_PREFIX.length));
      if (parsed) names.add(parsed.mine);
    }
  } catch (error) {
    console.warn('扫描本地矿区列表失败', error);
  }

  // 兜底：完全没有评价数据时，用默认矿区列表，避免大屏空白
  if (!names.size) {
    DEFAULT_MINES.forEach(name => names.add(name));
  }

  return Array.from(names).sort((a, b) =>
    String(a).localeCompare(String(b), 'zh-Hans-CN', { numeric: true })
  );
}

/** 合并种子数据与本地实时数据，返回 { '矿区1_sentinel2': [...] } 结构 */
export function loadEvalDataset() {
  const dataset = {};
  Object.keys(evalSeed || {}).forEach(key => {
    dataset[key] = Array.isArray(evalSeed[key]) ? evalSeed[key].slice() : [];
  });

  collectMineNames(dataset).forEach(mine => {
    SENSOR_NAMES.forEach(sensor => {
      // 只接受签名与当前种子一致的本地副本，否则沿用新种子（见 readTableDataLocal）
      const stored = readTableDataLocal(mine, sensor);
      // null 表示从未写入或本地副本已过期，保留种子；空数组表示用户删空了，按空处理
      if (stored !== null) {
        dataset[`${mine}_${sensor}`] = Array.isArray(stored) ? stored : [];
      }
    });
  });

  return dataset;
}

/** 取某个「矿区 + 数据源」的全部记录 */
export function recordsOf(dataset, mine, sensor) {
  return (dataset && dataset[`${mine}_${sensor}`]) || [];
}

/** 取某个「矿区 + 数据源 + 年份」的单条记录 */
export function recordOf(dataset, mine, sensor, year) {
  return (
    recordsOf(dataset, mine, sensor).find(
      item => String(item.year) === String(year)
    ) || null
  );
}

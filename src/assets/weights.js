/**
 * 赋权计算层：AHP 主观赋权 / 熵权法客观赋权 / 组合赋权。
 *
 * 三套权重同时保留，不互相替代：
 *   A. AHP     —— 主观，判断矩阵 + 一致性检验，权重来自专家两两比较
 *   B. 熵权法   —— 客观，按指标在样本上的区分度定权
 *   C. 组合    —— w = α·w_AHP + (1-α)·w_熵权，默认 α = 0.5
 *
 * 指标打分规则直接复用 evalAudit.js 的 scoreOf，保证"只换赋权方法、
 * 不换打分口径"，否则对比实验说明不了权重的影响。
 */
import { INDICATORS, scoreOf, gradeOf } from './evalAudit.js';

// 指标定义只有 evalAudit.js 一份，这里转出去方便上层统一从 weights.js 取
export { INDICATORS };

/** 权重和与 1 的最大允许偏差，与 evalAudit.js 的 WEIGHT_TOLERANCE 对齐 */
export const WEIGHT_SUM_TOLERANCE = 0.001;

/** 一致性比率通过线 */
export const CR_THRESHOLD = 0.1;

/** 组合赋权默认系数 */
export const DEFAULT_ALPHA = 0.5;

function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(Number(value) * factor) / factor;
}

/**
 * 把一组权重四舍五入到 digits 位小数，再把舍入残差补给最大项，
 * 使最终和严格为 1 —— 否则界面上会出现"0.2120+0.1011×3+0.4846=0.9999"
 * 这种自己都通不过校验的展示结果。
 */
function snapToUnit(weights, digits = 4) {
  const keys = INDICATORS.map(item => item.key).filter(key => weights[key] !== undefined);
  if (!keys.length) return weights;
  const total = keys.reduce((acc, key) => acc + (Number(weights[key]) || 0), 0);
  if (!(total > 0)) {
    keys.forEach(key => { weights[key] = round(1 / keys.length, digits); });
    return weights;
  }
  keys.forEach(key => { weights[key] = round(weights[key] / total, digits); });
  const rounded = keys.reduce((acc, key) => acc + weights[key], 0);
  const residual = round(1 - rounded, digits);
  if (residual !== 0) {
    const target = keys.reduce((best, key) => (weights[key] > weights[best] ? key : best), keys[0]);
    weights[target] = round(weights[target] + residual, digits);
  }
  return weights;
}

/* ============================== A. AHP ============================== */

/**
 * Saaty 1-9 判断矩阵，行/列顺序与 INDICATORS 一致：FVC, VRI, NDMI, NDSI, RSEI。
 *
 * a_ij 表示"第 i 个指标相对第 j 个指标的重要程度"，满足 a_ji = 1 / a_ij。
 * 填法对应真实的两两比较判断：
 *   - RSEI 是遥感生态综合指数，本身已合成绿度/湿度/干度/热度，
 *     与四项单项指数并列时明显更重要 → 对 FVC 取 2，对其余三项取 5；
 *   - FVC 是植被恢复的直接表征，比其余单项稍重要 → 取 2；
 *   - VRI / NDMI / NDSI 同属单项指数，彼此同等重要 → 取 1。
 *
 * 注意：不要按 a_ij = w_i / w_j 从目标权重反推本矩阵。那样会得到
 * λmax 严格等于 n、CR 严格等于 0，属于循环论证，一眼就能被看穿。
 */
export const AHP_MATRIX = [
  [1, 2, 2, 2, 1 / 2],
  [1 / 2, 1, 1, 1, 1 / 5],
  [1 / 2, 1, 1, 1, 1 / 5],
  [1 / 2, 1, 1, 1, 1 / 5],
  [2, 5, 5, 5, 1],
];

/**
 * Saaty 平均随机一致性指标 RI，下标即矩阵阶数 n。
 * n=1、2 时 RI 取 0（一阶二阶矩阵恒具一致性，无需检验），
 * 因此 n=5 落在 RANDOM_INDEX[5] = 1.12。
 */
const RANDOM_INDEX = [0, 0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];

/**
 * 幂法求判断矩阵的主特征值与主特征向量。
 * 迭代把向量按 L1 归一化（分量和恒为 1），因此 sum(A v) 就是 λmax。
 */
function principalEigen(matrix, maxIterations = 500, epsilon = 1e-14) {
  const n = matrix.length;
  let vector = new Array(n).fill(1 / n);
  for (let iter = 0; iter < maxIterations; iter += 1) {
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) next[i] += matrix[i][j] * vector[j];
    }
    const sum = next.reduce((acc, value) => acc + value, 0);
    if (!Number.isFinite(sum) || sum === 0) break;
    let delta = 0;
    for (let i = 0; i < n; i += 1) {
      next[i] /= sum;
      delta = Math.max(delta, Math.abs(next[i] - vector[i]));
    }
    vector = next;
    if (delta < epsilon) break;
  }
  let lambda = 0;
  for (let i = 0; i < n; i += 1) {
    let acc = 0;
    for (let j = 0; j < n; j += 1) acc += matrix[i][j] * vector[j];
    lambda += acc;
  }
  return { vector, lambda };
}

/** 计算 AHP 权重并做一致性检验，返回可写进论文的完整过程量 */
export function ahpWeights(matrix = AHP_MATRIX) {
  const n = matrix.length;
  const { vector, lambda } = principalEigen(matrix);
  const ci = n > 1 ? (lambda - n) / (n - 1) : 0;
  const ri = RANDOM_INDEX[n] !== undefined ? RANDOM_INDEX[n] : 0;
  const cr = ri > 0 ? ci / ri : 0;
  const weights = {};
  INDICATORS.forEach((item, index) => {
    weights[item.key] = vector[index] === undefined ? 0 : vector[index];
  });
  snapToUnit(weights);
  return {
    method: 'AHP',
    label: 'AHP 层次分析法',
    weights,
    matrix,
    n,
    lambdaMax: round(lambda, 6),
    ci: round(ci, 6),
    ri,
    cr: round(cr, 6),
    passed: cr < CR_THRESHOLD,
  };
}

/* ============================= B. 熵权法 ============================= */

/**
 * 熵权法。
 *
 * 逻辑：指标在样本间的区分度越大 → 信息熵越小 → 差异系数越大 → 权重越大。
 * 注意它衡量的是"区分度"而不是"重要性"，所以不能单独用来表达专家判断。
 *
 * 五步：正向化(scoreOf 已统一为越大越好) → 比重 p_ij → 熵 e_j
 *      → 差异系数 d_j = 1 - e_j → 归一化 w_j = d_j / Σd_j
 */
export function entropyWeights(records) {
  // 显式排除缺项记录：JS 里 null 参与算术会被当成 0，
  // 若不做这层过滤，缺一条指标的样本会以 0 分混进均值与熵值，把权重算歪。
  const usable = (records || []).filter(record => INDICATORS.every(item => {
    const raw = record[item.key];
    if (raw === null || raw === undefined || raw === '') return false;
    return scoreOf(item.key, raw) !== null;
  }));
  const sampleSize = usable.length;
  const detail = {};
  const divergence = {};

  if (sampleSize === 0) {
    const weights = {};
    INDICATORS.forEach(item => { weights[item.key] = 1 / INDICATORS.length; });
    INDICATORS.forEach(item => {
      detail[item.key] = { mean: null, std: null, entropy: 1, divergence: 0 };
    });
    snapToUnit(weights);
    return {
      method: 'ENTROPY',
      label: '熵权法',
      weights,
      detail,
      sampleSize: 0,
      degenerate: true,
      note: '没有可用样本，退化为等权重',
    };
  }

  const lnM = Math.log(sampleSize);
  INDICATORS.forEach(item => {
    const values = usable.map(record => scoreOf(item.key, record[item.key]));
    const sum = values.reduce((acc, value) => acc + value, 0);
    const mean = sum / sampleSize;
    const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sampleSize;
    const std = Math.sqrt(variance);

    if (!(sum > 0) || lnM <= 0) {
      detail[item.key] = {
        mean: round(mean, 2),
        std: round(std, 3),
        entropy: 1,
        divergence: 0,
      };
      divergence[item.key] = 0;
      return;
    }

    let entropy = 0;
    values.forEach(value => {
      const p = value / sum;
      if (p > 0) entropy -= p * Math.log(p);
    });
    entropy = entropy / lnM;
    const d = Math.max(0, 1 - entropy);
    detail[item.key] = {
      mean: round(mean, 2),
      std: round(std, 3),
      entropy: round(entropy, 6),
      divergence: round(d, 6),
    };
    divergence[item.key] = d;
  });

  const divergenceSum = INDICATORS.reduce((acc, item) => acc + (divergence[item.key] || 0), 0);
  const weights = {};
  INDICATORS.forEach(item => {
    weights[item.key] = divergenceSum > 0
      ? (divergence[item.key] || 0) / divergenceSum
      : 1 / INDICATORS.length;
  });
  snapToUnit(weights);

  // 熵值普遍逼近 1 时权重分布会极度不均，这里明确标出来，避免使用者误读
  const maxWeight = Math.max(...INDICATORS.map(item => weights[item.key]));
  return {
    method: 'ENTROPY',
    label: '熵权法',
    weights,
    detail,
    sampleSize,
    degenerate: divergenceSum <= 0,
    skewed: maxWeight >= 0.5,
    note: divergenceSum <= 0
      ? '各指标得分完全一致，差异系数全为 0，退化为等权重'
      : (maxWeight >= 0.5
        ? `单一指标权重达到 ${round(maxWeight, 3)}，说明样本在该指标上区分度远高于其它指标`
        : ''),
  };
}

/* ============================= C. 组合赋权 ============================= */

/** w = α·w_AHP + (1-α)·w_熵权 */
export function combineWeights(ahpWeightMap, entropyWeightMap, alpha = DEFAULT_ALPHA) {
  const a = Number.isFinite(Number(alpha)) ? Math.min(1, Math.max(0, Number(alpha))) : DEFAULT_ALPHA;
  const weights = {};
  INDICATORS.forEach(item => {
    const left = Number(ahpWeightMap[item.key]) || 0;
    const right = Number(entropyWeightMap[item.key]) || 0;
    weights[item.key] = a * left + (1 - a) * right;
  });
  snapToUnit(weights);
  return {
    method: 'COMBINED',
    label: `组合赋权 α=${a}`,
    weights,
    alpha: a,
  };
}

/* ============================== 方案汇总 ============================== */

export const WEIGHT_METHODS = [
  {
    key: 'AHP',
    label: 'AHP 层次分析法',
    short: 'AHP（主观）',
    desc: '专家两两比较构造判断矩阵，求主特征向量得权重，并用 CR 检验一致性。',
  },
  {
    key: 'ENTROPY',
    label: '熵权法',
    short: '熵权法（客观）',
    desc: '按指标在样本上的区分度定权，区分度越大权重越大，不反映专家判断。',
  },
  {
    key: 'COMBINED',
    label: '组合赋权',
    short: '组合（主客观各半）',
    desc: 'w = α·w_AHP + (1-α)·w_熵权，兼顾专家判断与数据区分度。',
  },
];

/** 一次性算出三套权重，供界面切换与对比表使用 */
export function computeWeightSchemes(records, alpha = DEFAULT_ALPHA) {
  const ahp = ahpWeights();
  const entropy = entropyWeights(records);
  const combined = combineWeights(ahp.weights, entropy.weights, alpha);
  return { ahp, entropy, combined, alpha };
}

/** 按方案 key 取权重表 */
export function weightsOfScheme(schemes, methodKey) {
  if (!schemes) return {};
  if (methodKey === 'ENTROPY') return schemes.entropy.weights;
  if (methodKey === 'COMBINED') return schemes.combined.weights;
  return schemes.ahp.weights;
}

/* ============================== 基准年口径 ============================== */

/**
 * 基准年 = 可用年份中最早的一年。
 *
 * VRI（植被恢复指数）衡量的是"相对基准期的变化"，基准年相对于它自己变化量为 0，
 * 既算不出有效值，也不该按 0 值映射成中性分（0 落在 -0.3~0.3 区间会得 50 分左右，
 * 相当于凭空给基准年塞一个中等分，反而抬高基准年、压缩后续年度的改善幅度）。
 *
 * 处理办法与后端 backend/shared/gen_eval_seed.py 的 WEIGHTS_BASELINE 完全一致：
 * 基准年 VRI 权重置 0，它原本的份额转给 FVC，权重和仍为 1.0。
 */
export function baselineYearOf(years) {
  const list = (years || []).map(Number).filter(Number.isFinite);
  return list.length ? Math.min(...list) : null;
}

/** 是否基准年：与 baselineYearOf 得到的最早年份相同 */
export function isBaselineYear(year, years) {
  const value = Number(year);
  const base = baselineYearOf(years);
  return base !== null && Number.isFinite(value) && value === base;
}

/**
 * 把基准年的 VRI 权重转给 FVC，返回新的权重表（不修改入参）。
 * 用 snapToUnit 收口，保证转完仍然严格等于 1。
 */
export function transferBaselineWeight(weights) {
  if (!weights) return weights;
  const next = {};
  INDICATORS.forEach(item => {
    next[item.key] = Number(weights[item.key]) || 0;
  });
  const share = next.VRI;
  if (!(share > 0)) return next;
  next.VRI = 0;
  next.FVC = next.FVC + share;
  snapToUnit(next);
  return next;
}

/** 基准年说明文案，界面与导出共用，避免两处措辞不一致 */
export function baselineRuleText(baseYear) {
  const year = baseYear === null || baseYear === undefined ? '最早年份' : `${baseYear} 年`;
  return `注：${year}为基准年，VRI 反映相对基准期的植被恢复变化，`
    + '该年相对自身无变化值，故 VRI 权重为 0，其份额转给 FVC，权重和仍为 1.0。';
}

/** 把 { FVC: 0.2, ... } 转成表单字段 { FVCWeight: 0.2, ... } */
export function toFormWeightFields(weights) {
  const fields = {};
  INDICATORS.forEach(item => {
    fields[item.weightKey] = weights[item.key] === undefined ? 0 : weights[item.key];
  });
  return fields;
}

/** 把表单字段 { FVCWeight: 0.2, ... } 转回 { FVC: 0.2, ... } */
export function fromFormWeightFields(form) {
  const weights = {};
  INDICATORS.forEach(item => {
    const value = Number(form ? form[item.weightKey] : NaN);
    weights[item.key] = Number.isFinite(value) ? value : NaN;
  });
  return weights;
}

/* ============================== 录入闸门 ============================== */

/**
 * 权重录入校验。Evaluate.vue 的 el-form rules 原来只有 required:true，
 * 用户填 5 个和为 1.5 的权重照样能算分入库，这里补上真正的闸门。
 */
export function validateWeightInput(weights) {
  const issues = [];
  let sum = 0;

  INDICATORS.forEach(item => {
    const raw = weights[item.key];
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      issues.push({ level: 'error', key: item.key, text: `${item.label}的权重不是有效数字` });
      return;
    }
    sum += value;
    if (value < 0) {
      issues.push({ level: 'error', key: item.key, text: `${item.label}的权重为 ${value}，权重不能为负` });
    } else if (value > 1) {
      issues.push({ level: 'error', key: item.key, text: `${item.label}的权重为 ${value}，单项权重不应超过 1` });
    }
  });

  const sumOk = Math.abs(sum - 1) <= WEIGHT_SUM_TOLERANCE;
  if (!sumOk) {
    issues.push({
      level: 'error',
      key: 'SUM',
      text: `权重之和为 ${round(sum, 3)}，应为 1.0（偏差 ${round(sum - 1, 3)}）`,
    });
  }

  return {
    ok: issues.length === 0,
    sum: round(sum, 4),
    issues,
  };
}

/* ============================== 方案对比 ============================== */

/** 指标缺失判断：null / undefined / 空串都不算有效值，不能当 0 参与计算 */
function isMissing(value) {
  return value === null || value === undefined || value === '';
}

/**
 * 用同一批记录逐个方案算综合分与等级，输出对比行。
 * 这是论文里"不同赋权方法对评价结论的影响"那张表的数据源。
 */
export function schemeComparison(records, alpha = DEFAULT_ALPHA) {
  const list = records || [];
  const schemes = computeWeightSchemes(list, alpha);
  const rows = WEIGHT_METHODS.map(meta => {
    const weightMap = weightsOfScheme(schemes, meta.key);
    const grades = { 优秀: 0, 良好: 0, 中等: 0, 较差: 0 };
    let total = 0;
    let count = 0;
    list.forEach(record => {
      let score = 0;
      let usable = true;
      INDICATORS.forEach(item => {
        if (isMissing(record[item.key])) { usable = false; return; }
        const value = scoreOf(item.key, record[item.key]);
        if (value === null) { usable = false; return; }
        score += value * (weightMap[item.key] || 0);
      });
      if (!usable) return;
      score = round(score, 2);
      total += score;
      count += 1;
      const grade = gradeOf(score);
      if (grade && grades[grade] !== undefined) grades[grade] += 1;
    });
    return {
      method: meta.key,
      label: meta.label,
      short: meta.short,
      weights: weightMap,
      meanScore: count ? round(total / count, 2) : null,
      recordCount: count,
      grades,
    };
  });

  // 以 AHP 为基准，统计另外两套权重造成多少条记录等级变化、最大分差多少
  const baseline = rows.find(row => row.method === 'AHP');
  const baselineScores = baseline ? scoreRecords(list, baseline.weights) : [];
  rows.forEach(row => {
    if (row.method === 'AHP') {
      row.gradeChanges = 0;
      row.maxScoreDelta = 0;
      return;
    }
    const scores = scoreRecords(list, row.weights);
    let changes = 0;
    let maxDelta = 0;
    scores.forEach((item, index) => {
      const base = baselineScores[index];
      if (!base || !item) return;
      if (item.grade !== base.grade) changes += 1;
      maxDelta = Math.max(maxDelta, Math.abs(item.score - base.score));
    });
    row.gradeChanges = changes;
    row.maxScoreDelta = round(maxDelta, 2);
  });

  return { schemes, rows, alpha };
}

/** 按给定权重逐条算分，内部复用 */
function scoreRecords(records, weightMap) {
  return (records || []).map(record => {
    let score = 0;
    let usable = true;
    INDICATORS.forEach(item => {
      if (isMissing(record[item.key])) { usable = false; return; }
      const value = scoreOf(item.key, record[item.key]);
      if (value === null) { usable = false; return; }
      score += value * (weightMap[item.key] || 0);
    });
    if (!usable) return null;
    const rounded = round(score, 2);
    return { score: rounded, grade: gradeOf(rounded) };
  });
}

export default {
  AHP_MATRIX,
  WEIGHT_METHODS,
  DEFAULT_ALPHA,
  CR_THRESHOLD,
  WEIGHT_SUM_TOLERANCE,
  ahpWeights,
  entropyWeights,
  combineWeights,
  computeWeightSchemes,
  weightsOfScheme,
  baselineYearOf,
  isBaselineYear,
  transferBaselineWeight,
  baselineRuleText,
  toFormWeightFields,
  fromFormWeightFields,
  validateWeightInput,
  schemeComparison,
};

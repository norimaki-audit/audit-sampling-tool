/*!
 * audit-sampling-tool v3.0 — 計算エンジン
 *
 * 設計方針:
 *   - 純関数のみ。DOM を一切参照しない。
 *   - 原理は2つだけ:
 *       (1) 属性サンプリング（統制テスト） … 正確二項（Clopper–Pearson）
 *       (2) 金額単位サンプリング（BS・PL共通） … ポアソン（MUS/PPS）
 *   - 丸めは最後に一度だけ。中間計算で Math.ceil を挟まない。
 *   - すべての戻り値に warnings[] / basis / formula を含める。
 */
(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.AuditSamplingEngine = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  /* ==========================================================================
   * 0. 汎用ユーティリティ
   * ========================================================================== */

  const EXPANSION_FACTOR = 1.6;   // 後方互換用の既定値（RIA=5%）

  /*
   * 拡大係数の標準表（受入リスク別）。
   * 監査基準報告書530 研究文書第1号 6-4 は拡張係数が「信頼度に対応する」係数であると述べ、
   * 設例で信頼度75%（リスク25%）→1.25 を示しており、この表と整合する。
   * サンプル設計では選択した RIA に対応する係数を使用する。
   */
  const EXPANSION_FACTOR_TABLE = Object.freeze([
    [0.01, 1.90], [0.05, 1.60], [0.10, 1.50], [0.15, 1.40],
    [0.20, 1.30], [0.25, 1.25], [0.30, 1.20], [0.37, 1.15], [0.50, 1.00]
  ]);

  /** RIA に対応する標準的な拡大係数（表にない値は線形補間、範囲外は端点） */
  function standardExpansionFactor(risk) {
    const t = EXPANSION_FACTOR_TABLE;
    if (risk <= t[0][0]) return t[0][1];
    if (risk >= t[t.length - 1][0]) return t[t.length - 1][1];
    for (let i = 1; i < t.length; i++) {
      if (risk <= t[i][0]) {
        const [x0, y0] = t[i - 1];
        const [x1, y1] = t[i];
        return y0 + (y1 - y0) * ((risk - x0) / (x1 - x0));
      }
    }
    return EXPANSION_FACTOR;
  }
  const RIA_MIN = 0.01;
  const RIA_MAX = 0.50;
  const PL_ABSOLUTE_CAP = 500;    // 後方互換用。サンプル数の上限には使用しない
  const MANY_ERRORS_THRESHOLD = 10; // これを超える誤謬件数は前提崩壊として警告

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  // ロケール差を避けるため自前で3桁区切りを行う（Node と ブラウザで同一出力）
  function group(n) {
    const rounded = Math.round(n);
    const sign = rounded < 0 ? '-' : '';
    return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function pct(rate, digits) {
    const d = digits === undefined ? 2 : digits;
    return (rate * 100).toFixed(d) + '%';
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /* ==========================================================================
   * 1. 数値計算基盤（外部ライブラリ非依存）
   * ========================================================================== */

  // 対数ガンマ（Lanczos 近似）。大きな n での階乗オーバーフローを避ける。
  function lgamma(z) {
    const g = 7;
    const c = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    }
    z -= 1;
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function lnChoose(n, k) {
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  }

  /** 二項CDF P(X <= x | n, p)。対数空間で加算しオーバーフローを回避。 */
  function binomCdf(n, x, p) {
    if (x >= n) return 1;
    if (x < 0) return 0;
    if (p <= 0) return 1;
    if (p >= 1) return 0;
    let sum = 0;
    for (let k = 0; k <= x; k++) {
      sum += Math.exp(lnChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));
    }
    return Math.min(1, sum);
  }

  /**
   * 上限逸脱率 ULD = BetaInv(1 − risk, x + 1, n − x)
   * 正確二項（Clopper–Pearson）片側上限。二項CDF に対する二分法で求める。
   */
  function upperDeviationLimit(n, x, risk) {
    if (!(n > 0)) return NaN;
    if (x >= n) return 1;
    let lo = x / n;
    let hi = 1;
    for (let i = 0; i < 200; i++) {
      const m = (lo + hi) / 2;
      if (binomCdf(n, x, m) > risk) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /**
   * ULD(n, x, risk) <= tolerable を満たす最小の n。
   * CDF は p について単調減少なので
   *   ULD(n,x,risk) <= tolerable  <=>  binomCdf(n, x, tolerable) <= risk
   * と同値。この同値変形により二分法を回さずに済む。
   */
  function minimumAttributeSampleSize(tolerableRate, expectedDeviations, risk) {
    const x = expectedDeviations;
    if (!(tolerableRate > 0) || !(tolerableRate < 1)) return NaN;
    for (let n = x + 1; n <= 20000; n++) {
      if (binomCdf(n, x, tolerableRate) <= risk) return n;
    }
    return NaN;
  }

  function poissonCdf(k, lambda) {
    if (lambda <= 0) return 1;
    let sum = 0;
    let term = Math.exp(-lambda);
    for (let i = 0; i <= k; i++) {
      if (i > 0) term *= lambda / i;
      sum += term;
    }
    return Math.min(1, sum);
  }

  /**
   * ポアソン信頼係数 CF(k, risk):  P(X <= k | lambda) = risk を満たす lambda。
   * k=0 では -ln(risk) に一致する。90%固定表を廃し、任意の RIA に対応する。
   */
  function poissonConfidenceFactor(k, risk) {
    if (k === 0) return -Math.log(risk);
    let lo = 0;
    let hi = 200;
    for (let i = 0; i < 200; i++) {
      const m = (lo + hi) / 2;
      if (poissonCdf(k, m) > risk) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  /* ==========================================================================
   * 2. 属性サンプリング（統制テスト）— §3.1
   * ========================================================================== */

  /*
   * ROO=10%（信頼度90%）の表は既存値を維持する（§3.1）。
   * この表は統計的最小値ではなく実務慣行値であり、逸脱2件の一部で
   * 正確二項の最小値（5%→105, 7%→75）より保守的な値を採っている。
   * いずれも ULD <= 許容逸脱率 を満たすため統計的に妥当。
   */
  const CONVENTIONAL_TABLE_ROO10 = Object.freeze({
    '0.05': Object.freeze({ 0: 45, 1: 77, 2: 116 }),
    '0.07': Object.freeze({ 0: 32, 1: 55, 2: 77 }),
    '0.09': Object.freeze({ 0: 25, 1: 42, 2: 58 })
  });

  const SUPPORTED_ROO = [0.05, 0.10];
  const STANDARD_TOLERABLE_RATES = [0.05, 0.07, 0.09];

  function normalizeROO(value) {
    const roo = toFiniteNumber(value, 0.10);
    // 最も近いサポート値に丸める（0.05 / 0.10）
    let best = SUPPORTED_ROO[0];
    let bestDiff = Infinity;
    for (const candidate of SUPPORTED_ROO) {
      const diff = Math.abs(candidate - roo);
      if (diff < bestDiff) { bestDiff = diff; best = candidate; }
    }
    return best;
  }

  /**
   * 表からサンプル数を引く。
   *   ROO=10% かつ標準許容逸脱率 → 慣行表（既存値を維持）
   *   それ以外（ROO=5% を含む） → 正確二項から導出
   */
  function attributeSampleSizeFromTable(tolerableRate, expectedDeviations, roo) {
    if (roo === 0.10) {
      const row = CONVENTIONAL_TABLE_ROO10[tolerableRate.toFixed(2)];
      if (row && row[expectedDeviations] !== undefined) {
        return { sampleSize: row[expectedDeviations], derived: false };
      }
    }
    return {
      sampleSize: minimumAttributeSampleSize(tolerableRate, expectedDeviations, roo),
      derived: true
    };
  }

  const FREQUENCY_LABELS = Object.freeze({
    daily: '日次・随時',
    weekly: '週次',
    monthly: '月次',
    quarterly: '四半期',
    annually: '年次'
  });

  /**
   * calculateAttributeSampling
   * @param {{frequency, populationSize, expectedDeviations, tolerableRate, ROO}} input
   */
  function calculateAttributeSampling(input) {
    const s = input || {};
    const frequency = s.frequency || 'daily';
    const populationSize = Math.max(0, Math.floor(toFiniteNumber(s.populationSize, 0)));
    const expectedDeviations = Math.max(0, Math.floor(toFiniteNumber(s.expectedDeviations, 0)));
    const tolerableRate = toFiniteNumber(s.tolerableRate, 0.09);
    const roo = normalizeROO(s.ROO);
    const samplingApproach = s.samplingApproach === 'nonstatistical' ? 'nonstatistical' : 'statistical';
    const warnings = [];
    const tenPercentRule = Math.max(2, Math.ceil(populationSize * 0.1));

    if (!(populationSize > 0) || !(tolerableRate > 0) || !(tolerableRate < 1)) {
      return {
        valid: false,
        frequency,
        frequencyLabel: FREQUENCY_LABELS[frequency] || frequency,
        populationSize,
        expectedDeviations,
        tolerableRate,
        ROO: roo,
        sampleSize: 0,
        statistical: samplingApproach === 'statistical',
        samplingApproach,
        warnings: ['母集団件数と許容逸脱率を正しく入力してください。'],
        basis: '入力が不足しているため算定できません。',
        formula: { expression: 'n = サンプリング設計による', substituted: '—', result: NaN }
      };
    }

    let sampleSize = 0;
    let basis = '';
    let derived = false;
    let additionalSamples = null;
    let formula;
    let exactMinimumSampleSize = null;
    const statistical = samplingApproach === 'statistical';

    if (statistical) {
      const picked = attributeSampleSizeFromTable(tolerableRate, expectedDeviations, roo);
      sampleSize = picked.sampleSize;
      derived = picked.derived;

      if (!Number.isFinite(sampleSize)) {
        warnings.push('許容逸脱率が範囲外のためサンプル数を算定できません。');
        sampleSize = 0;
      }

      basis = derived
        ? `正確二項（Clopper–Pearson）による統計的サンプリングです。過信リスク ROO=${pct(roo, 0)}、許容逸脱率 ${pct(tolerableRate, 0)}、計画上の予想逸脱 ${expectedDeviations} 件のもとで、上限逸脱率が許容逸脱率以下になる最小件数を求めます。`
        : '標準サンプル数表（過信リスク10%／信頼度90%）による統計的サンプリングです。一部のセルは正確二項の最小値より保守的です。';

      const nextLevel = attributeSampleSizeFromTable(tolerableRate, expectedDeviations + 1, roo);
      if (Number.isFinite(nextLevel.sampleSize) && nextLevel.sampleSize > sampleSize) {
        additionalSamples = nextLevel.sampleSize - sampleSize;
      }

      if (derived) {
        formula = {
          expression: 'n = min{ n : P(X ≤ x | n, TDR) ≤ ROO }',
          substituted: `n = min{ n : P(X ≤ ${expectedDeviations} | n, ${pct(tolerableRate, 0)}) ≤ ${pct(roo, 0)} } = ${group(sampleSize)}件`,
          result: sampleSize
        };
      } else {
        const exactMinimum = minimumAttributeSampleSize(tolerableRate, expectedDeviations, roo);
        const margin = Number.isFinite(exactMinimum) && exactMinimum < sampleSize
          ? `（正確二項の最小値 ${group(exactMinimum)}件を上回る保守側の慣行値）`
          : '（正確二項の最小値と一致）';
        formula = {
          expression: 'n = 標準サンプル数表[許容逸脱率, 計画上の予想逸脱件数]（ROO=10%）',
          substituted: `n = 標準表[許容逸脱率 ${pct(tolerableRate, 0)}, 予想逸脱 ${expectedDeviations}件] = ${group(sampleSize)}件${margin}`,
          result: sampleSize
        };
        if (Number.isFinite(exactMinimum) && exactMinimum < sampleSize) exactMinimumSampleSize = exactMinimum;
      }
    } else {
      const frequencyRules = {
        daily: { size: Math.min(25, populationSize), label: '日次・随時25件' },
        weekly: { size: Math.min(5, populationSize), label: '週次5件' },
        monthly: { size: Math.max(2, Math.min(3, populationSize)), label: '月次2〜3件' },
        quarterly: { size: Math.min(1, populationSize), label: '四半期1件' },
        annually: { size: Math.min(1, populationSize), label: '年次1件' }
      };
      const rule = frequencyRules[frequency];
      sampleSize = rule ? rule.size : Math.min(25, tenPercentRule);
      basis = `本ツールの参考頻度別ルール${rule ? `（${rule.label}）` : ''}による非統計的サンプリングです。監査基準が定める固定件数ではありません。所属法人等のメソドロジーを確認し、職業的専門家としてサンプル数を決定してください。`;
      warnings.push('非統計的サンプリングを選択しています。表示件数は参考値です。所属法人等のルールと置き換え、上限逸脱率だけから統計的な結論を導かないでください。');
      formula = {
        expression: 'n = 参考頻度別ルール（所属法人等のメソドロジーを要確認）',
        substituted: `n = ${FREQUENCY_LABELS[frequency] || frequency}・母集団${group(populationSize)}件 → ${group(sampleSize)}件（非統計的）`,
        result: sampleSize
      };
    }

    let fullPopulation = false;
    if (sampleSize > 0 && populationSize < sampleSize) {
      sampleSize = populationSize;
      fullPopulation = true;
      basis = '母集団が必要サンプル数より少ないため、全件を確認します。';
      warnings.push('母集団が算定件数より少ないため、全件を対象とします。');
      formula = {
        expression: 'n = 母集団件数（全件）',
        substituted: `n = ${group(populationSize)}件（全件確認）`,
        result: sampleSize
      };
    }

    if (sampleSize > 0 && expectedDeviations / sampleSize >= tolerableRate) {
      warnings.push('計画上の予想逸脱率が許容逸脱率以上です。統制に依拠する監査アプローチを再検討してください。');
    }

    return {
      valid: sampleSize > 0,
      frequency,
      frequencyLabel: FREQUENCY_LABELS[frequency] || frequency,
      populationSize,
      expectedDeviations,
      tolerableRate,
      ROO: roo,
      confidenceLevel: 1 - roo,
      tenPercentRule,
      sampleSize,
      allowableDeviations: expectedDeviations,
      additionalSamples,
      fullPopulation,
      statistical,
      samplingApproach,
      derivedFromExactBinomial: derived,
      exactMinimumSampleSize,
      warnings,
      basis,
      formula
    };
  }

  /**
   * evaluateAttributeResults
   * ULD と判定結果が常に一貫する単一経路。「逸脱0件なら無条件で有効」の先行分岐は持たない。
   */
  function evaluateAttributeResults(input) {
    const s = input || {};
    const sampleSize = Math.max(0, Math.floor(toFiniteNumber(s.sampleSize, 0)));
    const deviations = Math.max(0, Math.floor(toFiniteNumber(s.deviations, 0)));
    const tolerableRate = toFiniteNumber(s.tolerableRate, 0.09);
    const roo = normalizeROO(s.ROO);
    const statistical = s.statistical !== false;
    const warnings = [];

    if (sampleSize <= 0) {
      return {
        valid: false,
        sampleSize, deviations, tolerableRate, ROO: roo, statistical,
        deviationRate: NaN, upperDeviationLimit: NaN,
        effective: null, evaluation: '算定不能', requiredAction: 'サンプル数を入力してください',
        warnings: ['サンプル数を入力してください。'],
        basis: 'サンプル数が未入力のため評価できません。',
        formula: { expression: 'ULD = BetaInv(1 − ROO, x + 1, n − x)', substituted: '—', result: NaN }
      };
    }

    if (deviations > sampleSize) warnings.push('逸脱件数がサンプル数を超えています。入力を確認してください。');
    const cappedDeviations = Math.min(deviations, sampleSize);
    const deviationRate = cappedDeviations / sampleSize;
    const uld = upperDeviationLimit(sampleSize, cappedDeviations, roo);

    let effective = null;
    let evaluation = '職業的専門家としての判断が必要';
    let requiredAction = '逸脱の性質・原因・影響を評価し、所属法人等のメソドロジーに従って結論付けてください。';

    if (statistical) {
      effective = uld <= tolerableRate;
      if (effective) {
        evaluation = '統計的上限は許容範囲内';
        requiredAction = '逸脱の性質・原因・影響と、サンプルが母集団を代表しているかを含めて最終評価してください。';
      } else {
        evaluation = '計画した統制依拠を支持しない';
        requiredAction = '逸脱の性質・原因・影響を調査し、統制への依拠の見直し、追加手続又は実証手続の拡大を検討してください。';
        warnings.push('上限逸脱率が許容逸脱率を超えています。追加サンプルだけで機械的に結論を反転させず、原因と監査アプローチを再評価してください。');
      }
    } else {
      warnings.push('非統計的サンプリングのため、上限逸脱率は参考値です。この数値だけから統計的な結論は導けません。');
    }

    const comparison = statistical ? (effective ? '≤' : '>') : '（参考）';
    return {
      valid: true,
      sampleSize,
      deviations: cappedDeviations,
      tolerableRate,
      ROO: roo,
      confidenceLevel: 1 - roo,
      statistical,
      deviationRate,
      upperDeviationLimit: uld,
      effective,
      evaluation,
      requiredAction,
      additionalSamplesToPass: null,
      warnings,
      basis: statistical
        ? `正確二項（Clopper–Pearson）による片側上限です。過信リスク ROO=${pct(roo, 0)}。上限逸脱率 ${pct(uld)} と許容逸脱率 ${pct(tolerableRate, 0)} を比較した統計的結果であり、統制不備の最終判断そのものではありません。`
        : `正確二項による参考値です。設計が非統計的なため、ROO=${pct(roo, 0)} に基づく統計的結論としては使用できません。`,
      formula: {
        expression: 'ULD = BetaInv(1 − ROO, x + 1, n − x)',
        substituted: `ULD = BetaInv(${(1 - roo).toFixed(2)}, ${cappedDeviations + 1}, ${sampleSize - cappedDeviations}) = ${pct(uld)} ${comparison} ${pct(tolerableRate, 0)} → ${evaluation}`,
        result: uld
      }
    };
  }

  /* ==========================================================================
   * 3. リスクモデル — §3.4
   * ========================================================================== */

  function calculateRiskModel(input) {
    const s = input || {};
    const AR = toFiniteNumber(s.AR, 0.05);
    const IR = toFiniteNumber(s.IR, 1);
    const CR = toFiniteNumber(s.CR, 1);
    const RIA = toFiniteNumber(s.RIA, 0.10);
    const roo = normalizeROO(s.ROO);
    const warnings = [];

    if (!(AR > 0) || !(IR > 0) || !(CR > 0) || !(RIA > 0) || !(RIA < 1)) {
      return {
        valid: false, AR, IR, CR, DR: NaN, RIA, ROO: roo,
        clamped: false, clampedFrom: null,
        warnings: ['監査リスク、固有リスク、統制リスク及び受入リスクを正しく入力してください。'],
        basis: 'リスク値が不正のため算定できません。',
        formula: { expression: 'DR = AR ÷ (IR × CR)', substituted: '—', result: NaN }
      };
    }

    const DR = AR / (IR * CR);

    if (CR < 1) {
      warnings.push(`統制リスク CR=${CR} と評価しています。CRを1.00未満とする場合は、関連する統制テストを計画・実施し、その有効性を裏付けてください。`);
    }
    warnings.push('発見リスク（DR）は分析的実証手続などを含む実証手続全体のリスクです。本ツールはDRをMUSの受入リスク（RIA）へ自動変換しません。RIAは監査計画及び所属法人等のメソドロジーに従って別途設定してください。');

    return {
      valid: true,
      AR, IR, CR, DR, RIA,
      ROO: roo,
      confidenceLevel: 1 - RIA,
      clamped: false,
      clampedFrom: null,
      warnings,
      basis: `監査リスクモデル DR = AR ÷ (IR × CR) です。DRは実証手続全体に係る発見リスク、RIAは金額単位サンプリングに係る受入リスク、ROOは統制テストの過信リスクであり、それぞれ目的が異なるため独立して設定します。`,
      formula: {
        expression: 'DR = AR ÷ (IR × CR) ／ RIA・ROOは別途設定',
        substituted: `DR = ${pct(AR, 0)} ÷ (${IR} × ${CR}) = ${pct(DR, 1)} ／ RIA = ${pct(RIA, 0)} ／ ROO = ${pct(roo, 0)}`,
        result: DR
      }
    };
  }

  /* ==========================================================================
   * 4. 金額単位サンプリング（BS・PL共通）— §3.2
   * ========================================================================== */

  function calculateMonetarySampling(input) {
    const s = input || {};
    const BV = Math.max(0, toFiniteNumber(s.BV, 0));
    const TM = Math.max(0, toFiniteNumber(s.TM, 0));
    const EM = Math.max(0, toFiniteNumber(s.EM, 0));
    const RIA = toFiniteNumber(s.RIA, 0.10);
    const accountType = s.accountType === 'pl' ? 'pl' : 'bs';
    const assertion = s.assertion || 'occurrence';
    const method = s.method || 'systematic';
    const transactionCount = Math.max(0, Math.floor(toFiniteNumber(s.transactionCount, 0)));
    const highValueTotal = s.highValueTotal === undefined || s.highValueTotal === null
      ? null : Math.max(0, toFiniteNumber(s.highValueTotal, 0));
    const warnings = [];

    if (!(BV > 0) || !(TM > 0) || !(RIA > 0) || !(RIA < 1)) {
      return {
        valid: false, sampleSize: 0, accountType,
        warnings: ['母集団簿価、許容誤謬及び受入リスクを正しく入力してください。'],
        basis: '入力が不足しているため算定できません。',
        formula: { expression: 'n = BV × CF ÷ (TM − EM × EF)', substituted: '—', result: NaN }
      };
    }

    const CF = -Math.log(RIA);
    const EF = standardExpansionFactor(RIA);
    const denominator = TM - EM * EF;

    if (denominator <= 0) {
      return {
        valid: false, sampleSize: 0, accountType, CF, EF,
        warnings: [`期待誤謬 × 拡大係数（${group(EM * EF)}円）が許容誤謬（${group(TM)}円）以上です。全件検証、母集団の見直し又は他の監査手続を検討してください。`],
        basis: '許容誤謬から期待誤謬の取り置きを控除した残額が0以下のため、サンプリング設計が成立しません。',
        formula: {
          expression: 'n = BV × CF ÷ (TM − EM × EF)',
          substituted: `TM − EM × EF = ${group(TM)} − ${group(EM)}×${EF.toFixed(2)} = ${group(denominator)} ≤ 0 → 算定不能`,
          result: NaN
        }
      };
    }

    const SI = denominator / CF;
    const rawSampleSize = (BV * CF) / denominator;
    let n = Math.ceil(rawSampleSize);

    if (EM === 0) {
      warnings.push('期待誤謬を0としています。誤謬の発生が見込まれる場合は、過年度実績や予備的なテスト等を踏まえて期待誤謬を設定してください。');
    }
    if (accountType === 'pl') {
      warnings.push('BS・PLの区分だけではMUSの計算式を変更しません。母集団の特性、アサーション及び監査目的に応じて適用可能性を判断してください。');
    }
    if (method === 'stratified') {
      warnings.push('層化を選択しています。各層の母集団、許容誤謬及び抽出方法を別途設計してください。本ツールは層化を理由にサンプル数を自動減額しません。');
    }
    if (assertion === 'completeness') {
      warnings.push('MUSは計上済み簿価から金額比例で抽出するため、未計上項目や簿価0の項目の完全性検証には適しません。母集団外から帳簿へ追跡する手続等を別途設計してください。');
    }

    let fullPopulation = false;
    if (transactionCount > 0 && n > transactionCount) {
      warnings.push(`算定された選択ポイント数 ${group(n)} が母集団件数 ${group(transactionCount)} を超えています。全件検証として設計してください。`);
      n = transactionCount;
      fullPopulation = true;
    }

    let coverage = null;
    let coverageBasis;
    if (highValueTotal !== null) {
      if (highValueTotal > BV) warnings.push('確実抽出項目の合計額が母集団簿価を超えています。入力を確認してください。');
      coverage = Math.min(1, highValueTotal / BV);
      coverageBasis = '確実抽出項目比率 = SI以上の項目合計額 ÷ 母集団簿価';
    } else {
      coverageBasis = 'SI以上の項目合計額が未入力のため、確実抽出項目比率は算定していません。';
      warnings.push('SI以上となる確実抽出項目の合計額を入力すると、その比率を確認できます。');
    }

    const denomText = `(${group(TM)} − ${group(EM)}×${EF.toFixed(2)})`;
    const substituted = `n = ${group(BV)} × ${CF.toFixed(2)} ÷ ${denomText} = ${rawSampleSize.toFixed(2)} → ${group(n)}ポイント`;
    const basis = `金額単位サンプリング（MUS/PPS、ポアソン近似）です。信頼係数 CF = −ln(RIA) = ${CF.toFixed(2)}、RIAに対応する拡大係数 EF = ${EF.toFixed(2)}。サンプリング間隔は (TM − EM×EF) ÷ CF で求めます。算定件数は選択ポイント数であり、同一項目が複数回ヒットする場合はユニークな証憑・項目数と一致しないことがあります。`;

    return {
      valid: true,
      accountType,
      BV, TM, EM, RIA, CF, EF,
      denominator,
      rawSampleSize,
      sampleSize: n,
      samplingInterval: SI,
      assertionFactor: 1,
      methodFactor: 1,
      riskBand: null,
      floorApplied: false,
      capApplied: null,
      coverage,
      coverageBasis,
      transactionCount,
      fullPopulation,
      warnings,
      basis,
      formula: {
        expression: 'n = BV × CF ÷ (TM − EM × EF)　／　SI = (TM − EM × EF) ÷ CF',
        substituted,
        result: n
      }
    };
  }

  /* ==========================================================================
   * 5. PPS 誤謬評価 — §3.3
   * ========================================================================== */

  function projectOneDirection(items, SI, RIA) {
    // items: [{ bookValue, errorAmount }]（errorAmount > 0）
    const projected = items.map(function(item) {
      const bookValue = Math.max(0, toFiniteNumber(item.bookValue, 0));
      const errorAmount = Math.max(0, toFiniteNumber(item.errorAmount, 0));
      // 汚染率は「誤謬額 ÷ 個別項目の簿価」（誤謬額 ÷ SI ではない）
      const taint = bookValue > 0 ? Math.min(1, errorAmount / bookValue) : 1;
      // 項目簿価が SI 以上なら実額、そうでなければ taint × SI
      const projectedError = bookValue >= SI ? errorAmount : taint * SI;
      return { bookValue, errorAmount, taint, projectedError };
    });

    /*
     * 簿価が SI 以上の項目は必ず抽出されるため、そこに含まれる誤謬には
     * サンプリングリスクが存在しない。したがって増分許容誤謬の対象外とする。
     *   監査基準報告書530 研究文書第1号「監査と統計サンプリング」6-7:
     *   「サンプル抽出間隔以上のサンプルから発生したエラーは、そのすべてが
     *     サンプル項目として抽出されていますので、上限精度の増加高はありません」
     * 推定誤謬額の合計には実額で算入する。
     * これらをランク付けに含めると、信頼係数の増加高が本来より小さい項目へ
     * ずれて割り当てられ、推定誤謬上限が過小になりうる。
     */
    const highValue = projected.filter(function(p) { return p.bookValue >= SI; });
    const sampled = projected.filter(function(p) { return p.bookValue < SI; });

    // 増分許容誤謬の対象は抽出間隔未満の項目のみ。taint 降順、同率は推定誤謬額の大きい順。
    sampled.sort(function(a, b) {
      if (b.taint !== a.taint) return b.taint - a.taint;
      return b.projectedError - a.projectedError;
    });
    highValue.sort(function(a, b) { return b.projectedError - a.projectedError; });

    const basicPrecision = poissonConfidenceFactor(0, RIA) * SI;
    let projectedTotal = 0;
    let incrementalAllowance = 0;
    const detail = [];

    for (let j = 0; j < sampled.length; j++) {
      const i = j + 1; // 1-based
      const cfCurrent = poissonConfidenceFactor(i, RIA);
      const cfPrevious = poissonConfidenceFactor(i - 1, RIA);
      const increment = (cfCurrent - cfPrevious - 1) * sampled[j].projectedError;
      projectedTotal += sampled[j].projectedError;
      incrementalAllowance += increment;
      detail.push({
        rank: i,
        highValue: false,
        bookValue: sampled[j].bookValue,
        errorAmount: sampled[j].errorAmount,
        taint: sampled[j].taint,
        projectedError: sampled[j].projectedError,
        confidenceFactor: cfCurrent,
        incrementalAllowance: increment
      });
    }

    // 高額項目は実額を推定誤謬に加えるのみ（増分許容誤謬は発生しない）
    for (const item of highValue) {
      projectedTotal += item.projectedError;
      detail.push({
        rank: null,
        highValue: true,
        bookValue: item.bookValue,
        errorAmount: item.errorAmount,
        taint: item.taint,
        projectedError: item.projectedError,
        confidenceFactor: null,
        incrementalAllowance: 0
      });
    }

    return {
      count: projected.length,
      sampledCount: sampled.length,
      highValueCount: highValue.length,
      basicPrecision,
      projectedMisstatement: projectedTotal,
      incrementalAllowance,
      upperMisstatementLimit: basicPrecision + projectedTotal + incrementalAllowance,
      detail
    };
  }

  /**
   * evaluateMonetaryResults
   * @param {{SI, RIA, misstatements: [{bookValue, auditValue}], tolerableMisstatement}} input
   */
  function evaluateMonetaryResults(input) {
    const s = input || {};
    const SI = toFiniteNumber(s.SI, 0);
    const RIA = toFiniteNumber(s.RIA, 0.10);
    const tolerableMisstatement = s.tolerableMisstatement === undefined || s.tolerableMisstatement === null
      ? null : Math.max(0, toFiniteNumber(s.tolerableMisstatement, 0));
    const rows = Array.isArray(s.misstatements) ? s.misstatements : [];
    const warnings = [];

    if (!(SI > 0) || !(RIA > 0) || !(RIA < 1)) {
      return {
        valid: false,
        warnings: ['サンプリング間隔と受入リスクを正しく入力してください。'],
        basis: '入力が不足しているため評価できません。',
        formula: { expression: 'UML = 基本精度 + Σ推定誤謬 + 増分許容誤謬', substituted: '—', result: NaN }
      };
    }

    const overstatements = [];
    const understatements = [];

    for (const row of rows) {
      const bookValue = toFiniteNumber(row && row.bookValue, 0);
      const auditValue = toFiniteNumber(row && row.auditValue, 0);
      const difference = bookValue - auditValue;
      if (difference > 0) {
        if (bookValue > 0) overstatements.push({ bookValue, errorAmount: difference });
        else warnings.push('簿価が0以下の過大計上行はMUS投影から除外しました。個別に評価してください。');
      } else if (difference < 0) {
        understatements.push({ bookValue, errorAmount: -difference });
      }
    }

    const over = projectOneDirection(overstatements, SI, RIA);
    const knownUnderstatement = understatements.reduce(function(sum, item) { return sum + item.errorAmount; }, 0);
    const under = {
      count: understatements.length,
      sampledCount: understatements.length,
      highValueCount: 0,
      basicPrecision: 0,
      projectedMisstatement: knownUnderstatement,
      incrementalAllowance: 0,
      upperMisstatementLimit: null,
      knownMisstatement: knownUnderstatement,
      projected: false,
      detail: understatements.map(function(item) {
        return { bookValue: item.bookValue, errorAmount: item.errorAmount, projected: false };
      })
    };

    if (under.count > 0) {
      warnings.push(`過小計上が ${group(under.count)} 件（既知額 ${group(knownUnderstatement)}円）あります。MUSは計上済み簿価から金額比例で抽出するため、過小計上・未計上を統計的に投影しません。完全性に対応する別の手続を実施し、発見した誤謬は監基報450等に従って評価してください。`);
    }

    const totalErrorCount = over.count + under.count;
    if (totalErrorCount > MANY_ERRORS_THRESHOLD) {
      warnings.push(`誤謬件数が ${group(totalErrorCount)} 件に達しています。母集団の誤謬特性とサンプリング設計を再評価してください。`);
    }

    const governingUML = over.upperMisstatementLimit;
    let evaluation = null;
    let acceptable = null;
    if (tolerableMisstatement !== null && tolerableMisstatement > 0) {
      acceptable = governingUML <= tolerableMisstatement;
      evaluation = acceptable
        ? '統計的上限は許容誤謬以下'
        : '統計的上限が許容誤謬を超過';
      if (!acceptable) {
        warnings.push(`過大計上の推定誤謬上限（${group(governingUML)}円）が許容誤謬（${group(tolerableMisstatement)}円）を超過しています。母集団、誤謬の性質・原因、追加手続及び監査計画への影響を評価してください。`);
      }
    }

    const cf0 = poissonConfidenceFactor(0, RIA);
    return {
      valid: true,
      SI, RIA,
      confidenceFactorZero: cf0,
      overstatement: over,
      understatement: under,
      governingUML,
      tolerableMisstatement,
      acceptable,
      evaluation,
      warnings,
      basis: `PPS（MUS）による過大計上の誤謬評価です。基本精度 = CF(0, RIA) × SI = ${cf0.toFixed(2)} × ${group(SI)}円。汚染率は「誤謬額 ÷ 個別項目の簿価」で求め、簿価がSI以上の項目は誤謬実額を用います。増分許容誤謬は汚染率の高い順に積み上げます。過小計上は既知額のみを別表示し、MUSによる投影対象にはしていません。`,
      formula: {
        expression: 'UML（過大計上）= 基本精度 + Σ推定誤謬 + Σ(CF(i) − CF(i−1) − 1) × 推定誤謬_i',
        substituted: `UML（過大）= ${group(over.basicPrecision)} + ${group(over.projectedMisstatement)} + ${group(over.incrementalAllowance)} = ${group(over.upperMisstatementLimit)}円`
          + (under.count > 0 ? `／既知の過小計上額 = ${group(knownUnderstatement)}円（別途評価）` : ''),
        result: over.upperMisstatementLimit
      }
    };
  }

  /* ==========================================================================
   * 6. 早見表の動的生成 — §4 Phase 4
   * ========================================================================== */

  const QUICK_REFERENCE_RATIOS = [5, 10, 20, 30, 50, 75, 100];

  /**
   * generateQuickReference
   * @param {{type, AR, IR, CR, RIA, ROO, confidenceLevel}} input
   *   type: 'attribute' | 'monetary'
   * 早見表は個別計算と同一の関数を呼んで生成するため、表と実装が構造的にずれない。
   */
  function generateQuickReference(input) {
    const s = input || {};
    const type = s.type === 'monetary' ? 'monetary' : 'attribute';

    if (type === 'attribute') {
      // confidenceLevel が与えられたら ROO = 1 − confidenceLevel
      let roo = s.ROO;
      if (roo === undefined && s.confidenceLevel !== undefined) {
        roo = 1 - toFiniteNumber(s.confidenceLevel, 0.90);
      }
      roo = normalizeROO(roo);

      const rows = STANDARD_TOLERABLE_RATES.map(function(tolerableRate) {
        const cells = [0, 1, 2].map(function(expectedDeviations) {
          const result = calculateAttributeSampling({
            frequency: 'daily',
            populationSize: 100000,
            expectedDeviations,
            tolerableRate,
            ROO: roo
          });
          const evaluation = evaluateAttributeResults({
            sampleSize: result.sampleSize,
            deviations: expectedDeviations,
            tolerableRate,
            ROO: roo
          });
          return {
            expectedDeviations,
            sampleSize: result.sampleSize,
            upperDeviationLimit: evaluation.upperDeviationLimit
          };
        });
        return { tolerableRate, label: pct(tolerableRate, 0), cells };
      });

      return {
        type,
        ROO: roo,
        confidenceLevel: 1 - roo,
        columns: ['許容逸脱率', '予想逸脱0件', '予想逸脱1件', '予想逸脱2件'],
        rows,
        warnings: [],
        basis: `統制テストの早見表です。過信リスク ROO=${pct(roo, 0)}（信頼度${pct(1 - roo, 0)}）。各セルは計算画面と同じ関数で求めています。下段は正確二項による上限逸脱率です。`,
        formula: {
          expression: 'n = min{ n : P(X ≤ x | n, TDR) ≤ ROO }',
          substituted: `ROO = ${pct(roo, 0)} における標準サンプル数表`,
          result: null
        }
      };
    }

    // monetary: 行の索引は「母集団簿価 ÷ 許容誤謬（BV/TM）」に統一する
    let RIA = s.RIA;
    if (RIA === undefined) {
      if (s.AR !== undefined && s.IR !== undefined && s.CR !== undefined) {
        RIA = calculateRiskModel({ AR: s.AR, IR: s.IR, CR: s.CR }).RIA;
      } else if (s.confidenceLevel !== undefined) {
        RIA = 1 - toFiniteNumber(s.confidenceLevel, 0.90);
      } else {
        RIA = 0.10;
      }
    }
    RIA = clamp(toFiniteNumber(RIA, 0.10), RIA_MIN, RIA_MAX);

    const TM = 10000000; // 索引は比率なので基準額は結果に影響しない
    const rows = QUICK_REFERENCE_RATIOS.map(function(ratio) {
      const result = calculateMonetarySampling({
        BV: ratio * TM,
        TM,
        EM: 0,
        RIA,
        accountType: 'bs'
      });
      return {
        ratio,
        label: `${ratio}倍`,
        sampleSize: result.sampleSize,
        samplingIntervalRatio: result.samplingInterval / TM
      };
    });

    return {
      type,
      RIA,
      CF: -Math.log(RIA),
      columns: ['母集団簿価 ÷ 許容誤謬', '必要サンプル数'],
      rows,
      warnings: [],
      basis: `金額単位サンプリングの早見表です。受入リスク RIA=${pct(RIA, 0)}、信頼係数 CF=${(-Math.log(RIA)).toFixed(2)}、期待誤謬は0としています。行の見出しは「母集団簿価 ÷ 許容誤謬」で、BS・PL とも共通です。各セルは計算画面と同じ関数で求めています。`,
      formula: {
        expression: 'n = (BV ÷ TM) × CF',
        substituted: `n = (BV ÷ TM) × ${(-Math.log(RIA)).toFixed(2)}`,
        result: null
      }
    };
  }

  /* ==========================================================================
   * 7. 公開 API
   * ========================================================================== */

  return Object.freeze({
    // 仕様 §4 Phase 1 の公開関数
    calculateRiskModel,
    calculateAttributeSampling,
    evaluateAttributeResults,
    calculateMonetarySampling,
    evaluateMonetaryResults,
    generateQuickReference,

    // 数値計算基盤（テストおよび検算用）
    math: Object.freeze({
      lgamma,
      lnChoose,
      binomCdf,
      upperDeviationLimit,
      minimumAttributeSampleSize,
      poissonCdf,
      poissonConfidenceFactor,
      standardExpansionFactor,
      clamp
    }),

    // 定数
    constants: Object.freeze({
      EXPANSION_FACTOR,
      EXPANSION_FACTOR_TABLE,
      RIA_MIN,
      RIA_MAX,
      PL_ABSOLUTE_CAP,
      MANY_ERRORS_THRESHOLD,
      SUPPORTED_ROO,
      STANDARD_TOLERABLE_RATES,
      CONVENTIONAL_TABLE_ROO10,
      FREQUENCY_LABELS,
      QUICK_REFERENCE_RATIOS
    }),

    // 表示ヘルパ（UI 側で数値整形を再実装しないため）
    format: Object.freeze({ group, pct, round2 })
  });
});

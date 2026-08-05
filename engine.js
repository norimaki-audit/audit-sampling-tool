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

  const EXPANSION_FACTOR = 1.6;   // 拡大係数 EF（§3.2 により固定。標準表では受入リスク5%に対応）

  /*
   * 拡大係数の標準表（受入リスク別）。
   * 監査基準報告書530 研究文書第1号 6-4 は拡張係数が「信頼度に対応する」係数であると述べ、
   * 設例で信頼度75%（リスク25%）→1.25 を示しており、この表と整合する。
   * 本ツールは仕様により EF を 1.6 に固定するため、この表は警告の判定にのみ用いる。
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
  const RIA_MAX = 0.20;
  const PL_ABSOLUTE_CAP = 500;    // PL の絶対上限件数
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

    const warnings = [];
    const tenPercentRule = Math.max(2, Math.ceil(populationSize * 0.1));

    let sampleSize;
    let basis;
    let statistical;
    let derived = false;
    let additionalSamples = null;
    let formula;
    let exactMinimumSampleSize = null;

    const isTableRoute = frequency === 'daily' || populationSize >= 250;

    if (isTableRoute) {
      const picked = attributeSampleSizeFromTable(tolerableRate, expectedDeviations, roo);
      sampleSize = picked.sampleSize;
      derived = picked.derived;
      statistical = true;

      if (!Number.isFinite(sampleSize)) {
        warnings.push('許容逸脱率が範囲外のためサンプル数を算定できません。');
        sampleSize = 0;
      }

      basis = derived
        ? `正確二項（Clopper–Pearson）から求めた統計的サンプリングです。過信リスク ROO=${pct(roo, 0)}、許容逸脱率 ${pct(tolerableRate, 0)}、予想逸脱 ${expectedDeviations} 件のもとで、上限逸脱率が許容逸脱率以下になる最小のサンプル数です。`
        : `標準サンプル数表（過信リスク ROO=10%／信頼度90%が前提）による統計的サンプリングです。実務で定着している値のため、一部のセルは正確二項の最小値よりも保守的（サンプル数が多い側）になっています。`;

      // 追加サンプル数: 逸脱1件を許容できる水準まで引き上げる差分として算出
      const nextLevel = attributeSampleSizeFromTable(tolerableRate, expectedDeviations + 1, roo);
      if (Number.isFinite(nextLevel.sampleSize) && nextLevel.sampleSize > sampleSize) {
        additionalSamples = nextLevel.sampleSize - sampleSize;
      }

      // 慣行表を引いた場合、表の値は正確二項の最小値より大きいことがある。
      // その場合に「n = min{...}」と表示すると偽の主張になるため、経路ごとに式を分ける。
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
          : `（正確二項の最小値と一致）`;
        formula = {
          expression: 'n = 標準サンプル数表[許容逸脱率, 予想逸脱件数]（ROO=10%）',
          substituted: `n = 標準表[許容逸脱率 ${pct(tolerableRate, 0)}, 予想逸脱 ${expectedDeviations}件] = ${group(sampleSize)}件${margin}`,
          result: sampleSize
        };
        if (Number.isFinite(exactMinimum) && exactMinimum < sampleSize) {
          exactMinimumSampleSize = exactMinimum;
        }
      }
    } else {
      // 母集団 250 件未満の頻度別ルール（日本の実務慣行）
      const frequencyRules = {
        weekly: { size: Math.min(5, populationSize), label: '週次統制5件' },
        monthly: { size: Math.max(2, Math.min(3, populationSize)), label: '月次統制2〜3件' },
        quarterly: { size: Math.min(1, populationSize), label: '四半期統制1件' },
        annually: { size: Math.min(1, Math.max(1, populationSize)), label: '年次統制1件' }
      };
      const rule = frequencyRules[frequency];

      if (rule) {
        sampleSize = rule.size;
        basis = `頻度別ルール（${rule.label}）です。日本の実務慣行にもとづく非統計的サンプリングのため、正確二項による統計的な裏づけはありません。上限逸脱率は参考値として表示しています。`;
      } else {
        sampleSize = Math.min(25, Math.max(2, tenPercentRule));
        basis = '母集団の10%を使う頻度別ルールです。非統計的サンプリングのため、統計的な裏づけはありません。';
      }
      statistical = false;
      warnings.push('頻度別ルールによる算定です。統計的サンプリングではないため、上限逸脱率による統計的な結論は導けません。');

      formula = {
        expression: 'n = 頻度別ルール（実務慣行）',
        substituted: `n = ${FREQUENCY_LABELS[frequency] || frequency}・母集団${group(populationSize)}件 → ${group(sampleSize)}件（実務慣行）`,
        result: sampleSize
      };
    }

    let fullPopulation = false;
    if (populationSize > 0 && populationSize < sampleSize) {
      sampleSize = populationSize;
      fullPopulation = true;
      basis = '母集団が必要サンプル数より少ないため、全件を確認します。';
      warnings.push('母集団が推奨サンプル数より少ないため、全件を対象とします。');
      formula = {
        expression: 'n = 母集団件数（全件）',
        substituted: `n = ${group(populationSize)}件（全件確認）`,
        result: sampleSize
      };
    }

    // 予想逸脱率が許容逸脱率に達している場合、サンプリング自体が成立しない
    if (sampleSize > 0 && expectedDeviations / sampleSize >= tolerableRate) {
      warnings.push('予想逸脱率が許容逸脱率以上です。統制に依拠しない方針への変更を検討してください。');
    }

    return {
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
    const warnings = [];

    if (sampleSize <= 0) {
      return {
        valid: false,
        sampleSize, deviations, tolerableRate, ROO: roo,
        deviationRate: NaN, upperDeviationLimit: NaN,
        effective: false, evaluation: '算定不能', requiredAction: 'サンプル数を入力してください',
        warnings: ['サンプル数を入力してください。'],
        basis: 'サンプル数が未入力のため評価できません。',
        formula: { expression: 'ULD = BetaInv(1 − ROO, x + 1, n − x)', substituted: '—', result: NaN }
      };
    }

    if (deviations > sampleSize) {
      warnings.push('逸脱件数がサンプル数を超えています。入力を確認してください。');
    }

    const cappedDeviations = Math.min(deviations, sampleSize);
    const deviationRate = cappedDeviations / sampleSize;
    const uld = upperDeviationLimit(sampleSize, cappedDeviations, roo);

    // 判定は ULD のみから決まる（単一経路）
    const effective = uld <= tolerableRate;

    let evaluation;
    let requiredAction;
    if (effective) {
      evaluation = '有効';
      requiredAction = cappedDeviations === 0
        ? '追加手続不要。計画どおり統制に依拠できる。'
        : '追加手続不要。逸脱の原因分析は実施すること。';
    } else {
      evaluation = '無効（統制の不備）';
      requiredAction = '統制への依拠を取りやめて実証手続を拡大するか、サンプルを追加して再評価してください。';
    }

    // 追加サンプルで有効に転じうるかを提示（判定そのものは変えない）
    let additionalSamplesToPass = null;
    if (!effective) {
      for (let extra = 1; extra <= 2000; extra++) {
        if (upperDeviationLimit(sampleSize + extra, cappedDeviations, roo) <= tolerableRate) {
          additionalSamplesToPass = extra;
          break;
        }
      }
      if (additionalSamplesToPass !== null) {
        warnings.push(`追加サンプル ${group(additionalSamplesToPass)} 件で追加の逸脱が発見されなければ、上限逸脱率は許容逸脱率以下となります。`);
      }
    }

    return {
      valid: true,
      sampleSize,
      deviations: cappedDeviations,
      tolerableRate,
      ROO: roo,
      confidenceLevel: 1 - roo,
      deviationRate,
      upperDeviationLimit: uld,
      effective,
      evaluation,
      requiredAction,
      additionalSamplesToPass,
      warnings,
      basis: `正確二項（Clopper–Pearson）による片側上限です。過信リスク ROO=${pct(roo, 0)}。上限逸脱率 ${pct(uld)} を許容逸脱率 ${pct(tolerableRate, 0)} と比べて判定しています。`,
      formula: {
        expression: 'ULD = BetaInv(1 − ROO, x + 1, n − x)',
        substituted: `ULD = BetaInv(${(1 - roo).toFixed(2)}, ${cappedDeviations + 1}, ${sampleSize - cappedDeviations}) = ${pct(uld)} ${effective ? '≤' : '>'} ${pct(tolerableRate, 0)} → ${evaluation}`,
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
    const roo = normalizeROO(s.ROO);
    const warnings = [];

    if (!(IR > 0 && CR > 0)) {
      return {
        valid: false, AR, IR, CR, DR: NaN, RIA: NaN, ROO: roo,
        clamped: false, clampedFrom: null,
        warnings: ['固有リスク・統制リスクは0より大きい値を指定してください。'],
        basis: 'リスク値が不正のため算定できません。',
        formula: { expression: 'DR = AR ÷ (IR × CR)', substituted: '—', result: NaN }
      };
    }

    const DR = AR / (IR * CR);
    const RIA = clamp(DR, RIA_MIN, RIA_MAX);
    const clamped = Math.abs(RIA - DR) > 1e-12;

    if (clamped) {
      if (DR > RIA_MAX) {
        warnings.push(`発見リスク ${pct(DR, 1)} は上限 ${pct(RIA_MAX, 0)} に調整されました。サンプル数はこの上限に基づいて算定されています。`);
      } else {
        warnings.push(`発見リスク ${pct(DR, 1)} は下限 ${pct(RIA_MIN, 0)} に調整されました。サンプル数はこの下限に基づいて算定されています。`);
      }
    }

    // 監査基準報告書315 第33項:
    //   「監査人が内部統制の運用状況の有効性を評価する場合は、統制リスクを評価しなければならない。
    //     監査人が内部統制の運用状況の有効性を評価しない場合は、
    //     重要な虚偽表示リスクと固有リスクは同じ評価となる。」
    // 統制リスクを1.00未満に置くことは運用評価手続の実施を前提とする。
    if (CR < 1) {
      warnings.push(`統制リスク CR=${CR} と評価しています。CR を 1.00 未満とするには、内部統制の運用評価手続（統制テスト）を実施し、その有効性を裏づける必要があります（監査基準報告書315 第33項）。統制テストを実施しない場合、統制リスクは 1.00 として実証手続を計画してください。`);
    }

    return {
      valid: true,
      AR, IR, CR, DR, RIA,
      ROO: roo,
      confidenceLevel: 1 - RIA,
      clamped,
      clampedFrom: clamped ? DR : null,
      warnings,
      basis: `監査リスクモデル DR = AR ÷ (IR × CR) です。実証手続には RIA（受入リスク）を、統制テストには ROO（過信リスク）を使います。RIA は ${pct(RIA_MIN, 0)}〜${pct(RIA_MAX, 0)} の範囲に収めます。ROO は統制にどこまで依拠するかに応じて選ぶ、独立したパラメータです。`,
      formula: {
        expression: 'DR = AR ÷ (IR × CR)',
        substituted: `DR = ${pct(AR, 0)} ÷ (${IR} × ${CR}) = ${pct(DR, 1)}${clamped ? ` → RIA = ${pct(RIA, 0)}（クリップ適用）` : ` → RIA = ${pct(RIA, 1)}`}`,
        result: RIA
      }
    };
  }

  /* ==========================================================================
   * 4. 金額単位サンプリング（BS・PL共通）— §3.2
   * ========================================================================== */

  // PL 最低件数フロアの区分は RIA から導出する（独立セレクタを廃止）
  function riskBandFromRIA(RIA) {
    if (RIA >= 0.15) return { key: 'low', label: '低', floor: 30 };
    if (RIA >= 0.05) return { key: 'medium', label: '中', floor: 60 };
    return { key: 'high', label: '高', floor: 90 };
  }

  /**
   * calculateMonetarySampling
   * @param {{BV, TM, EM, RIA, accountType, assertion, method, transactionCount, highValueTotal}} input
   */
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
        warnings: ['母集団簿価・許容誤謬・受入リスクを正しく入力してください。'],
        basis: '入力が不足しているため算定できません。',
        formula: { expression: 'n = BV × CF ÷ (TM − EM × EF)', substituted: '—', result: NaN }
      };
    }

    const CF = -Math.log(RIA);
    const denominator = TM - EM * EXPANSION_FACTOR;

    if (denominator <= 0) {
      return {
        valid: false, sampleSize: 0, accountType, CF, EF: EXPANSION_FACTOR,
        warnings: [`期待誤謬 × 拡大係数（${group(EM * EXPANSION_FACTOR)}円）が許容誤謬（${group(TM)}円）以上です。サンプリングは成立しません。全件検証または母集団の見直しを検討してください。`],
        basis: '許容誤謬から期待誤謬の拡大分を差し引いた残りが0以下のため、統計的サンプリングは成立しません。',
        formula: {
          expression: 'n = BV × CF ÷ (TM − EM × EF)',
          substituted: `TM − EM × EF = ${group(TM)} − ${group(EM)}×${EXPANSION_FACTOR} = ${group(denominator)} ≤ 0 → 算定不能`,
          result: NaN
        }
      };
    }

    // サンプリング間隔は BV/n ではなく直接算出する（丸め誤差を伝播させない）
    const SI = denominator / CF;
    const rawSampleSize = (BV * CF) / denominator;

    // 基本精度 = CF × SI = TM − EM×EF が恒等的に成立する。
    // したがって EM=0 のとき基本精度は許容誤謬と一致し、誤謬を1件でも発見した時点で
    // 推定誤謬上限が許容誤謬を超える。既定値のまま設計すると必ずこの状態になるため明示する。
    if (EM === 0) {
      warnings.push('期待誤謬を0としているため、基本精度が許容誤謬と一致します（基本精度 = TM − EM×EF）。この設計では誤謬を1件でも発見すると推定誤謬上限が許容誤謬を超え「受入不可」となります。誤謬の発生が見込まれる場合は期待誤謬を設定してください。');
    } else {
      // 拡大係数は本来「信頼度に対応する」係数であり、単一の定数ではない。
      //   監査基準報告書530 研究文書第1号 6-4:
      //   「誤謬予想額に…信頼度に対応する拡張係数を掛け合わせて、
      //     最大許容誤謬額から控除する誤謬見積額を計算します」
      //   同項の設例は信頼度75%（リスク25%）で拡張係数 1.25 であり、標準表と一致する。
      // 本ツールは仕様により EF=1.6 に固定しているため、RIA が 5% から離れるほど
      // 標準表の値とずれる。RIA < 5% では標準値のほうが大きく、取り置きが不足する。
      const standard = standardExpansionFactor(RIA);
      if (standard > EXPANSION_FACTOR + 1e-9) {
        warnings.push(`拡大係数 EF=${EXPANSION_FACTOR} は受入リスク5%に対応する値です。RIA=${pct(RIA, 0)} では標準的な拡大係数は ${standard.toFixed(2)} であり、本ツールの固定値のほうが小さいため、期待誤謬の取り置きが不足します。サンプル数が必要数を下回る可能性があるため、期待誤謬を厚めに設定することを検討してください。`);
      } else if (standard < EXPANSION_FACTOR - 1e-9) {
        warnings.push(`拡大係数 EF=${EXPANSION_FACTOR} は受入リスク5%に対応する値です。RIA=${pct(RIA, 0)} では標準的な拡大係数は ${standard.toFixed(2)} であり、本ツールの固定値のほうが大きいため、サンプル数は保守側（多め）に算定されています。`);
      }
    }

    let adjusted = rawSampleSize;
    let assertionFactor = 1;
    let methodFactor = 1;
    let band = null;
    let floorApplied = false;
    let capApplied = null;

    if (accountType === 'pl') {
      if (assertion === 'completeness') assertionFactor = 1.5;
      if (method === 'stratified') methodFactor = 0.85;
      adjusted = rawSampleSize * assertionFactor * methodFactor;
    }

    // 丸めはここで一度だけ
    let n = Math.ceil(adjusted);

    if (accountType === 'pl') {
      band = riskBandFromRIA(RIA);

      // フロアは上限より優先する（BUG-08）
      if (n < band.floor) {
        n = band.floor;
        floorApplied = true;
      }

      // 10%上限はフロアを下回らない範囲でのみ適用する
      if (transactionCount > 0) {
        const softCap = Math.ceil(transactionCount * 0.1);
        if (n > softCap && softCap >= band.floor) {
          const beforeCap = n;
          n = softCap;
          capApplied = '母集団件数の10%';
          // 上限で切り詰めた時点で、入力した RIA に対応する信頼水準は達成されない。
          // 監査基準報告書530 第6項は「サンプリングリスクを許容可能な低い水準に
          // 抑えるために、十分なサンプル数を決定しなければならない」と要求している。
          warnings.push(`算定値 ${group(beforeCap)} 件を母集団件数の10%（${group(softCap)} 件）で頭打ちにしています。この上限により、受入リスク ${pct(RIA, 0)} に対応する信頼水準は達成されません。上限を適用する妥当性を検討してください。`);
        }
        if (transactionCount < band.floor) {
          warnings.push(`母集団 ${group(transactionCount)} 件では最低件数フロア ${band.floor} 件を満たせません。全件検証を検討してください。`);
        }
      }

      if (n > PL_ABSOLUTE_CAP) {
        n = PL_ABSOLUTE_CAP;
        capApplied = '絶対上限500件';
        warnings.push('算定結果が絶対上限500件を超えたため500件で頭打ちにしています。母集団の階層化を検討してください。');
      }

    }

    // 母集団件数を超えるサンプル数は成立しない。BS・PL のいずれにも適用する。
    let fullPopulation = false;
    if (transactionCount > 0 && n > transactionCount) {
      warnings.push(`必要サンプル数 ${group(n)} 件が母集団件数 ${group(transactionCount)} 件を超えたため、全件を対象とします。金額単位サンプリングではなく精査として設計してください。`);
      n = transactionCount;
      fullPopulation = true;
    }

    // 金額単位サンプリングは計上済みの母集団から金額に比例して抽出するため、
    // 計上漏れ（網羅性）の検証には構造的に向かない。
    if (assertion === 'completeness') {
      warnings.push('金額単位サンプリングは計上済みの母集団から金額に比例して抽出する手法のため、計上漏れ（網羅性）の検証には適していません。網羅性については、出荷記録や入金記録など母集団の外側から逆方向に突合する手続を別途設計してください。');
    }

    // カバレッジ率: 意味のある定義に置換（BUG-06）
    let coverage = null;
    let coverageBasis;
    if (highValueTotal !== null) {
      const normalSampleAmount = Math.max(0, Math.min(BV - highValueTotal, n * SI));
      coverage = Math.min(1, (highValueTotal + normalSampleAmount) / BV);
      coverageBasis = 'カバレッジ = (SI以上の高額項目の合計額 + 通常サンプルの抽出額) ÷ BV';
    } else {
      coverageBasis = '高額項目（SI以上）の合計額が未入力のため算定不能。';
      warnings.push('カバレッジ率は高額項目の合計額を入力すると算定されます。');
    }

    const denomText = EM > 0
      ? `(${group(TM)} − ${group(EM)}×${EXPANSION_FACTOR})`
      : `${group(TM)}`;
    let substituted = `n = ${group(BV)} × ${CF.toFixed(2)} ÷ ${denomText} = ${group(n)}件`;
    if (accountType === 'pl' && (assertionFactor !== 1 || methodFactor !== 1 || floorApplied || capApplied)) {
      const parts = [];
      if (assertionFactor !== 1) parts.push(`網羅性×${assertionFactor}`);
      if (methodFactor !== 1) parts.push(`階層化×${methodFactor}`);
      if (floorApplied) parts.push(`フロア${band.floor}件適用`);
      if (capApplied) parts.push(`${capApplied}適用`);
      substituted = `n = ${group(BV)} × ${CF.toFixed(2)} ÷ ${denomText} → ${parts.join('・')} = ${group(n)}件`;
    }

    let basis = `金額単位サンプリング（MUS/PPS、ポアソン近似）です。信頼係数 CF = −ln(RIA) = ${CF.toFixed(2)}、拡大係数 EF = ${EXPANSION_FACTOR}。サンプリング間隔は (TM − EM×EF) ÷ CF から直接求めているため、BV÷n の丸め誤差が間隔に伝わりません。`;
    if (accountType === 'pl') {
      basis += ` PL項目では、共通式のあとに監査要点と手法による調整、および最低件数フロア（リスク区分${band.label}＝${band.floor}件。RIA ${pct(RIA, 0)} から決まります）を適用します。`;
    }

    return {
      valid: true,
      accountType,
      BV, TM, EM, RIA, CF,
      EF: EXPANSION_FACTOR,
      denominator,
      rawSampleSize,
      sampleSize: n,
      samplingInterval: SI,
      assertionFactor,
      methodFactor,
      riskBand: band,
      floorApplied,
      capApplied,
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
        overstatements.push({ bookValue, errorAmount: difference });
      } else if (difference < 0) {
        // 過小計上は破棄せず別建てで集計する（BUG-09-3）
        understatements.push({ bookValue, errorAmount: -difference });
      }
    }

    // 誤謬件数に上限は設けない（BUG-09-2）
    const over = projectOneDirection(overstatements, SI, RIA);
    const under = projectOneDirection(understatements, SI, RIA);

    if (understatements.length > 0) {
      warnings.push(`過小計上が ${group(understatements.length)} 件あります。過大計上とは別に推定誤謬上限を算定しています。両方を評価してください。`);
    }

    const maxCount = Math.max(over.count, under.count);
    if (maxCount > MANY_ERRORS_THRESHOLD) {
      warnings.push(`誤謬件数が ${group(maxCount)} 件に達しています。サンプリングの前提（誤謬はまれである）が崩れているため、統計的な結論の信頼性は低下します。母集団全体の見直しを検討してください。`);
    }

    let evaluation = null;
    let acceptable = null;
    const governingUML = Math.max(over.upperMisstatementLimit, under.upperMisstatementLimit);

    if (tolerableMisstatement !== null && tolerableMisstatement > 0) {
      acceptable = governingUML <= tolerableMisstatement;
      if (!acceptable) {
        evaluation = '受入不可（追加手続必要）';
      } else if (governingUML < tolerableMisstatement * 0.5) {
        evaluation = '受入可能（余裕あり）';
      } else if (governingUML < tolerableMisstatement * 0.75) {
        evaluation = '受入可能（標準）';
      } else {
        evaluation = '受入可能（条件付き）';
      }
      if (!acceptable) {
        warnings.push(`推定誤謬上限（${group(governingUML)}円）が許容誤謬（${group(tolerableMisstatement)}円）を超過しています。`);
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
      basis: `PPS（MUS）による誤謬評価です。基本精度 = CF(0, RIA) × SI = ${cf0.toFixed(2)} × ${group(SI)}円。汚染率は「誤謬額 ÷ 個別項目の簿価」で求め、項目の簿価が SI 以上の場合は誤謬額の実額を推定誤謬とします。増分許容誤謬は、汚染率の高い順に (CF(i) − CF(i−1) − 1) × 推定誤謬_i を積み上げます。信頼係数は RIA=${pct(RIA, 0)} からポアソン分位として求めており、90%固定ではありません。過大計上と過小計上は別々に集計しています。`,
      formula: {
        expression: 'UML = 基本精度 + Σ推定誤謬 + Σ(CF(i) − CF(i−1) − 1) × 推定誤謬_i',
        substituted: `UML(過大) = ${group(over.basicPrecision)} + ${group(over.projectedMisstatement)} + ${group(over.incrementalAllowance)} = ${group(over.upperMisstatementLimit)}円`
          + (under.count > 0 ? `／UML(過小) = ${group(under.upperMisstatementLimit)}円` : ''),
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

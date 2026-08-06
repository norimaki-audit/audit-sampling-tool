'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../engine.js');

const {
  calculateRiskModel,
  calculateAttributeSampling,
  evaluateAttributeResults,
  calculateMonetarySampling,
  evaluateMonetaryResults,
  generateQuickReference
} = engine;

const closeTo = (actual, expected, tolerance = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('統制テスト: ROO10%の慣行表9セルを再現し、ULDがTDR以下になる', () => {
  const expected = {
    '0.05': [45, 77, 116],
    '0.07': [32, 55, 77],
    '0.09': [25, 42, 58]
  };
  for (const [rate, sizes] of Object.entries(expected)) {
    sizes.forEach((size, deviations) => {
      const plan = calculateAttributeSampling({
        frequency: 'daily', populationSize: 10000, expectedDeviations: deviations,
        tolerableRate: Number(rate), ROO: 0.10, samplingApproach: 'statistical'
      });
      assert.equal(plan.sampleSize, size);
      assert.equal(plan.statistical, true);
      const result = evaluateAttributeResults({
        sampleSize: size, deviations, tolerableRate: Number(rate), ROO: 0.10, statistical: true
      });
      assert.ok(result.upperDeviationLimit <= Number(rate) + 1e-12);
      assert.equal(result.effective, true);
      assert.equal(result.evaluation, '統計的上限は許容範囲内');
    });
  }
});

test('統制テスト: ROO5%は正確二項から導出される', () => {
  const plan = calculateAttributeSampling({
    frequency: 'daily', populationSize: 10000, expectedDeviations: 0,
    tolerableRate: 0.09, ROO: 0.05, samplingApproach: 'statistical'
  });
  assert.equal(plan.sampleSize, 32);
  assert.equal(plan.derivedFromExactBinomial, true);
  assert.match(plan.formula.expression, /min/);
});

test('統制テスト: 小規模・低頻度でも統計的設計を既定とする', () => {
  const plan = calculateAttributeSampling({
    frequency: 'monthly', populationSize: 12, expectedDeviations: 0,
    tolerableRate: 0.09, ROO: 0.10
  });
  assert.equal(plan.statistical, true);
  assert.equal(plan.fullPopulation, true);
  assert.equal(plan.sampleSize, 12);
});

test('統制テスト: 頻度別ルールは明示選択した場合だけ適用する', () => {
  const plan = calculateAttributeSampling({
    frequency: 'monthly', populationSize: 12, expectedDeviations: 0,
    tolerableRate: 0.09, ROO: 0.10, samplingApproach: 'nonstatistical'
  });
  assert.equal(plan.sampleSize, 3);
  assert.equal(plan.statistical, false);
  assert.match(plan.basis, /非統計的/);
});

test('統制テスト: 非統計的設計ではULDから合否を返さない', () => {
  const result = evaluateAttributeResults({
    sampleSize: 3, deviations: 0, tolerableRate: 0.09, ROO: 0.10, statistical: false
  });
  assert.equal(result.effective, null);
  assert.equal(result.evaluation, '職業的専門家としての判断が必要');
  assert.match(result.warnings.join(' '), /統計的な結論/);
});

test('統制テスト: ULD超過は統制不備と断定せず、計画した依拠を支持しないと表示する', () => {
  const result = evaluateAttributeResults({
    sampleSize: 25, deviations: 1, tolerableRate: 0.09, ROO: 0.10, statistical: true
  });
  assert.equal(result.effective, false);
  assert.equal(result.evaluation, '計画した統制依拠を支持しない');
  assert.equal(result.additionalSamplesToPass, null);
  assert.doesNotMatch(result.evaluation, /不備|無効/);
});

test('統制テスト: 逸脱0件でもULD超過なら許容範囲内としない', () => {
  const result = evaluateAttributeResults({
    sampleSize: 10, deviations: 0, tolerableRate: 0.09, ROO: 0.10, statistical: true
  });
  assert.ok(result.upperDeviationLimit > 0.09);
  assert.equal(result.effective, false);
});

test('リスクモデル: DRを算定し、RIAとROOは独立入力として保持する', () => {
  const result = calculateRiskModel({ AR: 0.05, IR: 0.5, CR: 0.5, RIA: 0.15, ROO: 0.05 });
  closeTo(result.DR, 0.20);
  assert.equal(result.RIA, 0.15);
  assert.equal(result.ROO, 0.05);
  assert.equal(result.clamped, false);
  assert.match(result.warnings.join(' '), /自動変換しません/);
});

test('リスクモデル: AR・IR・CRが変わっても明示したRIAは動かない', () => {
  const a = calculateRiskModel({ AR: 0.05, IR: 1, CR: 1, RIA: 0.10, ROO: 0.10 });
  const b = calculateRiskModel({ AR: 0.05, IR: 0.3, CR: 0.3, RIA: 0.10, ROO: 0.10 });
  assert.notEqual(a.DR, b.DR);
  assert.equal(a.RIA, b.RIA);
  assert.equal(a.ROO, b.ROO);
});

test('リスクモデル: CRが1未満なら統制テストによる裏付けを注意する', () => {
  const result = calculateRiskModel({ AR: 0.05, IR: 1, CR: 0.5, RIA: 0.10, ROO: 0.10 });
  assert.match(result.warnings.join(' '), /統制テスト/);
});

test('MUS設計: EM=0ではn=BV×CF÷TM、SI=TM÷CF', () => {
  const BV = 500_000_000;
  const TM = 15_000_000;
  for (const RIA of [0.01, 0.05, 0.10, 0.15, 0.20]) {
    const result = calculateMonetarySampling({ BV, TM, EM: 0, RIA, accountType: 'bs' });
    assert.equal(result.sampleSize, Math.ceil(BV * -Math.log(RIA) / TM));
    closeTo(result.samplingInterval, TM / -Math.log(RIA), 1e-6);
  }
});

test('MUS設計: RIAに対応する拡大係数を使う', () => {
  const expected = new Map([[0.01, 1.90], [0.05, 1.60], [0.10, 1.50], [0.15, 1.40], [0.20, 1.30]]);
  for (const [RIA, EF] of expected) {
    const result = calculateMonetarySampling({
      BV: 500_000_000, TM: 15_000_000, EM: 3_000_000, RIA, accountType: 'bs'
    });
    closeTo(result.EF, EF);
    closeTo(result.denominator, result.TM - result.EM * EF);
  }
});

test('MUS設計: EMの増加によりサンプル数が単調増加する', () => {
  const base = { BV: 500_000_000, TM: 15_000_000, RIA: 0.10, accountType: 'bs' };
  const sizes = [0, 1_000_000, 2_000_000, 3_000_000].map(EM =>
    calculateMonetarySampling({ ...base, EM }).sampleSize);
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1]);
});

test('MUS設計: BS・PL区分だけではコア計算を変えない', () => {
  const input = { BV: 1_000_000_000, TM: 20_000_000, EM: 2_000_000, RIA: 0.10 };
  const bs = calculateMonetarySampling({ ...input, accountType: 'bs' });
  const pl = calculateMonetarySampling({ ...input, accountType: 'pl' });
  assert.equal(bs.sampleSize, pl.sampleSize);
  assert.equal(pl.assertionFactor, 1);
  assert.equal(pl.methodFactor, 1);
  assert.equal(pl.riskBand, null);
  assert.equal(pl.capApplied, null);
});

test('MUS設計: 完全性を選んでも件数を自動補正せず限界を警告する', () => {
  const input = { BV: 500_000_000, TM: 15_000_000, EM: 0, RIA: 0.10, accountType: 'bs' };
  const occurrence = calculateMonetarySampling({ ...input, assertion: 'occurrence' });
  const completeness = calculateMonetarySampling({ ...input, assertion: 'completeness' });
  assert.equal(occurrence.sampleSize, completeness.sampleSize);
  assert.match(completeness.warnings.join(' '), /未計上|完全性/);
});

test('MUS設計: 層化を理由に15%減額しない', () => {
  const input = { BV: 500_000_000, TM: 15_000_000, EM: 0, RIA: 0.10, accountType: 'pl' };
  const systematic = calculateMonetarySampling({ ...input, method: 'systematic' });
  const stratified = calculateMonetarySampling({ ...input, method: 'stratified' });
  assert.equal(systematic.sampleSize, stratified.sampleSize);
  assert.match(stratified.warnings.join(' '), /自動減額しません/);
});

test('MUS設計: 500件等の任意上限で統計的算定値を切り詰めない', () => {
  const result = calculateMonetarySampling({
    BV: 100_000_000_000, TM: 5_000_000, EM: 0, RIA: 0.01,
    accountType: 'pl', transactionCount: 100_000
  });
  assert.ok(result.sampleSize > 500);
  assert.equal(result.capApplied, null);
});

test('MUS設計: 算定ポイントが母集団件数を超える場合は全件化する', () => {
  const result = calculateMonetarySampling({
    BV: 500_000_000, TM: 5_000_000, EM: 0, RIA: 0.05,
    accountType: 'bs', transactionCount: 40
  });
  assert.equal(result.sampleSize, 40);
  assert.equal(result.fullPopulation, true);
  assert.match(result.warnings.join(' '), /全件検証/);
});

test('MUS設計: 確実抽出項目比率は高額項目合計÷BV', () => {
  const result = calculateMonetarySampling({
    BV: 500_000_000, TM: 15_000_000, EM: 0, RIA: 0.10,
    accountType: 'bs', highValueTotal: 125_000_000
  });
  closeTo(result.coverage, 0.25);
  assert.match(result.coverageBasis, /確実抽出項目比率/);
});

test('MUS設計: 高額項目合計が未入力なら比率を作らない', () => {
  const result = calculateMonetarySampling({
    BV: 500_000_000, TM: 15_000_000, EM: 0, RIA: 0.10, accountType: 'bs'
  });
  assert.equal(result.coverage, null);
  assert.match(result.coverageBasis, /未入力/);
});

test('MUS設計: 分母が0以下なら算定不能', () => {
  const result = calculateMonetarySampling({
    BV: 500_000_000, TM: 15_000_000, EM: 10_000_000, RIA: 0.10, accountType: 'bs'
  });
  assert.equal(result.valid, false);
});

test('MUS評価: 誤謬0件ではUML=基本精度', () => {
  for (const RIA of [0.05, 0.10, 0.20]) {
    const result = evaluateMonetaryResults({ SI: 5_000_000, RIA, misstatements: [] });
    closeTo(result.overstatement.basicPrecision, -Math.log(RIA) * 5_000_000, 1e-5);
    closeTo(result.governingUML, result.overstatement.basicPrecision, 1e-5);
  }
});

test('MUS評価: 汚染率は誤謬額÷個別項目簿価', () => {
  const result = evaluateMonetaryResults({
    SI: 5_000_000, RIA: 0.10,
    misstatements: [{ bookValue: 1_000_000, auditValue: 500_000 }]
  });
  closeTo(result.overstatement.detail[0].taint, 0.5);
  closeTo(result.overstatement.detail[0].projectedError, 2_500_000);
});

test('MUS評価: 簿価がSI以上の項目は実額を使い増分許容誤謬を付けない', () => {
  const result = evaluateMonetaryResults({
    SI: 5_000_000, RIA: 0.05,
    misstatements: [{ bookValue: 8_000_000, auditValue: 7_000_000 }]
  });
  const item = result.overstatement.detail[0];
  assert.equal(item.highValue, true);
  assert.equal(item.projectedError, 1_000_000);
  assert.equal(item.incrementalAllowance, 0);
});

test('MUS評価: 増分許容誤謬は信頼係数の増加高から算定する', () => {
  const SI = 5_000_000;
  const RIA = 0.10;
  const result = evaluateMonetaryResults({
    SI, RIA, misstatements: [{ bookValue: 1_000_000, auditValue: 500_000 }]
  });
  const projected = 2_500_000;
  const expected = (engine.math.poissonConfidenceFactor(1, RIA)
    - engine.math.poissonConfidenceFactor(0, RIA) - 1) * projected;
  closeTo(result.overstatement.incrementalAllowance, expected, 1e-5);
});

test('MUS評価: 過小計上は既知額だけを別表示し投影しない', () => {
  const result = evaluateMonetaryResults({
    SI: 5_000_000, RIA: 0.10,
    misstatements: [{ bookValue: 1_000_000, auditValue: 1_400_000 }]
  });
  assert.equal(result.understatement.count, 1);
  assert.equal(result.understatement.knownMisstatement, 400_000);
  assert.equal(result.understatement.projected, false);
  assert.equal(result.understatement.upperMisstatementLimit, null);
  assert.equal(result.governingUML, result.overstatement.upperMisstatementLimit);
  assert.match(result.warnings.join(' '), /MUS.*投影しません/);
});

test('MUS評価: 過小計上だけでは過大計上UMLの比較結果を変えない', () => {
  const base = evaluateMonetaryResults({
    SI: 5_000_000, RIA: 0.10, misstatements: [], tolerableMisstatement: 12_000_000
  });
  const withUnder = evaluateMonetaryResults({
    SI: 5_000_000, RIA: 0.10,
    misstatements: [{ bookValue: 1_000_000, auditValue: 2_000_000 }],
    tolerableMisstatement: 12_000_000
  });
  assert.equal(base.governingUML, withUnder.governingUML);
  assert.equal(base.acceptable, withUnder.acceptable);
});

test('MUS評価: 結果ラベルは監査上の受入可能性を断定しない', () => {
  const pass = evaluateMonetaryResults({
    SI: 2_000_000, RIA: 0.10, misstatements: [], tolerableMisstatement: 10_000_000
  });
  const fail = evaluateMonetaryResults({
    SI: 5_000_000, RIA: 0.10, misstatements: [], tolerableMisstatement: 10_000_000
  });
  assert.equal(pass.evaluation, '統計的上限は許容誤謬以下');
  assert.equal(fail.evaluation, '統計的上限が許容誤謬を超過');
  assert.doesNotMatch(pass.evaluation, /受入可能|余裕あり|条件付き/);
});

test('MUS評価: 多数の誤謬を入力しても切り捨てず注意する', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ bookValue: 1_000_000 + i, auditValue: 900_000 + i }));
  const result = evaluateMonetaryResults({ SI: 5_000_000, RIA: 0.10, misstatements: rows });
  assert.equal(result.overstatement.count, 12);
  assert.match(result.warnings.join(' '), /誤謬件数/);
});

test('早見表: 統制テストは個別計算と一致する', () => {
  for (const ROO of [0.05, 0.10]) {
    const table = generateQuickReference({ type: 'attribute', ROO });
    for (const row of table.rows) {
      for (const cell of row.cells) {
        const plan = calculateAttributeSampling({
          frequency: 'daily', populationSize: 100000,
          expectedDeviations: cell.expectedDeviations,
          tolerableRate: row.tolerableRate, ROO, samplingApproach: 'statistical'
        });
        assert.equal(cell.sampleSize, plan.sampleSize);
      }
    }
  }
});

test('早見表: MUSは個別計算と一致する', () => {
  for (const RIA of [0.05, 0.10, 0.20]) {
    const table = generateQuickReference({ type: 'monetary', RIA });
    for (const row of table.rows) {
      const plan = calculateMonetarySampling({
        BV: row.ratio * 10_000_000, TM: 10_000_000, EM: 0, RIA, accountType: 'bs'
      });
      assert.equal(row.sampleSize, plan.sampleSize);
    }
  }
});

test('数値基盤: 二項CDFと上限逸脱率は大きなnでも有限', () => {
  const cdf = engine.math.binomCdf(10000, 20, 0.002);
  const uld = engine.math.upperDeviationLimit(10000, 20, 0.10);
  assert.ok(Number.isFinite(cdf) && cdf >= 0 && cdf <= 1);
  assert.ok(Number.isFinite(uld) && uld >= 0 && uld <= 1);
});

test('数値基盤: ポアソン信頼係数はk=0で-ln(RIA)', () => {
  for (const RIA of [0.01, 0.05, 0.10, 0.20]) {
    closeTo(engine.math.poissonConfidenceFactor(0, RIA), -Math.log(RIA));
  }
});

test('拡大係数表: 標準点と補間が連続する', () => {
  closeTo(engine.math.standardExpansionFactor(0.05), 1.60);
  closeTo(engine.math.standardExpansionFactor(0.10), 1.50);
  const middle = engine.math.standardExpansionFactor(0.075);
  assert.ok(middle < 1.60 && middle > 1.50);
});

test('全公開関数がwarnings・basis・formulaを返す', () => {
  const results = [
    calculateRiskModel({ AR: 0.05, IR: 1, CR: 1, RIA: 0.10, ROO: 0.10 }),
    calculateAttributeSampling({ frequency: 'daily', populationSize: 1000, expectedDeviations: 0, tolerableRate: 0.09, ROO: 0.10 }),
    evaluateAttributeResults({ sampleSize: 25, deviations: 0, tolerableRate: 0.09, ROO: 0.10 }),
    calculateMonetarySampling({ BV: 500_000_000, TM: 15_000_000, EM: 0, RIA: 0.10, accountType: 'bs' }),
    evaluateMonetaryResults({ SI: 5_000_000, RIA: 0.10, misstatements: [] }),
    generateQuickReference({ type: 'attribute', ROO: 0.10 }),
    generateQuickReference({ type: 'monetary', RIA: 0.10 })
  ];
  results.forEach(result => {
    assert.ok(Array.isArray(result.warnings));
    assert.equal(typeof result.basis, 'string');
    assert.equal(typeof result.formula, 'object');
    assert.equal(typeof result.formula.expression, 'string');
  });
});

test('計算エンジンはDOMを参照しない', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'engine.js'), 'utf8');
  assert.doesNotMatch(source, /\bdocument\b|querySelector|getElementById/);
});

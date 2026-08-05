const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../engine.js');

const {
  calculateRiskModel,
  calculateAttributeSampling,
  evaluateAttributeResults,
  calculateMonetarySampling,
  evaluateMonetaryResults,
  generateQuickReference
} = engine;

/* ==========================================================================
 * INV-01: 標準サンプル数表の9セットすべてで ULD <= 許容逸脱率
 * ========================================================================== */

test('INV-01: 標準サンプル数表9セットの上限逸脱率が許容逸脱率以下かつ期待値と一致する', () => {
  const cases = [
    { tolerableRate: 0.05, deviations: 0, sampleSize: 45, expectedULD: 4.99 },
    { tolerableRate: 0.05, deviations: 1, sampleSize: 77, expectedULD: 4.96 },
    { tolerableRate: 0.05, deviations: 2, sampleSize: 116, expectedULD: 4.52 },
    { tolerableRate: 0.07, deviations: 0, sampleSize: 32, expectedULD: 6.94 },
    { tolerableRate: 0.07, deviations: 1, sampleSize: 55, expectedULD: 6.89 },
    { tolerableRate: 0.07, deviations: 2, sampleSize: 77, expectedULD: 6.76 },
    { tolerableRate: 0.09, deviations: 0, sampleSize: 25, expectedULD: 8.80 },
    { tolerableRate: 0.09, deviations: 1, sampleSize: 42, expectedULD: 8.95 },
    { tolerableRate: 0.09, deviations: 2, sampleSize: 58, expectedULD: 8.92 }
  ];

  for (const c of cases) {
    // 表そのものが仕様どおりであること
    const planned = calculateAttributeSampling({
      frequency: 'daily',
      populationSize: 10000,
      expectedDeviations: c.deviations,
      tolerableRate: c.tolerableRate,
      ROO: 0.10
    });
    assert.equal(planned.sampleSize, c.sampleSize,
      `表の値: 許容${c.tolerableRate} 逸脱${c.deviations}`);

    const evaluated = evaluateAttributeResults({
      sampleSize: c.sampleSize,
      deviations: c.deviations,
      tolerableRate: c.tolerableRate,
      ROO: 0.10
    });

    const uldPercent = evaluated.upperDeviationLimit * 100;
    assert.ok(Math.abs(uldPercent - c.expectedULD) <= 0.02,
      `ULD 期待 ${c.expectedULD}% 実測 ${uldPercent.toFixed(3)}%`);
    assert.ok(evaluated.upperDeviationLimit <= c.tolerableRate,
      `ULD ${uldPercent.toFixed(3)}% が許容逸脱率 ${c.tolerableRate * 100}% を超過`);
    assert.equal(evaluated.effective, true);
  }
});

test('INV-01補: 自ツールの標準設計が「有効」と評価される（BUG-01 の再発検知）', () => {
  // 現行 v2.9 の Wilson 実装ではこの4件すべてが許容逸脱率を超過していた
  const standardDesigns = [
    { sampleSize: 25, deviations: 0, tolerableRate: 0.09 },
    { sampleSize: 42, deviations: 1, tolerableRate: 0.09 },
    { sampleSize: 32, deviations: 0, tolerableRate: 0.07 },
    { sampleSize: 45, deviations: 0, tolerableRate: 0.05 }
  ];
  for (const d of standardDesigns) {
    const r = evaluateAttributeResults({ ...d, ROO: 0.10 });
    assert.ok(r.upperDeviationLimit <= d.tolerableRate,
      `n=${d.sampleSize} x=${d.deviations}: ULD ${(r.upperDeviationLimit * 100).toFixed(2)}% > 許容 ${d.tolerableRate * 100}%`);
    assert.equal(r.effective, true);
    assert.equal(r.evaluation, '有効');
  }
});

/* ==========================================================================
 * INV-02: ULD と評価結果が常に一貫する
 * ========================================================================== */

test('INV-02: ULD > 許容逸脱率 なのに「有効」を返すケースが存在しない', () => {
  const sampleSizes = [1, 3, 5, 10, 25, 32, 42, 45, 55, 58, 77, 100, 116, 150, 200];
  const tolerableRates = [0.05, 0.07, 0.09];
  const roos = [0.05, 0.10];
  let checked = 0;

  for (const n of sampleSizes) {
    for (const tolerableRate of tolerableRates) {
      for (const ROO of roos) {
        for (let deviations = 0; deviations <= Math.min(n, 5); deviations++) {
          const r = evaluateAttributeResults({ sampleSize: n, deviations, tolerableRate, ROO });
          assert.equal(r.effective, r.upperDeviationLimit <= tolerableRate,
            `不一致: n=${n} x=${deviations} TDR=${tolerableRate} ROO=${ROO} ULD=${r.upperDeviationLimit}`);
          // 表示文字列と判定の整合（調書に矛盾した組み合わせが出ないこと）
          if (r.effective) {
            assert.equal(r.evaluation, '有効');
          } else {
            assert.ok(r.evaluation.startsWith('無効'));
          }
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 300, `検証件数が少なすぎる: ${checked}`);
});

test('INV-02補: 逸脱0件でも ULD が許容逸脱率を超えれば「無効」となる', () => {
  // n=10, x=0, ROO=10% → ULD = 1 - 0.1^(1/10) = 20.6% > 9%
  const r = evaluateAttributeResults({ sampleSize: 10, deviations: 0, tolerableRate: 0.09, ROO: 0.10 });
  assert.ok(r.upperDeviationLimit > 0.09);
  assert.equal(r.effective, false);
  assert.ok(r.evaluation.startsWith('無効'));
});

test('BUG-02: 許容逸脱率がハードコードされておらず選択値で判定が変わる', () => {
  const at9 = evaluateAttributeResults({ sampleSize: 25, deviations: 0, tolerableRate: 0.09, ROO: 0.10 });
  const at5 = evaluateAttributeResults({ sampleSize: 25, deviations: 0, tolerableRate: 0.05, ROO: 0.10 });
  assert.equal(at9.effective, true);
  assert.equal(at5.effective, false, 'n=25 の ULD は 8.8% なので 5% 基準では無効のはず');
});

/* ==========================================================================
 * INV-03: EM = 0 のとき n = BV × CF / TM
 * ========================================================================== */

test('INV-03: EM=0 のとき n = BV × CF ÷ TM に一致する（拡大係数が悪さをしない）', () => {
  const BV = 500000000;
  const TM = 15000000;
  for (const RIA of [0.05, 0.10, 0.15, 0.20]) {
    const r = calculateMonetarySampling({ BV, TM, EM: 0, RIA, accountType: 'bs' });
    const expected = Math.ceil((BV * -Math.log(RIA)) / TM);
    assert.equal(r.sampleSize, expected, `RIA=${RIA}`);
    // サンプリング間隔も BV/n ではなく TM/CF から直接算出されていること
    assert.ok(Math.abs(r.samplingInterval - TM / -Math.log(RIA)) < 1e-6);
  }
});

/* ==========================================================================
 * INV-04: EM 単調増加 / 増加率 1.15〜1.25（二重適用の再発検知）
 * ========================================================================== */

test('INV-04: EM を増やすとサンプル数が単調増加し、EM=TM×10% で 1.15〜1.25 倍', () => {
  const BV = 500000000;
  const TM = 15000000;
  const RIA = 0.10;

  let previous = 0;
  for (const fraction of [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5]) {
    const r = calculateMonetarySampling({ BV, TM, EM: TM * fraction, RIA, accountType: 'bs' });
    assert.ok(r.valid, `EM=TM×${fraction} で算定できること`);
    assert.ok(r.sampleSize >= previous, `単調増加でない: ${previous} -> ${r.sampleSize}`);
    previous = r.sampleSize;
  }

  const base = calculateMonetarySampling({ BV, TM, EM: 0, RIA, accountType: 'bs' });
  const tenPercent = calculateMonetarySampling({ BV, TM, EM: TM * 0.1, RIA, accountType: 'bs' });
  const ratio = tenPercent.sampleSize / base.sampleSize;
  assert.ok(ratio >= 1.15 && ratio <= 1.25,
    `増加率が範囲外（二重適用の疑い）: ${ratio.toFixed(4)}`);
});

test('BUG-05: CFadj = CF × (1 + EM/TM) の二重適用が存在しない', () => {
  const BV = 500000000;
  const TM = 15000000;
  const RIA = 0.10;
  const base = calculateMonetarySampling({ BV, TM, EM: 0, RIA, accountType: 'bs' });

  // 分子に (1 + EM/TM) が掛かっていないこと＝ raw = BV × CF ÷ 分母 が厳密に成立すること
  for (const fraction of [0, 0.1, 0.25, 0.5]) {
    const EM = TM * fraction;
    const r = calculateMonetarySampling({ BV, TM, EM, RIA, accountType: 'bs' });
    const expectedRaw = (BV * -Math.log(RIA)) / (TM - EM * 1.6);
    assert.ok(Math.abs(r.rawSampleSize - expectedRaw) < 1e-9,
      `EM=TM×${fraction}: 分子に係数が二重適用されている`);
  }

  // EM = TM×25% なら分母 = TM×0.6 → 1/0.6 = 1.667 倍
  const quarter = calculateMonetarySampling({ BV, TM, EM: TM * 0.25, RIA, accountType: 'bs' });
  const quarterRatio = quarter.sampleSize / base.sampleSize;
  assert.ok(quarterRatio > 1.6 && quarterRatio < 1.72,
    `EM=TM×25% の増加率が想定外: ${quarterRatio.toFixed(4)}`);

  // 分母が 0 以下になるのは EM = TM ÷ 1.6 = TM×0.625 から
  const degenerate = calculateMonetarySampling({ BV, TM, EM: TM * 0.625, RIA, accountType: 'bs' });
  assert.equal(degenerate.valid, false, 'EM×EF が TM に達したら算定不能を返すべき');
  assert.ok(degenerate.warnings.length > 0);
});

test('BUG-06: カバレッジ率は高額項目未入力なら算定不能を返し 100% と表示しない', () => {
  const noHighValue = calculateMonetarySampling({
    BV: 500000000, TM: 15000000, EM: 0, RIA: 0.10, accountType: 'bs'
  });
  assert.equal(noHighValue.coverage, null);
  assert.match(noHighValue.coverageBasis, /算定不能/);

  const withHighValue = calculateMonetarySampling({
    BV: 500000000, TM: 15000000, EM: 0, RIA: 0.10, accountType: 'bs',
    highValueTotal: 100000000
  });
  assert.ok(withHighValue.coverage !== null);
  assert.ok(withHighValue.coverage > 0 && withHighValue.coverage <= 1);
});

/* ==========================================================================
 * INV-05: 誤謬0件のとき UML = 基本精度
 * ========================================================================== */

test('INV-05: 誤謬0件のとき UML = 基本精度', () => {
  for (const RIA of [0.05, 0.10, 0.20]) {
    const SI = 5000000;
    const r = evaluateMonetaryResults({ SI, RIA, misstatements: [] });
    const expectedBasicPrecision = -Math.log(RIA) * SI;
    assert.ok(Math.abs(r.overstatement.basicPrecision - expectedBasicPrecision) < 1e-6);
    assert.equal(r.overstatement.upperMisstatementLimit, r.overstatement.basicPrecision);
    assert.equal(r.overstatement.projectedMisstatement, 0);
    assert.equal(r.overstatement.incrementalAllowance, 0);
  }
});

/* ==========================================================================
 * INV-06: 誤謬 4 件 → 5 件で UML が増加（脱落の再発検知）
 * ========================================================================== */

test('INV-06: 誤謬件数を 4 件から 5 件に増やすと UML が増加する', () => {
  const SI = 5000000;
  const RIA = 0.10;
  const rows = [
    { bookValue: 1000000, auditValue: 500000 },
    { bookValue: 900000, auditValue: 500000 },
    { bookValue: 800000, auditValue: 500000 },
    { bookValue: 700000, auditValue: 500000 },
    { bookValue: 600000, auditValue: 300000 }
  ];

  const four = evaluateMonetaryResults({ SI, RIA, misstatements: rows.slice(0, 4) });
  const five = evaluateMonetaryResults({ SI, RIA, misstatements: rows });

  assert.equal(four.overstatement.count, 4);
  assert.equal(five.overstatement.count, 5);
  assert.ok(five.overstatement.upperMisstatementLimit > four.overstatement.upperMisstatementLimit,
    `5件目が脱落している: 4件=${four.overstatement.upperMisstatementLimit} 5件=${five.overstatement.upperMisstatementLimit}`);
  assert.ok(five.overstatement.projectedMisstatement > four.overstatement.projectedMisstatement,
    '推定誤謬額から5件目が脱落している');

  // 10 件でも脱落しない
  const many = evaluateMonetaryResults({
    SI, RIA,
    misstatements: Array.from({ length: 10 }, (_, i) => ({ bookValue: 1000000 - i * 10000, auditValue: 500000 }))
  });
  assert.equal(many.overstatement.count, 10);
  assert.ok(many.overstatement.upperMisstatementLimit > five.overstatement.upperMisstatementLimit);
});

test('BUG-09-1: 増分許容誤謬が (CF(i) − CF(i−1) − 1) × 推定誤謬（/CF[0] ではない）', () => {
  const SI = 5000000;
  const RIA = 0.10;
  // 簿価 < SI の項目でのみ増分が発生する（簿価 ≥ SI は研究文書第1号 6-7 により対象外）
  // 簿価 2,000,000 / 誤謬 1,000,000 → taint 0.5 → 推定誤謬 = 0.5 × SI = 2,500,000
  const r = evaluateMonetaryResults({
    SI, RIA,
    misstatements: [{ bookValue: 2000000, auditValue: 1000000 }]
  });
  const cf0 = engine.math.poissonConfidenceFactor(0, RIA);
  const cf1 = engine.math.poissonConfidenceFactor(1, RIA);
  const projected = 0.5 * SI;
  assert.ok(Math.abs(r.overstatement.projectedMisstatement - projected) < 1e-6);
  const expected = (cf1 - cf0 - 1) * projected;
  assert.ok(Math.abs(r.overstatement.incrementalAllowance - expected) < 1,
    `増分許容誤謬 期待 ${expected} 実測 ${r.overstatement.incrementalAllowance}`);
  // 旧実装の / CF[0] を掛けた値とは一致しないこと
  const legacy = projected * (3.89 - 2.31) / 2.31;
  assert.ok(Math.abs(r.overstatement.incrementalAllowance - legacy) > 1);
});

test('BUG-09-3: 過小計上が無言で破棄されず別建てで集計される', () => {
  const SI = 5000000;
  const RIA = 0.10;
  const r = evaluateMonetaryResults({
    SI, RIA,
    misstatements: [
      { bookValue: 1000000, auditValue: 600000 },   // 過大 400,000
      { bookValue: 600000, auditValue: 1000000 }    // 過小 400,000
    ]
  });
  assert.equal(r.overstatement.count, 1);
  assert.equal(r.understatement.count, 1);
  assert.ok(r.understatement.upperMisstatementLimit > 0);
  assert.ok(r.warnings.some(w => w.includes('過小計上')), '過小計上の警告が出ていない');
});

test('BUG-09-4: 信頼係数が RIA から動的に決まる（90%固定ではない）', () => {
  const SI = 5000000;
  const at10 = evaluateMonetaryResults({ SI, RIA: 0.10, misstatements: [] });
  const at5 = evaluateMonetaryResults({ SI, RIA: 0.05, misstatements: [] });
  assert.ok(at5.overstatement.basicPrecision > at10.overstatement.basicPrecision);
  // RIA=10% では従来のハードコード 2.31 を再現する
  assert.ok(Math.abs(at10.confidenceFactorZero - 2.31) < 0.01);
  assert.ok(Math.abs(at5.confidenceFactorZero - 3.00) < 0.01);
});

test('BUG-09: 汚染率は誤謬額 ÷ 個別項目の簿価（誤謬額 ÷ SI ではない）', () => {
  const SI = 5000000;
  const RIA = 0.10;
  // 簿価 1,000,000（SI 未満）で誤謬 500,000 → taint = 0.5、推定誤謬 = 0.5 × SI
  const r = evaluateMonetaryResults({
    SI, RIA, misstatements: [{ bookValue: 1000000, auditValue: 500000 }]
  });
  assert.ok(Math.abs(r.overstatement.detail[0].taint - 0.5) < 1e-9);
  assert.ok(Math.abs(r.overstatement.detail[0].projectedError - 0.5 * SI) < 1e-6);

  // 簿価が SI 以上なら実額
  const r2 = evaluateMonetaryResults({
    SI, RIA, misstatements: [{ bookValue: 8000000, auditValue: 7000000 }]
  });
  assert.ok(Math.abs(r2.overstatement.detail[0].projectedError - 1000000) < 1e-6);
});

/* ==========================================================================
 * INV-07: 早見表と個別計算の一致
 * ========================================================================== */

test('INV-07: generateQuickReference（統制テスト）が個別計算と一致する', () => {
  for (const ROO of [0.05, 0.10]) {
    const table = generateQuickReference({ type: 'attribute', ROO });
    for (const row of table.rows) {
      for (const cell of row.cells) {
        const individual = calculateAttributeSampling({
          frequency: 'daily',
          populationSize: 100000,
          expectedDeviations: cell.expectedDeviations,
          tolerableRate: row.tolerableRate,
          ROO
        });
        assert.equal(cell.sampleSize, individual.sampleSize,
          `早見表と実装の乖離: ROO=${ROO} TDR=${row.tolerableRate} x=${cell.expectedDeviations}`);

        const evaluated = evaluateAttributeResults({
          sampleSize: cell.sampleSize,
          deviations: cell.expectedDeviations,
          tolerableRate: row.tolerableRate,
          ROO
        });
        assert.equal(cell.upperDeviationLimit, evaluated.upperDeviationLimit);
        assert.ok(cell.upperDeviationLimit <= row.tolerableRate,
          `早見表のセルが許容逸脱率を超過: ROO=${ROO} TDR=${row.tolerableRate} x=${cell.expectedDeviations}`);
      }
    }
  }
});

test('INV-07: generateQuickReference（金額単位）が個別計算と一致する', () => {
  const TM = 10000000;
  for (const RIA of [0.05, 0.10, 0.20]) {
    const table = generateQuickReference({ type: 'monetary', RIA });
    for (const row of table.rows) {
      const individual = calculateMonetarySampling({
        BV: row.ratio * TM, TM, EM: 0, RIA, accountType: 'bs'
      });
      assert.equal(row.sampleSize, individual.sampleSize,
        `早見表と実装の乖離: RIA=${RIA} 比率=${row.ratio}`);
      // 手計算との一致: n = ceil(比率 × CF)
      assert.equal(row.sampleSize, Math.ceil(row.ratio * -Math.log(RIA)));
    }
  }
});

test('INV-07補: 早見表の索引が 母集団÷許容誤謬 に統一されている', () => {
  const table = generateQuickReference({ type: 'monetary', RIA: 0.10 });
  assert.match(table.columns[0], /母集団.*許容誤謬/);
  // 基準額を変えても同じ比率なら同じサンプル数（件数ベースでない証明）
  const a = calculateMonetarySampling({ BV: 20 * 10000000, TM: 10000000, EM: 0, RIA: 0.10, accountType: 'bs' });
  const b = calculateMonetarySampling({ BV: 20 * 3000000, TM: 3000000, EM: 0, RIA: 0.10, accountType: 'bs' });
  assert.equal(a.sampleSize, b.sampleSize);
});

/* ==========================================================================
 * INV-08: RIA / ROO を変化させると全経路でサンプル数が変化する
 * ========================================================================== */

test('INV-08: ROO を変えると統制テストのサンプル数が変化する', () => {
  const base = { frequency: 'daily', populationSize: 10000, expectedDeviations: 0, tolerableRate: 0.09 };
  const at10 = calculateAttributeSampling({ ...base, ROO: 0.10 });
  const at5 = calculateAttributeSampling({ ...base, ROO: 0.05 });
  assert.notEqual(at10.sampleSize, at5.sampleSize,
    '統制テストが ROO に未配線（BUG-03 の再発）');
  assert.ok(at5.sampleSize > at10.sampleSize, '過信リスクを下げたらサンプル数は増えるはず');
  assert.equal(at10.sampleSize, 25);
  assert.equal(at5.sampleSize, 32);
});

test('INV-08: RIA を変えると BS のサンプル数が変化する', () => {
  const base = { BV: 500000000, TM: 15000000, EM: 0, accountType: 'bs' };
  const sizes = [0.20, 0.15, 0.10, 0.05, 0.01].map(RIA =>
    calculateMonetarySampling({ ...base, RIA }).sampleSize);
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] > sizes[i - 1],
      `BS が RIA に未配線または単調でない: ${sizes.join(', ')}`);
  }
});

test('INV-08: RIA を変えると PL のサンプル数が変化する', () => {
  const base = {
    BV: 1000000000, TM: 20000000, EM: 0,
    accountType: 'pl', assertion: 'occurrence', method: 'systematic',
    transactionCount: 100000
  };
  const sizes = [0.20, 0.15, 0.10, 0.05, 0.01].map(RIA =>
    calculateMonetarySampling({ ...base, RIA }).sampleSize);
  for (let i = 1; i < sizes.length; i++) {
    assert.ok(sizes[i] > sizes[i - 1],
      `PL が RIA に未配線または単調でない: ${sizes.join(', ')}`);
  }
});

test('INV-08: AR / IR / CR を変えると RIA 経由で実証手続のサンプル数が動く', () => {
  const build = (AR, IR, CR) => {
    const risk = calculateRiskModel({ AR, IR, CR, ROO: 0.10 });
    return calculateMonetarySampling({
      BV: 500000000, TM: 15000000, EM: 0, RIA: risk.RIA, accountType: 'bs'
    }).sampleSize;
  };
  const low = build(0.05, 0.5, 0.5);   // DR = 20% → RIA 20%
  const high = build(0.05, 1.0, 1.0);  // DR = 5%  → RIA 5%
  assert.ok(high > low, `AR/IR/CR が未配線: low=${low} high=${high}`);
});

/* ==========================================================================
 * リスクモデル（BUG-04）
 * ========================================================================== */

test('BUG-04: リスククリップが可視化される', () => {
  // AR5% / IR0.3 / CR0.3 → DR = 55.6% が 20% に丸められる
  const r = calculateRiskModel({ AR: 0.05, IR: 0.3, CR: 0.3, ROO: 0.10 });
  assert.ok(Math.abs(r.DR - 0.05 / 0.09) < 1e-9);
  assert.equal(r.RIA, 0.20);
  assert.equal(r.clamped, true);
  assert.ok(Math.abs(r.clampedFrom - r.DR) < 1e-12);
  assert.ok(r.warnings.some(w => w.includes('上限')), 'クリップ警告が出ていない');
  assert.ok(r.warnings.some(w => w.includes('20%')));
});

test('BUG-04: ROO が DR × 0.5 から導出されず独立パラメータになっている', () => {
  const a = calculateRiskModel({ AR: 0.05, IR: 1, CR: 1, ROO: 0.05 });
  const b = calculateRiskModel({ AR: 0.05, IR: 0.3, CR: 0.3, ROO: 0.05 });
  assert.equal(a.ROO, 0.05);
  assert.equal(b.ROO, 0.05, 'ROO が DR に連動してしまっている');
  const c = calculateRiskModel({ AR: 0.05, IR: 1, CR: 1, ROO: 0.10 });
  assert.equal(c.ROO, 0.10);
});

test('クリップが発動しない場合は clamped:false', () => {
  const r = calculateRiskModel({ AR: 0.05, IR: 1, CR: 1, ROO: 0.10 });
  assert.equal(r.clamped, false);
  assert.equal(r.clampedFrom, null);
  assert.ok(Math.abs(r.RIA - 0.05) < 1e-12);
});

/* ==========================================================================
 * PL フロアと上限の適用順（BUG-08）
 * ========================================================================== */

test('BUG-08: PL の 10%上限が最低件数フロアを下回らない', () => {
  // 母集団 500 件・高リスク（RIA < 5%）→ フロア 90 件
  // 旧実装は ceil(500 × 10%) = 50 件で頭打ちになっていた
  const r = calculateMonetarySampling({
    BV: 500000000, TM: 20000000, EM: 0, RIA: 0.03,
    accountType: 'pl', transactionCount: 500
  });
  assert.equal(r.riskBand.floor, 90);
  assert.ok(r.sampleSize >= 90, `フロアを下回っている: ${r.sampleSize}`);
});

test('BUG-08: 母集団がフロアを満たせない場合は全件検証の警告を返す', () => {
  const r = calculateMonetarySampling({
    BV: 50000000, TM: 20000000, EM: 0, RIA: 0.03,
    accountType: 'pl', transactionCount: 40
  });
  assert.ok(r.warnings.some(w => w.includes('全件検証')), '全件検証の警告が出ていない');
  assert.ok(r.sampleSize <= 40, '母集団件数を超えるサンプル数を返している');
});

test('PL フロアが RIA から導出される', () => {
  const mk = (RIA) => calculateMonetarySampling({
    BV: 1000000, TM: 20000000, EM: 0, RIA, accountType: 'pl', transactionCount: 100000
  });
  assert.equal(mk(0.20).riskBand.floor, 30);
  assert.equal(mk(0.10).riskBand.floor, 60);
  assert.equal(mk(0.03).riskBand.floor, 90);
});

test('PL の監査要点・手法による調整が効く', () => {
  const base = {
    BV: 1000000000, TM: 20000000, EM: 0, RIA: 0.10,
    accountType: 'pl', transactionCount: 100000
  };
  const plain = calculateMonetarySampling(base);
  const completeness = calculateMonetarySampling({ ...base, assertion: 'completeness' });
  const stratified = calculateMonetarySampling({ ...base, method: 'stratified' });
  assert.ok(completeness.sampleSize > plain.sampleSize, '網羅性 ×1.5 が効いていない');
  assert.ok(stratified.sampleSize < plain.sampleSize, '階層化 ×0.85 が効いていない');
});

/* ==========================================================================
 * 戻り値の契約（warnings / basis / formula）
 * ========================================================================== */

test('すべての公開関数が warnings / basis / formula を返す', () => {
  const results = [
    calculateRiskModel({ AR: 0.05, IR: 1, CR: 1, ROO: 0.10 }),
    calculateAttributeSampling({ frequency: 'daily', populationSize: 1000, expectedDeviations: 0, tolerableRate: 0.09, ROO: 0.10 }),
    evaluateAttributeResults({ sampleSize: 25, deviations: 0, tolerableRate: 0.09, ROO: 0.10 }),
    calculateMonetarySampling({ BV: 500000000, TM: 15000000, EM: 0, RIA: 0.10, accountType: 'bs' }),
    evaluateMonetaryResults({ SI: 5000000, RIA: 0.10, misstatements: [] }),
    generateQuickReference({ type: 'attribute', ROO: 0.10 }),
    generateQuickReference({ type: 'monetary', RIA: 0.10 })
  ];
  for (const r of results) {
    assert.ok(Array.isArray(r.warnings), 'warnings が配列でない');
    assert.equal(typeof r.basis, 'string');
    assert.ok(r.basis.length > 0, 'basis が空');
    assert.ok(r.formula && typeof r.formula.expression === 'string');
    assert.ok(typeof r.formula.substituted === 'string');
    assert.ok('result' in r.formula);
  }
});

test('formula.substituted が実数を代入した1行の式になっている', () => {
  const r = calculateMonetarySampling({
    BV: 500000000, TM: 15000000, EM: 1500000, RIA: 0.10, accountType: 'bs'
  });
  // 例: n = 500,000,000 × 2.30 ÷ (15,000,000 − 1,500,000×1.6) = 91件
  assert.match(r.formula.substituted, /500,000,000/);
  assert.match(r.formula.substituted, /15,000,000/);
  assert.match(r.formula.substituted, /1,500,000/);
  assert.match(r.formula.substituted, /件$/);
  assert.ok(!r.formula.substituted.includes('\n'), '1行でない');
});

test('非統計的な頻度別ルールが basis で明示される', () => {
  const monthly = calculateAttributeSampling({
    frequency: 'monthly', populationSize: 12, expectedDeviations: 0, tolerableRate: 0.09, ROO: 0.10
  });
  assert.equal(monthly.sampleSize, 3);
  assert.equal(monthly.statistical, false);
  assert.match(monthly.basis, /非統計的/);
  assert.ok(monthly.warnings.some(w => w.includes('統計的サンプリングではない')));

  const daily = calculateAttributeSampling({
    frequency: 'daily', populationSize: 10000, expectedDeviations: 0, tolerableRate: 0.09, ROO: 0.10
  });
  assert.equal(daily.statistical, true);
});

/* ==========================================================================
 * 数値計算基盤
 * ========================================================================== */

test('binomCdf / upperDeviationLimit が大きな n でも安定する', () => {
  const uld = engine.math.upperDeviationLimit(5000, 50, 0.10);
  assert.ok(Number.isFinite(uld) && uld > 0 && uld < 1);
  assert.ok(uld > 50 / 5000, '上限が点推定を下回っている');
  // n=45, x=0, risk=10% は閉形式 1 - 0.1^(1/45) と一致する
  const closedForm = 1 - Math.pow(0.10, 1 / 45);
  assert.ok(Math.abs(engine.math.upperDeviationLimit(45, 0, 0.10) - closedForm) < 1e-9);
});

test('poissonConfidenceFactor が従来のハードコード表を再現する', () => {
  const expected = [2.31, 3.89, 5.33, 6.69, 8.00];
  for (let k = 0; k < expected.length; k++) {
    const cf = engine.math.poissonConfidenceFactor(k, 0.10);
    assert.ok(Math.abs(cf - expected[k]) < 0.015,
      `CF(${k}, 10%) 期待 ${expected[k]} 実測 ${cf.toFixed(3)}`);
  }
  assert.ok(Math.abs(engine.math.poissonConfidenceFactor(0, 0.10) - -Math.log(0.10)) < 1e-12);
});

test('エンジンが DOM を参照しない（純関数である）', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof window, 'undefined');
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'engine.js'), 'utf8');
  assert.ok(!/document\./.test(source), 'engine.js が document を参照している');
  assert.ok(!/getElementById/.test(source), 'engine.js が getElementById を参照している');
});

/* ==========================================================================
 * 敵対的レビューで発見された欠陥の再発検知
 * ========================================================================== */

test('慣行表を引いたとき formula が「min{...}」と偽の主張をしない', () => {
  // TDR=5% 逸脱2件: 表は116件だが正確二項の最小は105件。
  // 「n = min{...} = 116」と表示すると数学的に偽になる。
  const conventional = calculateAttributeSampling({
    frequency: 'daily', populationSize: 10000,
    expectedDeviations: 2, tolerableRate: 0.05, ROO: 0.10
  });
  assert.equal(conventional.sampleSize, 116);
  assert.equal(conventional.derivedFromExactBinomial, false);
  assert.ok(!conventional.formula.substituted.includes('min{'),
    '慣行表なのに最小化の式を表示している');
  assert.match(conventional.formula.substituted, /標準表/);
  assert.equal(conventional.exactMinimumSampleSize, 105);
  assert.match(conventional.formula.substituted, /105/);

  // 導出経路（ROO=5%）では min{...} 表示で正しい
  const derived = calculateAttributeSampling({
    frequency: 'daily', populationSize: 10000,
    expectedDeviations: 2, tolerableRate: 0.05, ROO: 0.05
  });
  assert.equal(derived.derivedFromExactBinomial, true);
  assert.match(derived.formula.substituted, /min\{/);
  assert.equal(derived.exactMinimumSampleSize, null);

  // 表の値が最小値と一致するセルでは「一致」と表示する
  const same = calculateAttributeSampling({
    frequency: 'daily', populationSize: 10000,
    expectedDeviations: 0, tolerableRate: 0.09, ROO: 0.10
  });
  assert.equal(same.sampleSize, 25);
  assert.equal(same.exactMinimumSampleSize, null);
  assert.match(same.formula.substituted, /一致/);
});

test('基本精度 = TM − EM×EF が恒等的に成立する', () => {
  const cases = [
    { TM: 60000000, EM: 0 },
    { TM: 60000000, EM: 10000000 },
    { TM: 15000000, EM: 1500000 },
    { TM: 20000000, EM: 5000000 }
  ];
  for (const c of cases) {
    for (const RIA of [0.05, 0.10, 0.20]) {
      const plan = calculateMonetarySampling({ BV: 2e9, TM: c.TM, EM: c.EM, RIA, accountType: 'bs' });
      const ev = evaluateMonetaryResults({ SI: plan.samplingInterval, RIA, misstatements: [] });
      const expected = c.TM - c.EM * 1.6;
      assert.ok(Math.abs(ev.overstatement.basicPrecision - expected) < 1e-6,
        `TM=${c.TM} EM=${c.EM} RIA=${RIA}: 基本精度 ${ev.overstatement.basicPrecision} != ${expected}`);
    }
  }
});

test('EM=0 は基本精度が許容誤謬と一致する旨を警告する', () => {
  const withZero = calculateMonetarySampling({
    BV: 2e9, TM: 60000000, EM: 0, RIA: 0.10, accountType: 'bs'
  });
  assert.ok(withZero.warnings.some(w => w.includes('基本精度が許容誤謬と一致')),
    'EM=0 の警告が出ていない');

  const withEM = calculateMonetarySampling({
    BV: 2e9, TM: 60000000, EM: 10000000, RIA: 0.10, accountType: 'bs'
  });
  assert.ok(!withEM.warnings.some(w => w.includes('基本精度が許容誤謬と一致')),
    'EM>0 なのに警告が出ている');

  // 警告の内容が実際の挙動と一致すること: 誤謬1円で受入不可になる
  const ev0 = evaluateMonetaryResults({
    SI: withZero.samplingInterval, RIA: 0.10, misstatements: [],
    tolerableMisstatement: 60000000
  });
  assert.equal(ev0.acceptable, true);
  assert.ok(Math.abs(ev0.governingUML - 60000000) < 1e-6, '誤謬0件なら UML = TM ちょうど');

  const ev1 = evaluateMonetaryResults({
    SI: withZero.samplingInterval, RIA: 0.10,
    misstatements: [{ bookValue: 8000000, auditValue: 7999999 }],
    tolerableMisstatement: 60000000
  });
  assert.equal(ev1.acceptable, false, '誤謬1円で受入不可にならない');
});

/* ==========================================================================
 * 文献適合性: 高田敏文「固有リスクの評価 ―ベイズの定理を使った評価方法の検討―」
 *             現代監査 No.14 (2004.3) pp.32-39
 * 式(1) AR = IR × CR × DR / 式(4) DR = AR ÷ (IR × CR) / 第1表 DRマトリックス
 * ========================================================================== */

test('文献適合: 論文 式(4) DR = AR ÷ (IR × CR) と一致する', () => {
  const cases = [
    { AR: 0.01, IR: 0.5, CR: 0.2, DR: 0.1 },    // 本文の数値例
    { AR: 0.03, IR: 0.4, CR: 1, DR: 0.075 },     // 第1表
    { AR: 0.05, IR: 0.5, CR: 1, DR: 0.1 },
    { AR: 0.01, IR: 1.0, CR: 1, DR: 0.01 },
    { AR: 0.10, IR: 0.1, CR: 1, DR: 1.0 },
    { AR: 0.07, IR: 0.7, CR: 1, DR: 0.1 },
    { AR: 0.02, IR: 0.2, CR: 1, DR: 0.1 },
    { AR: 0.09, IR: 0.9, CR: 1, DR: 0.1 }
  ];
  for (const c of cases) {
    const r = calculateRiskModel({ AR: c.AR, IR: c.IR, CR: c.CR, ROO: 0.10 });
    assert.ok(Math.abs(r.DR - c.DR) < 1e-12,
      `AR=${c.AR} IR=${c.IR} CR=${c.CR}: 論文 ${c.DR} / 実装 ${r.DR}`);
  }
});

test('文献適合: 式(1) AR = IR × CR × DR に戻せる（逆算の整合）', () => {
  for (const AR of [0.01, 0.03, 0.05, 0.10]) {
    for (const IR of [0.2, 0.5, 0.7, 1.0]) {
      for (const CR of [0.2, 0.5, 1.0]) {
        const r = calculateRiskModel({ AR, IR, CR, ROO: 0.10 });
        // DR は未クリップの発見リスク。式(1) に戻すと AR が復元できること
        assert.ok(Math.abs(IR * CR * r.DR - AR) < 1e-12,
          `IR×CR×DR が AR に戻らない: AR=${AR} IR=${IR} CR=${CR}`);
      }
    }
  }
});

test('文献適合: クリップは DR ではなく RIA に対してのみ適用される', () => {
  // 論文の第1表は DR を 1.0 まで切り詰めずに提示している。
  // 実装も DR は生値を保持し、クリップは実証手続に渡す RIA にのみ適用する。
  const r = calculateRiskModel({ AR: 0.10, IR: 0.1, CR: 1, ROO: 0.10 });
  assert.ok(Math.abs(r.DR - 1.0) < 1e-12, 'DR が切り詰められている');
  assert.equal(r.RIA, 0.20, 'RIA は上限20%に収まるべき');
  assert.equal(r.clamped, true);
  assert.ok(Math.abs(r.clampedFrom - 1.0) < 1e-12, 'クリップ前の値を保持していない');
});

/* ==========================================================================
 * 文献適合: 監査基準報告書530 研究文書第1号「監査と統計サンプリング」
 *           （日本公認会計士協会 1984.10.8 制定 / 2022.10.13 改正）
 * 6-7「サンプル抽出間隔以上のサンプルから発生したエラーは、そのすべてが
 *      サンプル項目として抽出されていますので、上限精度の増加高はありません」
 * ========================================================================== */

test('文献適合: 簿価 ≥ SI の項目は増分許容誤謬の対象外（研究文書第1号 6-7）', () => {
  // 設問6-8 の設例（単位: 千円）
  const SI = 120000;
  const RIA = 0.05;
  const r = evaluateMonetaryResults({
    SI, RIA,
    misstatements: [
      { bookValue: 2000, auditValue: 2000 - 180 },       // taint 9%
      { bookValue: 6000, auditValue: 6000 - 60 },        // taint 1%
      { bookValue: 121000, auditValue: 121000 - 1000 }   // 簿価 ≥ SI
    ]
  });
  const o = r.overstatement;

  // 推定誤謬額の合計は高額項目の実額を含めて 13,000
  assert.ok(Math.abs(o.projectedMisstatement - 13000) < 1, `Σ推定誤謬 ${o.projectedMisstatement}`);

  // 高額項目は増分の対象外。正確ポアソンで 8,742
  //（文献値 8,760 は信頼係数表を 4.75 / 6.30 に丸めた場合の値）
  assert.ok(Math.abs(o.incrementalAllowance - 8742) < 2,
    `増分許容誤謬 ${o.incrementalAllowance}（高額項目を除外していない疑い）`);

  assert.equal(o.sampledCount, 2);
  assert.equal(o.highValueCount, 1);

  const high = o.detail.find(d => d.highValue);
  assert.ok(high, '高額項目が detail に含まれていない');
  assert.equal(high.incrementalAllowance, 0, '高額項目に増分が割り当てられている');
  assert.equal(high.rank, null, '高額項目にランクが付いている');
  assert.ok(Math.abs(high.projectedError - 1000) < 1e-6, '高額項目は実額であるべき');

  // 文献の信頼係数表（丸め値）を使えば厳密に 8,760 になること
  const rounded = (4.75 - 3 - 1) * 10800 + (6.30 - 4.75 - 1) * 1200;
  assert.ok(Math.abs(rounded - 8760) < 1, `丸め表での再現 ${rounded}`);
});

test('文献適合: 高額項目を増分に含めると常に過大になる（過小にはならない）', () => {
  const SI = 1000000;
  const RIA = 0.10;
  const cf = (k) => engine.math.poissonConfidenceFactor(k, RIA);

  // 旧ロジック（全項目を taint 降順でランク付け）を再現する参照実装
  const legacyIncremental = (items) => {
    const p = items
      .map((it) => {
        const t = Math.min(1, it.err / it.bv);
        return { t, p: it.bv >= SI ? it.err : t * SI };
      })
      .sort((a, b) => (b.t !== a.t ? b.t - a.t : b.p - a.p));
    return p.reduce((s, x, j) => s + (cf(j + 1) - cf(j) - 1) * x.p, 0);
  };

  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  for (let trial = 0; trial < 500; trial++) {
    const n = 2 + Math.floor(rnd() * 4);
    const items = [];
    for (let i = 0; i < n; i++) {
      const high = rnd() < 0.4;
      const bv = Math.round(high ? SI * (1 + rnd() * 2) : SI * rnd() * 0.9);
      items.push({ bv, err: Math.round(bv * (0.02 + rnd() * 0.95)) });
    }
    const current = evaluateMonetaryResults({
      SI, RIA,
      misstatements: items.map((i) => ({ bookValue: i.bv, auditValue: i.bv - i.err }))
    }).overstatement.incrementalAllowance;

    assert.ok(current <= legacyIncremental(items) + 1,
      `修正後が旧実装を上回った（想定外）: ${current} > ${legacyIncremental(items)}`);
  }
});

/* ==========================================================================
 * 文献適合: 拡大係数・統制リスク・上限の開示
 * ========================================================================== */

test('文献適合: 拡大係数の標準表（研究文書第1号 6-4 と整合）', () => {
  const f = engine.math.standardExpansionFactor;
  // 研究文書第1号 6-4 の設例: 信頼度75%（リスク25%）→ 拡張係数 1.25
  assert.ok(Math.abs(f(0.25) - 1.25) < 1e-9, '設例の 1.25 を再現しない');
  // 標準表の主要点
  assert.ok(Math.abs(f(0.01) - 1.90) < 1e-9);
  assert.ok(Math.abs(f(0.05) - 1.60) < 1e-9, 'EF=1.6 はリスク5%に対応する');
  assert.ok(Math.abs(f(0.10) - 1.50) < 1e-9, 'リスク10%は 1.5 であって 1.6 ではない');
  assert.ok(Math.abs(f(0.20) - 1.30) < 1e-9);
  // 単調減少
  let prev = Infinity;
  for (const r of [0.01, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.37, 0.50]) {
    assert.ok(f(r) <= prev, '拡大係数がリスクに対して単調減少でない');
    prev = f(r);
  }
});

test('固定 EF=1.6 と標準表のずれを向き付きで警告する', () => {
  const mk = (RIA) => calculateMonetarySampling({
    BV: 5e8, TM: 15e6, EM: 3e6, RIA, accountType: 'bs'
  }).warnings.find(w => w.includes('拡大係数'));

  assert.ok(/不足/.test(mk(0.01)), 'RIA<5% では取り置き不足を警告すべき');
  assert.equal(mk(0.05), undefined, 'RIA=5% では拡大係数の警告は不要');
  assert.ok(/保守側/.test(mk(0.10)), 'RIA>5% では保守側である旨を示すべき');
  assert.ok(/保守側/.test(mk(0.20)));
});

test('文献適合: CR < 1.00 は運用評価手続の実施が前提である旨を警告（監基報315 第33項）', () => {
  const withControls = calculateRiskModel({ AR: 0.05, IR: 1, CR: 0.5, ROO: 0.10 });
  assert.ok(withControls.warnings.some(w => w.includes('運用評価手続')),
    'CR<1 なのに統制テストの前提を警告していない');
  assert.ok(withControls.warnings.some(w => w.includes('315')));

  const noControls = calculateRiskModel({ AR: 0.05, IR: 1, CR: 1, ROO: 0.10 });
  assert.ok(!noControls.warnings.some(w => w.includes('運用評価手続')),
    'CR=1 なのに警告が出ている');
});

test('PL の10%上限が効いたときは信頼水準未達を警告する', () => {
  // 母集団件数が小さく 10% 上限が算定値を下回るケース
  const r = calculateMonetarySampling({
    BV: 1e9, TM: 5e6, EM: 0, RIA: 0.05,
    accountType: 'pl', transactionCount: 3000
  });
  assert.equal(r.capApplied, '母集団件数の10%');
  assert.ok(r.warnings.some(w => w.includes('信頼水準は達成されません')),
    '10%上限の警告が出ていない');
});

/* ==========================================================================
 * 文献適合: 監査・保証実務委員会報告第82号 付録2「統計的サンプル数の例示」
 *           （予想逸脱率0%・サンプリングリスク10%＝信頼度90%）
 * ========================================================================== */

test('文献適合: 第82号 付録2 のサンプル数表を再現する', () => {
  const table = {
    0.02: 114, 0.03: 76, 0.04: 57, 0.05: 45, 0.06: 38,
    0.07: 32, 0.08: 28, 0.09: 25, 0.10: 22, 0.15: 15, 0.20: 11
  };
  for (const [rate, expected] of Object.entries(table)) {
    const r = calculateAttributeSampling({
      frequency: 'daily', populationSize: 100000,
      expectedDeviations: 0, tolerableRate: Number(rate), ROO: 0.10
    });
    assert.equal(r.sampleSize, expected,
      `許容逸脱率 ${Number(rate) * 100}%: 第82号 ${expected}件 / 実装 ${r.sampleSize}件`);
  }
});

test('文献適合: 慣行表にない許容逸脱率も正確二項の導出で第82号と一致する', () => {
  // 2/3/4/6/8/10/15/20% は CONVENTIONAL_TABLE_ROO10 に存在せず、導出経路を通る
  const derivedRates = [0.02, 0.03, 0.04, 0.06, 0.08, 0.10, 0.15, 0.20];
  const expected = { 0.02: 114, 0.03: 76, 0.04: 57, 0.06: 38, 0.08: 28, 0.10: 22, 0.15: 15, 0.20: 11 };
  for (const rate of derivedRates) {
    const r = calculateAttributeSampling({
      frequency: 'daily', populationSize: 100000,
      expectedDeviations: 0, tolerableRate: rate, ROO: 0.10
    });
    assert.equal(r.derivedFromExactBinomial, true, `${rate} は導出経路を通るはず`);
    assert.equal(r.sampleSize, expected[rate]);
  }
});

test('文献適合: 内部統制実施基準の「90%の信頼度で25件」と整合する', () => {
  // 財務報告に係る内部統制の評価及び監査に関する実施基準 III.4(2)①ロa:
  // 「日常反復継続する取引について、統計上の二項分布を前提とすると、90%の信頼度を
  //   得るには、評価対象となる統制上の要点ごとに少なくとも25件のサンプルが必要になる。」
  const r = calculateAttributeSampling({
    frequency: 'daily', populationSize: 100000,
    expectedDeviations: 0, tolerableRate: 0.09, ROO: 0.10
  });
  assert.equal(r.sampleSize, 25);
  assert.equal(r.statistical, true);
  // 信頼度90% = 過信リスク10% で、上限逸脱率が許容逸脱率9%以下に収まること
  const ev = evaluateAttributeResults({ sampleSize: 25, deviations: 0, tolerableRate: 0.09, ROO: 0.10 });
  assert.ok(ev.upperDeviationLimit <= 0.09);
  assert.equal(ev.effective, true);
});

/* ==========================================================================
 * 初心者レビューで発見された欠陥の再発検知
 * ========================================================================== */

test('BS でも必要サンプル数が母集団件数を超えたら全件化して警告する', () => {
  // 修正前はこの全件化が PL ブロック内にあり、BS では母集団件数を超える件数が
  // そのまま表示され、警告も出なかった。
  const bs = calculateMonetarySampling({
    BV: 500000000, TM: 5000000, EM: 0, RIA: 0.05,
    accountType: 'bs', transactionCount: 60
  });
  assert.equal(bs.sampleSize, 60, '母集団件数で頭打ちになっていない');
  assert.equal(bs.fullPopulation, true);
  assert.ok(bs.warnings.some(w => w.includes('全件を対象とします')), 'BS で全件化の警告が出ていない');
  assert.ok(bs.warnings.some(w => w.includes('精査')), '精査として設計する旨の案内がない');

  // PL でも従来どおり働くこと
  const pl = calculateMonetarySampling({
    BV: 500000000, TM: 5000000, EM: 0, RIA: 0.05,
    accountType: 'pl', transactionCount: 60
  });
  assert.equal(pl.sampleSize, 60);
  assert.equal(pl.fullPopulation, true);

  // 母集団件数に余裕があれば全件化しない
  const ample = calculateMonetarySampling({
    BV: 500000000, TM: 5000000, EM: 0, RIA: 0.05,
    accountType: 'bs', transactionCount: 100000
  });
  assert.equal(ample.fullPopulation, false);
  assert.ok(!ample.warnings.some(w => w.includes('全件を対象とします')));
});

test('網羅性を選ぶと金額単位サンプリングが不向きである旨を警告する', () => {
  // MUS は計上済み母集団から金額比例で抽出するため、計上漏れの検証には構造的に向かない
  for (const accountType of ['bs', 'pl']) {
    const r = calculateMonetarySampling({
      BV: 500000000, TM: 15000000, EM: 0, RIA: 0.10,
      accountType, assertion: 'completeness', transactionCount: 100000
    });
    assert.ok(r.warnings.some(w => w.includes('網羅性')),
      `${accountType}: 網羅性の警告が出ていない`);
    assert.ok(r.warnings.some(w => w.includes('計上漏れ')));
  }

  const occurrence = calculateMonetarySampling({
    BV: 500000000, TM: 15000000, EM: 0, RIA: 0.10,
    accountType: 'bs', assertion: 'occurrence', transactionCount: 100000
  });
  assert.ok(!occurrence.warnings.some(w => w.includes('計上漏れ')),
    '実在性なのに網羅性の警告が出ている');
});

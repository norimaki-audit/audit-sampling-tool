(function(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.AuditSamplingCalculations = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const ATTRIBUTE_SAMPLE_SIZE_TABLE = Object.freeze({
    '0.05': Object.freeze({ 0: 45, 1: 77, 2: 116 }),
    '0.07': Object.freeze({ 0: 32, 1: 55, 2: 77 }),
    '0.09': Object.freeze({ 0: 25, 1: 42, 2: 58 })
  });

  const PL_CONFIDENCE_FACTORS = Object.freeze({
    0.90: 1.65,
    0.95: 1.96,
    0.99: 2.58
  });

  function toFiniteNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function calculateAttributeSampling(input) {
    const settings = input || {};
    const frequency = settings.frequency || 'daily';
    const populationSize = Math.max(0, Math.floor(toFiniteNumber(settings.populationSize, 0)));
    const expectedDeviations = Math.max(0, Math.min(2, Math.floor(toFiniteNumber(settings.expectedDeviations, 0))));
    const tolerableRate = toFiniteNumber(settings.tolerableRate, 0.09);
    const tenPercentRule = Math.max(2, Math.ceil(populationSize * 0.1));

    let sampleSize = 25;
    let allowableDeviations = 0;
    let additionalSamples = 17;
    let basis = '基準表による統計的サンプリング';

    if (frequency === 'daily' || populationSize >= 250) {
      const rateKey = tolerableRate.toFixed(2);
      const row = ATTRIBUTE_SAMPLE_SIZE_TABLE[rateKey];
      if (row && row[expectedDeviations] !== undefined) {
        sampleSize = row[expectedDeviations];
      }
      allowableDeviations = expectedDeviations;

      if (tolerableRate === 0.05) {
        additionalSamples = 32;
      } else if (tolerableRate === 0.07) {
        additionalSamples = 23;
      }
    } else if (frequency === 'weekly') {
      sampleSize = Math.min(5, populationSize);
      basis = '週次統制の頻度別基準';
    } else if (frequency === 'monthly') {
      sampleSize = Math.max(2, Math.min(3, populationSize));
      basis = '月次統制の頻度別基準';
    } else if (frequency === 'quarterly') {
      sampleSize = Math.min(1, populationSize);
      basis = '四半期統制の頻度別基準';
    } else if (frequency === 'annually') {
      sampleSize = 1;
      basis = '年次統制の全件確認';
    } else {
      sampleSize = Math.min(25, Math.max(2, tenPercentRule));
      basis = '母集団の10%を用いる頻度別基準';
    }

    const fullPopulation = populationSize < sampleSize;
    if (fullPopulation) {
      sampleSize = populationSize;
      basis = '母集団が基準件数より少ないため全件確認';
    }

    const expectedRateReference = sampleSize > 0 ? expectedDeviations / sampleSize : 0;

    return {
      frequency,
      populationSize,
      expectedDeviations,
      tolerableRate,
      tenPercentRule,
      sampleSize,
      allowableDeviations,
      additionalSamples,
      fullPopulation,
      basis,
      expectedRateReference,
      expectedAtOrAboveTolerable: sampleSize > 0 && expectedRateReference >= tolerableRate
    };
  }

  function calculatePLSampling(input) {
    const settings = input || {};
    const transactionCount = Math.max(0, Math.floor(toFiniteNumber(settings.transactionCount, 0)));
    const totalAmount = Math.max(0, toFiniteNumber(settings.totalAmount, 0));
    const materiality = Math.max(0, toFiniteNumber(settings.materiality, 0));
    const confidenceLevel = toFiniteNumber(settings.confidenceLevel, 0.95);
    const riskLevel = settings.riskLevel || 'low';
    const assertionType = settings.assertionType || 'occurrence';
    const samplingMethod = settings.samplingMethod || 'systematic';

    if (transactionCount <= 0 || totalAmount <= 0 || materiality <= 0) {
      return { valid: false, sampleSize: 0 };
    }

    const expectedErrorRates = { low: 0.005, medium: 0.01, high: 0.02 };
    const baseSampleRates = { low: 0.0075, medium: 0.015, high: 0.025 };
    const minSamples = { low: 30, medium: 60, high: 90 };
    const tolerableErrorRate = materiality / totalAmount;
    const expectedErrorRate = expectedErrorRates[riskLevel];
    const confidenceAdjustment = PL_CONFIDENCE_FACTORS[confidenceLevel] / 1.96;

    let sampleSize = Math.max(
      Math.ceil(transactionCount * baseSampleRates[riskLevel]),
      minSamples[riskLevel]
    );
    sampleSize = Math.ceil(sampleSize * confidenceAdjustment);

    let materialityAdjustment = 1;
    if (!settings.ignoreMaterialityAdjustment) {
      if (tolerableErrorRate < 0.01) {
        materialityAdjustment = 1.5;
      } else if (tolerableErrorRate < 0.02) {
        materialityAdjustment = 1.2;
      } else if (tolerableErrorRate > 0.05) {
        materialityAdjustment = 0.8;
      }
      sampleSize = Math.ceil(sampleSize * materialityAdjustment);
    }

    if (assertionType === 'completeness') {
      sampleSize = Math.ceil(sampleSize * 1.5);
    }

    if (samplingMethod === 'stratified' && !settings.ignoreStratification) {
      sampleSize = Math.ceil(sampleSize * 0.85);
    }

    const maxSampleSize = Math.min(Math.ceil(transactionCount * 0.1), 500);
    sampleSize = Math.min(sampleSize, maxSampleSize);

    return {
      valid: true,
      sampleSize,
      transactionCount,
      totalAmount,
      materiality,
      confidenceLevel,
      riskLevel,
      assertionType,
      samplingMethod,
      tolerableErrorRate,
      expectedErrorRate,
      confidenceAdjustment,
      materialityAdjustment,
      averageTransaction: totalAmount / transactionCount,
      specificThreshold: materiality * 0.5
    };
  }

  return Object.freeze({
    ATTRIBUTE_SAMPLE_SIZE_TABLE,
    PL_CONFIDENCE_FACTORS,
    calculateAttributeSampling,
    calculatePLSampling
  });
});

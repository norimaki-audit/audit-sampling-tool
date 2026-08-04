const assert = require('node:assert/strict');
const {
  calculateAttributeSampling,
  calculatePLSampling
} = require('../calculations.js');

const attributeCases = [
  [{ frequency: 'daily', populationSize: 1000, expectedDeviations: 0, tolerableRate: 0.09 }, 25],
  [{ frequency: 'daily', populationSize: 1000, expectedDeviations: 1, tolerableRate: 0.09 }, 42],
  [{ frequency: 'daily', populationSize: 1000, expectedDeviations: 0, tolerableRate: 0.07 }, 32],
  [{ frequency: 'daily', populationSize: 1000, expectedDeviations: 0, tolerableRate: 0.05 }, 45],
  [{ frequency: 'weekly', populationSize: 52, expectedDeviations: 0, tolerableRate: 0.09 }, 5],
  [{ frequency: 'monthly', populationSize: 12, expectedDeviations: 0, tolerableRate: 0.09 }, 3],
  [{ frequency: 'quarterly', populationSize: 4, expectedDeviations: 0, tolerableRate: 0.09 }, 1],
  [{ frequency: 'annually', populationSize: 1, expectedDeviations: 0, tolerableRate: 0.09 }, 1]
];

for (const [input, expected] of attributeCases) {
  assert.equal(calculateAttributeSampling(input).sampleSize, expected);
}

const defaultPL = calculatePLSampling({
  transactionCount: 10000,
  totalAmount: 1000000000,
  materiality: 20000000,
  confidenceLevel: 0.95,
  riskLevel: 'low',
  assertionType: 'occurrence',
  samplingMethod: 'systematic'
});

assert.equal(defaultPL.sampleSize, 75);
assert.equal(defaultPL.materialityAdjustment, 1);
assert.equal(defaultPL.confidenceAdjustment, 1);

const highConfidencePL = calculatePLSampling({
  transactionCount: 10000,
  totalAmount: 1000000000,
  materiality: 20000000,
  confidenceLevel: 0.99,
  riskLevel: 'low',
  assertionType: 'occurrence',
  samplingMethod: 'systematic'
});

assert.equal(highConfidencePL.sampleSize, 99);
assert.ok(highConfidencePL.sampleSize > defaultPL.sampleSize);

console.log('Calculation regression tests passed.');

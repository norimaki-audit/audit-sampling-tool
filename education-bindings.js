(function() {
  'use strict';

  const calculations = window.AuditSamplingCalculations;
  const originalCalculateAttributeSampling = window.calculateAttributeSampling;

  if (!calculations || typeof originalCalculateAttributeSampling !== 'function') return;

  function readCurrentInputs() {
    return {
      frequency: document.getElementById('controlFrequency')?.value || 'daily',
      populationSize: window.parseNumber(document.getElementById('populationSize')?.value || 0),
      expectedDeviations: Number(document.getElementById('expectedDeviations')?.value || 0),
      tolerableRate: Number(document.getElementById('tolerableRateNew')?.value || 0.09)
    };
  }

  window.calculateAttributeSampling = function() {
    const output = originalCalculateAttributeSampling.apply(this, arguments);
    const result = calculations.calculateAttributeSampling(readCurrentInputs());
    if (window.updateAttributeLearning) window.updateAttributeLearning(result);
    return output;
  };
})();

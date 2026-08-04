(function() {
  'use strict';

  const calculations = window.AuditSamplingCalculations;
  if (!calculations) return;

  const frequencyLabels = {
    daily: '日次・随時',
    weekly: '週次',
    monthly: '月次',
    quarterly: '四半期',
    annually: '年次'
  };

  function formatInteger(value) {
    return Number.isFinite(value) ? Math.round(value).toLocaleString('ja-JP') : '—';
  }

  function readInputs() {
    return {
      frequency: document.getElementById('controlFrequency')?.value || 'daily',
      populationSize: window.parseNumber(document.getElementById('populationSize')?.value || 0),
      expectedDeviations: Number(document.getElementById('expectedDeviations')?.value || 0),
      tolerableRate: Number(document.getElementById('tolerableRateNew')?.value || 0.09)
    };
  }

  window.calculateAttributeSampling = function() {
    const result = calculations.calculateAttributeSampling(readInputs());
    const alert = document.getElementById('attrAlert');

    document.getElementById('attrFrequency').textContent = frequencyLabels[result.frequency] || result.frequency;
    document.getElementById('attrPopulation').textContent = formatInteger(result.populationSize);
    document.getElementById('attr10Percent').textContent = formatInteger(result.tenPercentRule) + '件';
    document.getElementById('sampleSizeAdj').textContent = formatInteger(result.sampleSize);
    document.getElementById('allowableDeviations').textContent = formatInteger(result.allowableDeviations);
    document.getElementById('additionalSamples').textContent = result.sampleSize >= 25 ? formatInteger(result.additionalSamples) : 'N/A';

    if (alert) {
      if (result.fullPopulation) {
        alert.style.display = 'block';
        alert.textContent = '母集団が推奨サンプル数より少ないため、全件を対象とします。';
      } else {
        alert.style.display = 'none';
      }
    }

    if (window.updateAttributeLearning) window.updateAttributeLearning(result);
    return result;
  };
})();

(function() {
  'use strict';

  function syncRangeOutputs() {
    const population = window.parseNumber(document.getElementById('populationSize')?.value || 0);
    const populationRange = document.getElementById('populationSizeRange');
    if (populationRange) {
      populationRange.value = String(Math.max(1, Math.min(10000, population)));
      populationRange.nextElementSibling.value = population.toLocaleString('ja-JP') + '件';
    }

    const expectedValue = document.getElementById('expectedDeviations')?.value || '0';
    const expectedRange = document.getElementById('expectedDeviationsRange');
    if (expectedRange) {
      expectedRange.value = expectedValue;
      expectedRange.nextElementSibling.value = expectedValue + '件';
    }

    const tolerableValue = Math.round(Number(document.getElementById('tolerableRateNew')?.value || 0.09) * 100);
    const tolerableRange = document.getElementById('tolerableRateRange');
    if (tolerableRange) {
      tolerableRange.value = String(tolerableValue);
      tolerableRange.nextElementSibling.value = tolerableValue + '%';
    }

    const confidenceValue = document.getElementById('confidenceLevel')?.value || '0.90';
    const confidenceValues = ['0.90', '0.95', '0.99'];
    const confidenceRange = document.getElementById('confidenceLevelRange');
    if (confidenceRange) {
      const confidenceIndex = Math.max(0, confidenceValues.indexOf(confidenceValue));
      confidenceRange.value = String(confidenceIndex);
      confidenceRange.nextElementSibling.value = Math.round(Number(confidenceValue) * 100) + '%';
    }
  }

  function alignMonthlyReferenceTable() {
    const rows = Array.from(document.querySelectorAll('#attribute-tab .sample-table tbody tr'));
    const monthlyRow = rows.find(function(row) {
      return row.cells[0]?.textContent.trim() === '月次';
    });
    if (!monthlyRow) return;
    monthlyRow.cells[2].textContent = '2〜3件';
    monthlyRow.cells[3].textContent = '頻度別基準（母集団上限）';
  }

  function showNeutralInitialCheck() {
    const checkedCount = document.querySelectorAll('[data-full-check]:checked').length;
    const result = document.getElementById('fullAnalysisCheckResult');
    if (checkedCount === 0 && result) {
      result.className = 'check-result';
      result.innerHTML = '<strong>当てはまる項目を選択してください</strong><span>回答に応じて、全件分析と個別確認の組合せを検討する観点を表示します。</span>';
    }
  }

  function initializeCompatibilityFixes() {
    alignMonthlyReferenceTable();
    syncRangeOutputs();
    showNeutralInitialCheck();

    ['populationSize', 'expectedDeviations', 'tolerableRateNew', 'confidenceLevel'].forEach(function(id) {
      document.getElementById(id)?.addEventListener('change', syncRangeOutputs);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCompatibilityFixes);
  } else {
    initializeCompatibilityFixes();
  }
})();

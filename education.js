(function() {
  'use strict';

  const NOTE_ARTICLE_URL = '';
  const calculations = window.AuditSamplingCalculations;
  const svgNamespace = 'http://www.w3.org/2000/svg';
  let previousAttributeResult = null;
  let sensitivityFactor = 'population';

  function formatInteger(value) {
    return Number.isFinite(value) ? Math.round(value).toLocaleString('ja-JP') : '—';
  }

  function formatRate(value) {
    return Number.isFinite(value) ? (value * 100).toFixed(value * 100 % 1 ? 1 : 0) + '%' : '—';
  }

  function readNumber(id) {
    const element = document.getElementById(id);
    if (!element) return 0;
    return window.parseNumber ? window.parseNumber(element.value) : Number(String(element.value).replace(/,/g, ''));
  }

  function readMoney(id) {
    const element = document.getElementById(id);
    if (!element) return 0;
    return window.parseMoney ? window.parseMoney(element.value) : Number(String(element.value).replace(/,/g, ''));
  }

  function getAttributeInputs() {
    return {
      frequency: document.getElementById('controlFrequency')?.value || 'daily',
      populationSize: readNumber('populationSize'),
      expectedDeviations: Number(document.getElementById('expectedDeviations')?.value || 0),
      tolerableRate: Number(document.getElementById('tolerableRateNew')?.value || 0.09)
    };
  }

  function getPLInputs(confidenceLevel) {
    return {
      transactionCount: readNumber('plTransactionCount'),
      totalAmount: readMoney('plTotalAmount'),
      materiality: readMoney('plMateriality'),
      confidenceLevel: confidenceLevel ?? Number(document.getElementById('plConfidenceLevel')?.value || 0.95),
      riskLevel: document.getElementById('plRiskLevel')?.value || 'low',
      assertionType: document.getElementById('plAssertionType')?.value || 'occurrence',
      samplingMethod: document.getElementById('plSamplingMethod')?.value || 'systematic',
      ignoreMaterialityAdjustment: Boolean(document.getElementById('ignoreMaterialityAdjustment')?.checked),
      ignoreStratification: Boolean(document.getElementById('ignoreStratification')?.checked)
    };
  }

  function setList(id, items, emptyText) {
    const list = document.getElementById(id);
    if (!list) return;
    list.replaceChildren();
    const values = items.length ? items : [emptyText];
    values.forEach(function(item) {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
  }

  function buildReasonSummary(result) {
    if (result.populationSize <= 0) {
      return '母集団件数を1件以上で入力すると、件数の根拠を表示します。';
    }

    if (result.fullPopulation) {
      return `母集団が${formatInteger(result.populationSize)}件と基準件数より少ないため、母集団全体を確認する結果です。これは入力条件に基づく目安であり、手続の十分性は別途判断が必要です。`;
    }

    if (result.frequency !== 'daily' && result.populationSize < 250) {
      return `${result.basis}を適用しました。統制頻度と母集団${formatInteger(result.populationSize)}件を踏まえ、必要サンプル数は${formatInteger(result.sampleSize)}件となりました。`;
    }

    return `統制テストの90%信頼度を前提とする基準表を使用しています。許容逸脱率${formatRate(result.tolerableRate)}、予想逸脱${result.expectedDeviations}件の条件から、必要サンプル数は${formatInteger(result.sampleSize)}件となりました。`;
  }

  function buildFactorLists(result) {
    const increase = [];
    const decrease = [];

    if (result.tolerableRate <= 0.05) {
      increase.push('許容逸脱率が低く、厳しい判定条件です');
    } else if (result.tolerableRate >= 0.09) {
      decrease.push('許容逸脱率に比較的余裕があります');
    }

    if (result.expectedDeviations >= 1) {
      increase.push(`予想逸脱を${result.expectedDeviations}件見込んでいます`);
    } else {
      decrease.push('予想逸脱を0件としています');
    }

    if (result.expectedRateReference > 0 && result.tolerableRate - result.expectedRateReference <= 0.03) {
      increase.push('予想逸脱の参考率と許容逸脱率の差が小さくなっています');
    }

    if (result.populationSize < 250) {
      decrease.push('母集団が250件未満の頻度別基準です');
    }

    return { increase, decrease };
  }

  function findChangedAttribute(previous, current) {
    const labels = {
      frequency: '統制頻度',
      populationSize: '母集団件数',
      expectedDeviations: '予想逸脱件数',
      tolerableRate: '許容逸脱率'
    };

    return Object.keys(labels).find(function(key) {
      return previous[key] !== current[key];
    });
  }

  function renderComparison(previous, current) {
    const panel = document.getElementById('conditionComparison');
    if (!panel || !previous) return;

    const changedKey = findChangedAttribute(previous, current);
    if (!changedKey) return;

    const labelMap = {
      frequency: '統制頻度',
      populationSize: '母集団件数',
      expectedDeviations: '予想逸脱件数',
      tolerableRate: '許容逸脱率'
    };
    const valueFormatters = {
      frequency: function(value) {
        return { daily: '日次・随時', weekly: '週次', monthly: '月次', quarterly: '四半期', annually: '年次' }[value] || value;
      },
      populationSize: function(value) { return formatInteger(value) + '件'; },
      expectedDeviations: function(value) { return value + '件'; },
      tolerableRate: formatRate
    };

    document.getElementById('comparisonChangedLabel').textContent = labelMap[changedKey];
    document.getElementById('comparisonBeforeCondition').textContent = valueFormatters[changedKey](previous[changedKey]);
    document.getElementById('comparisonBeforeSample').textContent = formatInteger(previous.sampleSize) + '件';
    document.getElementById('comparisonAfterCondition').textContent = valueFormatters[changedKey](current[changedKey]);
    document.getElementById('comparisonAfterSample').textContent = formatInteger(current.sampleSize) + '件';

    const difference = current.sampleSize - previous.sampleSize;
    let explanation = 'この変更では、必要サンプル数は変わりませんでした。';
    if (difference !== 0) {
      const direction = difference > 0 ? '増加' : '減少';
      const reasons = {
        populationSize: '母集団規模に対応する基準が変わったため',
        expectedDeviations: difference > 0 ? '予想される逸脱が増え、より多くの確認が必要になったため' : '予想される逸脱が減ったため',
        tolerableRate: difference > 0 ? '許容できる逸脱を少なくし、より厳しい確認が必要になったため' : '許容逸脱率に比較的余裕を持たせたため',
        frequency: '統制頻度に対応する基準が変わったため'
      };
      explanation = `${reasons[changedKey]}、必要サンプル数が${formatInteger(Math.abs(difference))}件${direction}しました。`;
    }
    document.getElementById('comparisonExplanation').textContent = explanation;
    panel.hidden = false;
  }

  function renderAttributeLearning(result) {
    const number = document.getElementById('sampleSizeHero');
    const summary = document.getElementById('sampleReasonSummary');
    if (number) number.textContent = formatInteger(result.sampleSize);
    if (summary) summary.textContent = buildReasonSummary(result);

    const factors = buildFactorLists(result);
    setList('increaseFactors', factors.increase, 'この条件で明確な増加要因はありません');
    setList('decreaseFactors', factors.decrease, 'この条件で明確な減少要因はありません');

    const basis = document.getElementById('attributeBasisText');
    if (basis) {
      basis.textContent = `${result.basis}。計算では端数を切り上げ、基準件数が母集団を超える場合は母集団件数を上限とします。`;
    }

    const warning = document.getElementById('attributeInputWarning');
    const populationInput = document.getElementById('populationSize');
    if (warning) {
      if (result.populationSize <= 0) {
        warning.textContent = '母集団件数は1件以上で入力してください。';
        warning.hidden = false;
        populationInput?.setAttribute('aria-invalid', 'true');
      } else if (result.expectedAtOrAboveTolerable) {
        warning.textContent = '予想逸脱件数からみた参考率が許容逸脱率以上です。統制への依拠方針やテスト方法自体を再検討する必要がある可能性があります。';
        warning.hidden = false;
        populationInput?.removeAttribute('aria-invalid');
      } else {
        warning.hidden = true;
        populationInput?.removeAttribute('aria-invalid');
      }
    }

    if (previousAttributeResult) {
      renderComparison(previousAttributeResult, result);
    }
    previousAttributeResult = Object.assign({}, result);
    drawSensitivityChart();
  }

  window.updateAttributeLearning = renderAttributeLearning;

  window.syncLearningControl = function(type, rawValue) {
    if (type === 'population') {
      const population = document.getElementById('populationSize');
      population.value = Number(rawValue).toLocaleString('ja-JP');
      window.calculateAttributeSampling();
      return;
    }

    if (type === 'expected') {
      document.getElementById('expectedDeviations').value = String(rawValue);
      window.calculateAttributeSampling();
      return;
    }

    if (type === 'tolerable') {
      document.getElementById('tolerableRateNew').value = (Number(rawValue) / 100).toFixed(2);
      window.calculateAttributeSampling();
      return;
    }

    if (type === 'confidence') {
      const values = ['0.90', '0.95', '0.99'];
      const confidence = document.getElementById('confidenceLevel');
      confidence.value = values[Number(rawValue)] || '0.90';
      confidence.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  function syncRangeControls() {
    const populationRange = document.getElementById('populationSizeRange');
    if (populationRange) populationRange.value = String(Math.min(10000, Math.max(1, readNumber('populationSize'))));

    const expectedRange = document.getElementById('expectedDeviationsRange');
    if (expectedRange) expectedRange.value = document.getElementById('expectedDeviations')?.value || '0';

    const tolerableRange = document.getElementById('tolerableRateRange');
    if (tolerableRange) tolerableRange.value = String(Number(document.getElementById('tolerableRateNew')?.value || 0.09) * 100);
  }

  window.setLearningMode = function(mode) {
    const selectedMode = mode === 'detail' ? 'detail' : 'concise';
    document.body.dataset.learningMode = selectedMode;
    document.querySelectorAll('[data-learning-mode-button]').forEach(function(button) {
      const selected = button.dataset.learningModeButton === selectedMode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  };

  window.updateApproachSelection = function(value) {
    const summaries = {
      full: '同じ判定ルールを母集団全体へ適用できるか、元データと分析ロジックを含めて検討します。',
      specific: '高額・異常・関連当事者・期末日前後など、リスクの高い項目を定義して個別確認します。',
      statistical: '残余母集団が均質で、偏りのない抽出ができる場合に、サンプリングリスクを考慮して設計します。',
      nonstatistical: '監査目的、母集団の性質、職業的専門家としての判断を文書化して対象と件数を決めます。',
      combination: '全件分析と特定項目抽出の後に残余母集団を再定義し、必要に応じてサンプリングを検討します。'
    };
    const summary = document.getElementById('approachSelectionSummary');
    if (summary) summary.textContent = summaries[value] || '';
  };

  function updateFullPopulationCheck() {
    const checkboxes = Array.from(document.querySelectorAll('[data-full-check]'));
    const answered = checkboxes.filter(function(input) { return input.checked; }).length;
    const result = document.getElementById('fullAnalysisCheckResult');
    if (!result) return;

    result.className = 'check-result';
    if (answered >= 6) {
      result.classList.add('is-positive');
      result.innerHTML = '<strong>全件分析を適用しやすい可能性があります</strong><span>同じ判定ルールを母集団全体へ適用できる余地があります。ただし、元データの完全性・正確性と分析ロジックの妥当性は別途確認してください。</span>';
    } else if (answered >= 3) {
      result.classList.add('is-mixed');
      result.innerHTML = '<strong>全件分析と個別確認の組合せが考えられます</strong><span>機械的な条件で例外候補を抽出し、検出された項目を人が確認する方法が考えられます。</span>';
    } else {
      result.classList.add('is-caution');
      result.innerHTML = '<strong>サンプリングまたは個別判断が残りやすい状態です</strong><span>契約内容、証憑、承認の実態など、人による判断が必要な領域を整理してください。</span>';
    }
  }

  function createSvgElement(name, attributes, text) {
    const element = document.createElementNS(svgNamespace, name);
    Object.keys(attributes || {}).forEach(function(key) {
      element.setAttribute(key, attributes[key]);
    });
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function getSensitivitySeries() {
    const attributeInputs = getAttributeInputs();

    if (sensitivityFactor === 'tolerable') {
      return {
        title: '許容逸脱率を低くすると、必要サンプル数は増えやすい',
        points: [0.05, 0.07, 0.09].map(function(value) {
          const result = calculations.calculateAttributeSampling(Object.assign({}, attributeInputs, { tolerableRate: value }));
          return { label: formatRate(value), value: result.sampleSize };
        })
      };
    }

    if (sensitivityFactor === 'expected') {
      return {
        title: '予想逸脱を多く見込むほど、必要サンプル数は増えやすい',
        points: [0, 1, 2].map(function(value) {
          const result = calculations.calculateAttributeSampling(Object.assign({}, attributeInputs, { expectedDeviations: value }));
          return { label: value + '件', value: result.sampleSize };
        })
      };
    }

    if (sensitivityFactor === 'confidence') {
      return {
        title: 'PL実証手続では、信頼水準を高くすると必要サンプル数が増えやすい',
        points: [0.90, 0.95, 0.99].map(function(value) {
          const result = calculations.calculatePLSampling(getPLInputs(value));
          return { label: formatRate(value), value: result.sampleSize };
        })
      };
    }

    return {
      title: '母集団が一定規模を超えると、件数増加の影響が相対的に小さくなることがあります',
      points: [10, 25, 52, 100, 250, 500, 1000, 5000, 10000].map(function(value) {
        const result = calculations.calculateAttributeSampling(Object.assign({}, attributeInputs, { populationSize: value }));
        return { label: value >= 1000 ? value / 1000 + '千' : String(value), value: result.sampleSize };
      })
    };
  }

  function drawSensitivityChart() {
    const svg = document.getElementById('sensitivityChart');
    const summary = document.getElementById('sensitivitySummary');
    if (!svg || !summary || !calculations) return;

    const series = getSensitivitySeries();
    const width = 620;
    const height = 250;
    const margin = { top: 24, right: 22, bottom: 50, left: 52 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    const maxValue = Math.max(1, ...series.points.map(function(point) { return point.value; }));
    const yMax = Math.ceil(maxValue / 10) * 10 || 10;

    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.appendChild(createSvgElement('line', { x1: margin.left, y1: margin.top, x2: margin.left, y2: margin.top + chartHeight, class: 'chart-axis' }));
    svg.appendChild(createSvgElement('line', { x1: margin.left, y1: margin.top + chartHeight, x2: margin.left + chartWidth, y2: margin.top + chartHeight, class: 'chart-axis' }));

    [0, 0.5, 1].forEach(function(ratio) {
      const y = margin.top + chartHeight - chartHeight * ratio;
      svg.appendChild(createSvgElement('line', { x1: margin.left, y1: y, x2: margin.left + chartWidth, y2: y, class: 'chart-grid' }));
      svg.appendChild(createSvgElement('text', { x: margin.left - 9, y: y + 4, 'text-anchor': 'end', class: 'chart-label' }, formatInteger(yMax * ratio)));
    });

    const coordinates = series.points.map(function(point, index) {
      const denominator = Math.max(1, series.points.length - 1);
      return {
        x: margin.left + chartWidth * index / denominator,
        y: margin.top + chartHeight - chartHeight * point.value / yMax,
        point
      };
    });

    svg.appendChild(createSvgElement('polyline', {
      points: coordinates.map(function(item) { return `${item.x},${item.y}`; }).join(' '),
      class: 'chart-line'
    }));

    coordinates.forEach(function(item) {
      svg.appendChild(createSvgElement('circle', { cx: item.x, cy: item.y, r: 4.5, class: 'chart-point' }));
      svg.appendChild(createSvgElement('text', { x: item.x, y: item.y - 10, 'text-anchor': 'middle', class: 'chart-value' }, formatInteger(item.point.value)));
      svg.appendChild(createSvgElement('text', { x: item.x, y: margin.top + chartHeight + 22, 'text-anchor': 'middle', class: 'chart-label' }, item.point.label));
    });

    summary.textContent = series.title + '。グラフは現在の入力値を基準にした比較であり、監査判断を確定するものではありません。';
  }

  window.selectSensitivityFactor = function(factor) {
    sensitivityFactor = factor;
    document.querySelectorAll('[data-sensitivity-factor]').forEach(function(button) {
      const selected = button.dataset.sensitivityFactor === factor;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    drawSensitivityChart();
  };

  function setupNoteLink() {
    const link = document.getElementById('noteArticleLink');
    if (!link) return;
    if (NOTE_ARTICLE_URL) {
      link.href = NOTE_ARTICLE_URL;
      link.removeAttribute('aria-disabled');
      link.removeAttribute('title');
    } else {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.title = '記事公開後に education.js の NOTE_ARTICLE_URL を設定してください';
    }
  }

  function initializeEducation() {
    document.body.dataset.learningMode = 'concise';
    syncRangeControls();
    setupNoteLink();
    document.querySelectorAll('[data-full-check]').forEach(function(input) {
      input.addEventListener('change', updateFullPopulationCheck);
    });
    updateFullPopulationCheck();

    ['populationSize', 'expectedDeviations', 'tolerableRateNew'].forEach(function(id) {
      document.getElementById(id)?.addEventListener('change', syncRangeControls);
    });

    const selectedApproach = document.querySelector('input[name="auditApproach"]:checked');
    if (selectedApproach) window.updateApproachSelection(selectedApproach.value);

    if (!previousAttributeResult && calculations) {
      renderAttributeLearning(calculations.calculateAttributeSampling(getAttributeInputs()));
    }
    drawSensitivityChart();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEducation);
  } else {
    initializeEducation();
  }
})();

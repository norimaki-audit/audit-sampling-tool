/*!
 * audit-sampling-tool v3.0 — UI コントローラ
 *
 * 責務は「DOM の読み書き」だけ。計算は engine.js の純関数に委譲する。
 * このファイルに計算式を書かないこと（早見表と実装の乖離を防ぐため）。
 */
(function() {
  'use strict';

  const E = window.AuditSamplingEngine;
  if (!E) {
    document.addEventListener('DOMContentLoaded', function() {
      document.body.insertAdjacentHTML('afterbegin',
        '<div class="alert danger" style="margin:16px">engine.js の読み込みに失敗しました。</div>');
    });
    return;
  }

  /* ---------------------------------------------------------------- utils */

  const $ = (id) => document.getElementById(id);

  const state = {
    risk: null,
    attribute: null,
    monetary: null,
    attributeEval: null,
    monetaryEval: null,
    specific: null
  };

  function num(value) {
    const parsed = Number(String(value == null ? '' : value).replace(/[,\s円%]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function readNum(id) { const el = $(id); return el ? num(el.value) : 0; }
  function readStr(id) { const el = $(id); return el ? el.value : ''; }

  function money(value) {
    return Number.isFinite(value) ? E.format.group(value) : '—';
  }
  function moneyYen(value) {
    return Number.isFinite(value) ? E.format.group(value) + '円' : '—';
  }
  function intText(value) {
    return Number.isFinite(value) ? E.format.group(value) : '—';
  }
  function pctText(value, digits) {
    return Number.isFinite(value) ? E.format.pct(value, digits === undefined ? 2 : digits) : '—';
  }

  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function show(id, visible) { const el = $(id); if (el) el.hidden = !visible; }

  /** 数式1行・算定根拠・警告の共通描画 */
  function renderMeta(prefix, result) {
    const formulaEl = $(prefix + 'Formula');
    if (formulaEl) {
      formulaEl.textContent = result && result.formula ? result.formula.substituted : '—';
    }
    const basisEl = $(prefix + 'Basis');
    if (basisEl) {
      basisEl.innerHTML = result && result.basis
        ? '<strong>算定根拠:</strong> ' + escapeHtml(result.basis)
        : '';
    }
    renderWarnings(prefix + 'Warnings', result ? result.warnings : []);
  }

  function renderWarnings(id, warnings, danger) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = '';
    (warnings || []).forEach(function(text) {
      const li = document.createElement('li');
      li.textContent = text;
      if (danger) li.className = 'is-danger';
      el.appendChild(li);
    });
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function(ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function toast(message, isError) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'error-toast' + (isError ? ' is-error' : '') + ' visible';
    el.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function() { el.style.display = 'none'; }, 3200);
  }

  /* ------------------------------------------------------- 金額入力の整形 */

  function formatMoneyInput(input) {
    const value = num(input.value);
    input.value = value ? E.format.group(value) : '';
  }

  /* --------------------------------------------------------- モードタブ */

  const MODES = ['design', 'stats', 'theory', 'selection', 'ai'];

  function switchMode(mode, updateHash) {
    if (!MODES.includes(mode)) return;
    MODES.forEach(function(name) {
      const tab = $('tab-' + name);
      const panel = $('panel-' + name);
      if (tab) tab.setAttribute('aria-selected', String(name === mode));
      if (panel) panel.hidden = name !== mode;
    });
    if (mode === 'theory') renderQuickReference();
    if (updateHash && window.location.hash !== '#' + mode) {
      window.history.replaceState(null, '', '#' + mode);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function modeFromHash() {
    const hash = window.location.hash.slice(1);
    const aliases = { calculate: 'design', learn: 'theory' };
    const mode = aliases[hash] || hash;
    return MODES.includes(mode) ? mode : null;
  }

  /* ------------------------------------------------ ①対象／テスト種別 */

  function currentTestType() {
    return readStr('testType') || 'control';
  }

  function applyTestTypeVisibility() {
    const type = currentTestType();
    show('step-specific', type !== 'control');
    show('panel-control', type === 'control');
    show('panel-monetary', type !== 'control');
    show('eval-control', type === 'control');
    show('eval-monetary', type !== 'control');
    show('roo-group', type === 'control');
    show('rooCell', type === 'control');
    show('ria-group', type !== 'control');
    show('riaCell', type !== 'control');
    setText('testTypeLabel', {
      control: '統制テスト（属性サンプリング）',
      bs: 'BS項目（金額単位サンプリング）',
      pl: 'PL項目（金額単位サンプリング）'
    }[type]);
  }

  /* ------------------------------------------------------ ②リスク評価 */

  function recalcRisk() {
    const result = E.calculateRiskModel({
      AR: readNum('ar'),
      IR: readNum('ir'),
      CR: readNum('cr'),
      RIA: Number(readStr('ria')) || 0.10,
      ROO: Number(readStr('roo')) || 0.10
    });
    state.risk = result;

    setText('drValue', pctText(result.DR, 1));
    setText('riaValue', pctText(result.RIA, 1));
    setText('rooValue', pctText(result.ROO, 0));

    const drCell = $('drCell');
    if (drCell) drCell.className = 'result-cell';

    renderMeta('risk', result);
    return result;
  }

  /* -------------------------------------------------- ③特定項目控除 */

  // 閾値は1系統のみ（許容誤謬に対する百分率）。BUG-11 の二重基準を解消。
  function recalcSpecific() {
    const populationAmount = readNum('populationAmount');
    const populationCount = readNum('populationCount');
    const tolerable = readNum('tolerableMisstatement');
    const percent = readNum('specificThresholdPercent') / 100;

    const threshold = tolerable * percent;
    const specificAmount = readNum('specificItemAmount');
    const specificCount = readNum('specificItemCount');

    const residualAmount = Math.max(0, populationAmount - specificAmount);
    const residualCount = Math.max(0, populationCount - specificCount);
    const coverage = populationAmount > 0 ? specificAmount / populationAmount : NaN;

    const warnings = [];
    if (specificAmount > populationAmount) {
      warnings.push('特定項目の合計額が母集団総額を超えています。入力を確認してください。');
    }
    if (specificCount > populationCount) {
      warnings.push('特定項目の件数が母集団件数を超えています。入力を確認してください。');
    }
    if (tolerable > 0 && residualAmount > 0 && residualAmount < tolerable) {
      warnings.push('残余母集団が許容誤謬を下回っています。サンプリングを行わず分析的手続で足りる可能性があります。');
    }

    state.specific = {
      populationAmount, populationCount, tolerable, threshold,
      specificAmount, specificCount, residualAmount, residualCount, coverage
    };

    setText('specificThresholdAmount', moneyYen(threshold));
    setText('residualAmount', moneyYen(residualAmount));
    setText('residualCount', intText(residualCount) + '件');
    setText('specificCoverage', Number.isFinite(coverage) ? pctText(coverage, 1) : '—');
    renderWarnings('specificWarnings', warnings);

    setText('specificFormula',
      `特定項目閾値 = ${money(tolerable)} × ${(percent * 100).toFixed(0)}% = ${money(threshold)}円 ／ 残余母集団 = ${money(populationAmount)} − ${money(specificAmount)} = ${money(residualAmount)}円`);

    return state.specific;
  }

  /* ------------------------------------------------ ④サンプル数算定 */

  function setPopulationByFrequency() {
    const map = { daily: 250, weekly: 52, monthly: 12, quarterly: 4, annually: 1 };
    const frequency = readStr('controlFrequency');
    if (frequency !== 'daily' && map[frequency] !== undefined) {
      const field = $('populationSize');
      if (field) field.value = E.format.group(map[frequency]);
    }
    recalcAll();
  }

  function recalcControl() {
    const risk = state.risk || recalcRisk();
    const result = E.calculateAttributeSampling({
      frequency: readStr('controlFrequency'),
      populationSize: readNum('populationSize'),
      expectedDeviations: readNum('expectedDeviations'),
      tolerableRate: Number(readStr('tolerableRate')) || 0.09,
      ROO: risk.ROO,
      samplingApproach: readStr('samplingApproach') || 'statistical'
    });
    state.attribute = result;

    setText('ctrlSampleSize', intText(result.sampleSize) + '件');
    setText('ctrlAllowable', intText(result.allowableDeviations) + '件');
    setText('ctrlAdditional', result.additionalSamples === null ? 'N/A' : intText(result.additionalSamples) + '件');
    setText('ctrlMethod', result.statistical ? '統計的（正確二項）' : '非統計的（参考値）');

    const methodCell = $('ctrlMethodCell');
    if (methodCell) methodCell.className = 'result-cell' + (result.statistical ? '' : ' is-caution');

    renderMeta('ctrl', result);
    const evalField = $('attrSampleSize');
    if (evalField && !evalField.dataset.touched) evalField.value = result.sampleSize;
    return result;
  }

  function recalcMonetary() {
    const risk = state.risk || recalcRisk();
    const type = currentTestType();
    const specific = state.specific || recalcSpecific();
    const completeness = readStr('assertion') === '網羅性';

    const result = E.calculateMonetarySampling({
      BV: specific.residualAmount,
      TM: specific.tolerable,
      EM: readNum('expectedMisstatement'),
      RIA: risk.RIA,
      accountType: type,
      assertion: completeness ? 'completeness' : 'occurrence',
      method: 'systematic',
      transactionCount: specific.residualCount,
      highValueTotal: $('highValueTotal') && $('highValueTotal').value !== ''
        ? readNum('highValueTotal') : null
    });
    state.monetary = result;

    setText('mvSampleSize', result.valid ? intText(result.sampleSize) + 'ポイント' : '—');
    setText('mvInterval', result.valid ? moneyYen(result.samplingInterval) : '—');
    setText('mvCoverage', result.valid && result.coverage !== null ? pctText(result.coverage, 1) : '未算定');
    setText('mvCF', result.valid ? result.CF.toFixed(2) : '—');
    setText('mvEF', result.valid ? result.EF.toFixed(2) : '—');

    const coverageCell = $('mvCoverageCell');
    if (coverageCell) {
      coverageCell.className = 'result-cell' + (result.valid && result.coverage !== null ? ' is-primary' : '');
      coverageCell.title = result.coverageBasis || '';
    }

    renderMeta('mv', result);
    const evalField = $('ppsInterval');
    if (evalField && !evalField.dataset.touched && result.valid) {
      evalField.value = E.format.group(Math.round(result.samplingInterval));
    }
    return result;
  }

  /* --------------------------------------------------- ⑤誤謬評価 */

  function evaluateControl() {
    const risk = state.risk || recalcRisk();
    const design = state.attribute || recalcControl();
    const result = E.evaluateAttributeResults({
      sampleSize: readNum('attrSampleSize'),
      deviations: readNum('attrDeviations'),
      tolerableRate: Number(readStr('tolerableRate')) || 0.09,
      ROO: risk.ROO,
      statistical: design.statistical
    });
    state.attributeEval = result;

    setText('attrDeviationRate', pctText(result.deviationRate));
    setText('attrUpperLimit', pctText(result.upperDeviationLimit));
    setText('attrEvalResult', result.evaluation);
    setText('attrAction', result.requiredAction);

    let tone = '';
    if (result.effective === true) tone = ' is-good';
    if (result.effective === false) tone = ' is-bad';
    const cell = $('attrEvalCell');
    if (cell) cell.className = 'result-cell' + tone;
    const uldCell = $('attrUldCell');
    if (uldCell) uldCell.className = 'result-cell' + tone;

    renderMeta('attrEval', result);
    return result;
  }

  function collectMisstatements() {
    const rows = [];
    document.querySelectorAll('#misstatementRows .misstatement-row').forEach(function(row) {
      const bookValue = num(row.querySelector('.ms-book').value);
      const auditValue = num(row.querySelector('.ms-audit').value);
      if (bookValue === 0 && auditValue === 0) return;
      rows.push({ bookValue, auditValue });
    });
    return rows;
  }

  function refreshMisstatementDiffs() {
    document.querySelectorAll('#misstatementRows .misstatement-row').forEach(function(row) {
      const bookValue = num(row.querySelector('.ms-book').value);
      const auditValue = num(row.querySelector('.ms-audit').value);
      const diff = bookValue - auditValue;
      const cell = row.querySelector('.ms-diff');
      if (!cell) return;
      if (diff > 0) {
        cell.textContent = '過大 ' + moneyYen(diff);
        cell.className = 'ms-diff over';
      } else if (diff < 0) {
        cell.textContent = '過小 ' + moneyYen(-diff);
        cell.className = 'ms-diff under';
      } else {
        cell.textContent = '—';
        cell.className = 'ms-diff';
      }
    });
  }

  function addMisstatementRow() {
    const container = $('misstatementRows');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'misstatement-row';
    row.innerHTML =
      '<input type="text" class="form-input ms-book" placeholder="簿価" inputmode="numeric">' +
      '<input type="text" class="form-input ms-audit" placeholder="監査後価値" inputmode="numeric">' +
      '<div class="ms-diff">—</div>' +
      '<button type="button" class="btn btn-secondary btn-sm ms-remove" aria-label="この行を削除">×</button>';
    container.appendChild(row);
  }

  function evaluateMonetary() {
    const risk = state.risk || recalcRisk();
    const interval = readNum('ppsInterval');
    const rows = collectMisstatements();
    const noneFound = $('noMisstatementFound') && $('noMisstatementFound').checked;

    // 誤謬明細が未入力で「誤謬なし」の確認もされていない状態は「未評価」とする。
    // ここで評価すると、手続未実施でも統計的上限の比較結果が表示されてしまう
    // （期待誤謬0の設計では 基本精度 = 許容誤謬 となり UML ≦ TM が成立するため）。
    if (rows.length === 0 && !noneFound) {
      state.monetaryEval = null;
      ['ppsBasicPrecision', 'ppsProjected', 'ppsIncremental',
        'ppsUpperLimit', 'ppsUnderLimit'].forEach(function(id) { setText(id, '—'); });
      setText('ppsEvalResult', '未評価');
      const cell = $('ppsEvalCell');
      if (cell) cell.className = 'result-cell';
      const underCell = $('ppsUnderCell');
      if (underCell) underCell.className = 'result-cell';
      setText('ppsEvalFormula', '—');
      const basisEl = $('ppsEvalBasis');
      if (basisEl) basisEl.innerHTML = '';
      renderWarnings('ppsEvalWarnings',
        ['サンプルを抽出して検証したのち、発見した誤謬の簿価と監査後価値を入力してください。誤謬が0件だった場合は「誤謬は発見されなかった」にチェックを入れてください。']);
      return null;
    }

    const result = E.evaluateMonetaryResults({
      SI: interval,
      RIA: risk.RIA,
      misstatements: rows,
      tolerableMisstatement: readNum('tolerableMisstatement')
    });
    state.monetaryEval = result;

    if (!result.valid) {
      setText('ppsBasicPrecision', '—');
      setText('ppsProjected', '—');
      setText('ppsIncremental', '—');
      setText('ppsUpperLimit', '—');
      setText('ppsUnderLimit', '—');
      setText('ppsEvalResult', '—');
      renderMeta('ppsEval', result);
      return result;
    }

    const over = result.overstatement;
    setText('ppsBasicPrecision', moneyYen(over.basicPrecision));
    setText('ppsProjected', moneyYen(over.projectedMisstatement));
    setText('ppsIncremental', moneyYen(over.incrementalAllowance));
    setText('ppsUpperLimit', moneyYen(over.upperMisstatementLimit));
    setText('ppsUnderLimit', result.understatement.count > 0
      ? moneyYen(result.understatement.knownMisstatement)
      : '該当なし');
    setText('ppsEvalResult', result.evaluation || '—');

    const cell = $('ppsEvalCell');
    if (cell) {
      cell.className = 'result-cell ' + (result.acceptable === null ? '' : (result.acceptable ? 'is-good' : 'is-bad'));
    }
    const underCell = $('ppsUnderCell');
    if (underCell) {
      underCell.className = 'result-cell' + (result.understatement.count > 0 ? ' is-bad' : '');
    }

    renderMeta('ppsEval', result);
    return result;
  }

  /* ------------------------------------------------------- 早見表 */

  function renderQuickReference() {
    renderAttributeQuickReference();
    renderMonetaryQuickReference();
  }

  function renderAttributeQuickReference() {
    const host = $('qrAttribute');
    if (!host) return;
    const roo = Number(readStr('qrRoo')) || 0.10;
    const table = E.generateQuickReference({ type: 'attribute', ROO: roo });

    let html = '<div class="qr-scroll"><table class="qr-table"><thead><tr>';
    table.columns.forEach(function(col) { html += '<th>' + escapeHtml(col) + '</th>'; });
    html += '</tr></thead><tbody>';
    table.rows.forEach(function(row) {
      html += '<tr><th>' + escapeHtml(row.label) + '</th>';
      row.cells.forEach(function(cell) {
        html += '<td><strong>' + intText(cell.sampleSize) + '件</strong>'
          + '<span class="qr-sub">母集団で想定する逸脱率の上限 ' + pctText(cell.upperDeviationLimit) + '</span></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<p class="basis-line"><strong>算定根拠:</strong> ' + escapeHtml(table.basis) + '</p>';
    host.innerHTML = html;
  }

  function renderMonetaryQuickReference() {
    const host = $('qrMonetary');
    if (!host) return;
    const ria = Number(readStr('qrRia')) || 0.10;
    const table = E.generateQuickReference({ type: 'monetary', RIA: ria });

    let html = '<div class="qr-scroll"><table class="qr-table"><thead><tr>';
    table.columns.forEach(function(col) { html += '<th>' + escapeHtml(col) + '</th>'; });
    html += '</tr></thead><tbody>';
    table.rows.forEach(function(row) {
      html += '<tr><th>' + escapeHtml(row.label) + '</th><td><strong>'
        + intText(row.sampleSize) + '件</strong></td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<p class="basis-line"><strong>算定根拠:</strong> ' + escapeHtml(table.basis) + '</p>';
    host.innerHTML = html;
  }

  /* ------------------------------------------------------ ⑥検討用テキスト出力 */

  function buildWorksheet() {
    const type = currentTestType();
    const lines = [];
    const push = (label, value) => lines.push(label + '\t' + value);

    lines.push('監査サンプリング検討メモ v3.0');
    lines.push('【重要な免責】個人開発の非公式ツールによる計画・検討用の出力です。監査基準、所属法人等のメソドロジー、職業的専門家としての判断、十分かつ適切な監査証拠又は正式な監査調書を代替しません。計算と入力値は利用者が再検証してください。');
    lines.push('');
    push('対象会社', readStr('company') || '—');
    push('会計年度', readStr('fiscalYear') || '—');
    push('勘定科目', readStr('account') || '—');
    push('アサーション', readStr('assertion') || '—');
    push('テスト種別', $('testTypeLabel') ? $('testTypeLabel').textContent : type);
    lines.push('');

    if (state.risk) {
      lines.push('【②リスク評価】');
      push('目標監査リスク AR', pctText(state.risk.AR, 1));
      push('固有リスク IR', String(state.risk.IR));
      push('統制リスク CR', String(state.risk.CR));
      push('発見リスク DR', pctText(state.risk.DR, 1));
      if (type !== 'control') push('受入リスク RIA（別途設定）', pctText(state.risk.RIA, 1));
      if (type === 'control') push('過信リスク ROO', pctText(state.risk.ROO, 0));
      push('算式', state.risk.formula.substituted);
      push('算定根拠', state.risk.basis);
      state.risk.warnings.forEach((w, i) => push('注意' + (i + 1), w));
      lines.push('');
    }

    if (type !== 'control' && state.specific) {
      lines.push('【③特定項目控除】');
      push('母集団総額', moneyYen(state.specific.populationAmount));
      push('母集団件数', intText(state.specific.populationCount) + '件');
      push('利用者設定の特定項目閾値', moneyYen(state.specific.threshold));
      push('特定項目合計額', moneyYen(state.specific.specificAmount));
      push('特定項目件数', intText(state.specific.specificCount) + '件');
      push('残余母集団', moneyYen(state.specific.residualAmount));
      lines.push('');
    }

    lines.push('【④サンプル数算定】');
    if (type === 'control' && state.attribute) {
      const a = state.attribute;
      push('統制頻度', a.frequencyLabel);
      push('母集団件数', intText(a.populationSize) + '件');
      push('許容する逸脱の上限割合（TDR）', pctText(a.tolerableRate, 0));
      push('計画上の予想逸脱件数', intText(a.expectedDeviations) + '件');
      push('必要サンプル数', intText(a.sampleSize) + '件');
      push('予想逸脱+1件時の増分', a.additionalSamples === null ? 'N/A' : intText(a.additionalSamples) + '件');
      push('サンプリング区分', a.statistical ? '統計的（正確二項）' : '非統計的（参考頻度別ルール・要確認）');
      push('算式', a.formula.substituted);
      push('算定根拠', a.basis);
      a.warnings.forEach((w, i) => push('警告' + (i + 1), w));
    } else if (state.monetary && state.monetary.valid) {
      const m = state.monetary;
      push('母集団簿価 BV', moneyYen(m.BV));
      push('許容誤謬 TM', moneyYen(m.TM));
      push('期待誤謬 EM', moneyYen(m.EM));
      push('拡大係数 EF（RIA対応）', m.EF.toFixed(2));
      push('信頼係数 CF', m.CF.toFixed(2));
      push('選択ポイント数', intText(m.sampleSize) + 'ポイント');
      push('サンプリング間隔 SI', moneyYen(m.samplingInterval));
      push('確実抽出項目比率', m.coverage === null ? '未算定（' + m.coverageBasis + '）' : pctText(m.coverage, 1));
      push('算式', m.formula.substituted);
      push('算定根拠', m.basis);
      m.warnings.forEach((w, i) => push('警告' + (i + 1), w));
    } else {
      push('状態', '未算定');
    }
    lines.push('');

    lines.push('【⑤誤謬評価】');
    if (type === 'control' && state.attributeEval && state.attributeEval.valid) {
      const ev = state.attributeEval;
      push('サンプル数', intText(ev.sampleSize) + '件');
      push('逸脱件数', intText(ev.deviations) + '件');
      push('サンプル内の逸脱割合', pctText(ev.deviationRate));
      push('母集団で想定する逸脱率の上限（ULD）', pctText(ev.upperDeviationLimit));
      push('許容する逸脱の上限割合（TDR）', pctText(ev.tolerableRate, 0));
      push('統計的結果／判断', ev.evaluation);
      push('必要な対応', ev.requiredAction);
      push('算式', ev.formula.substituted);
      push('算定根拠', ev.basis);
      ev.warnings.forEach((w, i) => push('警告' + (i + 1), w));
    } else if (state.monetaryEval && state.monetaryEval.valid) {
      const ev = state.monetaryEval;
      push('サンプリング間隔 SI', moneyYen(ev.SI));
      push('基本精度', moneyYen(ev.overstatement.basicPrecision));
      push('推定誤謬額（過大）', moneyYen(ev.overstatement.projectedMisstatement));
      push('増分許容誤謬（過大）', moneyYen(ev.overstatement.incrementalAllowance));
      push('推定誤謬上限 UML（過大）', moneyYen(ev.overstatement.upperMisstatementLimit));
      push('既知の過小計上額（別途評価）', ev.understatement.count > 0
        ? moneyYen(ev.understatement.knownMisstatement) : '該当なし');
      push('許容誤謬', moneyYen(ev.tolerableMisstatement));
      push('統計的結果', ev.evaluation || '—');
      push('算式', ev.formula.substituted);
      push('算定根拠', ev.basis);
      ev.warnings.forEach((w, i) => push('警告' + (i + 1), w));
    } else {
      push('状態', '未評価');
    }

    lines.push('');
    lines.push('【利用上の確認】本出力だけで監査結論を形成しないでください。母集団の適合性・完全性、抽出の実施、例外や誤謬の性質・原因、定性的影響及び他の監査証拠をあわせて評価し、所属法人等の承認手続に従ってください。');
    lines.push('作成日時\t' + new Date().toLocaleString('ja-JP'));
    return lines.join('\n');
  }

  function copyWorksheet() {
    const text = buildWorksheet();
    const done = () => toast('検討用テキストをクリップボードにコピーしました');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function() { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('コピーに失敗しました', true); }
    document.body.removeChild(area);
  }

  function downloadWorksheet() {
    const text = buildWorksheet();
    // BOM 付きで Excel の文字化けを避ける
    const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const account = (readStr('account') || 'sampling').replace(/[\\/:*?"<>|]/g, '_');
    link.href = url;
    link.download = `監査サンプリング検討メモ_${account}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    toast('検討用テキストをダウンロードしました');
  }

  function previewWorksheet() {
    const el = $('worksheetPreview');
    if (!el) return;
    el.textContent = buildWorksheet();
    el.hidden = false;
  }

  /* ------------------------------------------------------- 再計算連鎖 */

  function recalcAll() {
    applyTestTypeVisibility();
    recalcRisk();
    const type = currentTestType();
    if (type === 'control') {
      recalcControl();
      evaluateControl();
    } else {
      recalcSpecific();
      recalcMonetary();
      evaluateMonetary();
    }
    previewIfOpen();
  }

  function previewIfOpen() {
    const el = $('worksheetPreview');
    if (el && !el.hidden) previewWorksheet();
  }

  /* ------------------------------------------------------------ 初期化 */

  function bindEvents() {
    // モードタブ
    MODES.forEach(function(name) {
      const tab = $('tab-' + name);
      if (tab) tab.addEventListener('click', function() { switchMode(name, true); });
    });

    // 入力の変化はすべて再計算に集約する
    document.addEventListener('input', function(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.mode-panel') && !target.closest('#panel-design')) return;
      if (target.classList.contains('ms-book') || target.classList.contains('ms-audit')) {
        refreshMisstatementDiffs();
        evaluateMonetary();
        previewIfOpen();
        return;
      }
      if (target.id === 'attrSampleSize' || target.id === 'ppsInterval') {
        target.dataset.touched = '1';
      }
      recalcAll();
    });

    document.addEventListener('change', function(event) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.id === 'qrRoo') { renderAttributeQuickReference(); return; }
      if (target.id === 'qrRia') { renderMonetaryQuickReference(); return; }
      if (target.id === 'controlFrequency') { setPopulationByFrequency(); return; }
      if (target.closest('.mode-panel') && !target.closest('#panel-design')) return;
      recalcAll();
    });

    // 金額入力の整形
    document.addEventListener('blur', function(event) {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.classList.contains('money-input')) {
        formatMoneyInput(target);
      }
    }, true);

    // 誤謬行の追加・削除
    $('addMisstatementRow').addEventListener('click', function() {
      addMisstatementRow();
      refreshMisstatementDiffs();
    });
    $('misstatementRows').addEventListener('click', function(event) {
      const button = event.target.closest('.ms-remove');
      if (!button) return;
      const rows = document.querySelectorAll('#misstatementRows .misstatement-row');
      if (rows.length <= 1) { toast('最低1行は必要です', true); return; }
      button.closest('.misstatement-row').remove();
      refreshMisstatementDiffs();
      evaluateMonetary();
      previewIfOpen();
    });

    // 検討用テキスト出力
    $('copyWorksheet').addEventListener('click', copyWorksheet);
    $('downloadWorksheet').addEventListener('click', downloadWorksheet);
    $('previewWorksheetBtn').addEventListener('click', previewWorksheet);
  }

  function init() {
    bindEvents();
    addMisstatementRow();
    recalcAll();
    renderQuickReference();
    const initialMode = modeFromHash();
    if (initialMode && initialMode !== 'design') switchMode(initialMode, false);
    window.addEventListener('hashchange', function() {
      const mode = modeFromHash();
      if (mode) switchMode(mode, false);
    });
    setText('buildStamp', '算定時刻: ' + new Date().toLocaleString('ja-JP'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

(function() {
  'use strict';

  const calculations = window.AuditSamplingCalculations;

  function addStylesheet() {
    if (document.getElementById('compactUiStyles')) return;

    const stylesheet = document.createElement('link');
    stylesheet.id = 'compactUiStyles';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = './compact-ui.css';
    document.head.appendChild(stylesheet);
  }

  function decorateHeading(section, icon, subtitle) {
    const heading = section?.querySelector(':scope > .card-header, :scope > h3');
    const title = heading?.querySelector('h2, h3') || heading;
    if (!heading || !title || heading.querySelector('.compact-heading-copy')) return;

    const titleText = title.textContent.trim();
    heading.classList.add('compact-section-heading');
    title.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i><span class="compact-heading-copy"><strong>${titleText}</strong><small>${subtitle}</small></span>`;
  }

  function compactAuditTarget() {
    const section = document.getElementById('audit-target');
    if (!section) return;

    section.classList.add('compact-audit-target');
    decorateHeading(section, 'ph-buildings', '案件を識別する基本情報');
  }

  function compactRiskModel() {
    const section = document.getElementById('risk-model');
    const body = section?.querySelector(':scope > .card-body');
    if (!section || !body) return;

    section.classList.add('compact-risk-model');
    decorateHeading(section, 'ph-shield-check', '許容リスクを構成要素に分けて評価');

    if (!body.querySelector('.risk-model-strip')) {
      body.insertAdjacentHTML('afterbegin', `
        <div class="risk-model-strip" aria-label="監査リスクモデルの関係">
          <span class="risk-equation">AR = IR × CR × DR</span>
          <span>固有リスク・統制リスクが高いほど、監査手続で抑える発見リスクは低くなります。</span>
        </div>
      `);
    }

    const kpis = body.querySelector('.kpi-grid');
    if (kpis && !kpis.previousElementSibling?.classList.contains('compact-result-label')) {
      kpis.insertAdjacentHTML('beforebegin', '<div class="compact-result-label">入力から算定されるリスク</div>');
    }
  }

  function compactSamplingDesign() {
    const section = document.getElementById('sampling-design');
    const body = section?.querySelector(':scope > .card-body');
    if (!section || !body) return;

    section.classList.add('compact-sampling-design');
    decorateHeading(section, 'ph-list-checks', '方法を選び、条件を設定して根拠を確認');

    const preparation = body.querySelector(':scope > .alert.info');
    if (preparation && !body.querySelector('.sampling-precheck')) {
      const details = document.createElement('details');
      details.className = 'sampling-precheck';
      details.innerHTML = '<summary><i class="ph ph-check-square-offset" aria-hidden="true"></i><span><strong>サンプリング前の3つの確認</strong><small>特定項目・階層化・母集団の完全性</small></span><i class="ph ph-caret-down precheck-caret" aria-hidden="true"></i></summary>';
      preparation.before(details);
      preparation.classList.add('sampling-precheck-body');
      preparation.removeAttribute('style');
      details.appendChild(preparation);
    }

    const tabs = body.querySelector(':scope > .tabs');
    if (tabs && !body.querySelector('.sampling-step-strip')) {
      tabs.insertAdjacentHTML('beforebegin', `
        <ol class="sampling-step-strip" aria-label="サンプリング設計の流れ">
          <li><span>1</span>方法を選ぶ</li>
          <li><span>2</span>条件を設定</li>
          <li><span>3</span>件数と根拠を確認</li>
        </ol>
      `);
    }
  }

  function createLogicGuide() {
    const sampling = document.getElementById('sampling-design');
    if (!sampling || document.getElementById('logic-guide')) return;

    sampling.insertAdjacentHTML('beforebegin', `
      <section class="logic-guide" id="logic-guide" aria-labelledby="logicGuideTitle">
        <div class="logic-guide-heading">
          <div>
            <span class="question-kicker">SAMPLE SIZE LOGIC</span>
            <h2 id="logicGuideTitle">サンプル数はどう決まる？</h2>
            <p>件数を暗記するのではなく、監査人が決めた条件から基準を選び、必要件数へたどり着く順序を理解します。</p>
          </div>
          <a class="logic-jump" href="#attribute-tab"><i class="ph ph-sliders-horizontal" aria-hidden="true"></i>条件を動かす</a>
        </div>

        <div class="logic-principles" aria-label="サンプル数を左右する4つの要素">
          <div class="logic-principle">
            <i class="ph ph-shield-check" aria-hidden="true"></i>
            <div><span>慎重さ</span><strong>信頼水準 90%</strong><small>この統制テスト基準表では固定</small></div>
          </div>
          <div class="logic-principle">
            <i class="ph ph-gauge" aria-hidden="true"></i>
            <div><span>判定の上限</span><strong id="logicTolerablePrinciple">許容逸脱率 9%</strong><small>低くするほど件数は増える</small></div>
          </div>
          <div class="logic-principle">
            <i class="ph ph-warning-circle" aria-hidden="true"></i>
            <div><span>事前の見込み</span><strong id="logicExpectedPrinciple">予想逸脱 0件</strong><small>多く見込むほど件数は増える</small></div>
          </div>
          <div class="logic-principle">
            <i class="ph ph-stack" aria-hidden="true"></i>
            <div><span>対象の大きさ・頻度</span><strong id="logicPopulationPrinciple">母集団 1,000件</strong><small>基準表か頻度別基準を選ぶ</small></div>
          </div>
        </div>

        <div class="logic-walkthrough" aria-live="polite">
          <div class="logic-live-result">
            <span>現在の必要サンプル数</span>
            <strong><b id="logicSampleSize">—</b>件</strong>
            <small id="logicBasisLabel">条件から基準を確認しています</small>
          </div>
          <div class="logic-path-wrap">
            <div class="logic-condition-line" id="logicConditionLine"></div>
            <div class="logic-path" id="logicPath" aria-label="現在の算定順序"></div>
            <p class="logic-explanation" id="logicExplanation"></p>
          </div>
        </div>

        <div class="logic-meaning">
          <i class="ph ph-lightbulb" aria-hidden="true"></i>
          <p><strong>この件数が保証するもの</strong><span>結論そのものを保証する件数ではありません。母集団を適切に定義し、偏りなく抽出したうえで、見逃しの可能性を一定水準に抑えて判断するための設計値です。</span></p>
        </div>

        <details class="logic-deep-dive">
          <summary><i class="ph ph-function" aria-hidden="true"></i>基準表の読み方と件数が変わる方向を詳しく見る</summary>
          <div class="logic-deep-dive-body">
            <div><strong>許容逸脱率</strong><p>統制に依拠できると判断する逸脱率の上限です。9%から7%、5%へ厳しくすると、同じ予想逸脱でも確認件数は増えます。</p></div>
            <div><strong>予想逸脱件数</strong><p>前年実績や統制変更から、テスト前に見込む逸脱です。0件から1件、2件へ増えると、逸脱を見込んだうえで判断するため確認件数は増えます。</p></div>
            <div><strong>母集団と統制頻度</strong><p>日次または250件以上では基準表を使用します。250件未満では週次・月次・四半期・年次の頻度別基準を使い、基準件数が母集団を超えるときは全件確認になります。</p></div>
            <div><strong>信頼水準</strong><p>この統制テストの基準表は90%信頼水準を前提としています。上部の信頼度入力は監査リスク表示等の設定であり、ここで算定する統制テスト件数は変えません。</p></div>
          </div>
        </details>
      </section>
    `);

    const referenceLabel = Array.from(document.querySelectorAll('.side-label')).find(function(label) {
      return label.textContent.trim() === '資料';
    });
    const approachLink = document.querySelector('.side-nav a[href="#approach-lab"]');
    const anchor = approachLink || referenceLabel;
    if (anchor && !document.querySelector('.side-nav a[href="#logic-guide"]')) {
      anchor.insertAdjacentHTML('afterend', '<a href="#logic-guide"><i class="ph ph-function" aria-hidden="true"></i><span>件数の決まり方</span></a>');
    }
  }

  function formatInteger(value) {
    return Number(value).toLocaleString('ja-JP');
  }

  function formatRate(value) {
    return Math.round(Number(value) * 100) + '%';
  }

  function getBaseSample(result) {
    const table = calculations?.ATTRIBUTE_SAMPLE_SIZE_TABLE;
    const row = table?.[Number(result.tolerableRate).toFixed(2)];
    return row?.[result.expectedDeviations];
  }

  function makePathStep(label, value, emphasis) {
    return `<div class="logic-path-step${emphasis ? ' is-result' : ''}"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function updateLogicGuide(result) {
    const sample = document.getElementById('logicSampleSize');
    if (!sample || !result) return;

    const frequencyLabels = {
      daily: '日次・随時',
      weekly: '週次',
      monthly: '月次',
      quarterly: '四半期',
      annually: '年次'
    };
    const frequency = frequencyLabels[result.frequency] || result.frequency;
    const rate = formatRate(result.tolerableRate);
    const population = formatInteger(result.populationSize);
    const expected = formatInteger(result.expectedDeviations);
    const usesTable = result.frequency === 'daily' || result.populationSize >= 250;
    const baseSample = getBaseSample(result);

    sample.textContent = formatInteger(result.sampleSize);
    document.getElementById('logicBasisLabel').textContent = result.basis;
    document.getElementById('logicTolerablePrinciple').textContent = `許容逸脱率 ${rate}`;
    document.getElementById('logicExpectedPrinciple').textContent = `予想逸脱 ${expected}件`;
    document.getElementById('logicPopulationPrinciple').textContent = `母集団 ${population}件`;
    document.getElementById('logicConditionLine').textContent = `${frequency} / 母集団 ${population}件 / 許容逸脱率 ${rate} / 予想逸脱 ${expected}件`;

    let pathHtml = '';
    let explanation = '';

    if (usesTable && baseSample !== undefined) {
      pathHtml = [
        makePathStep('前提', '信頼水準90%'),
        makePathStep('基準表の列', `許容逸脱率 ${rate}`),
        makePathStep('基準表の行', `予想逸脱 ${expected}件`),
        makePathStep('交点', `${formatInteger(baseSample)}件`),
        makePathStep('母集団上限後', `${formatInteger(result.sampleSize)}件`, true)
      ].join('<i class="ph ph-arrow-right" aria-hidden="true"></i>');

      const populationSentence = result.fullPopulation
        ? `ただし基準件数が母集団${population}件を超えるため、全件確認の${population}件が最終値です。`
        : `母集団${population}件は基準件数以上なので、${formatInteger(baseSample)}件がそのまま最終値です。`;
      explanation = `${frequency}または母集団250件以上の条件により、90%信頼水準の基準表を使います。許容逸脱率${rate}と予想逸脱${expected}件の交点は${formatInteger(baseSample)}件です。${populationSentence}`;
    } else {
      const frequencyBasis = {
        weekly: '最大5件',
        monthly: '2〜3件',
        quarterly: '1件',
        annually: '1件'
      }[result.frequency] || `${formatInteger(result.sampleSize)}件`;

      pathHtml = [
        makePathStep('母集団', `${population}件`),
        makePathStep('統制頻度', frequency),
        makePathStep('頻度別基準', frequencyBasis),
        makePathStep('母集団上限後', `${formatInteger(result.sampleSize)}件`, true)
      ].join('<i class="ph ph-arrow-right" aria-hidden="true"></i>');

      const fullPopulationSentence = result.fullPopulation
        ? '基準件数が母集団を超えるため、最終的に全件確認となります。'
        : '母集団件数の範囲内で、この頻度別基準を最終値とします。';
      explanation = `母集団が250件未満のため、${frequency}統制に対応する頻度別基準${frequencyBasis}を使います。${fullPopulationSentence}`;
    }

    document.getElementById('logicPath').innerHTML = pathHtml;
    document.getElementById('logicExplanation').textContent = explanation;
  }

  function bindNavigationClose() {
    document.querySelector('.side-nav a[href="#logic-guide"]')?.addEventListener('click', function() {
      if (window.closeAppNav) window.closeAppNav();
    });
  }

  addStylesheet();
  compactAuditTarget();
  compactRiskModel();
  compactSamplingDesign();
  createLogicGuide();
  bindNavigationClose();

  const originalUpdateAttributeLearning = window.updateAttributeLearning;
  window.updateAttributeLearning = function(result) {
    if (originalUpdateAttributeLearning) originalUpdateAttributeLearning(result);
    updateLogicGuide(result);
  };
})();

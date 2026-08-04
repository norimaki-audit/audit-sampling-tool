(function() {
  'use strict';

  function appendFieldSupport(inputId, html) {
    const input = document.getElementById(inputId);
    const group = input?.closest('.form-group');
    if (group && !group.querySelector('[data-support-for="' + inputId + '"]')) {
      group.insertAdjacentHTML('beforeend', html);
    }
  }

  const stylesheet = document.createElement('link');
  stylesheet.id = 'educationStyles';
  stylesheet.rel = 'stylesheet';
  stylesheet.href = './education.css';
  document.head.appendChild(stylesheet);

  document.getElementById('overview')?.insertAdjacentHTML('afterend', `
    <section class="question-panel" aria-labelledby="aiQuestionTitle">
      <div class="question-copy">
        <span class="question-kicker">AUDIT APPROACH / QUESTION</span>
        <h2 id="aiQuestionTitle">AIは、監査サンプリングをなくすのか？</h2>
        <p>全件分析が可能な領域は増えています。それでも、すべての監査証拠を機械的に評価できるわけではありません。全件分析、特定項目抽出、統計的サンプリングをどう使い分けるか、条件を動かしながら根拠を確認します。</p>
      </div>
      <div class="question-actions">
        <div class="cta-row">
          <a class="link-button primary" href="#sampling-design"><i class="ph ph-calculator" aria-hidden="true"></i>サンプリングを設計する</a>
          <a class="link-button" href="#approach-lab"><i class="ph ph-flow-arrow" aria-hidden="true"></i>AI時代の監査手続を考える</a>
        </div>
        <div class="learning-mode-toggle" aria-label="解説表示">
          <button type="button" class="active" data-learning-mode-button="concise" aria-pressed="true" onclick="setLearningMode('concise')">初心者向け</button>
          <button type="button" data-learning-mode-button="detail" aria-pressed="false" onclick="setLearningMode('detail')">詳細表示</button>
        </div>
      </div>
    </section>
  `);

  document.getElementById('risk-model')?.insertAdjacentHTML('afterend', `
    <section class="learning-panel" id="approach-lab" aria-labelledby="approachTitle">
      <div class="section-heading">
        <div class="section-heading-main">
          <span class="question-kicker">AUDIT APPROACH</span>
          <h2 id="approachTitle">この母集団は、どのようにテストしますか？</h2>
          <p>ツールが監査方針を決めるのではなく、監査目的と母集団の性質を整理するための選択肢です。</p>
        </div>
      </div>

      <div class="approach-grid" role="radiogroup" aria-label="監査アプローチ">
        <div class="approach-option"><input type="radio" name="auditApproach" id="approachFull" value="full" onchange="updateApproachSelection(this.value)"><label for="approachFull"><i class="ph ph-database" aria-hidden="true"></i><strong>全件分析</strong><span>同じ判定ルールを母集団全体へ適用し、重複、欠番、異常値、閾値超過などを検出します。</span></label></div>
        <div class="approach-option"><input type="radio" name="auditApproach" id="approachSpecific" value="specific" onchange="updateApproachSelection(this.value)"><label for="approachSpecific"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><strong>特定項目抽出</strong><span>高額、異常、関連当事者、期末日前後など、リスクの高い項目を個別確認します。</span></label></div>
        <div class="approach-option"><input type="radio" name="auditApproach" id="approachStatistical" value="statistical" onchange="updateApproachSelection(this.value)"><label for="approachStatistical"><i class="ph ph-chart-line" aria-hidden="true"></i><strong>統計的サンプリング</strong><span>偏りなく一部を抽出し、サンプリングリスクを考慮して母集団を判断します。</span></label></div>
        <div class="approach-option"><input type="radio" name="auditApproach" id="approachNonstatistical" value="nonstatistical" onchange="updateApproachSelection(this.value)"><label for="approachNonstatistical"><i class="ph ph-user-focus" aria-hidden="true"></i><strong>非統計的サンプリング</strong><span>職業的専門家としての判断により、確認対象と件数を決定します。</span></label></div>
        <div class="approach-option"><input type="radio" name="auditApproach" id="approachCombination" value="combination" onchange="updateApproachSelection(this.value)"><label for="approachCombination"><i class="ph ph-intersect" aria-hidden="true"></i><strong>組合せ</strong><span>例外と重要項目を個別確認し、残余母集団に必要な手続を適用します。常に最適とは限りません。</span></label></div>
      </div>
      <p class="approach-summary" id="approachSelectionSummary">監査目的に最も合う考え方を選ぶと、検討の観点を表示します。</p>

      <details class="learning-disclosure">
        <summary><i class="ph ph-check-square-offset" aria-hidden="true"></i>AI・データ分析で全件分析しやすいか確認する</summary>
        <div class="learning-disclosure-body">
          <div class="check-grid">
            <label class="check-item"><input type="checkbox" data-full-check>母集団を電子データとして取得できる</label>
            <label class="check-item"><input type="checkbox" data-full-check>母集団の完全性と正確性を確認できる</label>
            <label class="check-item"><input type="checkbox" data-full-check>正常と異常の判定ルールを明確に設定できる</label>
            <label class="check-item"><input type="checkbox" data-full-check>母集団全体へ同じ判定ルールを適用できる</label>
            <label class="check-item"><input type="checkbox" data-full-check>証憑や契約書を人が読まずに結論を出せる</label>
            <label class="check-item"><input type="checkbox" data-full-check>分析ロジックや出力を検証できる</label>
            <label class="check-item"><input type="checkbox" data-full-check>検出された例外項目を人が評価できる</label>
          </div>
          <div class="check-result" id="fullAnalysisCheckResult" aria-live="polite"></div>
          <p class="reference-note">このチェックは診断結果ではなく、監査手続を検討するための参考情報です。</p>
        </div>
      </details>

      <details class="learning-disclosure detail-only" id="ai-audit-flow">
        <summary><i class="ph ph-flow-arrow" aria-hidden="true"></i>AI時代の監査手続の流れを見る</summary>
        <div class="learning-disclosure-body">
          <div class="flow-diagram" aria-label="AI時代の監査手続フロー">
            <div class="flow-step"><i class="ph ph-stack" aria-hidden="true"></i><strong>母集団全体</strong><span>対象期間と範囲を定義</span></div>
            <div class="flow-step"><i class="ph ph-shield-check" aria-hidden="true"></i><strong>完全性・正確性</strong><span>元データと抽出過程を確認</span></div>
            <div class="flow-step"><i class="ph ph-cpu" aria-hidden="true"></i><strong>全件分析</strong><span>重複、欠番、異常値、閾値超過を抽出</span></div>
            <div class="flow-step"><i class="ph ph-magnifying-glass" aria-hidden="true"></i><strong>特定項目</strong><span>高額、異常、関連当事者を個別確認</span></div>
            <div class="flow-step"><i class="ph ph-funnel" aria-hidden="true"></i><strong>残余母集団</strong><span>対象を再定義</span></div>
            <div class="flow-step"><i class="ph ph-chart-line" aria-hidden="true"></i><strong>サンプリング</strong><span>必要に応じて統計的に抽出</span></div>
            <div class="flow-step"><i class="ph ph-scales" aria-hidden="true"></i><strong>発見事項の評価</strong><span>定性的・定量的に判断</span></div>
          </div>
          <p class="reference-note">AIが直接サンプル件数をゼロにするのではありません。AIによって母集団の分け方と重点項目が変わり、サンプリング対象が残余母集団になる可能性があります。</p>
        </div>
      </details>

      <details class="learning-disclosure detail-only">
        <summary><i class="ph ph-database" aria-hidden="true"></i>全件分析で確認しやすいこと・残る判断を見る</summary>
        <div class="learning-disclosure-body analysis-columns">
          <div><h4>全件分析で検出しやすい例</h4><ul class="plain-list"><li>伝票番号の欠番、重複取引</li><li>一定金額超、営業時間外、休日の取引</li><li>期末日前後の取引</li><li>通常使用されない勘定科目やユーザー</li><li>同一口座への集中送金、異常な値引率</li><li>一定条件に一致する仕訳</li></ul></div>
          <div><h4>全件分析でも残る確認</h4><ul class="plain-list"><li>元データと抽出結果は完全・正確か</li><li>判定ルールとプログラムは適切か</li><li>検出されない項目に問題はないか</li><li>例外項目をどう評価するか</li><li>証憑の真正性と取引の経済的実態</li><li>経営者の見積りや判断の合理性</li></ul></div>
        </div>
      </details>

      <details class="learning-disclosure detail-only">
        <summary><i class="ph ph-cards" aria-hidden="true"></i>なぜ一部を見て全体を考えられるのか</summary>
        <div class="learning-disclosure-body"><div class="conclusion-box"><h3>よく混ぜた箱から、偏りなくカードを取る</h3><p>大きな箱に正常なカードと逸脱のあるカードが混ざっているとします。箱をよく混ぜ、偏りなく取り出せば、全部を見なくても全体の傾向をある程度推測できます。</p><p>少なすぎると、たまたま正常なカードだけを引く可能性があります。多く確認するほど判断は慎重になりますが、時間とコストも増えます。正式には、この見逃しの可能性をサンプリングリスクと呼びます。</p><p>母集団が適切に定義され、抽出に偏りがなく、各項目に抽出される機会があることが前提です。</p></div></div>
      </details>

      <details class="learning-disclosure detail-only">
        <summary><i class="ph ph-lightbulb" aria-hidden="true"></i>「AIはサンプリングをなくすのか？」の結論</summary>
        <div class="learning-disclosure-body conclusion-box"><h3>サンプリングは、単純になくなるのではなく、使われる場所が変わる。</h3><p>機械で確認できる部分は全件分析し、リスクの高い項目は個別に確認し、残った均質な母集団には必要に応じてサンプリングを適用する組合せが重要になります。</p><p>必要なのは標準件数の暗記ではなく、「どのリスクに対して、どの手続を、なぜその範囲で実施したのか」を説明する力です。</p></div>
      </details>

      <div class="note-callout"><i class="ph ph-note" aria-hidden="true"></i><span>解説記事「AIは監査サンプリングをなくすのか？――『なぜ60件？』を統計学から考える」と連動予定です。</span><a class="link-button" id="noteArticleLink" target="_blank" rel="noopener">解説記事を読む</a></div>
    </section>
  `);

  appendFieldSupport('confidenceLevel', `
    <div data-support-for="confidenceLevel">
      <div class="range-control"><input id="confidenceLevelRange" type="range" min="0" max="2" step="1" value="0" aria-label="信頼度" oninput="syncLearningControl('confidence', this.value); this.nextElementSibling.value = ['90%','95%','99%'][Number(this.value)]"><output>90%</output></div>
      <details class="field-help"><summary><i class="ph ph-question" aria-hidden="true"></i>信頼度とは</summary><p>確認件数が少なすぎると、たまたま正常な取引だけを選ぶ可能性があります。どの程度慎重な判断を求めるかを表す正式な用語が信頼水準です。母集団や監査意見が正しい確率を意味しません。</p></details>
    </div>
  `);

  appendFieldSupport('populationSize', `
    <div data-support-for="populationSize">
      <div class="range-control"><input id="populationSizeRange" type="range" min="1" max="10000" step="1" value="1000" aria-label="母集団件数" oninput="syncLearningControl('population', this.value); this.nextElementSibling.value = Number(this.value).toLocaleString('ja-JP') + '件'"><output>1,000件</output></div>
      <details class="field-help"><summary><i class="ph ph-question" aria-hidden="true"></i>母集団件数とは</summary><p>テスト対象となる取引や証憑の総数です。1年間の売上取引が1,000件なら母集団件数は1,000件です。母集団が10倍でも必要サンプル数が必ず10倍になるわけではありません。</p></details>
    </div>
  `);

  appendFieldSupport('expectedDeviations', `
    <div data-support-for="expectedDeviations">
      <div class="range-control"><input id="expectedDeviationsRange" type="range" min="0" max="2" step="1" value="0" aria-label="予想逸脱件数" oninput="syncLearningControl('expected', this.value); this.nextElementSibling.value = this.value + '件'"><output>0件</output></div>
      <details class="field-help"><summary><i class="ph ph-question" aria-hidden="true"></i>予想逸脱件数とは</summary><p>テスト前に、サンプル内でどの程度の逸脱がありそうかを見積もる入力です。前年の逸脱、新システム導入、担当者変更などが判断材料になります。予想逸脱が増えるほど必要件数は増えやすくなります。</p></details>
    </div>
  `);

  appendFieldSupport('tolerableRateNew', `
    <div data-support-for="tolerableRateNew">
      <div class="range-control"><input id="tolerableRateRange" type="range" min="5" max="9" step="2" value="9" aria-label="許容逸脱率" oninput="syncLearningControl('tolerable', this.value); this.nextElementSibling.value = this.value + '%'"><output>9%</output></div>
      <details class="field-help"><summary><i class="ph ph-question" aria-hidden="true"></i>許容逸脱率とは</summary><p>この水準を超えると統制に依拠しにくいと判断する上限です。許容できる逸脱を少なくするほど、一般に必要サンプル数は増加します。予想逸脱は事前の見込み、許容逸脱率は判断の上限です。</p></details>
    </div>
  `);

  document.getElementById('sampleSizeAdj')?.closest('table')?.insertAdjacentHTML('afterend', `
    <section class="result-story" aria-labelledby="sampleReasonTitle">
      <div class="sample-result-hero"><span class="sample-result-label">必要サンプル数</span><span><strong class="sample-result-value" id="sampleSizeHero">—</strong><span class="sample-result-unit">件</span></span></div>
      <div>
        <h3 id="sampleReasonTitle">なぜこの件数になったのか</h3><p id="sampleReasonSummary">入力条件から件数の根拠を生成します。</p>
        <div class="factor-columns"><div class="factor-group"><strong>件数を増やしている要因</strong><ul id="increaseFactors"></ul></div><div class="factor-group"><strong>件数を抑えている要因</strong><ul id="decreaseFactors"></ul></div></div>
        <details class="field-help detail-only"><summary><i class="ph ph-function" aria-hidden="true"></i>計算ロジックを確認する</summary><p id="attributeBasisText"></p></details>
        <div class="input-warning" id="attributeInputWarning" role="alert" hidden></div>
        <div class="condition-comparison" id="conditionComparison" hidden>
          <div class="comparison-title"><span id="comparisonChangedLabel"></span>を変更した結果</div>
          <div class="comparison-grid"><div class="comparison-state"><span>変更前</span><strong id="comparisonBeforeCondition"></strong><span id="comparisonBeforeSample"></span></div><i class="ph ph-arrow-right comparison-arrow" aria-hidden="true"></i><div class="comparison-state is-after"><span>変更後</span><strong id="comparisonAfterCondition"></strong><span id="comparisonAfterSample"></span></div></div>
          <p class="comparison-explanation" id="comparisonExplanation"></p>
        </div>
      </div>
    </section>
    <details class="learning-disclosure detail-only" id="sensitivity-analysis">
      <summary><i class="ph ph-chart-line-up" aria-hidden="true"></i>条件を動かして理解する</summary>
      <div class="learning-disclosure-body">
        <div class="sensitivity-toolbar"><strong>どの条件の影響を見ますか？</strong><div class="sensitivity-tabs" aria-label="感度分析の条件"><button type="button" class="active" data-sensitivity-factor="population" aria-pressed="true" onclick="selectSensitivityFactor('population')">母集団件数</button><button type="button" data-sensitivity-factor="tolerable" aria-pressed="false" onclick="selectSensitivityFactor('tolerable')">許容逸脱率</button><button type="button" data-sensitivity-factor="expected" aria-pressed="false" onclick="selectSensitivityFactor('expected')">予想逸脱</button><button type="button" data-sensitivity-factor="confidence" aria-pressed="false" onclick="selectSensitivityFactor('confidence')">信頼水準</button></div></div>
        <div class="chart-wrap"><svg id="sensitivityChart" role="img" aria-label="入力条件と必要サンプル数の感度分析"></svg></div><p id="sensitivitySummary"></p>
      </div>
    </details>
  `);

  const referenceLabel = Array.from(document.querySelectorAll('.side-label')).find(function(label) {
    return label.textContent.trim() === '資料';
  });
  referenceLabel?.insertAdjacentHTML('beforebegin', '<div class="side-label">考える</div><a href="#approach-lab"><i class="ph ph-flow-arrow" aria-hidden="true"></i><span>監査アプローチ</span></a>');

  document.querySelectorAll('.side-nav a[href^="#"]').forEach(function(link) {
    link.addEventListener('click', function() {
      if (window.closeAppNav) window.closeAppNav();
    });
  });
})();

/*!
 * audit-sampling-tool v3.0 - sampling selection guide
 *
 * This module owns explanatory UI only. It does not calculate sample sizes.
 */
(function() {
  'use strict';

  const scenarios = {
    overstatement: {
      label: '高額項目・過大計上を重視',
      method: 'MUS / PPS',
      target: 'method-mus',
      summary: '各金額単位に抽出機会を与えるため、高額項目ほど選ばれやすくなります。売掛金や棚卸資産など、記録済み残高の過大計上を効率よく検証したい場面に向きます。',
      caution: 'ゼロ・マイナス残高や計上漏れは選ばれにくいため、別の母集団や手続を組み合わせます。'
    },
    equal: {
      label: 'すべての項目を同じ確率で選択',
      method: '単純無作為抽出',
      target: 'method-random',
      summary: '完全な母集団一覧に番号を付け、乱数で項目を選びます。金額にかかわらず1件を1単位として扱うため、統制テストや件数ベースの検証と相性がよい方法です。',
      caution: '母集団一覧の完全性と、乱数・シード・抽出結果を再現できる記録が必要です。'
    },
    ordered: {
      label: '一覧を効率よく全期間へ分散',
      method: '系統抽出',
      target: 'method-systematic',
      summary: 'ランダムな開始点を1つ決め、その後は一定間隔ごとに抽出します。時系列や伝票番号順の一覧から、母集団全体へ広く配置しやすい方法です。',
      caution: '母集団の周期的な並びと抽出間隔が重なると偏るため、並び方を事前に確認します。'
    },
    mixed: {
      label: '高額・通常・少額が混在',
      method: '階層化 + 各層で抽出',
      target: 'method-stratified',
      summary: '金額、リスク、取引種類などで比較的均質な層に分け、高額層は全件、残りは無作為または系統抽出といった組合せにします。',
      caution: '階層化だけでは抽出方法になりません。各層の母集団、件数、抽出方法、評価方法を別々に決めます。'
    },
    judgment: {
      label: '非統計的に偏りを避けて選択',
      method: '任意抽出',
      target: 'method-haphazard',
      summary: '監査人が特定の規則や乱数を使わず、意図的な偏りを避けて母集団全体から選びます。非統計的サンプリングで利用される選択方法です。',
      caution: '「目についたもの」や「取りやすいもの」を選ぶ方法ではありません。無意識の偏りを抑える設計と記録が必要です。'
    },
    specific: {
      label: '高額・異常・関連当事者を必ず確認',
      method: '特定項目抽出 + 残余母集団',
      target: 'method-specific',
      summary: 'リスクが高い項目を100%確認し、その項目を除いた残余母集団に必要なサンプリングを適用します。',
      caution: '特定項目の結果だけを、選ばれていない残余母集団へ投影することはできません。'
    },
    completeness: {
      label: '計上漏れ・網羅性を確認',
      method: 'まず抽出元を変える',
      target: 'selection-source-direction',
      summary: '記録済み帳簿から選ぶだけでは、帳簿に存在しない計上漏れを直接選べません。漏れた項目が含まれる外部・前段階の母集団から帳簿へ追跡します。',
      caution: '母集団を正しく定義した後、その中で無作為抽出や系統抽出などを選びます。'
    }
  };

  function createGuide() {
    const aiTab = document.getElementById('tab-ai');
    const aiPanel = document.getElementById('panel-ai');
    if (!aiTab || !aiPanel || document.getElementById('tab-selection')) return;

    aiTab.insertAdjacentHTML('beforebegin',
      '<button type="button" class="mode-tab" id="tab-selection" role="tab" aria-selected="false" aria-controls="panel-selection">抽出方法</button>'
    );

    aiPanel.insertAdjacentHTML('beforebegin', `
      <section class="mode-panel selection-panel" id="panel-selection" role="tabpanel" aria-labelledby="tab-selection" hidden>
        <header class="selection-intro">
          <span class="selection-kicker">SAMPLE SELECTION</span>
          <h2>そのサンプルを、どう選ぶ？</h2>
          <p>サンプル数が同じでも、選び方が監査目的と母集団に合わなければ結論は弱くなります。「何件見るか」の次に、「どこから、どの単位で、どう選ぶか」を決めます。</p>
        </header>

        <div class="selection-order" aria-label="抽出方法を決める順序">
          <div><span>01</span><strong>監査目的</strong><small>何を検証するか</small></div>
          <div><span>02</span><strong>母集団</strong><small>どこから選ぶか</small></div>
          <div><span>03</span><strong>抽出単位</strong><small>1件か1円か</small></div>
          <div><span>04</span><strong>抽出方法</strong><small>どう偏りを抑えるか</small></div>
        </div>

        <section class="selection-chooser" aria-labelledby="selectionChooserTitle">
          <div class="selection-chooser-head">
            <div>
              <span class="selection-kicker">QUICK GUIDE</span>
              <h3 id="selectionChooserTitle">監査目的に近いものを選ぶ</h3>
            </div>
            <p>唯一の正解を診断するものではなく、最初に検討する方法を絞るためのガイドです。</p>
          </div>
          <div class="selection-scenarios" role="group" aria-label="監査目的">
            <button type="button" data-selection-scenario="overstatement"><span>M</span>高額・過大計上</button>
            <button type="button" data-selection-scenario="equal"><span>R</span>各項目を同確率</button>
            <button type="button" data-selection-scenario="ordered"><span>S</span>一覧を効率抽出</button>
            <button type="button" data-selection-scenario="mixed"><span>L</span>金額分布に偏り</button>
            <button type="button" data-selection-scenario="judgment"><span>H</span>非統計的に選択</button>
            <button type="button" data-selection-scenario="specific"><span>100</span>特定リスクを全件</button>
            <button type="button" data-selection-scenario="completeness"><span>C</span>計上漏れを探す</button>
          </div>
          <div class="selection-recommendation" id="selectionRecommendation" aria-live="polite">
            <div>
              <span class="selection-recommendation-label">検討の出発点</span>
              <h4>監査目的を選択してください</h4>
              <p>目的に対応する抽出方法、向いている場面、注意点を表示します。</p>
              <small>抽出方法の前に、母集団の完全性と抽出元が目的に合うかを確認します。</small>
            </div>
            <a class="btn secondary" href="#panel-selection" hidden>詳細を見る</a>
          </div>
        </section>

        <div class="selection-method-grid">
          <article class="selection-method" id="method-mus">
            <div class="selection-method-head"><span>MUS</span><div><small>金額比例・統計的</small><h3>MUS / PPS</h3></div></div>
            <p>各円などの<strong>金額単位</strong>に均等な抽出機会を与えます。その結果、金額が大きい項目ほど選ばれる確率が高くなります。</p>
            <dl><div><dt>向く場面</dt><dd>記録済み残高の過大計上</dd></div><div><dt>抽出</dt><dd>ランダム開始 + 金額間隔</dd></div><div><dt>注意</dt><dd>ゼロ・負数・過小計上は別手続</dd></div></dl>
            <p class="selection-tool-map">計算タブ: BS・PL実証手続</p>
          </article>

          <article class="selection-method" id="method-random">
            <div class="selection-method-head"><span>RND</span><div><small>件数比例・統計的</small><h3>単純無作為抽出</h3></div></div>
            <p>完全な母集団一覧から乱数で選び、各項目に<strong>同じ抽出確率</strong>を与えます。金額差を選択確率へ反映しません。</p>
            <dl><div><dt>向く場面</dt><dd>統制テスト、件数ベースの検証</dd></div><div><dt>抽出</dt><dd>乱数表・監査ソフト</dd></div><div><dt>注意</dt><dd>母集団ID・乱数設定・結果を保存</dd></div></dl>
            <p class="selection-tool-map">計算タブ: 統制テスト</p>
          </article>

          <article class="selection-method" id="method-systematic">
            <div class="selection-method-head"><span>SYS</span><div><small>一定間隔・統計的</small><h3>系統抽出</h3></div></div>
            <p>母集団件数を必要件数で割って間隔を求め、<strong>ランダムな開始点</strong>から一定間隔ごとに選びます。</p>
            <dl><div><dt>向く場面</dt><dd>時系列・伝票番号順の大きな一覧</dd></div><div><dt>抽出</dt><dd>例: 開始7番、以後20件ごと</dd></div><div><dt>注意</dt><dd>並びの周期性を確認</dd></div></dl>
            <p class="selection-tool-map">必要件数は計算タブで確認</p>
          </article>

          <article class="selection-method" id="method-stratified">
            <div class="selection-method-head"><span>LAY</span><div><small>母集団設計</small><h3>階層化抽出</h3></div></div>
            <p>母集団を金額・リスク・取引種類などで<strong>比較的均質な層</strong>に分け、各層で必要な抽出を行います。</p>
            <dl><div><dt>向く場面</dt><dd>高額項目と多数の通常項目が混在</dd></div><div><dt>抽出</dt><dd>高額層は全件、残余層は無作為など</dd></div><div><dt>注意</dt><dd>層ごとに件数・方法・評価を設計</dd></div></dl>
            <p class="selection-tool-map">計算タブ: PL調整「階層化」</p>
          </article>

          <article class="selection-method" id="method-haphazard">
            <div class="selection-method-head"><span>HAP</span><div><small>判断ベース・非統計的</small><h3>任意抽出</h3></div></div>
            <p>特定の規則を使わず、監査人が<strong>意図的な偏りを避けて</strong>母集団全体から選びます。無作為抽出とは異なります。</p>
            <dl><div><dt>向く場面</dt><dd>非統計的サンプリング</dd></div><div><dt>抽出</dt><dd>期間・担当者・金額帯へ広く分散</dd></div><div><dt>注意</dt><dd>取りやすさ・見た目・連番への偏り</dd></div></dl>
            <p class="selection-tool-map">選択判断と偏り回避策を調書化</p>
          </article>

          <article class="selection-method" id="method-specific">
            <div class="selection-method-head"><span>100</span><div><small>サンプリングではない</small><h3>特定項目抽出</h3></div></div>
            <p>高額・異常・関連当事者・期末日前後など、監査目的上重要な項目を<strong>意図して全件確認</strong>します。</p>
            <dl><div><dt>向く場面</dt><dd>個別に重要、または高リスク</dd></div><div><dt>抽出</dt><dd>明確な金額・属性・期間基準</dd></div><div><dt>注意</dt><dd>結果を残余母集団へ投影しない</dd></div></dl>
            <p class="selection-tool-map">計算タブ: ステップ3 特定項目控除</p>
          </article>
        </div>

        <aside class="selection-source-direction" id="selection-source-direction">
          <span>C</span>
          <div>
            <small>COMPLETENESS</small>
            <h3>網羅性は「どう選ぶか」より「どこから選ぶか」</h3>
            <p>売上の計上漏れを探すのに売上帳から選ぶと、帳簿に存在しない取引は抽出できません。出荷記録から売上帳へ、買掛金の計上漏れなら期末後支払から買掛金元帳へ追跡するなど、漏れた項目を含む母集団を起点にします。</p>
          </div>
        </aside>

        <div class="selection-comparison-wrap">
          <table class="selection-comparison">
            <thead><tr><th>方法</th><th>抽出確率</th><th>強い目的</th><th>主な注意点</th></tr></thead>
            <tbody>
              <tr><th>MUS / PPS</th><td>金額に比例</td><td>過大計上・高額項目</td><td>ゼロ・負数・網羅性</td></tr>
              <tr><th>単純無作為</th><td>各項目で同じ</td><td>件数ベース・統制</td><td>完全な一覧と再現記録</td></tr>
              <tr><th>系統抽出</th><td>ランダム開始 + 間隔</td><td>一覧を効率的に分散</td><td>並びの周期性</td></tr>
              <tr><th>階層化</th><td>層ごとに設定</td><td>異質な母集団</td><td>各層を別々に設計</td></tr>
              <tr><th>任意抽出</th><td>測定しない</td><td>非統計的選択</td><td>無意識の偏り</td></tr>
              <tr><th>特定項目</th><td>意図的に選択</td><td>高額・異常・高リスク</td><td>残余母集団へ投影不可</td></tr>
            </tbody>
          </table>
        </div>

        <footer class="selection-reference">
          <p>この解説は一般的な監査サンプリングの考え方を整理したものです。実務では適用する監査基準、所属法人のマニュアル、母集団の性質を確認してください。</p>
          <div><a href="https://pcaobus.org/oversight/standards/auditing-standards/details/AS2315" target="_blank" rel="noopener">PCAOB AS 2315</a><a href="https://www.gao.gov/financial-audit-manual" target="_blank" rel="noopener">GAO Financial Audit Manual</a></div>
        </footer>
      </section>
    `);

    bindScenarios();
  }

  function selectScenario(key) {
    const scenario = scenarios[key];
    const panel = document.getElementById('selectionRecommendation');
    if (!scenario || !panel) return;

    document.querySelectorAll('[data-selection-scenario]').forEach(function(button) {
      const selected = button.dataset.selectionScenario === key;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });

    panel.classList.add('has-result');
    panel.querySelector('.selection-recommendation-label').textContent = scenario.label;
    panel.querySelector('h4').textContent = scenario.method;
    panel.querySelector('p').textContent = scenario.summary;
    panel.querySelector('small').textContent = scenario.caution;
    const link = panel.querySelector('a');
    link.href = '#' + scenario.target;
    link.hidden = false;
  }

  function bindScenarios() {
    document.querySelectorAll('[data-selection-scenario]').forEach(function(button) {
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function() {
        selectScenario(button.dataset.selectionScenario);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createGuide);
  } else {
    createGuide();
  }
})();

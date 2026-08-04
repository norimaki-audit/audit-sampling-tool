(function() {
  'use strict';

  function addStylesheet() {
    if (document.getElementById('workspacePagesStyles')) return;

    const stylesheet = document.createElement('link');
    stylesheet.id = 'workspacePagesStyles';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = './workspace-pages.css';
    document.head.appendChild(stylesheet);
  }

  function makePage(id, title, description, icon) {
    const page = document.createElement('section');
    page.id = id + '-page';
    page.className = 'workspace-page';
    page.dataset.workspacePage = id;
    page.setAttribute('aria-labelledby', id + 'PageTitle');
    page.innerHTML = `
      <header class="workspace-page-heading">
        <i class="ph ${icon}" aria-hidden="true"></i>
        <div>
          <span class="question-kicker">${id === 'calculate' ? 'CALCULATION WORKSPACE' : 'LEARNING WORKSPACE'}</span>
          <h2 id="${id}PageTitle">${title}</h2>
          <p>${description}</p>
        </div>
      </header>
    `;
    return page;
  }

  function createMobileSwitcher(overview) {
    const switcher = document.createElement('div');
    switcher.className = 'workspace-mobile-switcher';
    switcher.setAttribute('role', 'tablist');
    switcher.setAttribute('aria-label', 'ページ切替');
    switcher.innerHTML = `
      <button type="button" role="tab" data-workspace-page="calculate" aria-controls="calculate-page"><i class="ph ph-calculator" aria-hidden="true"></i>計算</button>
      <button type="button" role="tab" data-workspace-page="learn" aria-controls="learn-page"><i class="ph ph-book-open-text" aria-hidden="true"></i>解説</button>
    `;
    overview.insertAdjacentElement('afterend', switcher);
    return switcher;
  }

  function addCalculationWorkflow(page) {
    page.insertAdjacentHTML('beforeend', `
      <nav class="calculation-workflow" aria-label="計算の進め方">
        <a href="#audit-target"><span>1</span><strong>対象・リスク</strong><small>前提を設定</small></a>
        <a href="#sampling-design"><span>2</span><strong>テスト設計</strong><small>統制／実証</small></a>
        <a href="#error-evaluation-step"><span>3</span><strong>誤謬評価</strong><small>発見事項を評価</small></a>
      </nav>
      <div class="calculation-step-heading" id="calculation-step-1">
        <span>STEP 1</span>
        <div><strong>監査対象とリスクを設定</strong><small>何を、どのリスク水準で検証するかを整理します。</small></div>
      </div>
    `);
  }

  function separateErrorEvaluation() {
    const sampling = document.getElementById('sampling-design');
    const errorContent = document.getElementById('error-evaluation-tab');
    const tabs = sampling?.querySelector(':scope > .card-body > .tabs');
    if (!sampling || !errorContent || !tabs) return null;

    const tabButtons = Array.from(tabs.querySelectorAll('.tab-button'));
    tabButtons.forEach(function(button) {
      const action = button.getAttribute('onclick') || '';
      if (action.includes('error-evaluation')) {
        button.remove();
      } else if (action.includes('substantive')) {
        button.textContent = '実証テスト';
      }
    });
    tabs.classList.add('test-type-tabs');
    tabs.setAttribute('aria-label', 'テスト区分');

    const samplingHeader = sampling.querySelector(':scope > .card-header');
    if (samplingHeader && !samplingHeader.querySelector('.section-step-number')) {
      samplingHeader.insertAdjacentHTML('afterbegin', '<span class="section-step-number">STEP 2</span>');
    }

    errorContent.classList.remove('tab-content', 'active');
    errorContent.classList.add('error-evaluation-content');

    const step = document.createElement('section');
    step.id = 'error-evaluation-step';
    step.className = 'card fade-in error-evaluation-step';
    step.innerHTML = `
      <div class="card-header error-step-header">
        <span class="section-step-number">STEP 3</span>
        <i class="ph ph-scales" aria-hidden="true"></i>
        <span class="compact-heading-copy">
          <strong>誤謬評価</strong>
          <small>テストで発見した逸脱・誤謬を評価し、次の対応を判断</small>
        </span>
      </div>
      <div class="card-body"></div>
    `;
    step.querySelector('.card-body').appendChild(errorContent);
    return step;
  }

  function rebuildSideNavigation() {
    const nav = document.querySelector('.side-nav');
    if (!nav) return;

    nav.innerHTML = `
      <div class="side-label">ページ</div>
      <div class="workspace-side-tabs" role="tablist" aria-label="ページ切替">
        <a href="#calculate" role="tab" data-workspace-page="calculate" aria-controls="calculate-page"><i class="ph ph-calculator" aria-hidden="true"></i><span><strong>計算</strong><small>設計・評価</small></span></a>
        <a href="#learn" role="tab" data-workspace-page="learn" aria-controls="learn-page"><i class="ph ph-book-open-text" aria-hidden="true"></i><span><strong>解説</strong><small>考え方・根拠</small></span></a>
      </div>

      <div class="side-page-links" data-page-nav="calculate">
        <div class="side-label">計算ステップ</div>
        <a href="#audit-target"><span class="side-step">1</span><span>対象・リスク</span></a>
        <a href="#sampling-design"><span class="side-step">2</span><span>テスト設計</span></a>
        <a href="#error-evaluation-step"><span class="side-step">3</span><span>誤謬評価</span></a>
      </div>

      <div class="side-page-links" data-page-nav="learn">
        <div class="side-label">解説テーマ</div>
        <a href="#approach-lab"><i class="ph ph-flow-arrow" aria-hidden="true"></i><span>監査アプローチ</span></a>
        <a href="#logic-guide"><i class="ph ph-function" aria-hidden="true"></i><span>件数の決まり方</span></a>
        <a href="#quick-reference"><i class="ph ph-table" aria-hidden="true"></i><span>サンプル数早見表</span></a>
      </div>
    `;
  }

  function getPageForTarget(targetId, calculatePage, learnPage) {
    if (targetId === 'calculate') return 'calculate';
    if (targetId === 'learn') return 'learn';

    const target = document.getElementById(targetId);
    if (target && learnPage.contains(target)) return 'learn';
    if (target && calculatePage.contains(target)) return 'calculate';
    return 'calculate';
  }

  function initializePages() {
    const container = document.querySelector('.main > .container');
    const overview = document.getElementById('overview');
    const footer = container?.querySelector(':scope > .footer');
    if (!container || !overview || !footer || document.getElementById('calculate-page')) return;

    const overviewSummary = overview.querySelector('.version');
    if (overviewSummary) {
      overviewSummary.textContent = '監査リスクの評価からサンプル数の算定、誤謬評価までを、計算と解説に分けて確認';
    }

    const calculatePage = makePage(
      'calculate',
      'サンプリングを設計する',
      '対象とリスクを設定し、テストを設計した後に、発見事項を別ステップで評価します。',
      'ph-calculator'
    );
    const learnPage = makePage(
      'learn',
      'サンプリングを理解する',
      '監査アプローチの選び方と、なぜそのサンプル件数になるのかを順序立てて確認します。',
      'ph-book-open-text'
    );
    const mobileSwitcher = createMobileSwitcher(overview);
    mobileSwitcher.insertAdjacentElement('afterend', calculatePage);
    calculatePage.insertAdjacentElement('afterend', learnPage);

    addCalculationWorkflow(calculatePage);
    const errorStep = separateErrorEvaluation();

    [
      document.getElementById('audit-target'),
      document.getElementById('risk-model'),
      document.getElementById('sampling-design'),
      errorStep
    ].forEach(function(section) {
      if (section) calculatePage.appendChild(section);
    });

    [
      document.querySelector('.question-panel'),
      document.getElementById('approach-lab'),
      document.getElementById('logic-guide'),
      document.getElementById('quick-reference')
    ].forEach(function(section) {
      if (section) learnPage.appendChild(section);
    });

    rebuildSideNavigation();

    const side = document.getElementById('appSide');
    let currentPage = '';

    function updateSelectedSection(targetId) {
      document.querySelectorAll('.side-page-links a[href^="#"]').forEach(function(link) {
        link.classList.toggle('active', link.getAttribute('href') === '#' + targetId);
      });
    }

    function showPage(pageName, options) {
      const settings = options || {};
      const page = pageName === 'learn' ? 'learn' : 'calculate';
      currentPage = page;

      calculatePage.hidden = page !== 'calculate';
      learnPage.hidden = page !== 'learn';
      calculatePage.setAttribute('aria-hidden', page === 'calculate' ? 'false' : 'true');
      learnPage.setAttribute('aria-hidden', page === 'learn' ? 'false' : 'true');
      if (side) side.dataset.workspacePage = page;

      document.querySelectorAll('a[data-workspace-page], button[data-workspace-page]').forEach(function(control) {
        const selected = control.dataset.workspacePage === page;
        control.classList.toggle('active', selected);
        control.setAttribute('aria-selected', selected ? 'true' : 'false');
      });

      if (settings.updateHash) {
        window.history.pushState(null, '', '#' + page);
      }

      if (settings.scrollTop) {
        document.getElementById(page + '-page')?.scrollIntoView({ block: 'start', behavior: settings.smooth ? 'smooth' : 'auto' });
      }

      if (window.closeAppNav) window.closeAppNav();
    }

    window.showWorkspacePage = showPage;

    document.querySelectorAll('a[href^="#"]:not([data-workspace-page])').forEach(function(anchor) {
      anchor.addEventListener('click', function(event) {
        const targetId = anchor.getAttribute('href').slice(1);
        const target = document.getElementById(targetId);
        if (!target) return;

        event.preventDefault();
        const page = getPageForTarget(targetId, calculatePage, learnPage);
        showPage(page);
        updateSelectedSection(targetId);
        window.history.pushState(null, '', '#' + targetId);
        window.requestAnimationFrame(function() {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });
      });
    });

    document.addEventListener('click', function(event) {
      const pageControl = event.target.closest('a[data-workspace-page], button[data-workspace-page]');
      if (pageControl) {
        event.preventDefault();
        showPage(pageControl.dataset.workspacePage, { updateHash: true, scrollTop: true, smooth: true });
        return;
      }

      const anchor = event.target.closest('a[href^="#"]');
      if (!anchor) return;
      const targetId = anchor.getAttribute('href').slice(1);
      const page = getPageForTarget(targetId, calculatePage, learnPage);
      if (page !== currentPage) showPage(page);
      updateSelectedSection(targetId);
      if (window.closeAppNav) window.closeAppNav();
    });

    function showPageFromLocation() {
      const targetId = window.location.hash.slice(1) || 'calculate';
      const page = getPageForTarget(targetId, calculatePage, learnPage);
      showPage(page);
      updateSelectedSection(targetId);

      if (targetId !== 'calculate' && targetId !== 'learn') {
        window.requestAnimationFrame(function() {
          document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
        });
      }
    }

    window.addEventListener('hashchange', showPageFromLocation);
    window.addEventListener('popstate', showPageFromLocation);
    showPageFromLocation();
  }

  addStylesheet();
  initializePages();
})();

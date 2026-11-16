(function () {
  const data = window.RADAR_DATA || { rows: [], stats: {}, categoryNotes: { Default: '' } };
  const rows = Array.isArray(data.rows) ? data.rows.slice() : [];
  const stats = data.stats || {};
  const categoryNotes = data.categoryNotes || { Default: '' };

  const SORTS = {
    rank: { label: 'Rank', getValue: (row) => row.rank, direction: 'asc' },
    name: { label: 'Protocol', getValue: (row) => row.name.toLowerCase(), direction: 'asc' },
    category: { label: 'Category', getValue: (row) => row.category.toLowerCase(), direction: 'asc' },
    chains: { label: 'Chains', getValue: (row) => row.chains.join(',').toLowerCase(), direction: 'asc' },
    tvl: { label: 'TVL', getValue: (row) => row.tvl_usd, direction: 'desc' },
    change: { label: '7d', getValue: (row) => row.change_7d == null ? -Infinity : row.change_7d, direction: 'desc' },
    years: { label: 'Tokenless years', getValue: (row) => row.tokenless_years == null ? -Infinity : row.tokenless_years, direction: 'desc' },
    multiple: { label: 'Multiple', getValue: (row) => row.multiple_used, direction: 'desc' },
    implied: { label: 'Implied value', getValue: (row) => row.implied_value_usd, direction: 'desc' }
  };

  const TVL_BANDS = {
    all: () => true,
    gt500: (row) => row.tvl_usd > 500_000_000,
    '100to500': (row) => row.tvl_usd >= 100_000_000 && row.tvl_usd <= 500_000_000,
    '25to100': (row) => row.tvl_usd >= 25_000_000 && row.tvl_usd < 100_000_000,
    lt25: (row) => row.tvl_usd < 25_000_000
  };

  const state = {
    search: '',
    category: 'all',
    chain: 'all',
    tvlBand: 'all',
    watchlistOnly: false,
    sortKey: 'rank',
    sortDirection: 'asc',
    detailSlug: null
  };

  const elements = {
    appRoot: document.getElementById('app-root'),
    statsStrip: document.getElementById('stats-strip'),
    boardView: document.getElementById('board-view'),
    detailView: document.getElementById('detail-view'),
    searchInput: document.getElementById('search-input'),
    categorySelect: document.getElementById('category-select'),
    chainSelect: document.getElementById('chain-select'),
    tvlSelect: document.getElementById('tvl-select'),
    watchlistOnly: document.getElementById('watchlist-only'),
    filterSummary: document.getElementById('filter-summary'),
    boardHead: document.getElementById('board-head'),
    boardBody: document.getElementById('board-body')
  };

  function formatMoneyCompact(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: value >= 1_000_000_000 ? 2 : 1
    });
    return formatter.format(value).replace('K', 'K').replace('M', 'M').replace('B', 'B');
  }

  function formatMoneyFull(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(value);
  }

  function formatPercent(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}%`;
  }

  function formatYears(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    return value.toFixed(1);
  }

  function formatMultiple(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${value.toFixed(2)}x`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function chainPreview(chains) {
    if (!chains || !chains.length) return '—';
    if (chains.length <= 2) return chains.join(', ');
    return `${chains.slice(0, 2).join(', ')} +${chains.length - 2} more`;
  }

  function categoryOptions() {
    const counts = rows.reduce((acc, row) => {
      acc[row.category] = (acc[row.category] || 0) + 1;
      return acc;
    }, {});

    return Object.keys(counts)
      .sort((a, b) => a.localeCompare(b))
      .map((category) => ({ value: category, label: `${category} (${counts[category]})` }));
  }

  function chainOptions() {
    const counts = rows.reduce((acc, row) => {
      row.chains.forEach((chain) => {
        acc[chain] = (acc[chain] || 0) + 1;
      });
      return acc;
    }, {});

    return Object.keys(counts)
      .sort((a, b) => a.localeCompare(b))
      .map((chain) => ({ value: chain, label: `${chain} (${counts[chain]})` }));
  }

  function rowMatches(row) {
    const search = state.search.trim().toLowerCase();
    if (search && !row.name.toLowerCase().includes(search)) return false;
    if (state.category !== 'all' && row.category !== state.category) return false;
    if (state.chain !== 'all' && !row.chains.includes(state.chain)) return false;
    if (!TVL_BANDS[state.tvlBand](row)) return false;
    if (state.watchlistOnly && !row.on_watchlist) return false;
    return true;
  }

  function compareRows(a, b) {
    const sort = SORTS[state.sortKey];
    const dir = state.sortDirection === 'asc' ? 1 : -1;
    const left = sort.getValue(a);
    const right = sort.getValue(b);

    if (left < right) return -1 * dir;
    if (left > right) return 1 * dir;
    return a.rank - b.rank || a.name.localeCompare(b.name);
  }

  function getFilteredRows() {
    return rows.filter(rowMatches).sort(compareRows);
  }

  function detailRow() {
    return rows.find((row) => row.slug === state.detailSlug) || null;
  }

  function describeValue(row) {
    const growth = row.change_7d == null
      ? 'The growth tilt is neutral because the snapshot carries no seven-day change for it.'
      : row.change_7d >= 0
        ? `Its ${formatPercent(row.change_7d)} move over seven days nudges the estimate up rather than treating this as a flat peer multiple.`
        : `Its ${formatPercent(row.change_7d)} move over seven days trims the estimate back from the plain peer multiple.`;

    const age = row.tokenless_years == null
      ? 'The age tilt stays neutral because the snapshot does not expose how long it has been listed.'
      : `Its ${formatYears(row.tokenless_years)} years without a token add an age tilt that rewards a longer operating history without turning this into a certainty call.`;

    return [
      `${row.name} starts from ${formatMoneyCompact(row.tvl_usd)} in TVL and applies the ${formatMultiple(row.multiple_used)} market-cap-to-TVL multiple that token-bearing peers in ${row.category} record in this snapshot. That yields an implied value estimate of ${formatMoneyCompact(row.implied_value_usd)} from the same underlying figures.`,
      `${growth} ${age}`,
      'This is a model estimate from the snapshot, not a prediction or launch promise.'
    ];
  }

  function renderStats() {
    const items = [
      ['Protocols scanned', stats.totalProtocols],
      ['Pre-token found', stats.preTokenCount],
      ['Rows on board', stats.boardCount],
      ['Combined implied', formatMoneyCompact(stats.totalImpliedUsd)],
      ['Snapshot date', formatDate(stats.asOf)]
    ];

    elements.statsStrip.innerHTML = items.map(([label, value]) => (
      `<div class="stat-card"><dt>${escapeHtml(label)}</dt><dd class="mono">${escapeHtml(String(value))}</dd></div>`
    )).join('');
  }

  function renderSelectOptions(select, options, allLabel) {
    select.innerHTML = [`<option value="all">${escapeHtml(allLabel)}</option>`]
      .concat(options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`))
      .join('');
  }

  function renderControls() {
    renderSelectOptions(elements.categorySelect, categoryOptions(), 'All categories');
    renderSelectOptions(elements.chainSelect, chainOptions(), 'All chains');
    elements.searchInput.value = state.search;
    elements.categorySelect.value = state.category;
    elements.chainSelect.value = state.chain;
    elements.tvlSelect.value = state.tvlBand;
    elements.watchlistOnly.checked = state.watchlistOnly;
  }

  function renderHead() {
    const columns = [
      ['rank', 'Rank'],
      ['name', 'Protocol'],
      ['category', 'Category'],
      ['chains', 'Chains'],
      ['tvl', 'TVL'],
      ['change', '7d'],
      ['years', 'Years'],
      ['multiple', 'Multiple'],
      ['implied', 'Implied value']
    ];

    elements.boardHead.innerHTML = columns.map(([key, label]) => {
      const active = state.sortKey === key;
      const mark = active ? (state.sortDirection === 'asc' ? '↑' : '↓') : '·';
      return `<th scope="col"><button class="sort-button" type="button" data-sort="${key}" data-active="${active}" aria-sort="${active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}"><span>${label}</span><span class="sort-mark">${mark}</span></button></th>`;
    }).join('');
  }

  function renderBoard() {
    const filtered = getFilteredRows();
    elements.filterSummary.textContent = `${filtered.length} of ${rows.length} rows match the current screen.`;

    if (!filtered.length) {
      elements.boardBody.innerHTML = '<tr><td class="empty-state" colspan="9">No protocols match this screen. Relax a filter to widen the board.</td></tr>';
      return;
    }

    elements.boardBody.innerHTML = filtered.map((row) => {
      const changeClass = row.change_7d == null ? '' : row.change_7d >= 0 ? 'change change--up' : 'change change--down';
      return `
        <tr tabindex="0" data-slug="${escapeHtml(row.slug)}" aria-label="Open details for ${escapeHtml(row.name)}">
          <td class="rank-cell mono">${row.rank}</td>
          <td>
            <div class="protocol-cell">
              <span class="protocol-name">${escapeHtml(row.name)}</span>
              ${row.on_watchlist ? '<span class="watch-tag">Watchlist</span>' : ''}
            </div>
          </td>
          <td>${escapeHtml(row.category)}</td>
          <td class="chains-list" title="${escapeHtml(row.chains.join(', '))}">${escapeHtml(chainPreview(row.chains))}</td>
          <td class="mono right">${escapeHtml(formatMoneyCompact(row.tvl_usd))}</td>
          <td class="${changeClass}">${escapeHtml(formatPercent(row.change_7d))}</td>
          <td class="mono right">${escapeHtml(formatYears(row.tokenless_years))}</td>
          <td class="mono right">${escapeHtml(formatMultiple(row.multiple_used))}</td>
          <td class="value-cell">${escapeHtml(formatMoneyCompact(row.implied_value_usd))}</td>
        </tr>`;
    }).join('');
  }

  function renderDetail() {
    const row = detailRow();
    if (!row) {
      state.detailSlug = null;
      applyHash();
      return;
    }

    const note = categoryNotes[row.category] || categoryNotes.Default || '';
    const detailMarkup = `
      <div class="detail-shell">
        <button class="back-button" id="back-button" type="button">Back to board</button>
        <section class="panel detail-hero">
          <p class="eyebrow">Protocol detail</p>
          <div class="detail-headline">
            <h2>${escapeHtml(row.name)}</h2>
            ${row.on_watchlist ? '<span class="detail-tag">Watchlist</span>' : ''}
          </div>
          <p class="detail-note">${escapeHtml(note)}</p>
        </section>
        <div class="detail-grid">
          <section class="detail-main">
            <section class="panel">
              <div class="panel__heading">
                <p class="eyebrow">Snapshot stats</p>
                <h3>Current footing</h3>
              </div>
              <div class="metrics-grid">
                ${[
                  ['TVL', formatMoneyCompact(row.tvl_usd)],
                  ['Implied value', formatMoneyCompact(row.implied_value_usd)],
                  ['Multiple used', formatMultiple(row.multiple_used)],
                  ['7-day change', formatPercent(row.change_7d)],
                  ['Listed since', formatDate(row.listed_at)],
                  ['Years without token', formatYears(row.tokenless_years)],
                  ['Category', row.category],
                  ['Chains', row.chains.join(', ')]
                ].map(([label, value]) => `<div class="detail-metric"><span class="metric-label">${escapeHtml(label)}</span><span class="detail-metric__value">${escapeHtml(value)}</span></div>`).join('')}
              </div>
            </section>
            <section class="panel">
              <div class="panel__heading">
                <p class="eyebrow">Valuation logic</p>
                <h3>How this value is built</h3>
              </div>
              <div class="detail-summary">
                ${describeValue(row).map((sentence) => `<p>${escapeHtml(sentence)}</p>`).join('')}
              </div>
            </section>
          </section>
          <aside class="detail-side">
            <section class="panel">
              <div class="panel__heading panel__heading--split">
                <div>
                  <p class="eyebrow">Farm plan</p>
                  <h3>How to farm it</h3>
                </div>
                <p class="step-count">${row.farm_steps.length} steps</p>
              </div>
              <div class="timeline">
                ${row.farm_steps.map((step, index) => `
                  <article class="timeline-item">
                    <div class="timeline-index">${index + 1}</div>
                    <div class="timeline-card">
                      <p class="timeline-copy">${escapeHtml(step)}</p>
                    </div>
                  </article>
                `).join('')}
              </div>
            </section>
            <section class="panel">
              <p class="honesty-line">The protocol records no token in the snapshot; a launch is not guaranteed.</p>
            </section>
          </aside>
        </div>
      </div>`;

    elements.detailView.innerHTML = detailMarkup;
    const backButton = document.getElementById('back-button');
    if (backButton) backButton.addEventListener('click', () => setHash('/'));
  }

  function syncVisibility() {
    const inDetail = Boolean(state.detailSlug);
    elements.boardView.hidden = inDetail;
    elements.detailView.hidden = !inDetail;
  }

  function setSort(sortKey) {
    if (state.sortKey === sortKey) {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }
    state.sortKey = sortKey;
    state.sortDirection = SORTS[sortKey].direction;
  }

  function setHash(path) {
    const nextHash = `#${path}`;
    if (window.location.hash === nextHash) {
      applyHash();
      return;
    }
    window.location.hash = nextHash;
  }

  function applyHash() {
    const hash = window.location.hash || '#/';
    const match = hash.match(/^#\/p\/([^/]+)$/);
    if (match) {
      state.detailSlug = decodeURIComponent(match[1]);
    } else {
      state.detailSlug = null;
    }
    render();
  }

  function render() {
    renderStats();
    renderControls();
    renderHead();
    renderBoard();
    renderDetail();
    syncVisibility();
  }

  function onControlInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === elements.searchInput) state.search = elements.searchInput.value;
    if (target === elements.categorySelect) state.category = elements.categorySelect.value;
    if (target === elements.chainSelect) state.chain = elements.chainSelect.value;
    if (target === elements.tvlSelect) state.tvlBand = elements.tvlSelect.value;
    if (target === elements.watchlistOnly) state.watchlistOnly = elements.watchlistOnly.checked;
    renderBoard();
  }

  function onBoardClick(event) {
    const sortButton = event.target instanceof Element ? event.target.closest('[data-sort]') : null;
    if (sortButton) {
      setSort(sortButton.getAttribute('data-sort'));
      renderHead();
      renderBoard();
      return;
    }

    const row = event.target instanceof Element ? event.target.closest('[data-slug]') : null;
    if (row) {
      setHash(`/p/${encodeURIComponent(row.getAttribute('data-slug'))}`);
    }
  }

  function onBoardKeydown(event) {
    const row = event.target instanceof Element ? event.target.closest('[data-slug]') : null;
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setHash(`/p/${encodeURIComponent(row.getAttribute('data-slug'))}`);
      return;
    }

    if (event.key === 'Escape' && state.detailSlug) {
      setHash('/');
    }
  }

  function initEvents() {
    elements.searchInput.addEventListener('input', onControlInput);
    elements.categorySelect.addEventListener('change', onControlInput);
    elements.chainSelect.addEventListener('change', onControlInput);
    elements.tvlSelect.addEventListener('change', onControlInput);
    elements.watchlistOnly.addEventListener('change', onControlInput);
    elements.boardHead.addEventListener('click', onBoardClick);
    elements.boardBody.addEventListener('click', onBoardClick);
    elements.boardBody.addEventListener('keydown', onBoardKeydown);
    window.addEventListener('hashchange', applyHash);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.detailSlug) {
        setHash('/');
      }
    });
  }

  initEvents();
  applyHash();
})();

(function () {
  'use strict';
  const data = window.HELP_CONTENT;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const markdown = (v) => esc(v)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:|\/)[^)\s]+)\)/g, '<a href="$2">$1</a>');
  let lang = detectLanguage();

  function syncViewportMetrics() {
    const viewport = window.visualViewport;
    const width = viewport ? viewport.width : window.innerWidth;
    const height = viewport ? viewport.height : window.innerHeight;
    const left = viewport ? Math.max(0, viewport.offsetLeft) : 0;
    const top = viewport ? Math.max(0, viewport.offsetTop) : 0;
    const right = Math.max(0, window.innerWidth - left - width);
    const root = document.documentElement;
    root.style.setProperty('--viewport-height', `${Math.round(height)}px`);
    root.style.setProperty('--visual-left', `${Math.round(left)}px`);
    root.style.setProperty('--visual-right', `${Math.round(right)}px`);
    root.style.setProperty('--visual-top', `${Math.round(top)}px`);
  }

  function setSidebar(open) {
    const sidebar = $('[data-sidebar]');
    const trigger = $('[data-sidebar-open]');
    const scrim = $('.sidebar-scrim');
    sidebar.classList.toggle('open', open);
    document.body.classList.toggle('nav-open', open);
    trigger?.setAttribute('aria-expanded', String(open));
    scrim?.setAttribute('tabindex', open ? '0' : '-1');
    if (open) $('[data-sidebar-close]')?.focus({ preventScroll: true });
  }

  function detectLanguage() {
    const first = location.pathname.split('/').filter(Boolean)[0];
    return data.languages.includes(first) ? first : (localStorage.getItem('ddp-help-lang') || 'vi');
  }
  function tr(value) { return typeof value === 'object' ? (value[lang] || value.vi || '') : value; }
  function ui(key) { return data.ui[lang][key] || data.ui.vi[key] || key; }
  function pathFor(article, targetLang = lang) { return `/${targetLang}/${article.paths[targetLang]}/`; }
  function getArticle() {
    const current = location.pathname.replace(/^\/+|\/+$/g, '');
    const parts = current.split('/');
    if (!data.languages.includes(parts[0])) return null;
    const requested = parts.slice(1).join('/');
    return data.articles.find(a => a.paths[lang] === requested) || null;
  }
  function currentGroup(article) { return data.groups.find(g => g.id === article.group); }

  function renderNavigation(active) {
    $('[data-navigation]').innerHTML = data.groups.map(group => {
      const list = data.articles.filter(a => a.group === group.id).sort((a, b) => a.order - b.order);
      return `<section class="nav-group"><h2 class="nav-group-title">${esc(tr(group.name))}</h2>${list.map(a => `<a class="nav-link ${a.id === active ? 'active' : ''}" href="${pathFor(a)}">${esc(tr(a.title))}</a>`).join('')}</section>`;
    }).join('');
  }

  function renderBlock(block, sectionIndex, blockIndex) {
    if (block.type === 'p') return `<p>${markdown(tr(block.text))}</p>`;
    if (block.type === 'bullets') return `<ul class="${block.checklist ? 'checklist' : ''}">${tr(block.items).map(x => `<li>${markdown(x)}</li>`).join('')}</ul>`;
    if (block.type === 'steps') return tr(block.items).map((x, i) => `<div class="step"><span class="step-number">${i + 1}</span><div><p>${markdown(x)}</p></div></div>`).join('');
    if (block.type === 'callout') return `<aside class="callout ${esc(block.kind)}"><strong>${esc(tr(block.title))}</strong><span>${markdown(tr(block.text))}</span></aside>`;
    if (block.type === 'table') {
      const headers = tr(block.headers);
      return `<div class="help-table-wrap"><table class="help-table"><thead><tr>${headers.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${markdown(tr(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (block.type === 'image') {
      const id = `shot-${sectionIndex}-${blockIndex}`;
      const src = `/assets/help/screenshots/${encodeURIComponent(block.file)}`;
      return `<figure class="screenshot" id="${id}"><div class="image-placeholder"><span>${esc(ui('screenshotPending'))}<br><strong>${esc(block.file)}</strong></span></div><img src="${src}" alt="${esc(tr(block.caption))}" data-lightbox data-caption="${esc(tr(block.caption))}" hidden onload="this.hidden=false;this.previousElementSibling.hidden=true" onerror="this.remove()"><figcaption>${esc(tr(block.caption))} · <strong>${esc(block.file)}</strong><span class="image-open-hint">${esc(ui('imageOpen'))}</span></figcaption></figure>`;
    }
    return '';
  }

  function renderArticle(article) {
    const group = currentGroup(article);
    const related = data.articles.filter(a => a.group === article.group && a.id !== article.id).slice(0, 4);
    document.title = `${tr(article.title)} · Dan D Pak POS`;
    $('[data-page]').innerHTML = `
      <div class="breadcrumbs"><a href="/${lang}/">${esc(ui('home'))}</a><span>›</span><span>${esc(tr(group.name))}</span></div>
      <header class="article-head"><span class="eyebrow">${esc(tr(group.name))}</span><h1>${esc(tr(article.title))}</h1><p class="summary">${esc(tr(article.summary))}</p><div class="article-meta"><span>${esc(ui('updated'))}</span><span>•</span><span>${article.minutes} ${esc(ui('read'))}</span></div></header>
      <div class="article-layout"><article class="article">${article.sections.map((section, si) => `<section><h2 id="${esc(section.id)}">${esc(tr(section.title))}</h2>${section.blocks.map((b, bi) => renderBlock(b, si, bi)).join('')}</section>`).join('')}
      ${related.length ? `<section class="related"><h2>${esc(ui('related'))}</h2><div class="related-grid">${related.map(a => `<a class="related-card" href="${pathFor(a)}"><strong>${esc(tr(a.title))}</strong><br><small>${esc(tr(a.summary))}</small></a>`).join('')}</div></section>` : ''}</article>
      <aside class="toc"><strong>${esc(ui('onPage'))}</strong>${article.sections.map(s => `<a href="#${esc(s.id)}">${esc(tr(s.title))}</a>`).join('')}</aside></div>`;
  }

  function renderHome() {
    document.title = `${ui('helpCenter')} · Dan D Pak POS`;
    $('[data-page]').innerHTML = `<section class="home-hero"><h1>${esc(ui('homeTitle'))}</h1><p>${esc(ui('homeCopy'))}</p><div class="home-search" data-search-open><span>⌕</span><span>${esc(ui('searchPlaceholder'))}</span></div></section><section class="category-grid">${data.groups.map(group => { const list = data.articles.filter(a => a.group === group.id).sort((a,b) => a.order-b.order); return `<a class="category-card" href="${list[0] ? pathFor(list[0]) : '#'}"><span class="icon">${group.icon}</span><h2>${esc(tr(group.name))}</h2><p>${esc(tr(group.description))}</p><small>${list.length} ${esc(ui('articles'))} →</small></a>`; }).join('')}</section>`;
  }

  function renderUI() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    $$('[data-ui]').forEach(el => { el.textContent = ui(el.dataset.ui); });
    $('[data-language]').value = lang;
    $('[data-search-input]').placeholder = ui('searchPlaceholder');
    $('[data-home-link]').href = `/${lang}/`;
    const article = getArticle();
    renderNavigation(article?.id);
    article ? renderArticle(article) : renderHome();
    bindLocalLinks();
  }

  function bindLocalLinks() {
    $$('a[href^="/"]').forEach(link => link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || link.target) return;
      event.preventDefault();
      setSidebar(false);
      history.pushState({}, '', link.href);
      lang = detectLanguage();
      renderUI();
      scrollTo(0, 0);
    }, { once: true }));
  }

  function openSearch() {
    setSidebar(false);
    const modal = $('[data-search-modal]');
    modal.hidden = false;
    document.body.classList.add('search-open');
    const input = $('[data-search-input]');
    input.value = '';
    renderSearch('');
    setTimeout(() => input.focus(), 0);
  }
  function closeSearch() {
    $('[data-search-modal]').hidden = true;
    document.body.classList.remove('search-open');
  }
  function ensureLightbox() {
    let box = $('[data-lightbox-modal]');
    if (box) return box;
    box = document.createElement('div');
    box.className = 'lightbox-modal';
    box.dataset.lightboxModal = '';
    box.hidden = true;
    box.innerHTML = `<div class="lightbox-toolbar"><button type="button" data-lightbox-zoom></button><button type="button" class="lightbox-close" data-lightbox-close aria-label="Close">×</button></div><div class="lightbox-stage" data-lightbox-stage><img data-lightbox-image alt=""><div class="lightbox-caption" data-lightbox-caption></div></div>`;
    document.body.appendChild(box);
    return box;
  }
  function openLightbox(source) {
    const box = ensureLightbox();
    const image = $('[data-lightbox-image]', box);
    image.src = source.currentSrc || source.src;
    image.alt = source.alt || '';
    image.classList.remove('actual-size');
    $('[data-lightbox-caption]', box).textContent = source.dataset.caption || source.alt || '';
    $('[data-lightbox-zoom]', box).textContent = ui('imageActual');
    box.hidden = false;
    document.body.classList.add('lightbox-open');
  }
  function closeLightbox() {
    const box = $('[data-lightbox-modal]');
    if (!box || box.hidden) return;
    box.hidden = true;
    $('[data-lightbox-image]', box).src = '';
    document.body.classList.remove('lightbox-open');
  }
  function toggleLightboxZoom() {
    const box = ensureLightbox();
    const image = $('[data-lightbox-image]', box);
    const actual = image.classList.toggle('actual-size');
    $('[data-lightbox-zoom]', box).textContent = ui(actual ? 'imageFit' : 'imageActual');
    $('[data-lightbox-stage]', box).scrollTo({ top: 0, left: 0 });
  }
  function searchable(article) {
    return [tr(article.title), tr(article.summary), ...article.sections.flatMap(s => [tr(s.title), ...s.blocks.flatMap(b => b.text ? [tr(b.text)] : b.items ? tr(b.items) : b.rows ? b.rows.flatMap(row => row.map(tr)) : [])])].join(' ').toLocaleLowerCase();
  }
  function renderSearch(query) {
    const q = query.trim().toLocaleLowerCase();
    const matches = data.articles.filter(a => !q || searchable(a).includes(q)).slice(0, 12);
    $('[data-search-results]').innerHTML = matches.length ? matches.map(a => `<a class="search-result" href="${pathFor(a)}"><strong>${esc(tr(a.title))}</strong><small>${esc(tr(currentGroup(a).name))} · ${esc(tr(a.summary))}</small></a>`).join('') : `<div class="empty">${esc(ui('noResult'))}</div>`;
    $$('[data-search-results] a').forEach(link => link.addEventListener('click', e => { e.preventDefault(); closeSearch(); history.pushState({}, '', link.href); renderUI(); scrollTo(0,0); }));
  }

  document.addEventListener('click', event => {
    if (event.target.closest('[data-search-open]')) openSearch();
    if (event.target.closest('[data-search-close]')) closeSearch();
    if (event.target.closest('[data-lightbox]')) openLightbox(event.target.closest('[data-lightbox]'));
    if (event.target.closest('[data-lightbox-close]')) closeLightbox();
    if (event.target.closest('[data-lightbox-zoom]')) toggleLightboxZoom();
    if (event.target.matches('[data-lightbox-modal], [data-lightbox-stage]')) closeLightbox();
    if (event.target.closest('[data-sidebar-open]')) setSidebar(true);
    if (event.target.closest('[data-sidebar-close]')) setSidebar(false);
    if (event.target === $('[data-search-modal]')) closeSearch();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
    if (event.key === 'Escape') { closeSearch(); closeLightbox(); setSidebar(false); }
  });
  $('[data-search-input]').addEventListener('input', event => renderSearch(event.target.value));
  $('[data-language]').addEventListener('change', event => {
    const current = getArticle();
    lang = event.target.value;
    localStorage.setItem('ddp-help-lang', lang);
    history.pushState({}, '', current ? pathFor(current, lang) : `/${lang}/`);
    renderUI(); scrollTo(0, 0);
  });
  addEventListener('popstate', () => { lang = detectLanguage(); renderUI(); });
  addEventListener('resize', () => {
    syncViewportMetrics();
    if (window.innerWidth > 900) setSidebar(false);
  }, { passive: true });
  addEventListener('orientationchange', syncViewportMetrics, { passive: true });
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', syncViewportMetrics, { passive: true });
    visualViewport.addEventListener('scroll', syncViewportMetrics, { passive: true });
  }
  syncViewportMetrics();
  renderUI();
})();

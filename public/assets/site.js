const prefix = document.documentElement.lang === 'en' ? '/en' : '';
const languageLinks = [...document.querySelectorAll('[data-language-link]')];
const syncLanguageLinks = () => languageLinks.forEach(link => {
  const target = new URL(link.href);
  target.search = location.search;
  target.hash = location.hash;
  link.href = target.href;
});
syncLanguageLinks();
window.addEventListener('hashchange', syncLanguageLinks);
languageLinks.forEach(link => link.addEventListener('click', syncLanguageLinks));
const input = document.querySelector('#search-input');
if (input) {
  const form = document.querySelector('.search');
  const buttons = [...document.querySelectorAll('[data-filter]')];
  const cards = [...document.querySelectorAll('#note-list .note-card')];
  const params = new URLSearchParams(location.search);
  const resolveCategory = value => buttons.find(b => b.dataset.filter === value || b.dataset.legacyCategory === value)?.dataset.filter || 'all';
  let category = resolveCategory(params.get('category'));
  let corpus = new Map();
  input.value = params.get('q') || '';
  const update = (save = true) => {
    const terms = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    for (const card of cards) {
      const text = (corpus.get(card.dataset.slug) || card.textContent).toLocaleLowerCase();
      const matches = (category === 'all' || card.dataset.category === category) && terms.every(t => text.includes(t));
      card.hidden = !matches;
      if (matches) count++;
    }
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === category)));
    const result = document.querySelector('#results-count');
    result.textContent = count === 1 ? result.dataset.one : result.dataset.many.replace('{count}', count);
    document.querySelector('#empty-results').hidden = count !== 0;
    if (save) {
      const next = new URL(location.href);
      next.search = '';
      if (category !== 'all') next.searchParams.set('category', category);
      if (input.value.trim()) next.searchParams.set('q', input.value.trim());
      history.replaceState(null, '', next);
      syncLanguageLinks();
    }
  };
  form.addEventListener('submit', e => { e.preventDefault(); update(); });
  input.addEventListener('input', () => update());
  buttons.forEach(b => b.addEventListener('click', () => { category = b.dataset.filter; update(); }));
  document.querySelector('#reset-search').addEventListener('click', () => { input.value = ''; category = 'all'; update(); input.focus(); });
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(location.search);
    category = resolveCategory(p.get('category'));
    input.value = p.get('q') || '';
    update(false);
    syncLanguageLinks();
  });
  update(false);
  fetch(`${prefix}/search-index.json`).then(r => { if (!r.ok) throw new Error('Search index unavailable'); return r.json(); }).then(notes => {
    corpus = new Map(notes.map(n => [n.slug, [n.title, n.category, n.summary, ...n.tags, n.body].join(' ')]));
    update(false);
  }).catch(() => {
    document.querySelector('#search-fallback').hidden = false;
  });
}

let toastTimer;
function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}
document.querySelectorAll('.copy-code').forEach(button => button.addEventListener('click', async () => {
  const code = button.closest('.code-block').querySelector('pre code');
  try {
    await navigator.clipboard.writeText(code.textContent);
    notify(document.querySelector('#toast').dataset.copied);
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges(); selection.addRange(range);
    notify(document.querySelector('#toast').dataset.copyFallback);
  }
}));

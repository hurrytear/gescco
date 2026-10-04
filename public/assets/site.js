const input = document.querySelector('#search-input');
if (input) {
  const form = document.querySelector('.search');
  const buttons = [...document.querySelectorAll('[data-filter]')];
  const cards = [...document.querySelectorAll('#note-list .note-card')];
  const params = new URLSearchParams(location.search);
  let category = buttons.some(b => b.dataset.filter === params.get('category')) ? params.get('category') : '全部';
  let corpus = new Map();
  input.value = params.get('q') || '';
  const update = (save = true) => {
    const terms = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    for (const card of cards) {
      const text = (corpus.get(card.dataset.slug) || card.textContent).toLocaleLowerCase();
      const matches = (category === '全部' || card.dataset.category === category) && terms.every(t => text.includes(t));
      card.hidden = !matches;
      if (matches) count++;
    }
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === category)));
    document.querySelector('#results-count').textContent = `${count} 篇笔记`;
    document.querySelector('#empty-results').hidden = count !== 0;
    if (save) {
      const next = new URL(location.href);
      next.search = '';
      if (category !== '全部') next.searchParams.set('category', category);
      if (input.value.trim()) next.searchParams.set('q', input.value.trim());
      history.replaceState(null, '', next);
    }
  };
  form.addEventListener('submit', e => { e.preventDefault(); update(); });
  input.addEventListener('input', () => update());
  buttons.forEach(b => b.addEventListener('click', () => { category = b.dataset.filter; update(); }));
  document.querySelector('#reset-search').addEventListener('click', () => { input.value = ''; category = '全部'; update(); input.focus(); });
  window.addEventListener('popstate', () => {
    const p = new URLSearchParams(location.search);
    category = buttons.some(b => b.dataset.filter === p.get('category')) ? p.get('category') : '全部';
    input.value = p.get('q') || '';
    update(false);
  });
  update(false);
  fetch('/search-index.json').then(r => { if (!r.ok) throw new Error('Search index unavailable'); return r.json(); }).then(notes => {
    corpus = new Map(notes.map(n => [n.slug, [n.title, n.category, n.summary, ...n.tags, n.body].join(' ')]));
    update(false);
  }).catch(() => {
    document.querySelector('#results-count').textContent += ' · 当前仅检索标题与摘要';
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
    notify('代码已复制，请核对示例参数与运行环境。');
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges(); selection.addRange(range);
    notify('已选中代码，请手动复制。');
  }
}));

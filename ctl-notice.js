/* Cardiology Teaching Lab: site-wide notice and "Report a mistake" button.
   Included on every page with <script src="…/ctl-notice.js" defer></script>.

   To change the wording: edit NOTICE below and bump ACK_VERSION so everyone sees it again.
   To change where reports go: edit REPORT_URL.
     - A GitHub "new issue" link: page, slide and selected text are prefilled.
     - Any other link (e.g. a Google Form): opened with these placeholders filled in:
       {where} page name, slide and address; {selected} text the user highlighted;
       {url}, {page}, {details} the pieces separately. Get the entry numbers for a
       Google Form from its "Get pre-filled link" option. */
(function () {
  'use strict';

  var ACK_VERSION = '1';
  // Google Form (no account needed). Prefills "Page or tool" and, if text is highlighted, "What is wrong?".
  var REPORT_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdx6cWCKfRk5Uy2Vif-_KspEx9TZGSYG72BqPGz2VLKuXKPJw/viewform' +
    '?usp=pp_url&entry.1343790078={where}&entry.183730696={selected}';
  // GitHub alternative (needs a GitHub account):
  // var REPORT_URL = 'https://github.com/savagecabbagenl/cardiology-teaching-lab/issues/new';

  var NOTICE = {
    title: 'Before you start',
    paragraphs: [
      'This site is a <strong>work in progress</strong>. Its simulators and teaching sessions were created with the help of AI, so they <strong>may contain mistakes</strong>.',
      'It is for <strong>education only</strong>. Do not use it to make clinical decisions. Always check local guidelines and senior advice.',
      'If you spot something wrong, please tell us with the <strong>Report a mistake</strong> button at the bottom of every page.'
    ],
    button: 'I understand'
  };

  var KEY = 'ctl-ack';
  var doc = document;

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }

  var css = [
    '.ctl-report{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:12px;z-index:2147483000;',
    'display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.18);',
    'background:#14202b;color:#e6edf2;font:500 12.5px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;',
    'text-decoration:none;box-shadow:0 2px 10px rgba(0,0,0,.25);opacity:.88;cursor:pointer}',
    '.ctl-report:hover,.ctl-report:focus-visible{opacity:1;background:#22323f;text-decoration:underline}',
    '.ctl-report svg{width:13px;height:13px;flex:none}',
    '.ctl-veil{position:fixed;inset:0;z-index:2147483600;background:rgba(10,14,20,.62);display:flex;align-items:center;justify-content:center;padding:16px}',
    '.ctl-box{max-width:440px;width:100%;max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#1b1d22;border-radius:14px;',
    'padding:22px 22px 18px;box-shadow:0 12px 40px rgba(0,0,0,.35);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:left}',
    '.ctl-box h2{margin:0 0 10px;font-size:19px;line-height:1.25;color:#1b1d22;display:flex;align-items:center;gap:8px}',
    '.ctl-box h2 svg{width:22px;height:22px;flex:none;color:#b4232f}',
    '.ctl-box p{margin:0 0 10px}',
    '.ctl-box button{margin-top:8px;width:100%;padding:11px 16px;border:0;border-radius:10px;background:#b4232f;color:#fff;font:600 15px/1.2 inherit;font-family:inherit;cursor:pointer}',
    '.ctl-box button:hover{background:#951b26}.ctl-box button:focus-visible{outline:3px solid #f0a5ab;outline-offset:2px}',
    '@media (prefers-color-scheme:dark){.ctl-box{background:#1b1e23;color:#eef0f3}.ctl-box h2{color:#eef0f3}.ctl-box h2 svg{color:#ff5d68}}',
    '@media print{.ctl-report,.ctl-veil{display:none!important}}'
  ].join('');

  var FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>';
  var WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';

  function pageName() {
    var t = (doc.title || '').trim();
    return t || location.pathname.split('/').filter(Boolean).pop() || 'Home page';
  }

  function details() {
    var lines = [];
    var count = doc.getElementById('count');           // Ticker Talks slide counter
    if (count && count.textContent.trim()) lines.push('Slide: ' + count.textContent.trim());
    var sel = '';
    try { sel = String(window.getSelection() || '').trim(); } catch (e) {}
    if (sel) lines.push('Selected text: "' + sel.slice(0, 600) + '"');
    lines.push('Screen: ' + window.innerWidth + 'x' + window.innerHeight);
    lines.push('Reported: ' + new Date().toISOString().slice(0, 10));
    return lines.join('\n');
  }

  function reportHref() {
    var url = location.href;
    if (/github\.com\/.+\/issues\/new/.test(REPORT_URL)) {
      var body = [
        '**Page:** ' + pageName(),
        '**Link:** ' + url,
        details().split('\n').map(function (l) { return '**' + l.replace(/: /, ':** '); }).join('\n'),
        '',
        '### What is wrong?',
        '',
        '',
        '### What should it say? (a reference or guideline helps if you have one)',
        '',
        ''
      ].join('\n');
      return REPORT_URL + (REPORT_URL.indexOf('?') < 0 ? '?' : '&') +
        'title=' + encodeURIComponent('Mistake: ' + pageName()) +
        '&body=' + encodeURIComponent(body);
    }
    var count = doc.getElementById('count');
    var where = pageName() + (count && count.textContent.trim() ? ' (slide ' + count.textContent.trim() + ')' : '') + ' ' + url;
    var sel = '';
    try { sel = String(window.getSelection() || '').trim().slice(0, 600); } catch (e) {}
    return REPORT_URL
      .replace(/\{where\}/g, encodeURIComponent(where))
      .replace(/\{selected\}/g, sel ? encodeURIComponent('Highlighted text: "' + sel + '"\n\n') : '')
      .replace(/\{url\}/g, encodeURIComponent(url))
      .replace(/\{page\}/g, encodeURIComponent(pageName()))
      .replace(/\{details\}/g, encodeURIComponent(details()));
  }

  // Keep the button clear of bars fixed to the bottom of the screen (e.g. Ticker Talks controls).
  function placeButton(btn) {
    var lift = 0;
    var els = doc.body.querySelectorAll('*');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el === btn || el.classList.contains('ctl-veil')) continue;
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < window.innerHeight / 3 && r.width > window.innerWidth / 2 &&
          Math.abs(r.bottom - window.innerHeight) < 2) lift = Math.max(lift, r.height);
    }
    btn.style.bottom = (12 + lift) + 'px';
  }

  function showNotice() {
    var veil = doc.createElement('div');
    veil.className = 'ctl-veil';
    veil.innerHTML = '<div class="ctl-box" role="dialog" aria-modal="true" aria-labelledby="ctl-notice-title">' +
      '<h2 id="ctl-notice-title">' + WARN + NOTICE.title + '</h2>' +
      NOTICE.paragraphs.map(function (p) { return '<p>' + p + '</p>'; }).join('') +
      '<button type="button">' + NOTICE.button + '</button></div>';
    var btn = veil.querySelector('button');
    var prevFocus = doc.activeElement;

    // While the notice is open, keys must not drive the page underneath (slides, audio).
    function trapKeys(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') { e.preventDefault(); btn.focus(); }
      else if (e.target === btn && (e.key === 'Enter' || e.key === ' ')) return;
      e.stopImmediatePropagation();
    }
    function close() {
      store(ACK_VERSION);
      window.removeEventListener('keydown', trapKeys, true);
      veil.remove();
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) {}
    }
    btn.addEventListener('click', close);
    window.addEventListener('keydown', trapKeys, true);
    doc.body.appendChild(veil);
    btn.focus();
  }

  function init() {
    var style = doc.createElement('style');
    style.textContent = css;
    doc.head.appendChild(style);

    var a = doc.createElement('a');
    a.className = 'ctl-report';
    a.href = REPORT_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = FLAG + '<span>Report a mistake</span>';
    a.title = 'Tell us about a mistake on this page. Tip: highlight the wrong text first and it will be included.';
    // Build the link at the moment of use so it carries the current slide and any selected text.
    function refresh() { a.href = reportHref(); }
    a.addEventListener('mousedown', refresh);
    a.addEventListener('touchstart', refresh, {passive: true});
    a.addEventListener('focus', refresh);
    a.addEventListener('click', refresh);
    doc.body.appendChild(a);
    placeButton(a);
    window.addEventListener('resize', function () { placeButton(a); });
    setTimeout(function () { placeButton(a); }, 600);

    if (stored() !== ACK_VERSION) showNotice();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* solo 站点交互：主题切换 / 导航 / 滚动入场 / 语法 Tab */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 主题切换 ---------- */
  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('solo-theme', next); } catch (e) {}
      themeToggle.setAttribute('aria-label', next === 'dark' ? '切换到明亮主题' : '切换到暗色主题');
    });
  }

  /* ---------- 顶栏滚动态 ---------- */
  var header = document.getElementById('siteHeader');
  var onScroll = function () {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- 移动端菜单 ---------- */
  var navToggle = document.getElementById('navToggle');
  var mobileNav = document.getElementById('mobileNav');
  if (navToggle && mobileNav) {
    function setMenu(open) {
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
      mobileNav.hidden = !open;
    }
    function closeMenu(focusToggle) {
      if (mobileNav.hidden) return;
      setMenu(false);
      if (focusToggle) navToggle.focus();
    }
    navToggle.addEventListener('click', function () {
      var open = navToggle.getAttribute('aria-expanded') === 'true';
      setMenu(!open);
      if (!open) {
        // 打开后焦点进菜单第一项
        var first = mobileNav.querySelector('a');
        if (first) first.focus();
      }
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') closeMenu(false); // 复位 aria-label + aria-expanded
    });
    // Esc 关闭并把焦点还给汉堡按钮
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu(true);
    });
    // 点击菜单外部关闭
    document.addEventListener('click', function (e) {
      if (!mobileNav.hidden && !mobileNav.contains(e.target) && !navToggle.contains(e.target)) {
        closeMenu(false);
      }
    });
    // 窗口拖宽到桌面断点以上自动收起，避免残留一列链接
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) closeMenu(false);
    });
  }

  /* ---------- 导航当前区块高亮 ---------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.site-nav a'));
  if (navLinks.length && 'IntersectionObserver' in window) {
    var navSections = navLinks.map(function (a) {
      return document.querySelector(a.getAttribute('href'));
    }).filter(Boolean);
    var visible = {};
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var active = null;
      for (var i = 0; i < navSections.length; i++) {
        if (visible[navSections[i].id]) { active = navSections[i].id; break; }
      }
      navLinks.forEach(function (a) {
        var on = a.getAttribute('href') === '#' + active;
        a.classList.toggle('is-active', on);
        if (on) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-64px 0px -60% 0px' });
    navSections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- 滚动入场 ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  var heroDoc = document.getElementById('ewDoc');

  function reveal(el) { el.classList.add('is-revealed'); }

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(reveal);
    if (heroDoc) heroDoc.classList.add('is-revealed');
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          reveal(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { io.observe(el); });

    // hero 示意窗：进入视口即开始逐行"渲染"
    if (heroDoc) {
      var heroIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            heroDoc.classList.add('is-revealed');
            heroIO.disconnect();
          }
        });
      }, { threshold: 0.25 });
      heroIO.observe(heroDoc);
    }

    // 兜底：快速滚动 / 按 End 时 IntersectionObserver 可能整帧跳过中间元素，
    // 导致内容永久停在透明态。2.5s 后把「已进入或已掠过视口」的一律显示
    // （只看过的，不抢未看内容的动画）。
    setTimeout(function () {
      revealEls.forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) reveal(el);
      });
    }, 2500);
  }

  /* ---------- 语法 Tab（含键盘方向键） ---------- */
  var tablist = document.querySelector('.tablist');
  if (tablist) {
    var tabs = Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"]'));

    function selectTab(tab, focus) {
      tabs.forEach(function (t) {
        var selected = t === tab;
        t.setAttribute('aria-selected', String(selected));
        t.tabIndex = selected ? 0 : -1;
        var panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !selected;
      });
      if (focus) tab.focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { selectTab(tab, false); });
      tab.addEventListener('keydown', function (e) {
        var idx = null;
        if (e.key === 'ArrowRight') idx = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') idx = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') idx = 0;
        else if (e.key === 'End') idx = tabs.length - 1;
        if (idx !== null) { e.preventDefault(); selectTab(tabs[idx], true); }
      });
    });
  }

  /* ---------- FAQ 手风琴：一次只开一个 ---------- */
  var faqItems = Array.prototype.slice.call(document.querySelectorAll('.faq-list details'));
  faqItems.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) faqItems.forEach(function (o) { if (o !== d) o.open = false; });
    });
  });

  /* ---------- 另一种主题的字体样张预热 ----------
     六组样张是「亮/暗两张图 + display:none 切换」，隐藏的那张配了 loading="lazy"
     就永远不会下载 —— 一切主题就是六个空框，等图到了才补上（肉眼可见的闪）。
     这里在字体区快进入视口时把隐藏的那一半提前拉进缓存，切换即时且不拖慢首屏。 */
  var fontsSection = document.getElementById('fonts');
  if (fontsSection && 'IntersectionObserver' in window) {
    var prefetchIO = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      prefetchIO.disconnect();
      var hiddenSel = root.getAttribute('data-theme') === 'dark' ? '.fs-img-light' : '.fs-img-dark';
      Array.prototype.forEach.call(document.querySelectorAll(hiddenSel), function (img) {
        new Image().src = img.getAttribute('src'); // 仅预取入缓存，不插入 DOM
      });
    }, { rootMargin: '300px 0px' });
    prefetchIO.observe(fontsSection);
  }
})();

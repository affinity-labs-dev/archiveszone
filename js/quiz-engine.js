/*
 * Archives — reusable quiz engine
 * Renders an instant-play quiz into a page and shares progress across the site.
 *
 * Usage:
 *   initArchivesQuiz({
 *     topics: ["mixed","quran","seerah"],   // pill order; "mixed" = all topics
 *     topic: "mixed",                        // starting topic
 *     level: "beginner",                      // starting difficulty
 *     lockTopic: false,                       // hide topic pills (single-topic pages)
 *     kids: false,                            // start in kids mode
 *     perRound: 10                            // questions per round
 *   });
 */
(function () {
  "use strict";

  var META = {
    mixed:    { label: "Mixed",            ico: "🎲" },
    quran:    { label: "Quran",            ico: "📖" },
    hadith:   { label: "Hadith",           ico: "🗒️" },
    seerah:   { label: "Seerah",           ico: "🕋" },
    prophets: { label: "Prophets",         ico: "🌟" },
    history:  { label: "Islamic History",  ico: "🏛️" },
    pillars:  { label: "Pillars of Islam", ico: "🤲" },
    kids:     { label: "Kids",             ico: "🧒" }
  };
  var LEVELS = [
    { id: "beginner",     label: "Beginner",     ico: "🌱", desc: "The essentials — pillars, key prophets, Quran basics." },
    { id: "intermediate", label: "Intermediate", ico: "📚", desc: "A layer deeper into Seerah, hadith, and the eras." },
    { id: "advanced",     label: "Advanced",     ico: "🏆", desc: "Dates, names, and details for confident learners." }
  ];
  var STORE_KEY = "archives_quiz_v1";

  function $(id) { return document.getElementById(id); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function saveStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function track(name, props) {
    try { if (window.ttq) ttq.track(name, props || {}); } catch (e) {}
    try { if (window.fbq) fbq("trackCustom", name, props || {}); } catch (e) {}
    try { if (window.gtag) gtag("event", name, props || {}); } catch (e) {}
  }

  window.initArchivesQuiz = function (cfg) {
    cfg = cfg || {};
    var BANK = window.ARCHIVES_QUIZ_BANK || [];
    if (!BANK.length || !$("quiz")) return;

    var perRound = cfg.perRound || 10;
    var state = {
      topic: cfg.topic || "mixed",
      level: cfg.level || "beginner",
      kids: !!cfg.kids,
      age: cfg.age || null,
      order: [], idx: 0, score: 0, answered: false
    };

    /* ---------- topic pills ---------- */
    var topicPills = $("cat-pills");
    if (topicPills) {
      if (cfg.lockTopic) {
        var tw = topicPills.closest(".filters");
        if (tw) tw.style.display = "none";
      } else {
        (cfg.topics || ["mixed", "quran", "hadith", "seerah", "prophets", "history", "pillars"]).forEach(function (id) {
          var m = META[id]; if (!m) return;
          var b = document.createElement("button");
          b.type = "button"; b.className = "pill"; b.dataset.cat = id;
          b.innerHTML = '<span class="pe">' + m.ico + "</span>" + m.label;
          b.addEventListener("click", function () {
            state.topic = id;
            if (state.kids) { state.kids = false; var k = $("kids-toggle"); if (k) k.checked = false; }
            sync(); start();
          });
          topicPills.appendChild(b);
        });
      }
    }

    /* ---------- level pills + sheet ---------- */
    var levelPills = $("diff-pills"), sheetOpts = $("lvl-sheet-opts"), lvlBtn = $("lvl-btn"), sheet = $("lvl-sheet");
    LEVELS.forEach(function (lv) {
      if (levelPills) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "pill diff"; b.dataset.diff = lv.id;
        b.innerHTML = '<span class="pe">' + lv.ico + "</span>" + lv.label;
        b.addEventListener("click", function () { pickLevel(lv.id); });
        levelPills.appendChild(b);
      }
      if (sheetOpts) {
        var s = document.createElement("button");
        s.type = "button"; s.className = "sheet-opt"; s.dataset.diff = lv.id;
        s.innerHTML = '<span class="se">' + lv.ico + '</span><span><span class="st">' + lv.label +
          '</span><span class="sd">' + lv.desc + '</span></span><span class="schk">✓</span>';
        s.addEventListener("click", function () { closeSheet(); pickLevel(lv.id); });
        sheetOpts.appendChild(s);
      }
    });
    function pickLevel(id) {
      state.level = id;
      if (state.kids) { state.kids = false; var k = $("kids-toggle"); if (k) k.checked = false; }
      sync(); start();
    }
    function openSheet() {
      if (!sheet) return;
      sheet.hidden = false; if (lvlBtn) lvlBtn.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      var sel = sheetOpts && sheetOpts.querySelector('[aria-pressed="true"]'); if (sel) sel.focus();
    }
    function closeSheet() {
      if (!sheet) return;
      sheet.hidden = true; if (lvlBtn) lvlBtn.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }
    if (lvlBtn) lvlBtn.addEventListener("click", openSheet);
    if ($("lvl-sheet-bg")) $("lvl-sheet-bg").addEventListener("click", closeSheet);
    if ($("lvl-sheet-close")) $("lvl-sheet-close").addEventListener("click", closeSheet);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheet && !sheet.hidden) closeSheet(); });

    /* ---------- kids toggle ---------- */
    var kidsToggle = $("kids-toggle");
    if (kidsToggle) {
      kidsToggle.checked = state.kids;
      kidsToggle.addEventListener("change", function (e) {
        state.kids = e.target.checked; sync(); start(); scrollToQuiz();
      });
    }
    var kidsBtn = $("kids-play");
    if (kidsBtn) kidsBtn.addEventListener("click", function () {
      if (kidsToggle && !kidsToggle.checked) {
        kidsToggle.checked = true;
        kidsToggle.dispatchEvent(new Event("change", { bubbles: true }));
      } else scrollToQuiz();
    });

    function scrollToQuiz() {
      var t = $("hero") || $("quiz");
      if (t && t.scrollIntoView) t.scrollIntoView({ behavior: "smooth" });
    }

    /* ---------- topic jump cards (optional) ---------- */
    Array.prototype.forEach.call(document.querySelectorAll("[data-quiz-topic]"), function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-quiz-topic");
        if (kidsToggle) { kidsToggle.checked = false; }
        state.kids = false; state.topic = id; sync(); start(); scrollToQuiz();
      });
    });

    /* ---------- kids "packs": stay in kids mode, switch topic ---------- */
    var packEls = document.querySelectorAll("[data-kids-pack]");
    Array.prototype.forEach.call(packEls, function (el) {
      el.addEventListener("click", function () {
        state.kids = true;
        state.topic = el.getAttribute("data-kids-pack");
        Array.prototype.forEach.call(packEls, function (o) {
          o.setAttribute("aria-pressed", o === el);
        });
        start(); scrollToQuiz();
      });
    });
    if (packEls.length) {
      Array.prototype.forEach.call(packEls, function (o) {
        o.setAttribute("aria-pressed", o.getAttribute("data-kids-pack") === state.topic);
      });
    }

    /* ---------- kids age bands (optional): widen the pool as they grow ---------- */
    var ageEls = document.querySelectorAll("[data-age-band]");
    Array.prototype.forEach.call(ageEls, function (el) {
      el.addEventListener("click", function () {
        state.age = el.getAttribute("data-age-band");   // "young" | "middle" | "older"
        Array.prototype.forEach.call(ageEls, function (o) { o.setAttribute("aria-pressed", o === el); });
        start(); scrollToQuiz();
      });
    });
    if (ageEls.length) {
      state.age = state.age || cfg.age || "young";
      Array.prototype.forEach.call(ageEls, function (o) {
        o.setAttribute("aria-pressed", o.getAttribute("data-age-band") === state.age);
      });
    }

    function sync() {
      if (topicPills) Array.prototype.forEach.call(topicPills.children, function (b) {
        b.setAttribute("aria-pressed", b.dataset.cat === state.topic && !state.kids);
      });
      if (levelPills) Array.prototype.forEach.call(levelPills.children, function (b) {
        b.setAttribute("aria-pressed", b.dataset.diff === state.level);
      });
      if (sheetOpts) Array.prototype.forEach.call(sheetOpts.children, function (b) {
        b.setAttribute("aria-pressed", b.dataset.diff === state.level);
      });
      var lv = LEVELS.filter(function (l) { return l.id === state.level; })[0] || LEVELS[0];
      if ($("lvl-btn-ico")) $("lvl-btn-ico").textContent = state.kids ? META.kids.ico : lv.ico;
      if ($("lvl-btn-txt")) $("lvl-btn-txt").textContent = state.kids ? "Kids mode" : lv.label;
    }

    /* ---------- question selection ---------- */
    function pool() {
      var p;
      if (state.kids) {
        // Age bands widen the pool: youngest get kid-flagged only, older children
        // also get beginner and then intermediate questions.
        if (state.age === "middle") {
          p = BANK.filter(function (q) { return q.k || q.d === "beginner"; });
        } else if (state.age === "older") {
          p = BANK.filter(function (q) { return q.k || q.d === "beginner" || q.d === "intermediate"; });
        } else {
          p = BANK.filter(function (q) { return q.k; });
        }
        var topic = state.topic || cfg.topic;
        if (topic && topic !== "mixed") {
          var scoped = p.filter(function (q) { return q.c === topic; });
          if (scoped.length >= 4) p = scoped;
        }
        return p;
      }
      if (state.topic === "mixed") {
        p = BANK.filter(function (q) { return q.d === state.level; });
        return p.length >= 4 ? p : BANK.slice();
      }
      p = BANK.filter(function (q) { return q.c === state.topic && q.d === state.level; });
      if (p.length < 4) p = BANK.filter(function (q) { return q.c === state.topic; });
      return p;
    }

    function start() {
      var p = shuffle(pool().slice());
      state.order = p.slice(0, Math.min(perRound, p.length));
      state.idx = 0; state.score = 0; state.answered = false;
      if (!state.order.length) return;
      if ($("q-result")) $("q-result").style.display = "none";
      if ($("q-play")) $("q-play").style.display = "block";
      if ($("q-level-label")) {
        var AGE = { young: "Ages 5–7", middle: "Ages 8–10", older: "Ages 11+" };
        var lead = state.kids ? (state.age ? AGE[state.age] : "Kids mode") : cap(state.level) + " level";
        $("q-level-label").textContent = lead + " · " + state.order.length + " questions";
      }
      render();
    }

    function render() {
      state.answered = false;
      var q = state.order[state.idx], total = state.order.length;
      var packed = state.kids && state.topic && state.topic !== "mixed";
      var m = META[packed ? state.topic : (state.kids ? "kids" : q.c)] || META.mixed;
      if ($("q-emoji")) $("q-emoji").textContent = m.ico;
      if ($("q-cat-label")) $("q-cat-label").textContent =
        packed ? m.label : (state.kids ? "Kids Quiz" : m.label);
      if ($("q-progress")) $("q-progress").style.width = (state.idx / total * 100) + "%";
      if ($("q-count")) $("q-count").textContent = "Question " + (state.idx + 1) + " of " + total;
      if ($("q-scoreline")) $("q-scoreline").textContent = "⭐ " + state.score;
      $("q-text").textContent = q.q;
      var ex = $("q-explain"); if (ex) { ex.className = "explain"; ex.innerHTML = ""; }
      var next = $("q-next");
      if (next) { next.disabled = true; next.textContent = (state.idx === total - 1) ? "See results →" : "Next →"; }
      var opts = $("q-opts"); opts.innerHTML = "";
      var keys = ["A", "B", "C", "D"];
      q.o.forEach(function (text, i) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "opt";
        b.innerHTML = '<span class="key">' + keys[i] + '</span><span>' + text + '</span><span class="tick"></span>';
        b.addEventListener("click", function () { answer(i, b); });
        opts.appendChild(b);
      });
    }

    function answer(i, btn) {
      if (state.answered) return;
      state.answered = true;
      var q = state.order[state.idx], buttons = $("q-opts").children;
      Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
      if (i === q.a) {
        btn.classList.add("correct"); btn.querySelector(".tick").textContent = "✓";
        state.score++;
      } else {
        btn.classList.add("wrong"); btn.querySelector(".tick").textContent = "✗";
        buttons[q.a].classList.add("correct");
        buttons[q.a].querySelector(".tick").textContent = "✓";
      }
      var ex = $("q-explain");
      if (ex) {
        ex.innerHTML = "<b>" + (i === q.a ? "✅ Correct! " : "❌ Answer: " + q.o[q.a] + ". ") + "</b>" + q.e;
        ex.className = "explain show";
      }
      if ($("q-scoreline")) $("q-scoreline").textContent = "⭐ " + state.score;
      var next = $("q-next"); if (next) { next.disabled = false; next.focus(); }
    }

    if ($("q-next")) $("q-next").addEventListener("click", function () {
      if (!state.answered) return;
      if (state.idx < state.order.length - 1) {
        state.idx++;
        if ($("q-progress")) $("q-progress").style.width = (state.idx / state.order.length * 100) + "%";
        render();
      } else finish();
    });

    function finish() {
      var total = state.order.length, pct = Math.round(state.score / total * 100);
      if ($("q-play")) $("q-play").style.display = "none";
      if ($("q-result")) $("q-result").style.display = "block";
      if ($("q-badge")) $("q-badge").textContent = pct === 100 ? "🏆" : pct >= 70 ? "🎉" : pct >= 40 ? "💪" : "📖";
      if ($("q-final")) $("q-final").textContent = state.score + " / " + total;
      var msg = pct === 100 ? "Perfect score, mashaAllah! You clearly know your stuff."
        : pct >= 70 ? "Strong work — you know this well."
        : pct >= 40 ? "Good start. Read the explanations and try again to climb."
        : "Every expert started here. Give it another go — you'll improve fast.";
      if ($("q-msg")) $("q-msg").textContent = msg + " (" + pct + "%)";
      bumpStats(total, state.score);
      track("quiz_complete", {
        category: state.kids ? "kids" : state.topic, difficulty: state.level,
        score: state.score, total: total, percent: pct
      });
    }

    /* ---------- progress ---------- */
    function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
    function bumpStats(total, score) {
      var s = loadStore();
      s.quizzes = (s.quizzes || 0) + 1;
      s.answered = (s.answered || 0) + total;
      s.correct = (s.correct || 0) + score;
      s.xp = (s.xp || 0) + score * 10;
      s.best = Math.max(s.best || 0, Math.round(score / total * 100));
      var t = today();
      if (s.lastDay !== t) {
        var y = new Date(); y.setDate(y.getDate() - 1);
        var yStr = y.getFullYear() + "-" + (y.getMonth() + 1) + "-" + y.getDate();
        s.streak = (s.lastDay === yStr) ? (s.streak || 0) + 1 : 1;
        s.lastDay = t;
      } else if (!s.streak) { s.streak = 1; }
      saveStore(s);
      renderStats();
    }
    /* Kids progress: stars collected rather than XP/streak metrics. */
    function renderStars() {
      var el = $("kid-stars"); if (!el) return;
      var s = loadStore();
      var stars = s.correct || 0;
      var row = "";
      for (var i = 0; i < 10; i++) row += (i < Math.min(10, stars) ? "⭐" : "☆");
      el.innerHTML =
        '<div class="star-row" aria-hidden="true">' + row + "</div>" +
        '<p class="star-count"><b>' + stars + '</b> star' + (stars === 1 ? "" : "s") +
        " collected so far" + (stars >= 10 ? " — brilliant!" : "") + "</p>";
    }

    function renderStats() {
      renderStars();
      var el = $("stats"); if (!el) return;
      var s = loadStore();
      var items = [
        { e: "⚡", n: s.xp || 0, l: "XP earned" },
        { e: "🎮", n: s.quizzes || 0, l: "Quizzes done" },
        { e: "🔥", n: s.streak || 0, l: "Day streak" },
        { e: "🏅", n: (s.best || 0) + "%", l: "Best score" },
        { e: "🎯", n: (s.answered ? Math.round((s.correct || 0) / s.answered * 100) : 0) + "%", l: "Accuracy" }
      ];
      el.innerHTML = "";
      items.forEach(function (it) {
        var d = document.createElement("div");
        d.className = "stat";
        d.innerHTML = '<div class="e">' + it.e + '</div><div class="n">' + it.n + '</div><div class="l">' + it.l + "</div>";
        el.appendChild(d);
      });
    }

    if ($("q-retry")) $("q-retry").addEventListener("click", start);
    if ($("q-newtopic")) $("q-newtopic").addEventListener("click", function () {
      if ($("q-result")) $("q-result").style.display = "none";
      if ($("q-play")) $("q-play").style.display = "block";
      scrollToQuiz();
    });

    /* store/app click tracking */
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      if (/apps\.apple\.com|play\.google\.com|web\.archiveszone\.app|\/start\.html/.test(a.href || "")) {
        track("Download", { source: location.pathname });
      }
    });

    sync();
    renderStats();
    start();
  };
})();

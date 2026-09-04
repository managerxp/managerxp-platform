/* ==========================================================================
   CafeXP AI — From the numbers to the answer.

   This page renders an analysis; it does not produce one. Every figure on
   screen came from the backend, which computed it from SQL. Nothing here
   derives, rounds or infers a number — if a value is not in the response it is
   not shown, because a figure invented in the renderer would be exactly the
   thing the whole feature exists to avoid.
   ========================================================================== */
(function (global) {
  "use strict";

  var UI = global.CXUI, Store = global.CXStore, Icon = global.CXIcon, Motion = global.CXMotion;
  global.CXPages = global.CXPages || {};

  var rootEl = null;
  var thread = [];          // { question, answer }
  var suggestions = [];
  var health = null;
  var asking = false;

  // One conversation per visit, so a follow-up keeps the previous period.
  var conversationId = null;

  var CONFIDENCE = {
    high:   { label: "High confidence",   status: "online",  note: "Enough volume to stand behind this." },
    medium: { label: "Medium confidence", status: "warning", note: "The pattern holds, but on limited volume." },
    low:    { label: "Low confidence",    status: "idle",    note: "Too little data to be sure." }
  };

  /* ==========================================================================
     ASK
     ========================================================================== */
  function ask(question) {
    var text = String(question || "").trim();
    if (!text || asking) return;

    asking = true;
    thread.push({ question: text, answer: null, error: null });
    render();
    scrollToEnd();

    Store.aiAsk(text, conversationId)
      .then(function (answer) {
        thread[thread.length - 1].answer = answer;
      })
      .catch(function (err) {
        thread[thread.length - 1].error = err.message;
      })
      .then(function () {
        asking = false;
        render();
        scrollToEnd();
      });
  }

  function scrollToEnd() {
    // Let the render settle before moving, or the target is the old height.
    setTimeout(function () {
      var scroller = document.getElementById("pageScroll");
      if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    }, 60);
  }

  /* ==========================================================================
     ANSWER
     ========================================================================== */
  function answerCard(entry) {
    var card = UI.el("div", { class: "ai-turn col gap-4" });

    /* the question, restated so a long thread stays readable */
    var asked = UI.el("div", { class: "ai-asked" });
    asked.innerHTML = Icon("search", 14) + "<span>" + UI.esc(entry.question) + "</span>";
    card.appendChild(asked);

    if (entry.error) {
      card.appendChild(UI.el("div", {
        class: "notice", dataset: { status: "offline" },
        html: Icon("alert", 16) + "<div>" + UI.esc(entry.error) + "</div>"
      }));
      return card;
    }

    if (!entry.answer) {
      var thinking = UI.el("div", { class: "ai-thinking row gap-3" });
      thinking.innerHTML =
        '<span class="spinner"></span>' +
        "<span>Reading the café's figures…</span>";
      card.appendChild(thinking);
      return card;
    }

    var a = entry.answer;

    /* ---- analysis ---- */
    var analysis = UI.el("section", { class: "ai-block" });
    analysis.innerHTML =
      '<div class="ai-block-head">' +
        '<span class="ai-block-title">Analysis</span>' +
        (a.confidence
          ? '<span class="badge" data-status="' + (CONFIDENCE[a.confidence] || CONFIDENCE.low).status +
            '" data-tip="' + UI.esc((CONFIDENCE[a.confidence] || CONFIDENCE.low).note) + '">' +
            UI.esc((CONFIDENCE[a.confidence] || CONFIDENCE.low).label) + "</span>"
          : "") +
      "</div>" +
      '<p class="ai-prose">' + UI.esc(a.answer) + "</p>";

    /* The window and the baseline, always stated — a percentage with no
       comparison basis is not an answer. */
    var basis = UI.el("div", { class: "ai-basis row gap-2 wrap" });
    basis.innerHTML =
      '<span class="ai-tag">' + Icon("clock", 12) + UI.esc(a.period.label) + "</span>" +
      (a.comparison
        ? '<span class="ai-tag">' + Icon("reports", 12) + "vs " + UI.esc(a.comparison.basis) + "</span>"
        : "") +
      (a.tools_used && a.tools_used.length
        ? '<span class="ai-tag faint" data-tip="' + UI.esc(a.tools_used.join(", ")) + '">' +
          a.tools_used.length + " data source" + (a.tools_used.length === 1 ? "" : "s") + "</span>"
        : "");
    analysis.appendChild(basis);
    card.appendChild(analysis);

    /* ---- evidence ---- */
    if (a.evidence && a.evidence.length) {
      var ev = UI.el("section", { class: "ai-block" });
      ev.innerHTML = '<div class="ai-block-head"><span class="ai-block-title">Evidence</span></div>';

      var grid = UI.el("div", { class: "ai-evidence" });
      a.evidence.forEach(function (item) {
        // Direction comes from the sign the backend sent, not from a guess.
        var tone = item.change === null || item.change === undefined
          ? "idle"
          : (item.change > 0 ? "online" : (item.change < 0 ? "offline" : "idle"));

        var cell = UI.el("div", { class: "ai-metric", dataset: { status: tone } });
        cell.innerHTML =
          '<div class="ai-metric-label">' + UI.esc(item.label) + "</div>" +
          '<div class="ai-metric-value">' + UI.esc(item.value) + "</div>" +
          (item.change_label
            ? '<div class="ai-metric-change">' + UI.esc(item.change_label) + "</div>"
            : "");
        grid.appendChild(cell);
      });
      ev.appendChild(grid);
      card.appendChild(ev);
    }

    /* ---- next step ---- */
    if (a.suggested_next_step) {
      var next = UI.el("section", { class: "ai-block ai-next" });
      next.innerHTML =
        '<div class="ai-block-head"><span class="ai-block-title">Suggested next step</span></div>' +
        '<p class="ai-prose">' + UI.esc(a.suggested_next_step) + "</p>";
      card.appendChild(next);
    }

    /* ---- how it was produced ---- */
    var foot = UI.el("div", { class: "ai-foot faint row gap-3 wrap" });
    foot.innerHTML =
      "<span>" +
        (a.provider === "deterministic"
          ? "Computed directly from your data"
          : "Computed from your data, phrased by " + UI.esc(a.provider)) +
      "</span>" +
      (a.degraded ? '<span data-status="warning">model unavailable, wording is plain</span>' : "") +
      (a.duration_ms ? "<span>" + a.duration_ms + " ms</span>" : "");
    card.appendChild(foot);

    return card;
  }

  /* ==========================================================================
     RENDER
     ========================================================================== */
  function render() {
    if (!rootEl) return;

    var host = rootEl.querySelector("#aiThread");
    if (host) {
      UI.clear(host);
      thread.forEach(function (entry) { host.appendChild(answerCard(entry)); });
      if (thread.length) Motion.stagger(host.children, { step: 0.03, y: 10, maxDelay: 0.2 });
    }

    var empty = rootEl.querySelector("#aiEmpty");
    if (empty) empty.classList.toggle("hidden", thread.length > 0);

    var askBtn = rootEl.querySelector("#aiAsk");
    if (askBtn) {
      askBtn.disabled = asking;
      askBtn.querySelector(".btn-label").textContent = asking ? "Working…" : "Ask CafeXP AI";
    }

    var input = rootEl.querySelector("#aiInput");
    if (input) input.disabled = asking;

    var reset = rootEl.querySelector("#aiReset");
    if (reset) reset.classList.toggle("hidden", thread.length === 0);
  }

  function renderSuggestions() {
    var host = rootEl && rootEl.querySelector("#aiSuggestions");
    if (!host) return;
    UI.clear(host);

    suggestions.forEach(function (s) {
      var chip = UI.el("button", { class: "ai-suggestion", type: "button", text: s.text });
      chip.addEventListener("click", function () {
        var input = rootEl.querySelector("#aiInput");
        input.value = s.text;
        ask(s.text);
        input.value = "";
      });
      host.appendChild(chip);
    });
  }

  function renderHealth() {
    var host = rootEl && rootEl.querySelector("#aiHealth");
    if (!host || !health) return;

    // Say plainly how answers are produced. A café without a model key still
    // gets real analysis, and should not be left wondering.
    host.innerHTML =
      '<span class="ai-tag faint">' + Icon("sparkle", 12) +
      (health.configured
        ? UI.esc(health.provider) + " · " + UI.esc(health.model)
        : "No model configured — answers computed directly from your data") +
      "</span>";
  }

  /* ==========================================================================
     PAGE
     ========================================================================== */
  global.CXPages.ai = {
    title: "CafeXP AI",
    subtitle: "From the numbers to the answer",

    mount: function (root) {
      rootEl = root;
      thread = [];
      asking = false;
      conversationId = "c" + Date.now();

      var page = UI.el("div", { class: "page ai-page" });
      page.innerHTML =
        '<div class="ai-hero">' +
          '<div class="ai-hero-mark">' + Icon("sparkle", 22) + "</div>" +
          '<h1 class="ai-hero-title">CafeXP AI</h1>' +
          '<p class="ai-hero-lede">From the numbers to the answer.</p>' +
          '<p class="ai-hero-sub">Ask a question about the operation and get the analysis ' +
            "behind it, not just another chart.</p>" +
        "</div>" +

        '<div class="ai-askbox">' +
          '<label class="ai-askbox-label" for="aiInput">Ask about your café</label>' +
          '<div class="ai-askbox-row">' +
            '<input class="ai-input" id="aiInput" type="text" autocomplete="off" ' +
              'placeholder="Why was revenue lower yesterday?" maxlength="500">' +
            '<button class="btn btn-primary btn-lg" id="aiAsk">' + Icon("sparkle", 17) +
              '<span class="btn-label">Ask CafeXP AI</span></button>' +
          "</div>" +
          '<div class="row-between" style="margin-top:var(--s-3)">' +
            '<div id="aiHealth"></div>' +
            '<button class="btn btn-ghost btn-sm hidden" id="aiReset">' + Icon("close", 13) +
              '<span class="btn-label">Start over</span></button>' +
          "</div>" +
        "</div>" +

        '<div id="aiEmpty" class="ai-empty">' +
          '<div class="ai-empty-label">Try one of these</div>' +
          '<div class="ai-suggestions" id="aiSuggestions"></div>' +
          '<div class="notice" data-status="info" style="margin-top:var(--s-6)">' + Icon("info", 16) +
            "<div>Answers are calculated from this café's own bills, sessions, stations and " +
            "orders. When the data doesn't support an explanation, CafeXP AI says so rather " +
            "than guessing.</div></div>" +
        "</div>" +

        '<div class="ai-thread" id="aiThread"></div>';

      root.appendChild(page);

      var input = page.querySelector("#aiInput");
      var askBtn = page.querySelector("#aiAsk");

      var submit = function () {
        var value = input.value.trim();
        if (!value) { Motion.shake(input); return; }
        ask(value);
        input.value = "";
      };

      askBtn.addEventListener("click", submit);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
      });

      page.querySelector("#aiReset").addEventListener("click", function () {
        thread = [];
        conversationId = "c" + Date.now();
        render();
      });

      input.focus();

      Store.aiSuggestions()
        .then(function (list) { suggestions = list; renderSuggestions(); })
        .catch(function () { /* starters are a convenience, not a requirement */ });

      Store.aiHealth()
        .then(function (h) { health = h; renderHealth(); })
        .catch(function (err) {
          var box = page.querySelector("#aiEmpty");
          UI.clear(box);
          box.appendChild(UI.errorState(
            err.message.indexOf("does not allow") !== -1
              ? "Your role does not allow you to use CafeXP AI."
              : err.message
          ));
        });

      render();
    },

    unmount: function () {
      rootEl = null;
      thread = [];
    }
  };
})(window);

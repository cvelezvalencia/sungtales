/* Sung Tales story player.
 *
 * Classic script (not defer, not type=module) so it can read its own tag:
 *
 *   <script src="sungtales-player.js"
 *           data-sync="URL of data/sync/<slug>.json"
 *           data-audio="MP3 URL"
 *           data-stream="constant-bitrate copy (optional)"></script>
 *
 * data-audio is the original recording: Download gives that file, and the
 * sync JSON names it. data-stream, when set, is what the player plays: a
 * constant-bitrate (CBR) copy of the same recording with the same timeline.
 * Browsers jump inside a variable-bitrate MP3 by estimate, so after a jump
 * (verse ▶, tapping a verse, the seek bar, a shared link) the sound can be
 * seconds away from the time they report, and the highlight runs a line or
 * two off. In a CBR file the jump is exact. Measured in Chromium on the
 * Telima original: 3 s off at 9:33; the CBR copy 0.00 s (2026-11-11).
 *
 * It rearranges the existing Webflow story markup
 * (.w-tab-pane "Ku Waru" / "English" → .line → .line-number,
 * .paragraph-20px-regular, notes in .w-dropdown-list).
 * It never rewrites that text. Timings come from the sync JSON.
 *
 * ?v=12   open on that verse; play plays only that verse, then
 *         "Keep listening" continues the story.
 * ?review=1  listen-through tool: nudge the edited verse's start,
 *            set it to the playhead, export the same JSON shape.
 *
 * Lenis 0.2.28: load this file before `new Lenis()`, or set
 * window.lenis to the instance. Auto-scroll goes through scrollTo.
 */
(function () {
  "use strict";

  (function captureLenis() {
    function wrap(Ctor) {
      if (typeof Ctor !== "function" || Ctor.__sungtalesWrapped) return Ctor;
      function Wrapped() {
        var inst = new Ctor(...arguments);
        try { window.__sungtalesLenis = inst; } catch (e) { /* ignore */ }
        return inst;
      }
      Wrapped.prototype = Ctor.prototype;
      Wrapped.__sungtalesWrapped = true;
      try { Object.setPrototypeOf(Wrapped, Ctor); } catch (e) { /* ignore */ }
      return Wrapped;
    }
    var value = window.Lenis;
    try {
      Object.defineProperty(window, "Lenis", {
        configurable: true,
        enumerable: true,
        get: function () { return value; },
        set: function (v) { value = wrap(v); }
      });
    } catch (e) {
      if (typeof window.Lenis === "function") window.Lenis = wrap(window.Lenis);
      return;
    }
    if (value) value = wrap(value);
  })();

  var scriptEl = document.currentScript;

  // Drawn icons, not text characters: iPhones and Macs show "▶" as a
  // colour emoji, which didn't match the site (Camila, 2026-11-11).
  function icon(body, filled) {
    return '<svg class="st-icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"' +
      (filled ? ' fill="currentColor">' : ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">') +
      body + "</svg>";
  }
  var ICON_PLAY = icon('<path d="M8 5.2v13.6L19 12z"/>', true);
  var ICON_PAUSE = icon('<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/>', true);
  var ICON_REPEAT = icon('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>', false);
  var ICON_DOWNLOAD = icon('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>', false);
  // The usual "share" symbol (arrow out of a box) instead of the word,
  // which drew too much attention on every verse (Camila, 2026-11-11).
  var ICON_SHARE = icon('<path d="M12 15V3"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/>', false);
  var ICON_CHECK = icon('<path d="M5 12.5l4.5 4.5L19 7.5"/>', false);

  function onReady() {
    var script = scriptEl || document.querySelector("script[data-sync]");
    if (!script) return;
    var syncUrl = script.getAttribute("data-sync");
    var audioUrl = script.getAttribute("data-audio");
    var streamUrl = script.getAttribute("data-stream") || audioUrl;
    if (!syncUrl || !audioUrl) {
      console.warn("Sung Tales player: data-sync and data-audio are required.");
      return;
    }
    if (document.querySelector(".st-layout")) return;
    var panes = findPanes();
    if (!panes) {
      console.warn("Sung Tales player: Ku Waru and English tabs were not found.");
      return;
    }
    build(panes, syncUrl, audioUrl, streamUrl);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }

  function findPanes() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".w-tab-link"));
    var panes = Array.prototype.slice.call(document.querySelectorAll(".w-tab-pane"));
    function paneFor(label) {
      var link = links.find(function (a) {
        return a.textContent.replace(/\s+/g, " ").trim() === label;
      });
      if (!link) return null;
      var id = link.getAttribute("data-w-tab");
      return panes.find(function (p) { return p.getAttribute("data-w-tab") === id; }) || null;
    }
    var ku = paneFor("Ku Waru");
    var en = paneFor("English");
    if (!ku || !en || ku.closest(".w-tabs") !== en.closest(".w-tabs")) return null;
    return { ku: ku, en: en, tabs: ku.closest(".w-tabs") };
  }

  function verseNumber(line) {
    var el = line.querySelector(".line-number");
    if (!el) return null;
    var text = (el.textContent || "").replace(/\s+/g, "");
    var match = text.match(/^(\d+)\.?$/);
    return match ? Number(match[1]) : null;
  }

  function linesOf(pane) {
    return Array.prototype.filter.call(pane.querySelectorAll(".line"), function (line) {
      return !line.closest(".w-dropdown-list");
    });
  }

  function collect(pane) {
    var items = [];
    var after = 0;
    linesOf(pane).forEach(function (line) {
      var n = verseNumber(line);
      if (n == null) items.push({ kind: "label", after: after, line: line });
      else {
        items.push({ kind: "verse", n: n, line: line });
        after = n;
      }
    });
    return items;
  }

  function labelMap(items) {
    var map = new Map();
    var seen = new Map();
    items.forEach(function (item) {
      if (item.kind !== "label") return;
      var k = seen.get(item.after) || 0;
      seen.set(item.after, k + 1);
      map.set(item.after + ":" + k, item.line);
    });
    return map;
  }

  function verseMap(items) {
    var map = new Map();
    items.forEach(function (item) {
      if (item.kind === "verse" && !map.has(item.n)) map.set(item.n, item.line);
    });
    return map;
  }

  function eventTarget(event) {
    var node = event.target;
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  function sameLabel(a, b) {
    if (!a || !b) return false;
    var ta = a.textContent.replace(/\s+/g, " ").trim();
    var tb = b.textContent.replace(/\s+/g, " ").trim();
    return ta.length > 0 && ta === tb;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function build(panes, syncUrl, audioUrl, streamUrl) {
    var params = new URLSearchParams(location.search);
    var reviewOn = params.get("review") === "1";
    var shareParam = params.get("v");
    var shareFromUrl = shareParam != null && /^\d+$/.test(shareParam) ? Number(shareParam) : null;

    var kuItems = collect(panes.ku);
    var enItems = collect(panes.en);
    var kuLabels = labelMap(kuItems);
    var enLabels = labelMap(enItems);
    var kuVerses = verseMap(kuItems);
    var enVerses = verseMap(enItems);
    var numbers = Array.from(new Set(Array.from(kuVerses.keys()).concat(Array.from(enVerses.keys())))).sort(function (a, b) { return a - b; });

    var watched = Array.prototype.slice.call(panes.ku.querySelectorAll(".paragraph-20px-regular, .paragraph-18px-regular"))
      .concat(Array.prototype.slice.call(panes.en.querySelectorAll(".paragraph-20px-regular, .paragraph-18px-regular")));
    var title = document.querySelector("h1");
    var before = watched.map(function (node) { return node.innerHTML; });
    var titleBefore = title ? title.innerHTML : null;

    markNoTranslate(panes.ku);
    markNoTranslate(panes.en);
    if (title) title.setAttribute("translate", "no");

    var layout = el("div", "st-layout");
    layout.setAttribute("data-view", storedView());
    var toolbar = el("div", "st-toolbar");
    toolbar.setAttribute("role", "radiogroup");
    toolbar.setAttribute("aria-label", "Language");
    var viewNames = [["ku", "Ku Waru"], ["en", "English"], ["both", "Both"]];
    var viewButtons = {};
    viewNames.forEach(function (pair) {
      var button = el("button", "", pair[1]);
      button.type = "button";
      button.setAttribute("role", "radio");
      button.setAttribute("data-view", pair[0]);
      toolbar.appendChild(button);
      viewButtons[pair[0]] = button;
      button.addEventListener("click", function () { setView(pair[0]); });
    });
    // The language selector and the audio player sit together under the
    // menu and stay there while the story scrolls (Camila, 2026-11-11).
    var head = el("div", "st-head");
    head.appendChild(toolbar);
    layout.appendChild(head);

    var heads = el("div", "st-colheads");
    heads.setAttribute("aria-hidden", "true");
    heads.appendChild(el("span"));
    heads.appendChild(el("span", "st-colhead st-ku", "Ku Waru"));
    heads.appendChild(el("span", "st-colhead st-en", "English"));
    layout.appendChild(heads);

    var rows = el("div", "st-rows");
    var rowByN = new Map();
    var metaByN = new Map();

    function addLabel(afterIndex) {
      var i = 0;
      while (kuLabels.has(afterIndex + ":" + i) || enLabels.has(afterIndex + ":" + i)) {
        var kuLine = kuLabels.get(afterIndex + ":" + i) || null;
        var enLine = enLabels.get(afterIndex + ":" + i) || null;
        var row = el("div", "st-row st-label-row");
        var kuCol = el("div", "st-col st-ku");
        var enCol = el("div", "st-col st-en");
        if (kuLine) kuCol.appendChild(kuLine);
        if (enLine) enCol.appendChild(enLine);
        if (sameLabel(kuLine, enLine)) enCol.classList.add("st-mirror");
        row.appendChild(kuCol);
        row.appendChild(enCol);
        rows.appendChild(row);
        i += 1;
      }
    }

    function placeLeftovers(pane, colClass) {
      linesOf(pane).forEach(function (line) {
        var row = el("div", "st-row");
        var col = el("div", "st-col " + colClass);
        col.appendChild(line);
        row.appendChild(col);
        rows.appendChild(row);
      });
    }

    addLabel(0);
    numbers.forEach(function (n) {
      var row = el("div", "st-row");
      row.setAttribute("data-n", String(n));
      row.id = "st-verse-" + n;
      var play = el("button", "st-verse-play");
      play.innerHTML = ICON_PLAY;
      play.type = "button";
      play.setAttribute("aria-label", "Play verse " + n + " only");
      var kuCol = el("div", "st-col st-ku");
      var enCol = el("div", "st-col st-en");
      var kuLine = kuVerses.get(n) || null;
      var enLine = enVerses.get(n) || null;
      if (kuLine) kuCol.appendChild(kuLine);
      if (enLine) enCol.appendChild(enLine);
      var share = el("a", "st-share");
      share.innerHTML = ICON_SHARE;
      share.setAttribute("role", "button");
      share.setAttribute("aria-label", "Copy link to verse " + n);
      share.title = "Copy link to this verse";
      var meta = el("div", "st-meta");
      row.appendChild(play);
      row.appendChild(kuCol);
      row.appendChild(enCol);
      row.appendChild(share);
      row.appendChild(meta);
      rows.appendChild(row);
      rowByN.set(n, row);
      metaByN.set(n, meta);

      play.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        playOnly(n);
      });
      share.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        shareVerse(n, share);
      });
      // Webflow opens a note on mouseup of the whole toggle. Keep that for
      // the "i" icon, and let a tap on the verse text seek instead.
      row.addEventListener("mouseup", function (event) {
        var target = eventTarget(event);
        if (!target || target.closest(".line-info-icon, .info-icon-text")) return;
        if (hitKuNoteMark(event)) return;
        if (target.closest(".w-dropdown-toggle")) event.stopPropagation();
      }, true);
      row.addEventListener("click", function (event) {
        var target = eventTarget(event);
        if (!target) return;
        if (target.closest(".st-verse-play, .st-share, .w-dropdown-list, .line-info-icon, .info-icon-text")) return;
        if (hitKuNoteMark(event)) return;
        if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
        var sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed && sel.anchorNode && row.contains(sel.anchorNode)) return;
        if (target.closest(".w-dropdown-toggle")) event.stopPropagation();
        tapVerse(n);
      }, true);

      addLabel(n);
    });
    placeLeftovers(panes.ku, "st-ku");
    placeLeftovers(panes.en, "st-en");
    layout.appendChild(rows);
    panes.tabs.appendChild(layout);
    panes.tabs.classList.add("st-enhanced");
    // The site's .section has overflow: hidden, which turns off the sticky
    // toolbar. st-unclip switches it to overflow: clip (same clipping).
    for (var up = panes.tabs.parentElement; up && up !== document.body; up = up.parentElement) {
      var style = getComputedStyle(up);
      if (style.overflowX === "hidden" || style.overflowY === "hidden") up.classList.add("st-unclip");
    }
    document.documentElement.classList.add("st-on");
    document.documentElement.dataset.stReady = "1";
    if (reviewOn) document.documentElement.classList.add("st-review-on");

    var textOk = watched.every(function (node, i) { return node.innerHTML === before[i]; })
      && (!title || title.innerHTML === titleBefore);
    document.documentElement.dataset.stText = textOk ? "ok" : "changed";
    if (!textOk) console.error("Sung Tales player: story markup changed while building the layout.");

    var parkedNotes = [];
    var noteFitters = [];

    function fitOpenNotes() {
      noteFitters.forEach(function (item) {
        var list = item.list;
        if (!list) return;
        if (!list.classList.contains("w--open")) {
          list.style.width = "";
          list.style.marginLeft = "";
          return;
        }
        list.style.width = "";
        list.style.marginLeft = "";
        var hostR = item.host.getBoundingClientRect();
        var listR = list.getBoundingClientRect();
        list.style.marginLeft = (hostR.left - listR.left) + "px";
        list.style.width = hostR.width + "px";
      });
    }

    window.addEventListener("resize", fitOpenNotes);

    setView(layout.getAttribute("data-view"));

    var audio = document.createElement("audio");
    audio.className = "st-audio-el";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    audio.preload = "metadata";
    audio.src = streamUrl;
    document.body.appendChild(audio);

    var dock = el("div", "st-dock");
    var review = el("div", "st-review");
    if (!reviewOn) review.hidden = true;
    var reviewCount = el("p", "st-review-count");
    var readout = el("p", "st-review-readout", "Loading timings\u2026");
    var controls = el("div", "st-review-controls");
    function reviewButton(label, attrs) {
      var button = el("button", "", label);
      button.type = "button";
      Object.keys(attrs).forEach(function (key) { button.setAttribute(key, attrs[key]); });
      controls.appendChild(button);
      return button;
    }
    function bindNudge(pair) {
      var button = reviewButton(pair[0], { "data-nudge": pair[1] });
      button.addEventListener("click", function () { nudge(Number(pair[1])); });
    }
    [["\u22120.5s", "-0.5"], ["\u22120.1s", "-0.1"]].forEach(bindNudge);
    var nowButton = reviewButton("Set start = now", { "data-action": "now" });
    [["+0.1s", "0.1"], ["+0.5s", "0.5"]].forEach(bindNudge);
    var endButton = reviewButton("Set end = now", { "data-action": "end" });
    var prevButton = reviewButton("Prev verse", { "data-action": "prev" });
    var nextButton = reviewButton("Next verse", { "data-action": "next" });
    var followButton = reviewButton("Follow playback", { "data-action": "follow" });
    followButton.hidden = true;
    var exportButton = reviewButton("Export JSON", { "data-action": "export" });
    var discardButton = reviewButton("Discard edits", { "data-action": "discard" });
    nowButton.addEventListener("click", setStartNow);
    endButton.addEventListener("click", setEndNow);
    discardButton.addEventListener("click", discardEdits);
    prevButton.addEventListener("click", function () { pinRelative(-1); });
    nextButton.addEventListener("click", function () { pinRelative(1); });
    followButton.addEventListener("click", function () { pin(null); });
    exportButton.addEventListener("click", exportSync);
    var help = el("p", "st-review-help", "Left and right nudge the edited verse (\u00B10.1 s, shift \u00B10.5 s). S sets its start to the playhead, E its end (\u25B6 on a verse picks it first). [ and ] choose the previous or next verse. Esc follows playback again. Edits are kept in this browser until you discard them.");
    review.appendChild(reviewCount);
    review.appendChild(readout);
    review.appendChild(controls);
    review.appendChild(help);

    var bar = el("div", "st-bar");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Audio player");
    var playButton = el("button", "st-play");
    playButton.innerHTML = ICON_PLAY;
    playButton.type = "button";
    playButton.setAttribute("aria-label", "Play");
    var seek = el("input", "st-seek");
    seek.type = "range";
    seek.min = "0";
    seek.max = "0";
    seek.step = "0.01";
    seek.value = "0";
    seek.setAttribute("aria-label", "Seek");
    var timeEl = el("span", "st-time", "0:00 / 0:00");
    var repeatButton = el("button", "st-repeat");
    repeatButton.innerHTML = ICON_REPEAT + '<span class="st-btn-text">Repeat verse</span>';
    repeatButton.type = "button";
    repeatButton.title = "Repeat verse";
    repeatButton.setAttribute("aria-label", "Repeat verse");
    repeatButton.setAttribute("aria-pressed", "false");
    var download = el("a", "st-download");
    download.innerHTML = ICON_DOWNLOAD + '<span class="st-btn-text">Download</span>';
    download.title = "Download the audio";
    download.setAttribute("aria-label", "Download the audio");
    var downloadText = download.querySelector(".st-btn-text");
    download.href = audioUrl;
    download.setAttribute("download", fileName(audioUrl));
    // The audio is on another site (GitHub Pages), where browsers ignore the
    // download attribute and open the file over the story page. Fetch it and
    // save it instead. If that fails, open it in a new tab so the page stays.
    download.target = "_blank";
    download.rel = "noopener";
    download.addEventListener("click", function (event) {
      if (!window.fetch || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      if (download.getAttribute("aria-busy") === "true") return;
      download.setAttribute("aria-busy", "true");
      downloadText.textContent = "Downloading…";
      fetch(audioUrl).then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.blob();
      }).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var saver = document.createElement("a");
        saver.href = url;
        saver.download = fileName(audioUrl);
        document.body.appendChild(saver);
        saver.click();
        saver.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }).catch(function () {
        window.open(audioUrl, "_blank", "noopener");
      }).then(function () {
        download.removeAttribute("aria-busy");
        downloadText.textContent = "Download";
      });
    });
    var continueButton = el("button", "st-continue", "Keep listening");
    continueButton.type = "button";
    continueButton.hidden = true;
    continueButton.setAttribute("translate", "no");
    var statusEl = el("p", "st-status", "");
    statusEl.setAttribute("role", "status");
    // Screen readers hear "Link to verse 12 copied"; sighted readers see the
    // share icon turn into a check mark.
    var liveEl = el("span", "st-sr");
    liveEl.setAttribute("aria-live", "polite");
    function announce(text) {
      liveEl.textContent = "";
      setTimeout(function () { liveEl.textContent = text; }, 60);
    }
    bar.appendChild(playButton);
    bar.appendChild(seek);
    bar.appendChild(timeEl);
    bar.appendChild(repeatButton);
    bar.appendChild(download);
    bar.appendChild(continueButton);
    bar.appendChild(statusEl);
    bar.appendChild(liveEl);
    dock.appendChild(review);
    dock.appendChild(bar);
    head.appendChild(dock);

    var syncData = null;
    var verses = [];
    var verseByN = new Map();
    var timed = [];
    var originalStart = new Map();
    var originalEnd = new Map();
    var shareN = null;
    var playMode = "story";
    var onceN = null;
    var repeatOn = false;
    var loopN = null;
    var pinnedN = null;
    var fromScratch = false;
    var highlightedN = null;
    var wantTime = null;
    var sliding = false;
    var boundaryTimer = 0;
    var inBoundary = false;
    var rafId = 0;
    var userUntil = 0;
    var programmaticUntil = 0;
    var readoutKey = "";
    var editsKey = "sungtales-review:" + syncUrl;

    if (shareFromUrl != null && rowByN.has(shareFromUrl)) {
      shareN = shareFromUrl;
      rowByN.get(shareN).classList.add("st-shared");
      continueButton.hidden = false;
      playMode = "share";
      onceN = shareN;
    }
    refreshShareHrefs();

    playButton.addEventListener("click", toggleMain);
    repeatButton.addEventListener("click", toggleRepeat);
    continueButton.addEventListener("click", continuar);
    seek.addEventListener("input", function () {
      sliding = true;
      wantTime = null;
      var t = Number(seek.value);
      try { audio.currentTime = t; } catch (e) { /* not ready */ }
      updateTimeLabel();
      updateHighlight();
    });
    function endSlide() { sliding = false; scheduleBoundary(); }
    seek.addEventListener("change", endSlide);
    seek.addEventListener("pointerup", endSlide);
    seek.addEventListener("pointercancel", endSlide);

    audio.addEventListener("loadedmetadata", function () {
      if (Number.isFinite(audio.duration)) seek.max = String(audio.duration);
      if (wantTime != null) {
        try { audio.currentTime = wantTime; } catch (e) { /* ignore */ }
      }
      statusEl.textContent = "";
      updateTimeLabel();
    });
    audio.addEventListener("playing", function () {
      if (wantTime != null) {
        var target = wantTime;
        var fix = function () {
          if (Math.abs(audio.currentTime - target) > 0.35) {
            try { audio.currentTime = target; } catch (e) { /* ignore */ }
          }
        };
        fix();
        setTimeout(fix, 200);
        wantTime = null;
      }
      updatePlayButton();
      scheduleBoundary();
      ensureTick();
      if (pinnedN == null) {
        var playingVerse = verseAt(audio.currentTime || 0);
        var playingRow = playingVerse && rowByN.get(playingVerse.n);
        if (playingRow && !comfortablyVisible(playingRow)) scrollRow(playingRow, false, false);
      }
    });
    // Show "pause" as soon as playback is asked for, not only once the audio
    // has buffered: on a slow phone connection that can take seconds.
    audio.addEventListener("play", updatePlayButton);
    audio.addEventListener("pause", function () {
      clearTimeout(boundaryTimer);
      updatePlayButton();
      updateTimeLabel();
    });
    audio.addEventListener("ended", function () {
      if (shareN != null) continueButton.classList.add("is-ready");
      updatePlayButton();
    });
    audio.addEventListener("timeupdate", function () {
      if (sliding) return;
      var boundary = boundaryInfo();
      if (boundary && audio.currentTime >= boundary.at - 0.02) onBoundary();
      else scheduleBoundary();
      updatePlayhead();
    });
    audio.addEventListener("seeked", function () {
      updateHighlight();
      updateTimeLabel();
      scheduleBoundary();
    });
    audio.addEventListener("error", function () {
      // If the constant-bitrate copy is missing, play the original rather
      // than nothing (jumps are then approximate again).
      if (streamUrl !== audioUrl && audio.getAttribute("src") === streamUrl) {
        console.warn("Sung Tales player: data-stream didn't load; playing data-audio.");
        audio.src = audioUrl;
        audio.load();
        return;
      }
      statusEl.textContent = "The audio file didn\u2019t load.";
    });

    document.addEventListener("keydown", onKey);
    window.addEventListener("wheel", noteUserScroll, { passive: true });
    window.addEventListener("touchmove", noteUserScroll, { passive: true });
    window.addEventListener("scroll", function () {
      if (Date.now() > programmaticUntil) userUntil = Date.now() + 6000;
    }, { passive: true });

    var resize = new ResizeObserver(applyPad);
    resize.observe(head);
    applyPad();
    window.addEventListener("resize", applyPad);
    window.addEventListener("load", applyPad);
    setTimeout(applyPad, 1500);

    var userMoved = false;
    function revealShare() {
      if (shareN == null || userMoved) return;
      var row = rowByN.get(shareN);
      if (row) scrollRow(row, true, true);
    }
    setTimeout(revealShare, 60);
    window.addEventListener("load", revealShare);

    fetch(syncUrl, { credentials: "same-origin" }).then(function (res) {
      // A new story has no timings file yet: the sync tool starts it from zero.
      if (res.status === 404 && reviewOn) {
        fromScratch = true;
        return blankSync();
      }
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }).then(applySync).catch(function () {
      statusEl.textContent = "Timings didn\u2019t load. Playback still works; verses won\u2019t highlight.";
      if (reviewOn) readout.textContent = "Timings didn\u2019t load.";
      document.documentElement.dataset.stSync = "error";
    });

    function blankSync() {
      var ns = [];
      rowByN.forEach(function (row, n) { ns.push({ n: n }); });
      return {
        slug: location.pathname.split("/").filter(Boolean).pop() || "story",
        audio: fileName(audioUrl),
        method: "manual, with the sync tool",
        verses: ns
      };
    }

    function applySync(data) {
      syncData = data;
      verses = [];
      verseByN = new Map();
      (data.verses || []).forEach(function (v) {
        if (!v || !Number.isFinite(Number(v.n)) || verseByN.has(Number(v.n))) return;
        v.n = Number(v.n);
        verseByN.set(v.n, v);
        verses.push(v);
        originalStart.set(v.n, v.start);
        originalEnd.set(v.n, v.end);
      });
      verses.sort(function (a, b) { return a.n - b.n; });
      var restored = reviewOn ? restoreEdits() : 0;
      rebuildTimed();
      if (Number.isFinite(Number(data.duration)) && !Number.isFinite(audio.duration)) {
        seek.max = String(data.duration);
      }
      var reviewCountN = 0;
      var gapCount = 0;
      verses.forEach(function (v) {
        var row = rowByN.get(v.n);
        if (v.review) reviewCountN += 1;
        if (v.untranscribed_after != null) gapCount += 1;
        if (row && (v.review || v.untranscribed_after != null)) row.classList.add("st-flagged");
        renderMeta(v);
      });
      if (reviewOn) {
        reviewCount.textContent = reviewCountN + " low-confidence" + (gapCount ? " \u00B7 " + gapCount + " with untranscribed audio after the verse" : "")
          + (restored ? " \u00B7 restored " + restored + " edited verse" + (restored > 1 ? "s" : "") + " from this browser" : "");
        markEdited();
        updateReadout(true);
      }
      updateHighlight();
      updateTimeLabel();
      if (fromScratch) {
        reviewCount.textContent = "New story: play the audio and press S as each verse begins. It moves on to the next verse by itself."
          + (restored ? " Restored " + restored + " timed verse" + (restored > 1 ? "s" : "") + " from this browser." : "");
        pinFirstUntimed();
      }
      document.documentElement.dataset.stSync = "ok";
      document.documentElement.dataset.stVerses = String(rowByN.size);
    }

    function rebuildTimed() {
      timed = verses.filter(function (v) { return Number.isFinite(Number(v.start)); })
        .sort(function (a, b) { return a.start - b.start || a.n - b.n; });
    }

    function verseAt(t) {
      var lo = 0;
      var hi = timed.length - 1;
      var ans = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (timed[mid].start <= t + 1e-4) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      return ans >= 0 ? timed[ans] : null;
    }

    function nextStart(n) {
      var passed = false;
      for (var i = 0; i < verses.length; i++) {
        var v = verses[i];
        if (!passed) {
          if (v.n === n) passed = true;
          continue;
        }
        if (Number.isFinite(Number(v.start))) return Number(v.start);
      }
      return Number.isFinite(audio.duration) ? audio.duration : 1e12;
    }

    function prevFloor(n) {
      var prev = null;
      for (var i = 0; i < verses.length; i++) {
        if (verses[i].n === n) break;
        if (Number.isFinite(Number(verses[i].start))) prev = Number(verses[i].start);
      }
      return prev;
    }

    function onceEnd(verse) {
      var start = Number(verse.start);
      if (!Number.isFinite(start)) return null;
      var next = nextStart(verse.n);
      var end = Number.isFinite(Number(verse.end)) ? Number(verse.end) + 0.15 : next;
      var stop = Math.min(end, next);
      if (!(stop > start + 0.03)) stop = Math.min(next, start + 0.05);
      if (!(stop > start)) return null;
      return stop;
    }

    function boundaryInfo() {
      if (repeatOn && loopN != null && verseByN.has(loopN)) {
        var loopVerse = verseByN.get(loopN);
        var loopAt = onceEnd(loopVerse);
        if (loopAt == null) return null;
        return { action: "loop", verse: loopVerse, at: loopAt };
      }
      if ((playMode === "once" || playMode === "share") && onceN != null && verseByN.has(onceN)) {
        var onceVerse = verseByN.get(onceN);
        var onceAt = onceEnd(onceVerse);
        if (onceAt == null) return null;
        return { action: "stop", verse: onceVerse, at: onceAt };
      }
      return null;
    }

    function scheduleBoundary() {
      clearTimeout(boundaryTimer);
      if (audio.paused || sliding) return;
      var boundary = boundaryInfo();
      if (!boundary) return;
      var ms = (boundary.at - audio.currentTime) * 1000;
      if (ms <= 40) onBoundary();
      else boundaryTimer = setTimeout(onBoundary, ms);
    }

    function onBoundary() {
      if (inBoundary || sliding) return;
      var boundary = boundaryInfo();
      if (!boundary || audio.currentTime + 0.04 < boundary.at) return;
      inBoundary = true;
      try {
        if (boundary.action === "loop") {
          if (boundary.at > boundary.verse.start + 0.03) audio.currentTime = boundary.verse.start;
          else audio.pause();
        } else {
          var next = nextStart(boundary.verse.n);
          var t = boundary.at;
          if (t >= next - 0.0005) t = Math.max(Number(boundary.verse.start) || 0, next - 0.01);
          audio.pause();
          if (Math.abs((audio.currentTime || 0) - t) > 0.02) {
            try { audio.currentTime = t; } catch (e) { /* ignore */ }
          }
          if (shareN != null) continueButton.classList.add("is-ready");
        }
      } finally {
        inBoundary = false;
      }
    }

    function play() {
      var pending = audio.play();
      if (pending && pending.catch) pending.catch(function () { /* needs a gesture */ });
      ensureTick();
    }

    function seekPlay(t) {
      wantTime = t;
      try { audio.currentTime = t; } catch (e) { /* before metadata */ }
      play();
    }

    function toggleMain() {
      if (!audio.paused) {
        audio.pause();
        return;
      }
      if (shareN != null) {
        var verse = verseByN.get(shareN);
        playMode = "share";
        onceN = shareN;
        if (repeatOn) loopN = shareN;
        var end = verse ? onceEnd(verse) : null;
        if (!verse || verse.start == null) {
          play();
          return;
        }
        if (audio.currentTime < verse.start - 0.05 || (end != null && audio.currentTime >= end - 0.05)) {
          seekPlay(Number(verse.start));
        } else play();
        return;
      }
      // Paused in the middle of a ▶ verse: finish that verse. Once it has
      // played, the main button carries on with the story from there.
      if (playMode === "once" && onceN != null && verseByN.has(onceN)) {
        var onceStop = onceEnd(verseByN.get(onceN));
        if (onceStop != null && audio.currentTime < onceStop - 0.05) {
          play();
          return;
        }
      }
      playMode = "story";
      onceN = null;
      play();
    }

    function playOnly(n) {
      var verse = verseByN.get(n);
      if (!verse || !Number.isFinite(Number(verse.start))) return;
      onceN = n;
      if (repeatOn) {
        loopN = n;
        playMode = "story";
      } else {
        loopN = null;
        playMode = "once";
      }
      if (reviewOn) pin(n);
      seekPlay(Number(verse.start));
    }

    function tapVerse(n) {
      var verse = verseByN.get(n);
      if (!verse || !Number.isFinite(Number(verse.start))) return;
      shareN = null;
      continueButton.hidden = true;
      continueButton.classList.remove("is-ready");
      playMode = "story";
      onceN = null;
      loopN = repeatOn ? n : null;
      if (reviewOn) pin(null);
      seekPlay(Number(verse.start));
    }

    function toggleRepeat() {
      repeatOn = !repeatOn;
      repeatButton.setAttribute("aria-pressed", repeatOn ? "true" : "false");
      if (repeatOn) {
        var current = verseAt(audio.currentTime || 0);
        loopN = (current && current.n) || onceN || shareN || pinnedN;
        if (loopN != null) playMode = "story";
      } else {
        loopN = null;
      }
      scheduleBoundary();
    }

    function continuar() {
      var n = shareN;
      shareN = null;
      continueButton.hidden = true;
      continueButton.classList.remove("is-ready");
      playMode = "story";
      onceN = null;
      loopN = null;
      repeatOn = false;
      repeatButton.setAttribute("aria-pressed", "false");
      var verse = n != null ? verseByN.get(n) : null;
      if (verse && Number.isFinite(Number(verse.start)) && audio.currentTime < Number(verse.start) - 0.05) {
        seekPlay(Number(verse.start));
      } else play();
    }

    function editedVerse() {
      if (pinnedN != null && verseByN.has(pinnedN)) return verseByN.get(pinnedN);
      var t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      return verseAt(t) || timed.find(function (v) { return v.start > t; }) || verses[0] || null;
    }

    function pin(n) {
      pinnedN = n;
      rowByN.forEach(function (row, verseN) {
        row.classList.toggle("st-editing", n != null && verseN === n);
      });
      followButton.hidden = n == null;
      updateReadout(true);
      if (n != null) {
        var row = rowByN.get(n);
        if (row && !comfortablyVisible(row)) scrollRow(row, false, true);
      }
    }

    function pinRelative(dir) {
      var current = editedVerse();
      if (!current) return;
      var index = verses.findIndex(function (v) { return v.n === current.n; });
      var next = index + dir;
      if (next < 0 || next >= verses.length) return;
      pin(verses[next].n);
    }

    function setStart(verse, start) {
      var prev = prevFloor(verse.n);
      var next = nextStart(verse.n);
      var min = prev == null ? 0 : Math.round((prev + 0.001) * 1000) / 1000;
      var max = Math.max(min, Math.round((next - 0.001) * 1000) / 1000);
      var value = Math.round(Number(start) * 1000) / 1000;
      if (!Number.isFinite(value)) return;
      if (value < min) value = min;
      if (value > max) value = max;
      verse.start = value;
      if (verse.end != null && Number(verse.end) < value) verse.end = value;
      rebuildTimed();
      renderMeta(verse);
      markEdited();
      updateHighlight();
      updateReadout(true);
      scheduleBoundary();
    }

    function nudge(delta) {
      var verse = editedVerse();
      if (!verse) return;
      pin(verse.n);
      var base = Number.isFinite(Number(verse.start)) ? Number(verse.start) : (audio.currentTime || 0);
      setStart(verse, base + delta);
    }

    function setStartNow() {
      if (!Number.isFinite(audio.currentTime)) return;
      var verse = editedVerse();
      if (!verse) return;
      pin(verse.n);
      setStart(verse, audio.currentTime);
      if (fromScratch) afterScratchStart(verse);
    }

    // Starting a story from zero: this start closes the previous verse, unless
    // it already has an end, and the tool moves on to the next verse.
    function afterScratchStart(verse) {
      var index = verses.indexOf(verse);
      var before = index > 0 ? verses[index - 1] : null;
      if (before && before.end == null && Number.isFinite(Number(before.start))) {
        before.end = verse.start;
        renderMeta(before);
        markEdited();
      }
      if (index + 1 < verses.length) pin(verses[index + 1].n);
    }

    function pinFirstUntimed() {
      var first = verses.find(function (v) { return v.start == null; });
      if (first) pin(first.n);
    }

    function setEndNow() {
      if (!Number.isFinite(audio.currentTime)) return;
      var verse = editedVerse();
      if (!verse || !Number.isFinite(Number(verse.start))) return;
      pin(verse.n);
      var value = Math.round(audio.currentTime * 1000) / 1000;
      value = Math.min(Math.max(value, Number(verse.start)), Math.round(nextStart(verse.n) * 1000) / 1000);
      verse.end = value;
      renderMeta(verse);
      markEdited();
      updateReadout(true);
      scheduleBoundary();
    }

    function discardEdits() {
      if (!window.confirm("Discard all timing edits for this story?")) return;
      verses.forEach(function (v) {
        v.start = originalStart.get(v.n);
        v.end = originalEnd.get(v.n);
        renderMeta(v);
      });
      rebuildTimed();
      markEdited();
      updateHighlight();
      updateReadout(true);
      scheduleBoundary();
    }

    // Edits survive a reload: kept per story in localStorage, each with the
    // timings it started from, and restored only while the sync file still
    // has those (so a newer file isn't overridden by old edits).
    function saveEdits() {
      var edits = {};
      verses.forEach(function (v) {
        var s0 = originalStart.get(v.n);
        var e0 = originalEnd.get(v.n);
        if (v.start !== s0 || v.end !== e0) edits[v.n] = [s0, e0, v.start, v.end];
      });
      try {
        if (Object.keys(edits).length) localStorage.setItem(editsKey, JSON.stringify(edits));
        else localStorage.removeItem(editsKey);
      } catch (e) { /* storage off: edits last until the page closes */ }
    }

    function restoreEdits() {
      var edits;
      try { edits = JSON.parse(localStorage.getItem(editsKey) || "{}") || {}; } catch (e) { edits = {}; }
      var count = 0;
      Object.keys(edits).forEach(function (key) {
        var v = verseByN.get(Number(key));
        var e = edits[key];
        // Loose on purpose: a verse with no timing yet is undefined here and
        // null in the saved edit.
        if (!v || !Array.isArray(e) || v.start != e[0] || v.end != e[1]) return;
        v.start = e[2] == null ? undefined : e[2];
        v.end = e[3] == null ? undefined : e[3];
        count += 1;
      });
      return count;
    }

    function renderMeta(verse) {
      var node = metaByN.get(verse.n);
      if (!node) return;
      var bits = [];
      if (!Number.isFinite(Number(verse.start))) bits.push("no timing");
      else bits.push(fmtFine(verse.start) + "\u2013" + fmtFine(verse.end));
      if (verse.score != null && verse.score !== "") bits.push("score " + Number(verse.score).toFixed(3));
      if (verse.review) bits.push("review");
      if (verse.untranscribed_after != null) bits.push("untranscribed " + verse.untranscribed_after + "s");
      node.textContent = bits.join(" \u00B7 ");
    }

    function updateReadout(force) {
      if (!reviewOn) return;
      var verse = editedVerse();
      var key = verse ? [verse.n, verse.start, verse.end, pinnedN, verse.score].join(":") : "";
      if (!force && key === readoutKey) return;
      readoutKey = key;
      if (!verse) {
        readout.textContent = "No verse at the playhead.";
        return;
      }
      var where = pinnedN != null ? "pinned" : "following playback";
      var when = Number.isFinite(Number(verse.start))
        ? "start " + fmtFine(verse.start) + " \u00B7 end " + fmtFine(verse.end)
        : "no timing";
      var score = verse.score != null && verse.score !== "" ? " \u00B7 score " + Number(verse.score).toFixed(3) : "";
      readout.textContent = "Verse " + verse.n + " (" + where + ") \u00B7 " + when + score;
    }

    function markEdited() {
      var changed = verses.some(function (v) {
        return v.start !== originalStart.get(v.n) || v.end !== originalEnd.get(v.n);
      });
      exportButton.textContent = changed ? "Export JSON *" : "Export JSON";
      discardButton.disabled = !changed;
      if (reviewOn) saveEdits();
    }

    function exportSync() {
      if (!syncData) return;
      var output = syncData;
      if (fromScratch) {
        // The file a story keeps: every timed verse has an end, and the length is in it.
        var duration = Number.isFinite(audio.duration) ? audio.duration : null;
        output = JSON.parse(JSON.stringify(syncData));
        if (duration != null) output.duration = Math.round(duration * 1000) / 1000;
        output.verses.forEach(function (v, i) {
          var next = output.verses[i + 1];
          if (v.start == null || v.end != null) return;
          if (next && next.start != null) v.end = next.start;
          else if (duration != null) v.end = output.duration;
        });
      }
      var json = JSON.stringify(output, null, 1);
      var blob = new Blob([json], { type: "application/json" });
      var link = document.createElement("a");
      var slug = syncData.slug || "story";
      link.href = URL.createObjectURL(blob);
      link.download = slug + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
    }

    function updateHighlight() {
      var verse = verseAt(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      var n = verse ? verse.n : null;
      if (n === highlightedN) return;
      if (highlightedN != null && rowByN.has(highlightedN)) {
        var prev = rowByN.get(highlightedN);
        prev.classList.remove("st-current");
        prev.removeAttribute("aria-current");
      }
      highlightedN = n;
      if (n != null && rowByN.has(n)) {
        var row = rowByN.get(n);
        row.classList.add("st-current");
        row.setAttribute("aria-current", "true");
        maybeFollow(row);
      }
      updateReadout(false);
    }

    function updatePlayhead() {
      updateHighlight();
      updateTimeLabel();
    }

    function updateTimeLabel() {
      var duration = Number.isFinite(audio.duration) ? audio.duration : Number(seek.max);
      var current = sliding ? Number(seek.value) : (audio.currentTime || 0);
      timeEl.textContent = fmt(current) + " / " + fmt(duration);
      if (!sliding && Number.isFinite(audio.currentTime)) seek.value = String(audio.currentTime);
    }

    function updatePlayButton() {
      var playing = !audio.paused && !audio.ended;
      playButton.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
    }

    function maybeFollow(row) {
      if (pinnedN != null || audio.paused) return;
      if (Date.now() < userUntil) return;
      if (comfortablyVisible(row)) return;
      scrollRow(row, false, false);
    }

    function navBottom() {
      var nav = document.querySelector(".nav-component");
      if (!nav) return 0;
      var b = nav.getBoundingClientRect().bottom;
      return b > 0 ? b : 0;
    }

    // Where text starts under the menu and the sticky selector + player.
    // While the story is scrolled, the head is stuck right under the menu.
    function chromeTop() {
      return navBottom() + head.getBoundingClientRect().height + 8;
    }

    // The site's back-to-top bar covers the bottom 60 px on tablets and phones.
    function chromeBottom() {
      return window.matchMedia("(max-width: 991px)").matches ? 60 : 0;
    }

    function comfortablyVisible(node) {
      var rect = node.getBoundingClientRect();
      var top = chromeTop();
      var limit = window.innerHeight - chromeBottom() - 8;
      if (rect.height >= limit - top) return rect.top >= top - 4 && rect.top <= top + 48;
      return rect.top >= top && rect.bottom <= limit;
    }

    function scrollRow(node, immediate, force) {
      if (!force && Date.now() < userUntil) return;
      var top = Math.max(0, node.getBoundingClientRect().top + window.scrollY - chromeTop());
      var lenis = getLenis();
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var jump = immediate || reduce;
      programmaticUntil = Date.now() + (jump ? 80 : 900);
      if (lenis && typeof lenis.scrollTo === "function") {
        if (jump || !lenis.smooth) lenis.scrollTo(top, { immediate: true });
        else {
          var before = window.scrollY;
          lenis.scrollTo(top, { duration: 0.6 });
          setTimeout(function () {
            if (Math.abs(window.scrollY - before) < 2 && Math.abs(window.scrollY - top) > 4) {
              lenis.scrollTo(top, { immediate: true });
            }
          }, 90);
        }
        return;
      }
      window.scrollTo({ top: top, behavior: jump ? "auto" : "smooth" });
    }

    function ensureTick() {
      if (rafId || audio.paused) return;
      rafId = requestAnimationFrame(tick);
    }

    function tick() {
      if (audio.paused) { rafId = 0; return; }
      if (!sliding) {
        var boundary = boundaryInfo();
        if (boundary && audio.currentTime >= boundary.at - 0.02) onBoundary();
        if (!audio.paused) updatePlayhead();
      }
      rafId = audio.paused ? 0 : requestAnimationFrame(tick);
    }

    function noteUserScroll() {
      if (Date.now() <= programmaticUntil) return;
      userUntil = Date.now() + 6000;
      userMoved = true;
    }

    function onKey(event) {
      if (event.target && event.target.closest && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        if (event.target.closest && event.target.closest("button, a")) return;
        event.preventDefault();
        toggleMain();
        return;
      }
      if (!reviewOn) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        var step = event.shiftKey ? 0.5 : 0.1;
        nudge(event.key === "ArrowLeft" ? -step : step);
      } else if (event.code === "KeyS" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setStartNow();
      } else if (event.code === "KeyE" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        setEndNow();
      } else if (event.code === "BracketLeft") {
        event.preventDefault();
        pinRelative(-1);
      } else if (event.code === "BracketRight") {
        event.preventDefault();
        pinRelative(1);
      } else if (event.key === "Escape") {
        pin(null);
      }
    }

    function verseUrl(n) {
      var url = new URL(location.href);
      url.searchParams.set("v", String(n));
      url.hash = "";
      return url;
    }

    function refreshShareHrefs() {
      rowByN.forEach(function (row, n) {
        var link = row.querySelector(".st-share");
        if (link) link.href = verseUrl(n).toString();
      });
    }

    function shareVerse(n, link) {
      var url = verseUrl(n);
      history.replaceState(null, "", url.pathname + url.search);
      refreshShareHrefs();
      copyText(url.toString()).then(function () {
        clearTimeout(link.__stCopied);
        link.classList.add("is-copied");
        link.innerHTML = ICON_CHECK;
        link.title = "Link copied";
        announce("Link to verse " + n + " copied");
        link.__stCopied = setTimeout(function () {
          link.innerHTML = ICON_SHARE;
          link.title = "Copy link to this verse";
          link.classList.remove("is-copied");
        }, 1400);
      });
    }

    // A Ku Waru note with no "i" uses the verse as the toggle. The icon is a
    // CSS ::after, so a click on it has to be recognized by position. That
    // click opens the note; a click on the words still seeks.
    function hitKuNoteMark(event) {
      if (layout.getAttribute("data-view") !== "ku") return false;
      var target = eventTarget(event);
      if (!target || !target.closest) return false;
      var content = target.closest(".st-col.st-ku .w-dropdown-toggle > .line-content");
      if (!content || content.querySelector(".line-info-icon")) return false;
      var text = content.querySelector(":scope > .line-text");
      if (!text) return false;
      var gap = parseFloat(window.getComputedStyle(content).columnGap);
      if (!isFinite(gap)) gap = 16;
      var tr = text.getBoundingClientRect();
      var size = 20;
      var left = tr.right + gap;
      var top = tr.top + Math.max(0, (tr.height - size) / 2);
      var x = event.clientX;
      var y = event.clientY;
      return x >= left - 4 && x <= left + size + 4 && y >= top - 4 && y <= top + size + 4;
    }

    // Notes live in the English line. In the Ku Waru-only view that line is
    // hidden, so park the whole dropdown (icon + note) after the Ku Waru
    // verse. A verse that already has its own Ku Waru note is left alone:
    // its note opens from the "i" drawn on that toggle. The paragraph
    // markup is not touched. Restored in the other views.
    function restoreParkedNotes() {
      parkedNotes.forEach(function (item) {
        if (item.observer) item.observer.disconnect();
        item.dropdown.classList.remove("st-parked-note");
        item.host.classList.remove("st-note-host");
        if (item.list) {
          item.list.classList.remove("w--open");
          item.list.style.width = "";
          item.list.style.marginLeft = "";
        }
        if (item.toggle) {
          item.toggle.classList.remove("w--open");
          if (item.toggle.hasAttribute("aria-expanded")) item.toggle.setAttribute("aria-expanded", "false");
        }
        if (item.next && item.next.parentNode === item.parent) item.parent.insertBefore(item.dropdown, item.next);
        else item.parent.appendChild(item.dropdown);
      });
      parkedNotes = [];
      noteFitters = [];
    }

    function parkNotesForKu() {
      restoreParkedNotes();
      Array.prototype.forEach.call(layout.querySelectorAll(".st-row"), function (row) {
        var kuCol = row.querySelector(":scope > .st-col.st-ku");
        var enCol = row.querySelector(":scope > .st-col.st-en");
        if (!kuCol || !enCol) return;
        if (kuCol.querySelector(".line-info-icon")) return;
        var dropdown = enCol.querySelector(".line-dropdown.w-dropdown");
        if (!dropdown || !dropdown.querySelector(".line-info-icon")) return;
        var host = kuCol.querySelector(".line .line-paragraphs");
        if (!host || host.closest(".w-dropdown-list")) return;
        var list = dropdown.querySelector(".w-dropdown-list");
        var entry = {
          dropdown: dropdown,
          parent: dropdown.parentNode,
          next: dropdown.nextSibling,
          host: host,
          list: list,
          toggle: dropdown.querySelector(".w-dropdown-toggle")
        };
        if (list) {
          entry.observer = new MutationObserver(fitOpenNotes);
          entry.observer.observe(list, { attributes: true, attributeFilter: ["class"] });
          noteFitters.push(entry);
        }
        parkedNotes.push(entry);
        host.classList.add("st-note-host");
        dropdown.classList.add("st-parked-note");
        host.appendChild(dropdown);
      });
    }

    function setView(view) {
      if (view !== "ku" && view !== "en" && view !== "both") view = "both";
      if (view === "ku") parkNotesForKu();
      else restoreParkedNotes();
      layout.setAttribute("data-view", view);
      Object.keys(viewButtons).forEach(function (key) {
        viewButtons[key].setAttribute("aria-checked", key === view ? "true" : "false");
      });
      try { sessionStorage.setItem("sungtales-view", view); } catch (e) { /* private mode */ }
    }

    // The head sticks right under the menu, whatever the menu's height. Rows
    // reached by a #st-verse-n link land below the head, not under it.
    function applyPad() {
      var navH = navBottom();
      head.style.top = navH + "px";
      layout.style.setProperty("--st-chrome", Math.ceil(navH + head.getBoundingClientRect().height + 8) + "px");
    }
  }

  function markNoTranslate(scope) {
    var nodes = scope.querySelectorAll(".paragraph-20px-regular, .paragraph-18px-regular, .w-dropdown-list, .line-paragraphs");
    Array.prototype.forEach.call(nodes, function (node) {
      node.setAttribute("translate", "no");
    });
  }

  function storedView() {
    try {
      var view = sessionStorage.getItem("sungtales-view");
      if (view === "ku" || view === "en" || view === "both") return view;
    } catch (e) { /* private mode */ }
    return "both";
  }

  function getLenis() {
    var candidates = [window.lenis, window.__sungtalesLenis];
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i] && typeof candidates[i].scrollTo === "function") return candidates[i];
    }
    return null;
  }

  function fmt(t) {
    if (!Number.isFinite(t) || t < 0) t = 0;
    var whole = Math.floor(t);
    var m = Math.floor(whole / 60);
    var s = whole % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function fmtFine(t) {
    if (t == null || !Number.isFinite(Number(t))) return "\u2014";
    t = Number(t);
    var m = Math.floor(t / 60);
    var s = (t - m * 60).toFixed(2);
    if (s.length < 5) s = "0" + s;
    return m + ":" + s;
  }

  function fileName(url) {
    try {
      var path = new URL(url, location.href).pathname.split("/").pop() || "audio.mp3";
      return decodeURIComponent(path);
    } catch (e) {
      return "audio.mp3";
    }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); } catch (e) { /* ignore */ }
    area.remove();
    return Promise.resolve();
  }
})();

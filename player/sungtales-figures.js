/*
 * Sung Tales: audio sync for figures in the Introduction (Alan, 2026-11-17).
 *
 * Figure 1 (a table: 8 rows = Konts lines 3-10), Text 4 (10 lines = Small Boy
 * lines 1-10) and Figure 3 (a score: 10 measures = Small Boy lines 1-10) are
 * images. This script finds each image by its file name, lays line areas over
 * it and adds a play button below its caption. While the song plays, a highlight moves
 * to the line being sung; tapping a line plays from there; playback stops at
 * the end of the last line.
 *
 * The line boxes (pixels of the image file) are in sync/introduction-figures.json.
 * The timings are read from each story's own sync file, so a verse fixed with
 * ?review=1 on the story page is fixed here too. If an image is replaced in
 * Webflow its file name changes and that figure is left as a plain image until
 * its boxes are measured on the new file.
 *
 * Introduction page, Custom code > Before </body>:
 *   <link rel="stylesheet" href="https://cvelezvalencia.github.io/sungtales/player/sungtales-figures.css">
 *   <script src="https://cvelezvalencia.github.io/sungtales/player/sungtales-figures.js"
 *     data-figures="https://cvelezvalencia.github.io/sungtales/sync/introduction-figures.json"></script>
 */
(function () {
  "use strict";

  var script = document.currentScript;
  var figuresAttr = script && script.getAttribute("data-figures");
  if (!figuresAttr || window.__stFigures) return;
  var figuresUrl = new URL(figuresAttr, location.href).href;

  function icon(body) {
    return '<svg class="st-icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" fill="currentColor">' + body + "</svg>";
  }
  var ICON_PLAY = icon('<path d="M8 5.2v13.6L19 12z"/>');
  var ICON_PAUSE = icon('<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"/>');

  var figures = [];
  var audio = null;     // one <audio> for the page, made on first use
  var active = null;    // the figure that is using it
  var wantTime = null;  // a jump waiting for the recording to load
  var finished = false; // stopped at the end of a figure's last line
  var rafId = 0;
  var stopTimer = 0;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function getJson(url) {
    return fetch(url, { credentials: "omit" }).then(function (res) {
      if (!res.ok) throw new Error(res.status + " " + url);
      return res.json();
    });
  }

  // Webflow serves an asset as ".../<asset id>_<file name>", plus resized
  // copies ("-p-800") in srcset. Match the full-size file name in src.
  function findImage(fileName) {
    var imgs = document.getElementsByTagName("img");
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute("src") || "";
      try { src = decodeURIComponent(src); } catch (e) { /* keep as is */ }
      src = src.split("?")[0];
      if (src.slice(-(fileName.length + 1)) === "_" + fileName) return imgs[i];
    }
    return null;
  }

  function pct(value, total) {
    return (100 * value / total).toFixed(4) + "%";
  }

  function place(node, box, size) {
    node.style.left = pct(box[0], size[0]);
    node.style.top = pct(box[1], size[1]);
    node.style.width = pct(box[2], size[0]);
    node.style.height = pct(box[3], size[1]);
  }

  // Same rule as a single verse in the story player: stop 0.15 s after the
  // line's end, but never later than the next verse's start.
  function timesFor(def, sync) {
    var verses = (sync && sync.verses) || [];
    var byN = {};
    verses.forEach(function (v) { byN[v.n] = v; });
    var lines = [];
    def.lines.forEach(function (line) {
      var v = byN[line.n];
      var start = v ? Number(v.start) : NaN;
      if (v && v.start != null && Number.isFinite(start)) {
        lines.push({ n: line.n, box: line.box, start: start, end: Number(v.end) });
      }
    });
    if (lines.length !== def.lines.length) return null;
    lines.sort(function (a, b) { return a.start - b.start; });
    var last = lines[lines.length - 1];
    var next = Infinity;
    verses.forEach(function (v) {
      var s = Number(v.start);
      if (v.start != null && Number.isFinite(s) && s > last.start + 0.0005 && s < next) next = s;
    });
    var stop = Number.isFinite(last.end) ? last.end + 0.15 : next;
    stop = Math.min(stop, next);
    if (!(stop > last.start)) return null;
    return { lines: lines, first: lines[0].start, stopAt: stop };
  }

  function build(def, img, times, syncBase) {
    var fig = {
      def: def,
      lines: times.lines,
      first: times.first,
      stopAt: times.stopAt,
      audioUrl: new URL(def.audio, syncBase).href,
      shownN: null
    };

    var wrap = el("div", "st-fig");
    wrap.setAttribute("data-highlight", def.highlight === "outline" ? "outline" : "fill");
    img.parentNode.insertBefore(wrap, img);
    wrap.appendChild(img);

    var layer = el("div", "st-fig-layer");
    layer.setAttribute("aria-hidden", "true");
    var hl = el("div", "st-fig-hl");
    layer.appendChild(hl);
    fig.lines.forEach(function (line) {
      var hit = el("div", "st-fig-hit");
      hit.setAttribute("data-n", String(line.n));
      hit.title = "Play from line " + line.n;
      place(hit, line.box, def.size);
      hit.addEventListener("click", function () { start(fig, line.start); });
      layer.appendChild(hit);
    });
    wrap.appendChild(layer);

    var bar = el("div", "st-fig-bar");
    var button = el("button", "st-fig-play");
    button.type = "button";
    var label = el("span", "st-fig-label", def.label || "Listen");
    var nowEl = el("span", "st-fig-now", "");
    bar.appendChild(button);
    bar.appendChild(label);
    bar.appendChild(nowEl);
    // Below the figure's caption (Camila, 2026-11-19), or below the image if
    // it has none.
    var after = wrap;
    var next = wrap.nextElementSibling;
    if (next && next.classList.contains("caption")) after = next;
    after.parentNode.insertBefore(bar, after.nextSibling);
    button.addEventListener("click", function () { toggle(fig); });
    // The whole framed box works like the button (Camila, 2026-11-23).
    bar.addEventListener("click", function (e) {
      if (!button.contains(e.target)) toggle(fig);
    });

    fig.button = button;
    fig.label = label;
    fig.show = function (line) {
      var n = line ? line.n : null;
      if (n === fig.shownN) return;
      fig.shownN = n;
      if (line) {
        // First line of a run: appear in place instead of sliding in.
        if (!hl.classList.contains("is-on")) hl.classList.add("st-fig-jump");
        place(hl, line.box, def.size);
        hl.offsetWidth; // apply the position before showing it
        hl.classList.remove("st-fig-jump");
        hl.classList.add("is-on");
        nowEl.textContent = "Line " + n;
      } else {
        hl.classList.remove("is-on");
        nowEl.textContent = "";
      }
    };
    setButton(fig, false);
    figures.push(fig);
  }

  function setButton(fig, playing) {
    fig.button.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    fig.button.setAttribute("aria-label", playing ? "Pause" : (fig.def.label || "Play"));
    fig.button.classList.toggle("is-playing", playing);
  }

  function refresh() {
    figures.forEach(function (fig) {
      setButton(fig, fig === active && audio && !audio.paused);
    });
  }

  function getAudio() {
    if (audio) return audio;
    audio = document.createElement("audio");
    audio.className = "st-fig-audio";
    audio.preload = "none";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("webkit-playsinline", "");
    document.body.appendChild(audio);
    audio.addEventListener("loadedmetadata", function () {
      if (wantTime != null) {
        try { audio.currentTime = wantTime; } catch (e) { /* ignore */ }
      }
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
      refresh();
      loop();
      armStop();
    });
    audio.addEventListener("play", refresh);
    audio.addEventListener("pause", refresh);
    audio.addEventListener("timeupdate", function () { check(); armStop(); });
    audio.addEventListener("seeked", function () { check(); armStop(); });
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", function () {
      wantTime = null;
      if (active) {
        active.show(null);
        active.label.textContent = "The recording didn\u2019t load. Please try again later.";
      }
      refresh();
    });
    return audio;
  }

  function now() {
    if (wantTime != null) return wantTime;
    return audio ? audio.currentTime || 0 : 0;
  }

  function lineAt(fig, t) {
    if (t >= fig.stopAt) return null;
    var found = null;
    for (var i = 0; i < fig.lines.length; i++) {
      if (fig.lines[i].start <= t + 1e-4) found = fig.lines[i];
      else break;
    }
    return found;
  }

  function check() {
    if (!active || !audio) return;
    if (finished) {
      active.show(null);
      return;
    }
    var t = now();
    if (wantTime == null && !audio.paused && t >= active.stopAt - 0.02) {
      finish();
      return;
    }
    active.show(lineAt(active, t));
  }

  // A timer for the exact end of the last line: animation frames stop in
  // background tabs and timeupdate only comes about four times a second.
  function armStop() {
    clearTimeout(stopTimer);
    if (!active || !audio || audio.paused || finished || wantTime != null) return;
    var ms = (active.stopAt - audio.currentTime) * 1000 / (audio.playbackRate || 1);
    if (ms <= 20) {
      finish();
      return;
    }
    stopTimer = setTimeout(function () {
      check();
      armStop();
    }, ms);
  }

  function loop() {
    cancelAnimationFrame(rafId);
    if (!audio || audio.paused) return;
    check();
    rafId = requestAnimationFrame(loop);
  }

  // End of the last line: stop, clear the highlight, and let Play start over.
  function finish() {
    if (!audio) return;
    cancelAnimationFrame(rafId);
    clearTimeout(stopTimer);
    wantTime = null;
    finished = true;
    audio.pause();
    if (active) {
      active.show(null);
      try { audio.currentTime = active.first; } catch (e) { /* ignore */ }
    }
    refresh();
  }

  function start(fig, t) {
    var a = getAudio();
    if (active && active !== fig) {
      a.pause();
      active.show(null);
    }
    active = fig;
    finished = false;
    fig.label.textContent = fig.def.label || "Listen";
    if (a.getAttribute("src") !== fig.audioUrl) a.src = fig.audioUrl;
    wantTime = t;
    try { a.currentTime = t; } catch (e) { /* before metadata: loadedmetadata does it */ }
    var pending = a.play();
    if (pending && pending.catch) pending.catch(function () { refresh(); });
    fig.show(lineAt(fig, t));
    refresh();
  }

  function toggle(fig) {
    var a = getAudio();
    if (active === fig && !a.paused) {
      a.pause();
      return;
    }
    var t = a.currentTime || 0;
    if (active === fig && wantTime == null && a.getAttribute("src") === fig.audioUrl &&
        t >= fig.first - 0.05 && t < fig.stopAt - 0.05) {
      finished = false;
      var pending = a.play();
      if (pending && pending.catch) pending.catch(function () { refresh(); });
      return;
    }
    start(fig, fig.first);
  }

  function init() {
    getJson(figuresUrl).then(function (data) {
      var defs = (data && data.figures) || [];
      var syncs = {};
      defs.forEach(function (def) {
        if (!def.sync || syncs[def.sync]) return;
        var url = new URL(def.sync, figuresUrl).href;
        syncs[def.sync] = getJson(url).catch(function () { return null; });
      });
      defs.forEach(function (def) {
        var img = def.image && findImage(def.image);
        if (!img || !def.size || !def.lines || !syncs[def.sync]) return;
        syncs[def.sync].then(function (sync) {
          var times = timesFor(def, sync);
          if (times && img.parentNode) build(def, img, times, figuresUrl);
        });
      });
    }).catch(function () { /* figures stay plain images */ });
  }

  window.__stFigures = {
    figures: figures,
    audio: function () { return audio; },
    check: check
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

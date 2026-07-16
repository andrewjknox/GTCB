/* GTCB shared nav — renders the nav bar into the <nav class="site-nav">
   placeholder on every page (single source of truth for the links), then
   wires the mobile burger toggle + metric/imperial unit toggle.
   Unit choice persists in localStorage ("gtcb-units"). */
(function () {
  "use strict";

  /* ---------- render ---------- */
  /* Entries are either ["href", "Label"] or a group: ["Label", [entries]].
     Groups render as a dropdown on desktop and an expandable section in
     the burger menu. */
  var PAGES = [
    ["index.html", "Dashboard"],
    ["Training Plan", [
      ["plan.html", "The Plan"],
      ["strength.html", "Strength"],
      ["venues.html", "Locations"]
    ]],
    ["course.html", "Course"],
    ["regs.html", "102K Regs"],
    ["conditions.html", "Entry Conditions"]
  ];

  var nav = document.querySelector("nav.site-nav");
  if (nav) {
    // Last path segment; a directory URL ("…/gtcb/") means the index page.
    var here = location.pathname.split("/").pop() || "index.html";

    var renderLink = function (page) {
      return '<a href="' + page[0] + '"' +
        (page[0] === here ? ' aria-current="page"' : "") +
        ">" + page[1] + "</a>";
    };

    var parts = [
      '<button class="nav-burger" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Toggle navigation menu">',
      '<span class="burger-box" aria-hidden="true">',
      '<span class="burger-bar"></span><span class="burger-bar"></span><span class="burger-bar"></span>',
      '</span> MENU</button>',
      '<div id="nav-links" class="nav-links">'
    ];
    for (var p = 0; p < PAGES.length; p++) {
      if (Array.isArray(PAGES[p][1])) {
        var children = PAGES[p][1];
        var hasCurrent = false;
        for (var c = 0; c < children.length; c++) {
          if (children[c][0] === here) { hasCurrent = true; break; }
        }
        parts.push(
          '<div class="nav-group">',
          '<button class="nav-group-btn' + (hasCurrent ? " has-current" : "") +
          '" type="button" aria-expanded="false">' + PAGES[p][0] +
          ' <span class="nav-caret" aria-hidden="true">▾</span></button>',
          '<div class="nav-sub">'
        );
        for (c = 0; c < children.length; c++) parts.push(renderLink(children[c]));
        parts.push("</div>", "</div>");
      } else {
        parts.push(renderLink(PAGES[p]));
      }
    }
    parts.push(
      '<button id="unit-toggle" class="unit-toggle" type="button" aria-pressed="false" aria-label="Switch between metric and imperial units">UNITS: KM·M</button>',
      "</div>"
    );
    nav.innerHTML = parts.join("");
  }

  /* ---------- nav groups (sub-nav dropdowns) ---------- */
  var groupBtns = document.querySelectorAll(".nav-group-btn");

  function closeGroups(except) {
    for (var g = 0; g < groupBtns.length; g++) {
      if (groupBtns[g] === except) continue;
      groupBtns[g].setAttribute("aria-expanded", "false");
      groupBtns[g].parentNode.classList.remove("open");
    }
  }

  for (var gb = 0; gb < groupBtns.length; gb++) {
    groupBtns[gb].addEventListener("click", function () {
      var open = this.getAttribute("aria-expanded") !== "true";
      closeGroups(this);
      this.setAttribute("aria-expanded", open ? "true" : "false");
      this.parentNode.classList.toggle("open", open);
    });
  }

  // A click anywhere outside a group closes any open dropdown.
  document.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t.nodeType === 1) {
      if (t.classList.contains("nav-group")) return;
      t = t.parentNode;
    }
    closeGroups(null);
  });

  /* ---------- burger ---------- */
  var btn = document.querySelector(".nav-burger");
  var links = document.getElementById("nav-links");

  if (btn && links) {
    var setOpen = function (open) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      links.classList.toggle("open", open);
      if (!open) closeGroups(null);
    };

    btn.addEventListener("click", function () {
      setOpen(btn.getAttribute("aria-expanded") !== "true");
    });

    // Close the menu once a destination is chosen.
    links.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t !== links) {
        if (t.tagName === "A") { setOpen(false); return; }
        t = t.parentNode;
      }
    });

    // Escape closes the menu and returns focus to the button.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeGroups(null);
        if (btn.getAttribute("aria-expanded") === "true") {
          setOpen(false);
          btn.focus();
        }
      }
    });
  }

  /* ---------- units (metric <-> imperial) ---------- */
  var UNITS_KEY = "gtcb-units";

  var currentUnits = (function () {
    try {
      return localStorage.getItem(UNITS_KEY) === "imperial" ? "imperial" : "metric";
    } catch (e) {
      return "metric";
    }
  })();

  function getUnits() { return currentUnits; }

  window.GTCBUnits = { get: getUnits };

  var toggle = document.getElementById("unit-toggle");

  /* Doc pages mark their <main> with data-units-convert; baked metric text
     ("1,400 m", "~8–9 km", "30m") is rewritten in place. Originals are kept
     so toggling back is lossless. The dashboard converts in app.js instead. */
  var convertRoot = document.querySelector("[data-units-convert]");
  var originals = null; // [{ node, text }]

  var NUM = "\\d[\\d,]*(?:\\.\\d+)?";
  // number, optional dash-joined second number, then a bare m/km unit
  var UNIT_RE = new RegExp(
    "(" + NUM + ")(?:(\\s*[\\u2013\\u2014-]\\s*)(" + NUM + "))?\\s?(km|m)\\b",
    "g"
  );

  function parseNum(s) { return parseFloat(s.replace(/,/g, "")); }

  function fmtFt(s) {
    return Math.round(parseNum(s) * 3.28084).toLocaleString("en-GB");
  }

  function fmtMi(s) {
    var mi = (parseNum(s) * 0.621371).toFixed(1);
    return mi.slice(-2) === ".0" ? mi.slice(0, -2) : mi;
  }

  function toImperial(text) {
    return text.replace(UNIT_RE, function (_all, a, sep, b, unit) {
      var f = unit === "km" ? fmtMi : fmtFt;
      return f(a) + (sep ? sep + f(b) : "") + " " + (unit === "km" ? "mi" : "ft");
    });
  }

  function collectOriginals() {
    originals = [];
    var walker = document.createTreeWalker(convertRoot, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      UNIT_RE.lastIndex = 0;
      if (UNIT_RE.test(n.nodeValue)) originals.push({ node: n, text: n.nodeValue });
    }
  }

  function applyUnits() {
    var imperial = getUnits() === "imperial";
    if (toggle) {
      toggle.textContent = imperial ? "UNITS: MI·FT" : "UNITS: KM·M";
      toggle.setAttribute("aria-pressed", imperial ? "true" : "false");
    }
    if (convertRoot) {
      if (originals === null) collectOriginals();
      for (var i = 0; i < originals.length; i++) {
        var o = originals[i];
        o.node.nodeValue = imperial ? toImperial(o.text) : o.text;
      }
    }
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = currentUnits === "imperial" ? "metric" : "imperial";
      currentUnits = next;
      try { localStorage.setItem(UNITS_KEY, next); } catch (e) { /* in-memory only */ }
      applyUnits();
      window.dispatchEvent(new CustomEvent("gtcb:units", { detail: { units: next } }));
    });
  }

  applyUnits();
})();

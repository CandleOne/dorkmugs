/* include/sexymode.js — Sexy Mode toggle */
(function () {
  'use strict';

  var STORAGE_KEY = 'dorkmugs_sexy_mode';

  function applyMode(enabled) {
    document.body.classList.toggle('sexy-mode', enabled);
  }

  function init() {
    var enabled = localStorage.getItem(STORAGE_KEY) === '1';
    applyMode(enabled);

    var btn = document.getElementById('btn-sexy-mode');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var isOn = document.body.classList.toggle('sexy-mode');
      localStorage.setItem(STORAGE_KEY, isOn ? '1' : '0');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

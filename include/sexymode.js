/* include/sexymode.js — Sexy Mode toggle */
(function () {
  'use strict';

  var STORAGE_KEY = 'dorkmugs_sexy_mode';
  var audio = null;

  function getAudio() {
    if (!audio) {
      audio = new Audio('./Assets/audio/music/OMFG - Hello [No Copyright - Free Music].mp3');
      audio.loop = true;
      audio.volume = 0.5;
    }
    return audio;
  }

  var PLEASURE_NORMAL = './Assets/designassets/pleasure.png';
  var PLEASURE_SEXY   = './Assets/designassets/pleasuresexymode.png';

  function applyMode(enabled) {
    document.body.classList.toggle('sexy-mode', enabled);
    var img = document.querySelector('.inline-pleasure-img');
    if (img) {
      img.src = enabled ? PLEASURE_SEXY : PLEASURE_NORMAL;
    }
    if (enabled) {
      getAudio().play().catch(function () { /* autoplay blocked — user must interact first */ });
    } else {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }

  function init() {
    var enabled = localStorage.getItem(STORAGE_KEY) === '1';
    applyMode(enabled);

    var btn = document.getElementById('btn-sexy-mode');
    if (!btn) return;

    btn.addEventListener('click', function () {
      var isOn = document.body.classList.toggle('sexy-mode');
      localStorage.setItem(STORAGE_KEY, isOn ? '1' : '0');
      var img = document.querySelector('.inline-pleasure-img');
      if (img) {
        img.src = isOn ? PLEASURE_SEXY : PLEASURE_NORMAL;
      }
      if (isOn) {
        getAudio().play().catch(function () {});
      } else {
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

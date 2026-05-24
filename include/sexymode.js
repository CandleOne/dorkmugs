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

  function applyMode(enabled) {
    document.body.classList.toggle('sexy-mode', enabled);
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

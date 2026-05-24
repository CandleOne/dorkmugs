/* include/auth.js — frontend auth state helper
 * Communicates with the backend API (cookies are httpOnly; this file
 * only manages the non-sensitive display state stored in sessionStorage).
 */
(function () {
  'use strict';

  function resolveApiBase() {
    var explicit = window.__DORKMUGS_API_BASE__;
    if (explicit) return String(explicit).replace(/\/+$/, '');

    if (window.location.protocol === 'file:') {
      return 'http://localhost:5000/api';
    }

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return window.location.protocol + '//' + window.location.hostname + ':5000/api';
    }

    return window.location.origin.replace(/\/+$/, '') + '/api';
  }

  var API = resolveApiBase();

  // ─── Public API ────────────────────────────────────────────────────────────

  window.Auth = {
    getUser: getUser,
    isLoggedIn: isLoggedIn,
    isAdmin: isAdmin,
    login: login,
    register: register,
    logout: logout,
    refreshSession: refreshSession,
    updateNavButtons: updateNavButtons,
  };

  // ─── Session state (non-sensitive) ─────────────────────────────────────────

  var SESSION_KEY = 'dm_user';

  function getUser() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
    catch (e) { return null; }
  }

  function setUser(user) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  function clearUser() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function isLoggedIn() { return !!getUser(); }
  function isAdmin() { var u = getUser(); return u && u.role === 'ADMIN'; }

  // ─── API calls ──────────────────────────────────────────────────────────────

  function api(method, path, body) {
    return fetch(API + path, {
      method: method,
      credentials: 'include', // send/receive httpOnly cookies
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw Object.assign(new Error(data.error || 'Request failed'), { data: data, status: r.status });
        return data;
      });
    });
  }

  /** Attempt silent refresh; resolves with user or null */
  function refreshSession() {
    return api('POST', '/auth/refresh')
      .then(function (data) { setUser(data.user); return data.user; })
      .catch(function () { clearUser(); return null; });
  }

  /** On page load: validate session cookie via /auth/me, fallback to refresh */
  function initSession() {
    return api('GET', '/auth/me')
      .then(function (data) { setUser(data.user); return data.user; })
      .catch(function () {
        return refreshSession();
      });
  }

  function login(email, password) {
    return api('POST', '/auth/login', { email: email, password: password })
      .then(function (data) { setUser(data.user); return data.user; });
  }

  function register(name, email, password) {
    return api('POST', '/auth/register', { name: name, email: email, password: password })
      .then(function (data) { setUser(data.user); return data.user; });
  }

  function logout() {
    return api('POST', '/auth/logout')
      .finally(function () {
        clearUser();
        window.location.href = 'index.html';
      });
  }

  // ─── Nav button wiring ──────────────────────────────────────────────────────

  function updateNavButtons() {
    var user = getUser();
    var btnLogin = document.getElementById('btn-login');
    var btnSignup = document.getElementById('btn001');
    var btnAccount = document.getElementById('btn-account');
    var btnLogout = document.getElementById('btn-logout');

    // Mobile nav dropdown auth items
    var navLiLogin   = document.getElementById('nav-li-login');
    var navLiSignup  = document.getElementById('nav-li-signup');
    var navLiAccount = document.getElementById('nav-li-account');
    var navLiLogout  = document.getElementById('nav-li-logout');
    var navLogoutLink = document.getElementById('nav-logout-link');

    if (user) {
      // Logged in state — header buttons
      if (btnLogin) { btnLogin.style.display = 'none'; }
      if (btnSignup) { btnSignup.style.display = 'none'; }
      if (btnAccount) {
        btnAccount.style.display = '';
        btnAccount.textContent = user.name.split(' ')[0];
        btnAccount.onclick = function () {
          window.location.href = user.role === 'ADMIN' ? 'admin.html' : 'account.html';
        };
      }
      if (btnLogout) {
        btnLogout.style.display = '';
        btnLogout.onclick = function () { Auth.logout(); };
      }
      // Logged in state — nav dropdown
      if (navLiLogin)  { navLiLogin.style.display  = 'none'; }
      if (navLiSignup) { navLiSignup.style.display = 'none'; }
      if (navLiAccount) {
        navLiAccount.style.display = '';
        var acctLink = navLiAccount.querySelector('a');
        if (acctLink) {
          acctLink.textContent = user.name.split(' ')[0] + "'s Account";
          acctLink.href = user.role === 'ADMIN' ? 'admin.html' : 'account.html';
        }
      }
      if (navLiLogout)  { navLiLogout.style.display = ''; }
      if (navLogoutLink) { navLogoutLink.onclick = function (e) { e.preventDefault(); Auth.logout(); }; }
    } else {
      // Logged out state — header buttons
      if (btnLogin) {
        btnLogin.style.display = '';
        btnLogin.onclick = function () { window.location.href = 'login.html'; };
      }
      if (btnSignup) {
        btnSignup.style.display = '';
        btnSignup.onclick = function () { window.location.href = 'register.html'; };
      }
      if (btnAccount) { btnAccount.style.display = 'none'; }
      if (btnLogout)  { btnLogout.style.display  = 'none'; }
      // Logged out state — nav dropdown
      if (navLiLogin)   { navLiLogin.style.display   = ''; }
      if (navLiSignup)  { navLiSignup.style.display  = ''; }
      if (navLiAccount) { navLiAccount.style.display = 'none'; }
      if (navLiLogout)  { navLiLogout.style.display  = 'none'; }
    }
  }

  // ─── Auto-init ──────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    initSession().then(function () {
      updateNavButtons();
    });
  });

})();

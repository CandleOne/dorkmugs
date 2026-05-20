/* cart.js — Dork Mugs client-side cart with localStorage persistence + backend checkout */
var Cart = (function () {
  'use strict';

  var KEY = 'dorkmugs_cart';

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

  /* ── storage ── */
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function save(items) {
    localStorage.setItem(KEY, JSON.stringify(items));
    _updateBadge();
  }

  /* ── public read ── */
  function getItems() { return load(); }
  function getCount() {
    return load().reduce(function (n, i) { return n + i.qty; }, 0);
  }
  function getTotal() {
    return load().reduce(function (s, i) { return s + i.price * i.qty; }, 0);
  }

  /* ── mutations ── */
  /**
   * Add a product to the cart.
   * @param {string} id                   Internal product ID
   * @param {string} name
   * @param {number} price                  In cents (e.g. 2499 for $24.99)
   * @param {string} image
   * @param {number} qty
   * @param {string} [printifyProductId]    Printify product ID (required for fulfillment)
   * @param {string} [variantId]            Printify variant ID (required for fulfillment)
   * @param {string} [placement]             Design placement: 'left' | 'center' | 'right'
   */
  function add(id, name, price, image, qty, printifyProductId, variantId, placement) {
    qty = parseInt(qty, 10) || 1;
    var items = load();
    var found = false;
    for (var x = 0; x < items.length; x++) {
      if (items[x].id === id) {
        items[x].qty += qty;
        if (printifyProductId) items[x].printifyProductId = printifyProductId;
        if (variantId) items[x].variantId = variantId;
        if (placement) items[x].placement = placement;
        found = true; break;
      }
    }
    if (!found) {
      items.push({
        id: id, name: name, price: parseFloat(price), image: image, qty: qty,
        printifyProductId: printifyProductId || null,
        variantId: variantId || null,
        placement: placement || 'left',
      });
    }
    save(items);
    _showToast(name);
  }

  function remove(id) {
    save(load().filter(function (i) { return i.id !== id; }));
    renderDrawer();
  }

  function setQty(id, qty) {
    qty = parseInt(qty, 10);
    if (qty < 1) { remove(id); return; }
    var items = load();
    for (var x = 0; x < items.length; x++) {
      if (items[x].id === id) { items[x].qty = qty; break; }
    }
    save(items);
    renderDrawer();
  }

  /* ── badge ── */
  function _updateBadge() {
    var badge = document.getElementById('cart-badge');
    if (!badge) return;
    var n = getCount();
    badge.textContent = n;
    badge.style.display = n > 0 ? 'flex' : 'none';
  }

  /* ── toast ── */
  function _esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _showToast(name) {
    var t = document.getElementById('cart-toast');
    if (!t) return;
    t.innerHTML = '<i class="fas fa-check-circle"></i> <strong>' + _esc(name) + '</strong> added to cart!';
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  /* ── checkout ── */
  /**
   * Create a Stripe Checkout Session via the backend and redirect to Stripe.
   */
  function checkout() {
    var items = load();
    if (!items.length) return;

    // Guard: Stripe requires a non-zero charge
    var total = items.reduce(function (s, i) { return s + i.price * i.qty; }, 0);
    if (total <= 0) {
      alert('Your cart total is $0.00. Please add a priced item before checking out.');
      return;
    }

    var btn = document.getElementById('checkout-btn') || document.querySelector('.cart-checkout-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting…'; }

    var payload = items.map(function (i) {
      return {
        name: i.name,
        price: Math.round(i.price * 100), // convert to cents
        qty: i.qty,
        image: i.image || undefined,
        printifyProductId: i.printifyProductId || undefined,
        variantId: i.variantId || undefined,
        placement: i.placement || 'left',
      };
    });

    fetch(API + '/checkout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    })
    .then(function (r) {
      return r.text().then(function (raw) {
        var data;
        try { data = raw ? JSON.parse(raw) : {}; }
        catch (_e) {
          throw new Error('Checkout endpoint returned an unexpected response.');
        }
        if (!r.ok) {
          var msg = data.error ||
            (Array.isArray(data.errors) && data.errors.length && data.errors[0].msg) ||
            'Checkout failed.';
          throw new Error(msg);
        }
        return data;
      });
    })
    .then(function (data) {
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned.');
      }
    })
    .catch(function (err) {
      alert(err.message || 'Could not start checkout. Please try again.');
      if (btn) { btn.disabled = false; btn.textContent = 'Proceed to Checkout'; }
    });
  }

  /* ── drawer render ── */
  function renderDrawer() {
    var list    = document.getElementById('cart-items');
    var totalEl = document.getElementById('cart-total');
    var countEl = document.getElementById('cart-drawer-count');
    if (!list) return;

    var items = load();

    if (countEl) countEl.textContent = getCount();

    if (items.length === 0) {
      list.innerHTML = '<p class="cart-empty"><i class="fas fa-shopping-cart"></i><br>Your cart is empty.</p>';
      if (totalEl) totalEl.textContent = '$0.00';
      return;
    }

    list.innerHTML = items.map(function (item) {
      return [
        '<div class="cart-item">',
          '<img class="cart-item-img" src="' + _esc(item.image) + '" alt="' + _esc(item.name) + '" />',
          '<div class="cart-item-info">',
            '<p class="cart-item-name">' + _esc(item.name) + '</p>',
            (item.placement ? '<p class="cart-item-placement"><i class="fas fa-align-' + _esc(item.placement) + '"></i> ' + _esc(item.placement.charAt(0).toUpperCase() + item.placement.slice(1)) + ' placement</p>' : ''),
            '<p class="cart-item-price">$' + (item.price * item.qty).toFixed(2) + '</p>',
            '<div class="cart-item-qty">',
              '<button type="button" aria-label="Decrease" onclick="Cart.setQty(\'' + _esc(item.id) + '\',' + (item.qty - 1) + ')">&#8722;</button>',
              '<span>' + item.qty + '</span>',
              '<button type="button" aria-label="Increase" onclick="Cart.setQty(\'' + _esc(item.id) + '\',' + (item.qty + 1) + ')">&#43;</button>',
            '</div>',
          '</div>',
          '<button class="cart-item-remove" type="button" aria-label="Remove item"',
            ' onclick="Cart.remove(\'' + _esc(item.id) + '\')">&#10005;</button>',
        '</div>'
      ].join('');
    }).join('');

    if (totalEl) totalEl.textContent = '$' + getTotal().toFixed(2);
  }

  /* ── drawer open / close ── */
  function openDrawer() {
    renderDrawer();
    var drawer  = document.getElementById('cart-drawer');
    var overlay = document.getElementById('cart-overlay');
    if (drawer)  { drawer.classList.add('open');  drawer.setAttribute('aria-hidden', 'false'); }
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    var drawer  = document.getElementById('cart-drawer');
    var overlay = document.getElementById('cart-overlay');
    if (drawer)  { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* ── init ── */
  document.addEventListener('DOMContentLoaded', function () {
    /* cart button */
    var cartBtn = document.getElementById('btn002');
    if (cartBtn) cartBtn.addEventListener('click', openDrawer);

    /* close btn */
    var closeBtn = document.getElementById('cart-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

    /* overlay click */
    var overlay = document.getElementById('cart-overlay');
    if (overlay) overlay.addEventListener('click', closeDrawer);

    /* Escape key */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    /* hamburger */
    var hamburger = document.getElementById('nav-hamburger');
    var navList   = document.querySelector('.header-nav');
    if (hamburger && navList) {
      hamburger.addEventListener('click', function () {
        var open = navList.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }

    _updateBadge();

    /* checkout button */
    var checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', function () { Cart.checkout(); });
    }
  });

  /* ── public API ── */
  return {
    add: add, remove: remove, setQty: setQty,
    getItems: getItems, getCount: getCount, getTotal: getTotal,
    openDrawer: openDrawer, closeDrawer: closeDrawer,
    renderDrawer: renderDrawer, updateBadge: _updateBadge,
    checkout: checkout,
  };
})();

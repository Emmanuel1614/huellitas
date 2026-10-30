/**
 * HUELLITAS - Lógica interactiva completa
 * - Carrito de compras interactivo con persistencia y apertura de pasarela de pago
 * - Pasarela de pagos multicanal: Tarjeta Débito/Crédito, Nequi, Daviplata, Bancolombia, Davivienda
 * - Sistema de suscripción interactivo con selección de medio de pago
 * - Contratación directa de servicios individuales (Peluquería o Veterinaria)
 * - Filtros dinámicos de galería social
 */

document.addEventListener('DOMContentLoaded', () => {

  const formatCOP = (val) => '$' + val.toLocaleString('es-CO') + ' COP';

  const escapeHTML = (str) => String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Detección real de soporte para transiciones discretas de display (evita bug Firefox 1882408)
  let supportsDisplayTransition;
  function canTransitionDisplay() {
    if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
    if (!window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
      supportsDisplayTransition = false;
      return false;
    }
    const probe = document.createElement('div');
    probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
    document.body.appendChild(probe);
    getComputedStyle(probe).display;
    probe.style.display = 'none';
    supportsDisplayTransition = getComputedStyle(probe).display === 'block';
    probe.remove();
    return supportsDisplayTransition;
  }

  async function hideElement(el) {
    if (!el || el.hidden) return;
    if (canTransitionDisplay()) {
      el.hidden = true;
    } else {
      el.setAttribute('data-closing', '');
    }

    const animations = el.getAnimations ? el.getAnimations() : [];
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
    }

    if (el.hasAttribute('data-closing')) {
      el.removeAttribute('data-closing');
      el.hidden = true;
    }
  }

  function showElement(el) {
    if (!el) return;
    el.removeAttribute('data-closing');
    el.hidden = false;
  }

  // =========================================================================
  // 1. CARRITO DE COMPRAS INTERACTIVO CON CANTIDADES Y SELECTOR RÁPIDO
  // =========================================================================
  const CART_STORAGE_KEY = 'huellitas_cart_v2';
  const FREE_SHIPPING_GOAL = 120000;
  const STANDARD_SHIPPING = 9900;

  const getProductKey = (img, price, title) =>
    img ? `${img}|${price}` : `${String(title || '').trim().toLowerCase()}|${price}`;

  const loadStoredCart = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw
        .filter((it) => it && it.title && Number.isFinite(Number(it.price)))
        .map((it) => {
          const price = Math.max(0, parseInt(it.price, 10) || 0);
          const qty = Math.min(99, Math.max(1, parseInt(it.qty, 10) || 1));
          const img = String(it.img || '');
          const title = String(it.title || '');
          return {
            key: it.key || getProductKey(img, price, title),
            title,
            price,
            img,
            qty
          };
        });
    } catch {
      return [];
    }
  };

  let cart = loadStoredCart();
  let lastUpdatedCartKey = null;

  const saveCart = () => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignorar si almacenamiento privado está restringido
    }
  };

  const cartTriggerBtn = document.getElementById('cartTriggerBtn');
  const cartDrawerOverlay = document.getElementById('cartDrawerOverlay');
  const closeCartBtn = document.getElementById('closeCartBtn');
  const btnClearCart = document.getElementById('btnClearCart');
  const cartItemsList = document.getElementById('cartItemsList');
  const cartQuickCatalogList = document.getElementById('cartQuickCatalogList');
  const cartBadgeCount = document.getElementById('cartBadgeCount');
  const cartUnitsSummary = document.getElementById('cartUnitsSummary');
  const cartFooterUnits = document.getElementById('cartFooterUnits');
  const cartRawSubtotalVal = document.getElementById('cartRawSubtotalVal');
  const cartShippingVal = document.getElementById('cartShippingVal');
  const cartSubtotalVal = document.getElementById('cartSubtotalVal');
  const cartGoalBanner = document.getElementById('cartGoalBanner');
  const cartGoalText = document.getElementById('cartGoalText');
  const cartGoalPct = document.getElementById('cartGoalPct');
  const cartGoalProgress = document.getElementById('cartGoalProgress');
  const toastMsg = document.getElementById('toastMsg');
  const toastText = document.getElementById('toastText');
  const btnCheckoutCart = document.getElementById('btnCheckoutCart');
  const btnCheckoutCartLabel = document.getElementById('btnCheckoutCartLabel');

  // Construir catálogo único de productos/servicios disponibles en la página para el selector dentro del carrito
  const catalogProducts = [];
  const seenCatalogKeys = new Set();
  document.querySelectorAll('.btn-add-cart').forEach((btn) => {
    const title = (btn.dataset.title || '').trim();
    const price = parseInt(btn.dataset.price, 10) || 0;
    const img = (btn.dataset.img || '').trim();
    if (!title || price <= 0) return;
    const key = getProductKey(img, price, title);
    if (!seenCatalogKeys.has(key)) {
      seenCatalogKeys.add(key);
      catalogProducts.push({ key, title, price, img });
    }
  });

  // Modal de Pago
  const paymentModalOverlay = document.getElementById('paymentModalOverlay');
  const btnClosePaymentModal = document.getElementById('btnClosePaymentModal');
  const paymentSummaryBox = document.getElementById('paymentSummaryBox');
  const paymentInstructionsBox = document.getElementById('paymentInstructionsBox');
  const btnProcessPayment = document.getElementById('btnProcessPayment');

  let currentPaymentContext = {
    type: 'cart', // 'cart' o 'subscription'
    title: 'Pedido de Carrito',
    amount: 0,
    method: 'nequi',
    details: ''
  };

  let toastTimerId = null;
  const showToast = (text) => {
    if (!toastMsg || !toastText) return;
    toastText.textContent = text;
    toastMsg.classList.add('show');
    if (toastTimerId) clearTimeout(toastTimerId);
    toastTimerId = setTimeout(() => {
      toastMsg.classList.remove('show');
    }, 2600);
  };

  const openCartDrawer = () => {
    if (!cartDrawerOverlay) return;
    cartDrawerOverlay.classList.add('open');
    syncFloatingSubsVisibility();
  };

  const closeCartDrawer = (restoreFocus = false) => {
    if (!cartDrawerOverlay) return;
    cartDrawerOverlay.classList.remove('open');
    syncFloatingSubsVisibility();
    if (restoreFocus && cartTriggerBtn) {
      cartTriggerBtn.focus();
    }
  };

  const updateCartGoalAndTotals = (subtotal, totalUnits) => {
    const unitLabel = totalUnits === 1 ? '1 unidad' : `${totalUnits} unidades`;
    if (cartBadgeCount) cartBadgeCount.textContent = String(totalUnits);
    if (cartUnitsSummary) cartUnitsSummary.textContent = unitLabel;
    if (cartFooterUnits) cartFooterUnits.textContent = String(totalUnits);
    if (btnClearCart) btnClearCart.hidden = cart.length === 0;

    const progressVal = Math.min(FREE_SHIPPING_GOAL, subtotal);
    const pct = Math.min(100, Math.round((progressVal / FREE_SHIPPING_GOAL) * 100));
    const unlockedFreeShip = subtotal >= FREE_SHIPPING_GOAL;

    if (cartGoalProgress) {
      cartGoalProgress.value = progressVal;
      cartGoalProgress.textContent = `${pct}%`;
    }
    if (cartGoalPct) {
      cartGoalPct.textContent = `${pct}%`;
    }
    if (cartGoalBanner) {
      cartGoalBanner.classList.toggle('goal-unlocked', unlockedFreeShip);
    }
    if (cartGoalText) {
      if (subtotal === 0) {
        cartGoalText.innerHTML = `<i class="fas fa-truck-fast" aria-hidden="true"></i> En compras desde <strong>${formatCOP(FREE_SHIPPING_GOAL)}</strong> tienes <strong>Envío Gratis VIP</strong>`;
      } else if (!unlockedFreeShip) {
        const missing = FREE_SHIPPING_GOAL - subtotal;
        cartGoalText.innerHTML = `<i class="fas fa-truck-fast" aria-hidden="true"></i> Suma <strong>${formatCOP(missing)}</strong> más para <strong>Envío Gratis + Snack</strong>`;
      } else {
        cartGoalText.innerHTML = `<i class="fas fa-gift" aria-hidden="true"></i> <strong>¡Envío Gratis VIP + Snack Natural desbloqueados!</strong>`;
      }
    }

    const shippingCost = subtotal === 0 ? 0 : (unlockedFreeShip ? 0 : STANDARD_SHIPPING);
    const grandTotal = subtotal + shippingCost;

    if (cartRawSubtotalVal) cartRawSubtotalVal.textContent = formatCOP(subtotal);
    if (cartShippingVal) {
      if (subtotal === 0) {
        cartShippingVal.textContent = 'Por calcular';
        cartShippingVal.classList.remove('is-free');
      } else if (unlockedFreeShip) {
        cartShippingVal.textContent = '¡GRATIS VIP!';
        cartShippingVal.classList.add('is-free');
      } else {
        cartShippingVal.textContent = formatCOP(STANDARD_SHIPPING);
        cartShippingVal.classList.remove('is-free');
      }
    }
    if (cartSubtotalVal) cartSubtotalVal.textContent = formatCOP(grandTotal);
    if (btnCheckoutCartLabel) {
      btnCheckoutCartLabel.textContent =
        totalUnits > 0
          ? `Elegir Medio de Pago • ${formatCOP(grandTotal)}`
          : 'Elegir Medio de Pago y Comprar';
    }
  };

  const renderQuickCatalogPicker = () => {
    if (!cartQuickCatalogList) return;
    cartQuickCatalogList.innerHTML = '';

    const qtyByKey = new Map(cart.map((item) => [item.key, item.qty]));

    catalogProducts.forEach((prod) => {
      const currentQty = qtyByKey.get(prod.key) || 0;
      const card = document.createElement('div');
      card.className = `cart-pick-card${currentQty > 0 ? ' in-cart' : ''}`;
      const safeTitle = escapeHTML(prod.title);
      const safeImg = escapeHTML(prod.img);

      card.innerHTML = `
        ${currentQty > 0 ? `<span class="cart-pick-badge">x${currentQty}</span>` : ''}
        <img src="${safeImg}" alt="${safeTitle}" width="160" height="120" loading="lazy" class="cart-pick-thumb">
        <div class="cart-pick-title">${safeTitle}</div>
        <div class="cart-pick-price">${formatCOP(prod.price)}</div>
        <button type="button" class="cart-pick-add-btn" aria-label="Sumar una unidad de ${safeTitle}">
          <i class="fas fa-plus" aria-hidden="true"></i>
          <span>${currentQty > 0 ? 'Sumar +1' : 'Agregar'}</span>
        </button>
      `;

      const addBtn = card.querySelector('.cart-pick-add-btn');
      addBtn?.addEventListener('click', () => {
        addProductToCart(prod, 1, false);
      });

      cartQuickCatalogList.appendChild(card);
    });
  };

  const addProductToCart = ({ title, price, img }, deltaQty = 1, shouldOpenDrawer = true) => {
    const cleanPrice = Math.max(0, parseInt(price, 10) || 0);
    const key = getProductKey(img, cleanPrice, title);
    const existing = cart.find((item) => item.key === key);

    if (existing) {
      existing.qty = Math.min(99, existing.qty + deltaQty);
      lastUpdatedCartKey = key;
      renderCart();
      showToast(`🐾 Cantidad actualizada (${existing.qty} uds.): ${existing.title}`);
    } else {
      const initialQty = Math.min(99, Math.max(1, deltaQty));
      cart.push({ key, title, price: cleanPrice, img, qty: initialQty });
      lastUpdatedCartKey = key;
      renderCart();
      showToast(`¡Añadido al carrito: ${title}!`);
    }

    if (shouldOpenDrawer) {
      openCartDrawer();
    }
  };

  const renderCart = () => {
    saveCart();
    if (!cartItemsList) return;

    const totalUnits = cart.reduce((acc, item) => acc + item.qty, 0);
    const subtotal = cart.reduce((acc, item) => acc + item.price * item.qty, 0);

    updateCartGoalAndTotals(subtotal, totalUnits);
    renderQuickCatalogPicker();

    if (cart.length === 0) {
      cartItemsList.innerHTML = `
        <div class="cart-empty-message">
          <i class="fas fa-basket-shopping" aria-hidden="true"></i>
          <h4>Tu carrito está vacío</h4>
          <p>Explora la tienda y agrega los productos que quieras para consentir a tu mascota.</p>
        </div>
      `;
      lastUpdatedCartKey = null;
      return;
    }

    cartItemsList.innerHTML = '';

    cart.forEach((item, index) => {
      const lineTotal = item.price * item.qty;
      const row = document.createElement('div');
      row.className = `cart-item-row${item.key === lastUpdatedCartKey ? ' just-updated' : ''}`;
      const safeTitle = escapeHTML(item.title);
      const safeImg = escapeHTML(item.img);

      row.innerHTML = `
        <div class="cart-item-top">
          <img src="${safeImg}" alt="${safeTitle}" width="112" height="112" class="cart-item-thumb">
          <div class="cart-item-details">
            <h4>${safeTitle}</h4>
            <span class="cart-item-unit-price">${formatCOP(item.price)} c/u</span>
          </div>
          <button type="button" class="cart-item-remove-btn" data-index="${index}" aria-label="Eliminar ${safeTitle} del carrito" title="Eliminar producto">
            <i class="fas fa-trash-can" aria-hidden="true"></i>
          </button>
        </div>
        <div class="cart-item-controls">
          <div class="cart-qty-group">
            <div class="cart-qty-stepper" role="group" aria-label="Cantidad de ${safeTitle}">
              <button type="button" class="cart-qty-btn" data-action="dec" data-index="${index}" aria-label="Restar una unidad de ${safeTitle}">
                <i class="fas fa-minus" aria-hidden="true"></i>
              </button>
              <input type="text"
                     class="cart-qty-input"
                     inputmode="numeric"
                     pattern="[0-9]*"
                     maxlength="2"
                     value="${item.qty}"
                     data-index="${index}"
                     aria-label="Cantidad exacta de ${safeTitle}">
              <button type="button" class="cart-qty-btn" data-action="inc" data-index="${index}" aria-label="Sumar una unidad de ${safeTitle}">
                <i class="fas fa-plus" aria-hidden="true"></i>
              </button>
            </div>
            <button type="button" class="cart-qty-boost-btn" data-action="boost2" data-index="${index}" aria-label="Agregar 2 unidades más de ${safeTitle}" title="Sumar 2 unidades rápido">+2</button>
          </div>
          <span class="cart-item-line-total">${formatCOP(lineTotal)}</span>
        </div>
      `;

      cartItemsList.appendChild(row);
    });

    lastUpdatedCartKey = null;

    // Eliminar producto completo
    cartItemsList.querySelectorAll('.cart-item-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        const removed = cart.splice(idx, 1);
        renderCart();
        if (removed[0]) {
          showToast(`Eliminado: ${removed[0].title}`);
        }
      });
    });

    // Botones - / + / +2
    cartItemsList.querySelectorAll('.cart-qty-btn, .cart-qty-boost-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        const action = btn.dataset.action;
        const target = cart[idx];
        if (!target) return;

        if (action === 'dec') {
          if (target.qty > 1) {
            target.qty -= 1;
            lastUpdatedCartKey = target.key;
            renderCart();
          } else {
            const removed = cart.splice(idx, 1);
            renderCart();
            if (removed[0]) showToast(`Eliminado: ${removed[0].title}`);
          }
        } else if (action === 'inc') {
          target.qty = Math.min(99, target.qty + 1);
          lastUpdatedCartKey = target.key;
          renderCart();
        } else if (action === 'boost2') {
          target.qty = Math.min(99, target.qty + 2);
          lastUpdatedCartKey = target.key;
          renderCart();
          showToast(`+2 unidades de ${target.title} (${target.qty} en total)`);
        }
      });
    });

    // Edición numérica directa de cantidad (1..99, o 0 para quitar)
    cartItemsList.querySelectorAll('.cart-qty-input').forEach((input) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D+/g, '').slice(0, 2);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          input.blur();
        }
      });

      const commitTypedQty = () => {
        const idx = parseInt(input.dataset.index, 10);
        const target = cart[idx];
        if (!target) return;
        const raw = input.value.trim();
        if (raw === '') {
          input.value = String(target.qty);
          return;
        }
        const parsed = parseInt(raw, 10);
        if (parsed <= 0) {
          const removed = cart.splice(idx, 1);
          renderCart();
          if (removed[0]) showToast(`Eliminado: ${removed[0].title}`);
        } else {
          target.qty = Math.min(99, parsed);
          lastUpdatedCartKey = target.key;
          renderCart();
        }
      };

      input.addEventListener('blur', commitTypedQty);
    });
  };

  if (cartTriggerBtn && cartDrawerOverlay) {
    cartTriggerBtn.addEventListener('click', openCartDrawer);
  }

  if (closeCartBtn && cartDrawerOverlay) {
    closeCartBtn.addEventListener('click', () => closeCartDrawer(true));

    cartDrawerOverlay.addEventListener('click', (e) => {
      if (e.target === cartDrawerOverlay) {
        closeCartDrawer(false);
      }
    });
  }

  if (btnClearCart) {
    btnClearCart.addEventListener('click', () => {
      if (cart.length === 0) return;
      cart = [];
      renderCart();
      showToast('Carrito vaciado correctamente.');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && cartDrawerOverlay?.classList.contains('open')) {
      closeCartDrawer(true);
    }
  });

  // Botones de agregar al carrito en tienda y servicios individuales
  document.querySelectorAll('.btn-add-cart').forEach((button) => {
    button.addEventListener('click', () => {
      const title = button.dataset.title;
      const price = parseInt(button.dataset.price, 10);
      const img = button.dataset.img;
      addProductToCart({ title, price, img }, 1, true);
    });
  });

  // Al presionar Proceder al Pago en el Carrito
  if (btnCheckoutCart) {
    btnCheckoutCart.addEventListener('click', () => {
      if (cart.length === 0) {
        showToast('Agrega al menos un producto al carrito antes de continuar.');
        return;
      }

      const subtotal = cart.reduce((acc, curr) => acc + curr.price * curr.qty, 0);
      const totalUnits = cart.reduce((acc, curr) => acc + curr.qty, 0);
      const shippingCost = subtotal >= FREE_SHIPPING_GOAL ? 0 : STANDARD_SHIPPING;
      const finalAmount = subtotal + shippingCost;
      const shippingNote = shippingCost === 0 ? 'Envío Gratis VIP incluido' : `Domicilio ${formatCOP(shippingCost)}`;

      currentPaymentContext = {
        type: 'cart',
        title: 'Compra de Carrito Huellitas',
        amount: finalAmount,
        method: 'nequi',
        details: `${totalUnits} unidad(es): ${cart.map((i) => `${i.qty}x ${i.title}`).join(', ')} • ${shippingNote}`
      };

      closeCartDrawer(false);
      openPaymentModal();
    });
  }

  // =========================================================================
  // 2. PASARELA DE PAGOS MULTICANAL
  // =========================================================================
  const paymentInstructions = {
    tarjeta: `
      <h5><i class="fas fa-credit-card" style="color:var(--color-acento);"></i> Pago con Tarjeta de Crédito / Débito</h5>
      <p>Aceptamos Visa, Mastercard, American Express y Diners. Transacción 100% encriptada y protegida.</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
        <input type="text" name="cc_number" autocomplete="cc-number" inputmode="numeric" placeholder="Número de Tarjeta (16 dígitos)" style="grid-column:1 / -1; padding:10px 12px; font-size:1rem; border-radius:8px; border:1px solid #E6CBA8;">
        <input type="text" name="cc_exp" autocomplete="cc-exp" placeholder="MM/AA" style="padding:10px 12px; font-size:1rem; border-radius:8px; border:1px solid #E6CBA8;">
        <input type="password" name="cc_csc" autocomplete="cc-csc" inputmode="numeric" placeholder="CVV (3 dígitos)" style="padding:10px 12px; font-size:1rem; border-radius:8px; border:1px solid #E6CBA8;">
      </div>
    `,
    nequi: `
      <h5><i class="fas fa-mobile-screen" style="color:#FF0055;"></i> Transferencia Directa por Nequi</h5>
      <p>Transfiere el total desde tu App Nequi al número oficial de Huellitas:</p>
      <div style="background:#fff; border-radius:8px; padding:10px 14px; margin:8px 0; font-weight:700; color:#5C4A3D;">
        📱 Número Nequi: <strong>312 890 4421</strong> &bull; Titular: <em>Huellitas Mascotas SAS</em>
      </div>
      <p style="font-size:0.82rem; color:var(--color-texto-muted);">Al confirmar, enviaremos la solicitud de cobro push directo a tu celular.</p>
    `,
    daviplata: `
      <h5><i class="fas fa-wallet" style="color:#ED1C24;"></i> Transferencia Directa por Daviplata</h5>
      <p>Transfiere desde tu monedero Daviplata al número autorizado:</p>
      <div style="background:#fff; border-radius:8px; padding:10px 14px; margin:8px 0; font-weight:700; color:#5C4A3D;">
        📱 Número Daviplata: <strong>312 890 4421</strong> &bull; CC / NIT: <em>901.442.855-1</em>
      </div>
      <p style="font-size:0.82rem; color:var(--color-texto-muted);">Aprobación inmediata sin costo adicional de transferencia.</p>
    `,
    bancolombia: `
      <h5><i class="fas fa-building-columns" style="color:#FDDA24;"></i> Transferencia Bancolombia / Botón Bancolombia</h5>
      <p>Cuenta de Ahorros empresarial para transferencias por App Bancolombia o código QR:</p>
      <div style="background:#fff; border-radius:8px; padding:10px 14px; margin:8px 0; font-weight:700; color:#5C4A3D;">
        🏦 Cta. Ahorros: <strong>245-000892-14</strong> &bull; Huellitas Mascotas SAS
      </div>
      <p style="font-size:0.82rem; color:var(--color-texto-muted);">También puedes usar la llave Transfiya o pago con código QR en tienda.</p>
    `,
    davivienda: `
      <h5><i class="fas fa-landmark" style="color:#ED1C24;"></i> Transferencia o PSE Davivienda</h5>
      <p>Pago seguro por cuenta corriente o de ahorros Davivienda:</p>
      <div style="background:#fff; border-radius:8px; padding:10px 14px; margin:8px 0; font-weight:700; color:#5C4A3D;">
        🏦 Cta. Davivienda: <strong>0056-7890-1234</strong> &bull; Huellitas Mascotas SAS
      </div>
      <p style="font-size:0.82rem; color:var(--color-texto-muted);">Te redirigiremos a la pasarela bancaria oficial Davivienda PSE.</p>
    `
  };

  const openPaymentModal = () => {
    if (!paymentModalOverlay) return;

    const safeTitle = escapeHTML(currentPaymentContext.title);
    const safeDetails = escapeHTML(currentPaymentContext.details);

    paymentSummaryBox.innerHTML = `
      <div style="background:#FDFBF7; border:1px solid #F5E6D3; border-radius:12px; padding:16px; margin-bottom:14px; font-size:0.92rem;">
        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:4px;">
          <strong>Concepto:</strong>
          <span style="text-align:right;">${safeTitle}</span>
        </div>
        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom:6px; font-size:0.84rem; color:var(--color-texto-muted);">
          <span>Detalles:</span>
          <span style="text-align:right; max-width:260px;">${safeDetails}</span>
        </div>
        <div style="border-top:1px dashed #E6CBA8; padding-top:8px; margin-top:8px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-weight:800; font-size:1rem;">Total a Pagar:</span>
          <span style="font-weight:900; font-size:1.35rem; color:var(--color-acento);">${formatCOP(currentPaymentContext.amount)}</span>
        </div>
      </div>
    `;

    // Seleccionar método activo (por defecto Nequi)
    document.querySelectorAll('.payment-method-card').forEach(card => {
      card.classList.toggle('selected', card.dataset.method === currentPaymentContext.method);
    });

    paymentInstructionsBox.innerHTML = paymentInstructions[currentPaymentContext.method];
    paymentModalOverlay.classList.add('active');
    syncFloatingSubsVisibility();
  };

  // Selector de métodos de pago
  document.querySelectorAll('.payment-method-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.payment-method-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      currentPaymentContext.method = card.dataset.method;
      paymentInstructionsBox.innerHTML = paymentInstructions[currentPaymentContext.method];
    });
  });

  if (btnClosePaymentModal && paymentModalOverlay) {
    btnClosePaymentModal.addEventListener('click', () => {
      paymentModalOverlay.classList.remove('active');
      syncFloatingSubsVisibility();
    });

    paymentModalOverlay.addEventListener('click', (e) => {
      if (e.target === paymentModalOverlay) {
        paymentModalOverlay.classList.remove('active');
        syncFloatingSubsVisibility();
      }
    });
  }

  // Procesar pago final
  if (btnProcessPayment) {
    btnProcessPayment.addEventListener('click', () => {
      const methodLabel = currentPaymentContext.method.toUpperCase();
      alert(`🎉 ¡Pago de ${formatCOP(currentPaymentContext.amount)} procesado con éxito a través de ${methodLabel}!\n\nTu pedido/suscripción está activo. Hemos enviado el comprobante a tu WhatsApp y correo electrónico.`);
      
      if (currentPaymentContext.type === 'cart') {
        cart = [];
        renderCart();
      }

      paymentModalOverlay.classList.remove('active');
      syncFloatingSubsVisibility();
    });
  }

  // =========================================================================
  // 3. SISTEMA INTERACTIVO DE SUSCRIPCIÓN: CLUB HUELLITAS + ACCESO RÁPIDO
  // =========================================================================
  const subState = {
    petType: 'perro',
    petName: 'Max',
    petStage: 'Adulto',
    petAge: 'Adulto (1 - 7 años)',
    petSize: 'mediano',
    petWeight: 12,
    dailyGrams: 185,
    weightTouched: false,
    foodTouched: false,
    foodBrand: 'Cuido Premium Huellitas (Estrella)',
    foodImg: 'img/cuido-huellitas-10kg.jpg',
    deliveryDay: 'Día 5 de cada mes',
    basePrice: 50000,
    extraPeluqueria: false,
    pricePeluqueria: 50000,
    extraVeterinaria: false,
    priceVeterinaria: 70000,
    currentStep: 1
  };

  const subsSection = document.getElementById('suscripcion');
  const subsWizardForm = document.getElementById('subsWizardForm');
  const wizardProgressFill = document.getElementById('wizardProgressFill');
  const floatingSubsDock = document.getElementById('floatingSubsDock');
  const ambientBgControl = document.getElementById('ambientBgControl');

  // Referencias del resumen visual y controles vivos
  const sumPetAvatar = document.getElementById('sumPetAvatar');
  const sumClubTier = document.getElementById('sumClubTier');
  const sumPetType = document.getElementById('sumPetType');
  const sumPetDetails = document.getElementById('sumPetDetails');
  const sumFoodThumb = document.getElementById('sumFoodThumb');
  const sumFood = document.getElementById('sumFood');
  const sumDeliveryDay = document.getElementById('sumDeliveryDay');
  const sumExtraPeluqueria = document.getElementById('sumExtraPeluqueria');
  const sumExtraVeterinaria = document.getElementById('sumExtraVeterinaria');
  const sumSpaMiniThumb = document.getElementById('sumSpaMiniThumb');
  const sumVetMiniThumb = document.getElementById('sumVetMiniThumb');
  const sumTotal = document.getElementById('sumTotal');
  const btnSubmitSubsTxt = document.getElementById('btnSubmitSubsTxt');

  // Barra móvil rápida
  const mLivePetAvatar = document.getElementById('mLivePetAvatar');
  const mLivePetLabel = document.getElementById('mLivePetLabel');
  const mLiveTotalVal = document.getElementById('mLiveTotalVal');
  const btnMobileQuickActivate = document.getElementById('btnMobileQuickActivate');

  // Controles Paso 1, 2 y 3
  const petNameInput = document.getElementById('petNameInput');
  const petAgeInput = document.getElementById('petAgeInput');
  const petSizeInput = document.getElementById('petSizeInput');
  const petWeightInput = document.getElementById('petWeightInput');
  const petWeightDisplay = document.getElementById('petWeightDisplay');
  const weightPetNameRef = document.getElementById('weightPetNameRef');
  const autoSizeChip = document.getElementById('autoSizeChip');
  const dailyGramsVal = document.getElementById('dailyGramsVal');

  const recBadgeEstrella = document.getElementById('recBadgeEstrella');
  const recBadgePuppy = document.getElementById('recBadgePuppy');

  const subsSpaThumb = document.getElementById('subsSpaThumb');
  const subsSpaDesc = document.getElementById('subsSpaDesc');
  const subsVetThumb = document.getElementById('subsVetThumb');
  const subsVetDesc = document.getElementById('subsVetDesc');
  const extraPeluqueriaCard = document.getElementById('extraPeluqueria');
  const extraVeterinariaCard = document.getElementById('extraVeterinaria');
  const btnToggleVipCombo = document.getElementById('btnToggleVipCombo');
  const vipComboBtnTxt = document.getElementById('vipComboBtnTxt');

  const computePetNutrition = () => {
    const w = Number(subState.petWeight) || 12;
    if (subState.petType === 'gato') {
      subState.petSize = w <= 4 ? 'pequeño' : (w <= 7 ? 'mediano' : 'grande');
    } else {
      subState.petSize = w <= 8 ? 'pequeño' : (w <= 22 ? 'mediano' : 'grande');
    }

    const stageFactor = subState.petStage === 'Cachorro' ? 1.22 : (subState.petStage === 'Senior' ? 0.9 : 1);
    const speciesFactor = subState.petType === 'gato' ? 0.85 : 1;
    const rawGrams = 28.7 * Math.pow(w, 0.75) * stageFactor * speciesFactor;
    subState.dailyGrams = Math.max(35, Math.round(rawGrams / 5) * 5);

    if (petSizeInput) {
      petSizeInput.value = subState.petSize;
    }
    if (autoSizeChip) {
      autoSizeChip.textContent = subState.petSize.charAt(0).toUpperCase() + subState.petSize.slice(1);
    }
    if (dailyGramsVal) {
      dailyGramsVal.textContent = `${subState.dailyGrams} g/día`;
    }
  };

  function syncWeightSlider() {
    if (!petWeightInput) return;
    computePetNutrition();

    petWeightInput.style.setProperty('--attr-min', petWeightInput.min || 1);
    petWeightInput.style.setProperty('--attr-max', petWeightInput.max || 60);
    petWeightInput.style.setProperty('--control-value', petWeightInput.value);

    if (petWeightDisplay) {
      petWeightDisplay.textContent = `${petWeightInput.value} kg`;
    }

    const sizeLabel = subState.petSize;
    petWeightInput.setAttribute(
      'aria-valuetext',
      `${petWeightInput.value} kilogramos, tamaño ${sizeLabel}, ración sugerida ${subState.dailyGrams} gramos por día`
    );

    document.querySelectorAll('.weight-preset-chip').forEach(chip => {
      chip.classList.toggle('active', Number(chip.dataset.weight) === Number(petWeightInput.value));
    });
  }

  const syncExtraCardUI = (card, isSelected) => {
    if (!card) return;
    card.classList.toggle('selected', isSelected);
    card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    const icon = card.querySelector('.extra-check-icon');
    if (icon) {
      icon.className = isSelected ? 'fas fa-check extra-check-icon' : 'extra-check-icon';
    }
  };

  const updateSubsSummary = () => {
    computePetNutrition();

    let total = subState.basePrice;
    if (subState.extraPeluqueria) total += subState.pricePeluqueria;
    if (subState.extraVeterinaria) total += subState.priceVeterinaria;

    const cleanName = subState.petName || 'Tu Mascota';
    const sizeCap = subState.petSize.charAt(0).toUpperCase() + subState.petSize.slice(1);

    if (weightPetNameRef) {
      weightPetNameRef.textContent = cleanName;
    }

    if (sumPetType) {
      sumPetType.textContent = `Caja de ${cleanName} (${subState.petType.toUpperCase()})`;
    }

    if (sumPetDetails) {
      sumPetDetails.textContent = `${subState.petStage} • ${sizeCap} • ${subState.petWeight} kg • ${subState.dailyGrams} g/día`;
    }

    if (sumFood) {
      sumFood.textContent = subState.foodBrand;
    }

    if (sumFoodThumb && subState.foodImg) {
      sumFoodThumb.src = subState.foodImg;
    }

    if (sumDeliveryDay) {
      sumDeliveryDay.textContent = `Entrega: ${subState.deliveryDay}`;
    }

    if (sumExtraPeluqueria) {
      if (subState.extraPeluqueria) {
        showElement(sumExtraPeluqueria);
      } else {
        hideElement(sumExtraPeluqueria);
      }
    }

    if (sumExtraVeterinaria) {
      if (subState.extraVeterinaria) {
        showElement(sumExtraVeterinaria);
      } else {
        hideElement(sumExtraVeterinaria);
      }
    }

    // Insignia dinámica del nivel del Club
    const activeExtrasCount = (subState.extraPeluqueria ? 1 : 0) + (subState.extraVeterinaria ? 1 : 0);
    if (sumClubTier) {
      sumClubTier.classList.remove('tier-plus', 'tier-vip');
      if (activeExtrasCount === 2) {
        sumClubTier.classList.add('tier-vip');
        sumClubTier.innerHTML = '<i class="fas fa-crown" aria-hidden="true"></i> Club VIP Diamante';
      } else if (activeExtrasCount === 1) {
        sumClubTier.classList.add('tier-plus');
        sumClubTier.innerHTML = '<i class="fas fa-star" aria-hidden="true"></i> Club Plus';
      } else {
        sumClubTier.innerHTML = '<i class="fas fa-medal" aria-hidden="true"></i> Club Esencial';
      }
    }

    if (btnToggleVipCombo && vipComboBtnTxt) {
      const bothActive = subState.extraPeluqueria && subState.extraVeterinaria;
      btnToggleVipCombo.classList.toggle('active', bothActive);
      vipComboBtnTxt.textContent = bothActive ? 'Pack VIP Activado ✓' : 'Activar Pack VIP Completo';
    }

    const formattedTotal = formatCOP(total);
    if (sumTotal) {
      sumTotal.textContent = formattedTotal;
    }
    if (btnSubmitSubsTxt) {
      btnSubmitSubsTxt.textContent = `Activar Plan • ${formattedTotal}`;
    }
    if (mLivePetLabel) {
      mLivePetLabel.textContent = `Caja de ${cleanName} (${subState.petType})`;
    }
    if (mLiveTotalVal) {
      mLiveTotalVal.textContent = `${formattedTotal}/mes`;
    }
  };

  const tabButtons = document.querySelectorAll('.wizard-tab-btn');
  const stepPanes = document.querySelectorAll('.wizard-step-pane');

  const goToStep = (stepNumber) => {
    subState.currentStep = stepNumber;

    if (wizardProgressFill) {
      const pct = stepNumber === 1 ? '33.33%' : (stepNumber === 2 ? '66.66%' : '100%');
      wizardProgressFill.style.width = pct;
    }

    tabButtons.forEach(btn => {
      const s = parseInt(btn.dataset.step);
      const isCurrent = s === stepNumber;
      btn.classList.toggle('active', isCurrent);
      btn.classList.toggle('completed', s < stepNumber);
      if (isCurrent) {
        btn.setAttribute('aria-current', 'step');
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    stepPanes.forEach(pane => {
      pane.classList.toggle('active', parseInt(pane.dataset.step) === stepNumber);
    });
  };

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      goToStep(parseInt(btn.dataset.step));
    });
  });

  document.querySelectorAll('.btn-next-step').forEach(btn => {
    btn.addEventListener('click', () => {
      goToStep(parseInt(btn.dataset.next));
    });
  });

  document.querySelectorAll('.btn-prev-step').forEach(btn => {
    btn.addEventListener('click', () => {
      goToStep(parseInt(btn.dataset.prev));
    });
  });

  // Cambio dinámico de especie (Perro vs Gato) con fotos reales adaptadas
  const setPetSpecies = (species) => {
    subState.petType = species === 'gato' ? 'gato' : 'perro';

    document.querySelectorAll('.pet-interactive-card').forEach(c => {
      const isMatch = c.dataset.pet === subState.petType;
      c.classList.toggle('selected', isMatch);
      c.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });

    const avatarSrc = subState.petType === 'gato' ? 'img/social-gatito-chequeo.jpg' : 'img/hero-mascotas.jpg';
    if (sumPetAvatar) sumPetAvatar.src = avatarSrc;
    if (mLivePetAvatar) mLivePetAvatar.src = avatarSrc;

    if (subState.petType === 'gato') {
      if (subsSpaThumb) subsSpaThumb.src = 'img/spa-gato-cepillado-real.jpg';
      if (sumSpaMiniThumb) sumSpaMiniThumb.src = 'img/spa-gato-cepillado-real.jpg';
      if (subsSpaDesc) subsSpaDesc.textContent = 'Cepillado felino relajante, espuma tibia e higiene de uñas.';
      if (subsVetThumb) subsVetThumb.src = 'img/vet-consulta-gato-real.jpg';
      if (sumVetMiniThumb) sumVetMiniThumb.src = 'img/vet-consulta-gato-real.jpg';
      if (subsVetDesc) subsVetDesc.textContent = 'Valoración felina Fear-Free en consultorio silencioso.';

      if (!subState.weightTouched && Number(subState.petWeight) > 8) {
        subState.petWeight = 4;
        if (petWeightInput) petWeightInput.value = '4';
      }
      if (petNameInput && petNameInput.value.trim() === 'Max') {
        petNameInput.value = 'Luna';
        subState.petName = 'Luna';
      }
    } else {
      if (subsSpaThumb) subsSpaThumb.src = 'img/spa-bano-espuma-perro.jpg';
      if (sumSpaMiniThumb) sumSpaMiniThumb.src = 'img/spa-bano-espuma-perro.jpg';
      if (subsSpaDesc) subsSpaDesc.textContent = 'Baño tibio con avena, cepillado y corte sin jaulas.';
      if (subsVetThumb) subsVetThumb.src = 'img/vet-consulta-perro-real.jpg';
      if (sumVetMiniThumb) sumVetMiniThumb.src = 'img/vet-consulta-perro-real.jpg';
      if (subsVetDesc) subsVetDesc.textContent = 'Consulta preventiva sin estrés, control de peso y vacunas.';

      if (!subState.weightTouched && Number(subState.petWeight) <= 5) {
        subState.petWeight = 12;
        if (petWeightInput) petWeightInput.value = '12';
      }
      if (petNameInput && petNameInput.value.trim() === 'Luna') {
        petNameInput.value = 'Max';
        subState.petName = 'Max';
      }
    }

    syncWeightSlider();
    updateSubsSummary();
  };

  document.querySelectorAll('.pet-interactive-card').forEach(card => {
    card.addEventListener('click', () => {
      setPetSpecies(card.dataset.pet);
    });
  });

  // Botones de acceso rápido desde la franja superior bajo el Hero
  document.querySelectorAll('.subs-quick-pet-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPet = btn.dataset.quickPet || 'perro';
      setPetSpecies(targetPet);
      goToStep(1);
      if (subsSection) {
        subsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      showToast(`🐾 Configurando la caja mensual para tu ${targetPet}`);
    });
  });

  if (petNameInput) {
    petNameInput.addEventListener('input', (e) => {
      subState.petName = e.target.value.trim() || 'Tu Mascota';
      updateSubsSummary();
    });
  }

  // Etapas de vida de 1 toque + recomendación automática de receta
  document.querySelectorAll('.stage-pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stage-pill-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      subState.petStage = btn.dataset.stage || 'Adulto';
      subState.petAge = btn.dataset.ageLabel || 'Adulto (1 - 7 años)';
      if (petAgeInput) petAgeInput.value = subState.petAge;

      const isPuppy = subState.petStage === 'Cachorro';
      if (recBadgePuppy) recBadgePuppy.hidden = !isPuppy;
      if (recBadgeEstrella) recBadgeEstrella.hidden = isPuppy;

      if (!subState.foodTouched) {
        const targetFoodSelector = isPuppy
          ? '.food-card-interactive[data-rec-stage="Cachorro"]'
          : '.food-card-interactive[data-food-img="img/cuido-huellitas-10kg.jpg"]';
        const recCard = document.querySelector(targetFoodSelector);
        if (recCard) {
          document.querySelectorAll('.food-card-interactive').forEach(c => {
            c.classList.remove('selected');
            c.setAttribute('aria-pressed', 'false');
          });
          recCard.classList.add('selected');
          recCard.setAttribute('aria-pressed', 'true');
          subState.foodBrand = recCard.dataset.brand;
          subState.foodImg = recCard.dataset.foodImg;
        }
      }

      syncWeightSlider();
      updateSubsSummary();
    });
  });

  if (petWeightInput) {
    petWeightInput.addEventListener('input', (e) => {
      subState.weightTouched = true;
      subState.petWeight = Number(e.target.value) || 1;
      syncWeightSlider();
      updateSubsSummary();
    });
  }

  // Atajos rápidos de peso (4 kg, 12 kg, 25 kg, 40 kg)
  document.querySelectorAll('.weight-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetWeight = Number(chip.dataset.weight) || 12;
      subState.weightTouched = true;
      subState.petWeight = targetWeight;
      if (petWeightInput) {
        petWeightInput.value = String(targetWeight);
      }
      syncWeightSlider();
      updateSubsSummary();
    });
  });

  // Paso 2: Recetas con foto y día de entrega
  document.querySelectorAll('.food-card-interactive').forEach(card => {
    card.addEventListener('click', () => {
      subState.foodTouched = true;
      document.querySelectorAll('.food-card-interactive').forEach(c => {
        c.classList.remove('selected');
        c.setAttribute('aria-pressed', 'false');
      });
      card.classList.add('selected');
      card.setAttribute('aria-pressed', 'true');
      subState.foodBrand = card.dataset.brand;
      subState.foodImg = card.dataset.foodImg || 'img/cuido-huellitas-10kg.jpg';
      updateSubsSummary();
    });
  });

  document.querySelectorAll('.delivery-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.delivery-day-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      subState.deliveryDay = btn.dataset.day || 'Día 5 de cada mes';
      updateSubsSummary();
    });
  });

  // Paso 3: Extras interactivos (clic + teclado) y botón Pack VIP Completo
  const toggleExtraService = (key, card) => {
    subState[key] = !subState[key];
    syncExtraCardUI(card, subState[key]);
    updateSubsSummary();
  };

  if (extraPeluqueriaCard) {
    extraPeluqueriaCard.addEventListener('click', () => toggleExtraService('extraPeluqueria', extraPeluqueriaCard));
    extraPeluqueriaCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExtraService('extraPeluqueria', extraPeluqueriaCard);
      }
    });
  }

  if (extraVeterinariaCard) {
    extraVeterinariaCard.addEventListener('click', () => toggleExtraService('extraVeterinaria', extraVeterinariaCard));
    extraVeterinariaCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExtraService('extraVeterinaria', extraVeterinariaCard);
      }
    });
  }

  if (btnToggleVipCombo) {
    btnToggleVipCombo.addEventListener('click', () => {
      const activateBoth = !(subState.extraPeluqueria && subState.extraVeterinaria);
      subState.extraPeluqueria = activateBoth;
      subState.extraVeterinaria = activateBoth;
      syncExtraCardUI(extraPeluqueriaCard, activateBoth);
      syncExtraCardUI(extraVeterinariaCard, activateBoth);
      updateSubsSummary();
      if (activateBoth) {
        showToast(`👑 ¡Pack VIP Diamante activado para ${subState.petName}!`);
      }
    });
  }

  // Apertura de pasarela de pago de suscripción (Submit del formulario o barra móvil)
  const triggerSubscriptionCheckout = () => {
    let total = subState.basePrice;
    if (subState.extraPeluqueria) total += subState.pricePeluqueria;
    if (subState.extraVeterinaria) total += subState.priceVeterinaria;

    const extrasList = [];
    if (subState.extraPeluqueria) extrasList.push('Spa mensual (+$50k)');
    if (subState.extraVeterinaria) extrasList.push('Veterinaria mensual (+$70k)');

    currentPaymentContext = {
      type: 'subscription',
      title: `Club Mensual Huellitas: ${subState.petName} (${subState.petType})`,
      amount: total,
      method: 'nequi',
      details: `${subState.foodBrand} • ${subState.deliveryDay} • Extras: ${extrasList.length > 0 ? extrasList.join(', ') : 'Solo caja base + regalo'}`
    };

    openPaymentModal();
  };

  if (subsWizardForm) {
    subsWizardForm.addEventListener('submit', (e) => {
      e.preventDefault();
      triggerSubscriptionCheckout();
    });
  }

  if (btnMobileQuickActivate) {
    btnMobileQuickActivate.addEventListener('click', triggerSubscriptionCheckout);
  }

  // Visibilidad inteligente del botón flotante de acceso a Suscripción
  let isSubsSectionVisible = false;
  let isFooterVisible = false;
  let scrollHideTimeout = null;
  let isUserScrolling = false;

  function shouldHideFloatingDock() {
    const isCartOpen = cartDrawerOverlay?.classList.contains('open');
    const isPaymentOpen = paymentModalOverlay?.classList.contains('active');
    return isSubsSectionVisible || isFooterVisible || isCartOpen || isPaymentOpen;
  }

  function syncFloatingSubsVisibility() {
    if (!floatingSubsDock) return;
    const shouldHide = shouldHideFloatingDock();

    if (shouldHide) {
      hideElement(floatingSubsDock);
    } else {
      showElement(floatingSubsDock);
      if (!isUserScrolling) {
        floatingSubsDock.classList.remove('is-scroll-hidden');
      }
    }
  }

  // Ocultar botón flotante de suscripción al scrolear (en pantalla principal y en responsive)
  window.addEventListener(
    'scroll',
    () => {
      if (!floatingSubsDock) return;

      if (!isUserScrolling) {
        isUserScrolling = true;
        floatingSubsDock.classList.add('is-scroll-hidden');
      }

      clearTimeout(scrollHideTimeout);
      scrollHideTimeout = setTimeout(() => {
        isUserScrolling = false;
        if (!shouldHideFloatingDock()) {
          floatingSubsDock.classList.remove('is-scroll-hidden');
        }
      }, 700);
    },
    { passive: true }
  );

  if (subsSection && floatingSubsDock && 'IntersectionObserver' in window) {
    const subsObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isSubsSectionVisible = entry.isIntersecting;
          syncFloatingSubsVisibility();
        });
      },
      { threshold: 0.12 }
    );
    subsObserver.observe(subsSection);
  }

  const footerEl = document.querySelector('footer');
  if (footerEl && floatingSubsDock && 'IntersectionObserver' in window) {
    const footerObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isFooterVisible = entry.isIntersecting;
          syncFloatingSubsVisibility();
        });
      },
      { threshold: 0.08 }
    );
    footerObserver.observe(footerEl);
  }

  // =========================================================================
  // 4. MENÚ HAMBURGUESA MÓVIL
  // =========================================================================
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      const icon = menuToggle.querySelector('i');
      if (icon) {
        icon.className = navLinks.classList.contains('open') ? 'fas fa-times' : 'fas fa-bars';
      }
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        const icon = menuToggle.querySelector('i');
        if (icon) icon.className = 'fas fa-bars';
      });
    });
  }

  // =========================================================================
  // 5. GALERÍA SOCIAL CON FILTRO DE REDES
  // =========================================================================
  const socialTabs = document.querySelectorAll('.social-tab');
  const galeriaItems = document.querySelectorAll('.galeria-item');

  socialTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      socialTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const network = tab.dataset.network;
      galeriaItems.forEach(item => {
        if (network === 'todas' || item.dataset.network === network) {
          item.style.display = '';
          item.style.animation = 'fadeInCard 0.4s ease forwards';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });

  // =========================================================================
  // 6. MODAL DE AUTENTICACIÓN (REGISTRO E INICIO DE SESIÓN SEPARADO)
  // =========================================================================
  const authModalOverlay = document.getElementById('authModalOverlay');
  const btnCloseAuthModal = document.getElementById('btnCloseAuthModal');
  const btnOpenAuthModal = document.getElementById('btnOpenAuthModal');
  const headerUserLabel = document.getElementById('headerUserLabel');

  const authTabBtnRegister = document.getElementById('authTabBtnRegister');
  const authTabBtnLogin = document.getElementById('authTabBtnLogin');
  const authContentRegister = document.getElementById('authContentRegister');
  const authContentLogin = document.getElementById('authContentLogin');

  const btnSwitchToLogin = document.getElementById('btnSwitchToLogin');
  const btnSwitchToRegister = document.getElementById('btnSwitchToRegister');
  const btnCtaOpenRegister = document.getElementById('btnCtaOpenRegister');
  const btnCtaOpenLogin = document.getElementById('btnCtaOpenLogin');

  const modalRegForm = document.getElementById('modalRegistrationForm');
  const mRegSuccessCard = document.getElementById('mRegSuccessCard');
  const mRegSuccessMsg = document.getElementById('mRegSuccessMsg');
  const mBtnOpenWhatsAppDirect = document.getElementById('mBtnOpenWhatsAppDirect');
  const mBtnCloseSuccess = document.getElementById('mBtnCloseSuccess');

  const modalLoginForm = document.getElementById('modalLoginForm');
  const mLoginSuccessCard = document.getElementById('mLoginSuccessCard');
  const mLoginBtnContinue = document.getElementById('mLoginBtnContinue');

  // Contact Method selector en el modal
  const mContactRadios = document.querySelectorAll('input[name="mContactMethod"]');
  const mRadioCardWhatsapp = document.getElementById('mRadioCardWhatsapp');
  const mRadioCardEmail = document.getElementById('mRadioCardEmail');
  const mRegPhone = document.getElementById('mRegPhone');
  const mRegEmail = document.getElementById('mRegEmail');
  const mPhoneReqMarker = document.getElementById('mPhoneReqMarker');
  const mEmailReqMarker = document.getElementById('mEmailReqMarker');

  function openAuthModal(initialTab = 'register') {
    if (!authModalOverlay) return;
    switchAuthTab(initialTab);
    authModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeAuthModal() {
    if (!authModalOverlay) return;
    authModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function switchAuthTab(tabName) {
    if (tabName === 'login') {
      if (authTabBtnLogin) authTabBtnLogin.classList.add('active');
      if (authTabBtnRegister) authTabBtnRegister.classList.remove('active');
      if (authContentLogin) authContentLogin.classList.add('active');
      if (authContentRegister) authContentRegister.classList.remove('active');
    } else {
      if (authTabBtnRegister) authTabBtnRegister.classList.add('active');
      if (authTabBtnLogin) authTabBtnLogin.classList.remove('active');
      if (authContentRegister) authContentRegister.classList.add('active');
      if (authContentLogin) authContentLogin.classList.remove('active');
    }
  }

  if (btnOpenAuthModal) {
    btnOpenAuthModal.addEventListener('click', () => {
      const activeUser = getActiveUser();
      if (activeUser) {
        if (confirm(`Sesión activa como: ${activeUser.tutorName} (Mascota: ${activeUser.petName || 'Registrada'}). ¿Deseas cerrar tu sesión?`)) {
          logoutUser();
        }
      } else {
        openAuthModal('register');
      }
    });
  }

  if (btnCtaOpenRegister) btnCtaOpenRegister.addEventListener('click', () => openAuthModal('register'));
  if (btnCtaOpenLogin) btnCtaOpenLogin.addEventListener('click', () => openAuthModal('login'));

  if (btnCloseAuthModal) btnCloseAuthModal.addEventListener('click', closeAuthModal);
  if (authModalOverlay) {
    authModalOverlay.addEventListener('click', (e) => {
      if (e.target === authModalOverlay) closeAuthModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && authModalOverlay && authModalOverlay.classList.contains('active')) {
      closeAuthModal();
    }
  });

  if (authTabBtnRegister) authTabBtnRegister.addEventListener('click', () => switchAuthTab('register'));
  if (authTabBtnLogin) authTabBtnLogin.addEventListener('click', () => switchAuthTab('login'));
  if (btnSwitchToLogin) btnSwitchToLogin.addEventListener('click', () => switchAuthTab('login'));
  if (btnSwitchToRegister) btnSwitchToRegister.addEventListener('click', () => switchAuthTab('register'));

  // Toggle visibilidad de contraseñas
  document.querySelectorAll('.btn-toggle-pwd').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) {
          icon.className = isPassword ? 'far fa-eye-slash' : 'far fa-eye';
        }
      }
    });
  });

  // Selector WhatsApp vs Correo en el modal
  if (mContactRadios.length > 0) {
    mContactRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.value === 'whatsapp') {
          if (mRadioCardWhatsapp) mRadioCardWhatsapp.classList.add('active');
          if (mRadioCardEmail) mRadioCardEmail.classList.remove('active');
          if (mRegPhone) mRegPhone.required = true;
          if (mRegEmail) mRegEmail.required = false;
          if (mPhoneReqMarker) mPhoneReqMarker.style.display = 'inline';
          if (mEmailReqMarker) mEmailReqMarker.style.display = 'none';
        } else {
          if (mRadioCardEmail) mRadioCardEmail.classList.add('active');
          if (mRadioCardWhatsapp) mRadioCardWhatsapp.classList.remove('active');
          if (mRegEmail) mRegEmail.required = true;
          if (mRegPhone) mRegPhone.required = false;
          if (mPhoneReqMarker) mPhoneReqMarker.style.display = 'none';
          if (mEmailReqMarker) mEmailReqMarker.style.display = 'inline';
        }
      });
    });
  }

  // Submit Registro Modal
  if (modalRegForm) {
    modalRegForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const tutorName = document.getElementById('mRegTutorName').value.trim();
      const contactMethod = document.querySelector('input[name="mContactMethod"]:checked')?.value || 'whatsapp';
      const phone = mRegPhone ? mRegPhone.value.trim() : '';
      const email = mRegEmail ? mRegEmail.value.trim() : '';
      const petName = document.getElementById('mRegPetName').value.trim();
      const petType = document.getElementById('mRegPetType').value;
      const specialNeeds = document.getElementById('mRegSpecialNeeds').value.trim();
      const password = document.getElementById('mRegPassword').value;

      const newUser = {
        tutorName,
        contactMethod,
        phone,
        email,
        petName,
        petType,
        specialNeeds,
        password,
        registeredAt: new Date().toISOString()
      };

      // Guardar usuario en base local de registros
      try {
        const users = JSON.parse(localStorage.getItem('huellitas_users') || '[]');
        users.push(newUser);
        localStorage.setItem('huellitas_users', JSON.stringify(users));
        setActiveUser(newUser);
      } catch (err) {
        console.warn('LocalStorage error:', err);
      }

      // Preparar enlace de WhatsApp con mensaje personalizado
      const waNumber = '573104448355';
      const waMsg = encodeURIComponent(
        `¡Hola Huellitas! Acabo de crear mi cuenta en la web.\n\n` +
        `👤 Tutor: ${tutorName}\n` +
        `🐾 Mascota: ${petName} (${petType})\n` +
        (phone ? `📞 Teléfono: ${phone}\n` : '') +
        (email ? `✉️ Correo: ${email}\n` : '') +
        (specialNeeds ? `📋 Consulta: ${specialNeeds}\n` : '') +
        `Quisiera activar mi bono de bienvenida y recibir asesoría personalizada. ¡Gracias!`
      );

      if (mBtnOpenWhatsAppDirect) {
        mBtnOpenWhatsAppDirect.href = `https://wa.me/${waNumber}?text=${waMsg}`;
      }

      if (mRegSuccessMsg) {
        mRegSuccessMsg.innerHTML = `¡Bienvenido, <strong>${tutorName}</strong>! La ficha de <strong>${petName}</strong> ha quedado registrada. Tu asesor veterinario asignado te contactará por <strong>${contactMethod === 'whatsapp' ? 'WhatsApp' : 'Correo'}</strong>.`;
      }

      modalRegForm.style.display = 'none';
      if (mRegSuccessCard) mRegSuccessCard.style.display = 'block';
    });
  }

  if (mBtnCloseSuccess) {
    mBtnCloseSuccess.addEventListener('click', () => {
      closeAuthModal();
      if (modalRegForm) {
        modalRegForm.reset();
        modalRegForm.style.display = 'block';
      }
      if (mRegSuccessCard) mRegSuccessCard.style.display = 'none';
    });
  }

  // Submit Iniciar Sesión Modal
  if (modalLoginForm) {
    modalLoginForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const identifier = document.getElementById('loginUserIdentifier').value.trim();
      const password = document.getElementById('loginPassword').value;

      let foundUser = null;
      try {
        const users = JSON.parse(localStorage.getItem('huellitas_users') || '[]');
        foundUser = users.find(u => 
          (u.email && u.email.toLowerCase() === identifier.toLowerCase()) || 
          (u.phone && u.phone.includes(identifier))
        );
      } catch (err) {
        console.warn(err);
      }

      // Si no existe previamente, creamos la sesión para el tutor con el identificador ingresado
      if (!foundUser) {
        foundUser = {
          tutorName: identifier.includes('@') ? identifier.split('@')[0] : 'Cliente Huellitas',
          email: identifier.includes('@') ? identifier : '',
          phone: !identifier.includes('@') ? identifier : '',
          petName: 'Mi Mascota'
        };
      }

      setActiveUser(foundUser);

      modalLoginForm.style.display = 'none';
      if (mLoginSuccessCard) {
        const titleEl = document.getElementById('mLoginSuccessTitle');
        const msgEl = document.getElementById('mLoginSuccessMsg');
        if (titleEl) titleEl.textContent = `¡Hola de nuevo, ${foundUser.tutorName}!`;
        if (msgEl) msgEl.textContent = `Has iniciado sesión correctamente. Tu ficha de mascota y descuentos están activos.`;
        mLoginSuccessCard.style.display = 'block';
      }
    });
  }

  if (mLoginBtnContinue) {
    mLoginBtnContinue.addEventListener('click', () => {
      closeAuthModal();
      if (modalLoginForm) {
        modalLoginForm.reset();
        modalLoginForm.style.display = 'block';
      }
      if (mLoginSuccessCard) mLoginSuccessCard.style.display = 'none';
    });
  }

  function setActiveUser(user) {
    localStorage.setItem('huellitas_active_user', JSON.stringify(user));
    updateHeaderUserUI();
  }

  function getActiveUser() {
    try {
      return JSON.parse(localStorage.getItem('huellitas_active_user') || 'null');
    } catch {
      return null;
    }
  }

  function logoutUser() {
    localStorage.removeItem('huellitas_active_user');
    updateHeaderUserUI();
    showToast('Has cerrado sesión correctamente.');
  }

  function updateHeaderUserUI() {
    const user = getActiveUser();
    if (headerUserLabel) {
      if (user && user.tutorName) {
        const firstName = user.tutorName.split(' ')[0];
        headerUserLabel.textContent = `¡Hola, ${firstName}!`;
      } else {
        headerUserLabel.textContent = 'Ingresar / Registro';
      }
    }
  }

  // Inicializar estado del usuario al cargar
  updateHeaderUserUI();

  // Interacción de Me Gusta en tarjetas de Redes Sociales
  document.querySelectorAll('.ig-heart-act, .tt-action-btn, .fb-btn, .x-heart-act').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('liked');
      const heartIcon = btn.querySelector('.fa-heart, .fa-thumbs-up');
      if (heartIcon && btn.classList.contains('liked')) {
        heartIcon.classList.remove('far');
        heartIcon.classList.add('fas');
        showToast('🐾 ¡Gracias por interactuar con la comunidad Huellitas!');
      }
    });
  });

  // Fallback ligero de compactación al hacer scroll para navegadores sin Scroll-driven Animations (ej. Firefox)
  if (
    !window.CSS?.supports?.('(animation-timeline: scroll()) and (animation-range: 0% 100%)') &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    const brandLogoFrame = document.querySelector('.brand-logo-frame');
    if (brandLogoFrame) {
      const scrollDistance = 140;
      const syncHeaderCrestScale = () => {
        const scrollPercent = Math.min(1, Math.max(0, window.scrollY) / scrollDistance);
        const crestScale = 1 - 0.14 * scrollPercent;
        brandLogoFrame.style.setProperty('--header-crest-scale', crestScale.toFixed(3));
      };
      window.addEventListener('scroll', syncHeaderCrestScale, { passive: true });
      syncHeaderCrestScale();
    }
  }

  // =========================================================================
  // 7. FONDO DINÁMICO EN INTERVALO LENTO (EL LOCAL, PERROS Y GATOS)
  // =========================================================================
  const ambientBgStage = document.getElementById('ambientBgStage');
  const ambientBgLabel = document.getElementById('ambientBgLabel');
  const ambientToggleBtn = document.getElementById('ambientToggleBtn');
  const ambientNextBtn = document.getElementById('ambientNextBtn');

  if (ambientBgStage) {
    const bgSlides = Array.from(ambientBgStage.querySelectorAll('.ambient-bg-slide'));
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const SLOW_INTERVAL_MS = 8500;
    let currentSlideIdx = Math.max(0, bgSlides.findIndex((s) => s.classList.contains('is-active')));
    let isBgPaused = reducedMotionQuery.matches;
    let bgTimerId = null;

    const preloadNextSlide = (idx) => {
      const nextSlide = bgSlides[(idx + 1) % bgSlides.length];
      const nextImg = nextSlide?.querySelector('img');
      if (nextImg && typeof nextImg.decode === 'function') {
        nextImg.decode().catch(() => {});
      }
    };

    const syncAmbientControlUI = () => {
      const activeSlide = bgSlides[currentSlideIdx];
      if (ambientBgLabel && activeSlide) {
        ambientBgLabel.textContent = activeSlide.getAttribute('data-bg-label') || 'Huellitas';
      }
      if (ambientBgControl) {
        ambientBgControl.classList.toggle('is-paused', isBgPaused);
      }
      if (ambientToggleBtn) {
        ambientToggleBtn.setAttribute('aria-pressed', String(isBgPaused));
        ambientToggleBtn.setAttribute(
          'aria-label',
          isBgPaused ? 'Reanudar rotación de imágenes de fondo' : 'Pausar rotación de imágenes de fondo'
        );
        const icon = ambientToggleBtn.querySelector('i');
        if (icon) {
          icon.className = isBgPaused ? 'fas fa-play' : 'fas fa-pause';
        }
      }
    };

    const goToAmbientSlide = (targetIdx) => {
      if (bgSlides.length < 2) return;
      bgSlides[currentSlideIdx]?.classList.remove('is-active');
      currentSlideIdx = (targetIdx + bgSlides.length) % bgSlides.length;
      bgSlides[currentSlideIdx]?.classList.add('is-active');
      syncAmbientControlUI();
      preloadNextSlide(currentSlideIdx);
    };

    const stopAmbientTimer = () => {
      if (bgTimerId !== null) {
        window.clearInterval(bgTimerId);
        bgTimerId = null;
      }
    };

    const startAmbientTimer = () => {
      stopAmbientTimer();
      if (!isBgPaused && !document.hidden && bgSlides.length > 1) {
        bgTimerId = window.setInterval(() => {
          goToAmbientSlide(currentSlideIdx + 1);
        }, SLOW_INTERVAL_MS);
      }
    };

    if (ambientToggleBtn) {
      ambientToggleBtn.addEventListener('click', () => {
        isBgPaused = !isBgPaused;
        syncAmbientControlUI();
        if (isBgPaused) {
          stopAmbientTimer();
        } else {
          startAmbientTimer();
        }
      });
    }

    if (ambientNextBtn) {
      ambientNextBtn.addEventListener('click', () => {
        goToAmbientSlide(currentSlideIdx + 1);
        if (!isBgPaused) {
          startAmbientTimer();
        }
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAmbientTimer();
      } else {
        startAmbientTimer();
      }
    });

    reducedMotionQuery.addEventListener?.('change', (ev) => {
      isBgPaused = ev.matches;
      syncAmbientControlUI();
      if (isBgPaused) {
        stopAmbientTimer();
      } else {
        startAmbientTimer();
      }
    });

    syncAmbientControlUI();
    preloadNextSlide(currentSlideIdx);
    startAmbientTimer();
  }

  // Inicializar componentes
  syncWeightSlider();
  updateSubsSummary();
  renderCart();
  syncFloatingSubsVisibility();
});

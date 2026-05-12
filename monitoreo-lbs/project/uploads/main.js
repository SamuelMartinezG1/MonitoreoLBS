/* ======================================================================
   0. CSRF INTERCEPTOR — inject X-CSRFToken header on every mutating fetch
   Must run BEFORE DOMContentLoaded so it patches fetch() early.
   ====================================================================== */
(function () {
    const _fetch = window.fetch;
    window.fetch = function (url, opts) {
        opts = opts || {};
        const method = (opts.method || 'GET').toUpperCase();
        if (['POST', 'PUT', 'DELETE', 'PATCH'].indexOf(method) !== -1) {
            var meta = document.querySelector('meta[name="csrf-token"]');
            if (meta) {
                opts.headers = opts.headers || {};
                // Support both plain object and Headers instance
                if (opts.headers instanceof Headers) {
                    if (!opts.headers.has('X-CSRFToken')) {
                        opts.headers.set('X-CSRFToken', meta.getAttribute('content'));
                    }
                } else {
                    if (!opts.headers['X-CSRFToken']) {
                        opts.headers['X-CSRFToken'] = meta.getAttribute('content');
                    }
                }
            }
        }
        return _fetch.call(this, url, opts);
    };
})();

document.addEventListener('DOMContentLoaded', function () {

    /* ======================================================================
       1. CLOCK — preserved exact
       ====================================================================== */
    function updateClock() {
        const now = new Date();
        const clockEl = document.getElementById('clock');
        const dateEl = document.getElementById('date');

        if (clockEl) {
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            clockEl.textContent = `${h}:${m}:${s}`;
        }

        if (dateEl) {
            dateEl.textContent = now.toISOString().split('T')[0];
        }
    }

    setInterval(updateClock, 1000);
    updateClock();

    /* ======================================================================
       2. SMOOTH SCROLL
       ====================================================================== */
    document.documentElement.style.scrollBehavior = 'smooth';

    /* ======================================================================
       3. INTERSECTION OBSERVER — scroll reveal with stagger
       ====================================================================== */
    const revealTargets = document.querySelectorAll(
        '.glass-card, .eng-panel, .tech-matrix, .card-control, .test-card, ' +
        '.stat-card, .project-card, .quick-action, .data-cell, .recap-item'
    );

    if (revealTargets.length > 0 && 'IntersectionObserver' in window) {
        // Add reveal class to elements below the fold
        revealTargets.forEach(function (el) {
            const rect = el.getBoundingClientRect();
            if (rect.top > window.innerHeight) {
                el.classList.add('reveal-on-scroll');
            }
        });

        let revealIndex = 0;
        const revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    // Stagger delay based on order of appearance
                    const delay = (revealIndex % 6) * 60;
                    revealIndex++;
                    setTimeout(function () {
                        el.classList.add('is-visible');
                    }, delay);
                    revealObserver.unobserve(el);
                }
            });
        }, { threshold: 0.08 });

        document.querySelectorAll('.reveal-on-scroll').forEach(function (el) {
            revealObserver.observe(el);
        });
    }

    /* ======================================================================
       4. BUTTON RIPPLE — Material Design effect (event delegation)
       ====================================================================== */
    document.addEventListener('click', function (e) {
        const btn = e.target.closest('.btn');
        if (!btn) return;

        const circle = document.createElement('span');
        circle.classList.add('ripple-effect');
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        circle.style.width = circle.style.height = size + 'px';
        circle.style.left = (e.clientX - rect.left - size / 2) + 'px';
        circle.style.top = (e.clientY - rect.top - size / 2) + 'px';
        btn.appendChild(circle);

        circle.addEventListener('animationend', function () {
            circle.remove();
        });
    });

    /* ======================================================================
       5. COUNTER ANIMATION — numbers animate from 0 to real value
       ====================================================================== */
    function animateCounter(el, target) {
        const duration = 1200;
        const start = performance.now();
        const isFloat = String(target).includes('.');
        const decimals = isFloat ? (String(target).split('.')[1] || '').length : 0;

        function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // ease-out-expo
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            const current = eased * target;

            if (isFloat) {
                el.textContent = current.toFixed(decimals);
            } else {
                el.textContent = Math.round(current);
            }

            if (progress < 1) {
                requestAnimationFrame(tick);
            }
        }

        requestAnimationFrame(tick);
    }

    const counterEls = document.querySelectorAll('.stat-content h3, .cell-value');

    if (counterEls.length > 0 && 'IntersectionObserver' in window) {
        const counterObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    const el = entry.target;
                    const text = el.textContent.trim();
                    // Extract leading number (int or float)
                    const match = text.match(/^[\d,]+\.?\d*/);
                    if (match) {
                        const numStr = match[0].replace(/,/g, '');
                        const num = parseFloat(numStr);
                        if (!isNaN(num) && num > 0) {
                            const suffix = text.slice(match[0].length);
                            const origText = el.textContent;
                            el.dataset.counterTarget = numStr;
                            el.dataset.counterSuffix = suffix;

                            const duration = 1200;
                            const startTime = performance.now();
                            const isFloat = numStr.includes('.');
                            const decimals = isFloat ? (numStr.split('.')[1] || '').length : 0;

                            function tick(now) {
                                const elapsed = now - startTime;
                                const progress = Math.min(elapsed / duration, 1);
                                const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
                                const current = eased * num;

                                if (isFloat) {
                                    el.textContent = current.toFixed(decimals) + suffix;
                                } else {
                                    el.textContent = Math.round(current).toLocaleString() + suffix;
                                }

                                if (progress < 1) {
                                    requestAnimationFrame(tick);
                                }
                            }

                            requestAnimationFrame(tick);
                        }
                    }
                    counterObserver.unobserve(el);
                }
            });
        }, { threshold: 0.3 });

        counterEls.forEach(function (el) {
            counterObserver.observe(el);
        });
    }

    /* ======================================================================
       6. TOAST SYSTEM — window.showToast(msg, type, duration)
       ====================================================================== */
    // Create toast container if not exists
    var toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.className = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    var toastIcons = {
        success: '\u2713',
        error: '\u2717',
        warning: '\u26A0',
        info: '\u2139'
    };

    window.showToast = function (message, type, duration) {
        type = type || 'info';
        duration = duration || 3500;

        var toast = document.createElement('div');
        toast.className = 'toast-item toast-' + type;
        toast.innerHTML = '<span style="font-size:1.1rem">' + (toastIcons[type] || '') + '</span> ' + message;
        toastContainer.appendChild(toast);

        setTimeout(function () {
            toast.classList.add('toast-exit');
            toast.addEventListener('animationend', function () {
                toast.remove();
            });
        }, duration);
    };

    /* ======================================================================
       7. FORM FOCUS LABELS — label turns red on focus
       ====================================================================== */
    document.addEventListener('focusin', function (e) {
        if (e.target.matches('.form-control, .form-select, textarea')) {
            var label = findLabel(e.target);
            if (label) label.classList.add('label-focused');
        }
    });

    document.addEventListener('focusout', function (e) {
        if (e.target.matches('.form-control, .form-select, textarea')) {
            var label = findLabel(e.target);
            if (label) label.classList.remove('label-focused');
        }
    });

    function findLabel(input) {
        // Check for associated label by id
        if (input.id) {
            var label = document.querySelector('label[for="' + input.id + '"]');
            if (label) return label;
        }
        // Check parent for .form-label
        var parent = input.closest('.mb-3, .mb-2, .form-group, .col');
        if (parent) {
            return parent.querySelector('.form-label');
        }
        return null;
    }

    /* ======================================================================
       8. SIDEBAR ANIMATION — nav links enter with slideInLeft stagger
       ====================================================================== */
    var sidebarLinks = document.querySelectorAll('.sidebar-nav .nav-link, .device-list-item');
    sidebarLinks.forEach(function (link, i) {
        link.style.opacity = '0';
        link.style.animation = 'slideInLeft 0.4s cubic-bezier(0.16, 1, 0.3, 1) both';
        link.style.animationDelay = (i * 50 + 100) + 'ms';
    });

    /* ======================================================================
       9. HAMBURGER MENU — toggle mobile nav
       ====================================================================== */
    // Cerrar nav al hacer click en un link
    document.querySelectorAll('.nav-segmented .nav-link').forEach(function (link) {
        link.addEventListener('click', function () {
            var nav = document.querySelector('.nav-segmented');
            if (nav) nav.classList.remove('open');
        });
    });

    // Cerrar nav al hacer click fuera
    document.addEventListener('click', function (e) {
        var nav = document.querySelector('.nav-segmented');
        var toggler = document.querySelector('.navbar-toggler');
        if (nav && nav.classList.contains('open') && !nav.contains(e.target) && (!toggler || !toggler.contains(e.target))) {
            nav.classList.remove('open');
        }
    });

});

/* Funciones globales para el drawer mobile */
function toggleMobileDrawer() {
    var nav = document.querySelector('.nav-segmented');
    var backdrop = document.getElementById('mobileDrawerBackdrop');
    if (nav) {
        nav.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('active');
    }
}

function closeMobileDrawer() {
    var nav = document.querySelector('.nav-segmented');
    var backdrop = document.getElementById('mobileDrawerBackdrop');
    if (nav) nav.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
}

/* Compatibilidad con templates que aún usen toggleMobileNav */
function toggleMobileNav() {
    toggleMobileDrawer();
}

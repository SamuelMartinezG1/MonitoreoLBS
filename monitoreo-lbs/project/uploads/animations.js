/**
 * LBS Animations — GSAP-powered UI animations
 * Requires gsap.min.js loaded before this file.
 *
 * SAFETY RULES:
 *   - NEVER set opacity:0 on broad selectors (.eng-panel, .card, [class*=container])
 *   - Only use gsap.fromTo (never gsap.from) to avoid stuck-invisible elements
 *   - Only animate elements that explicitly opt-in via .animate-reveal class
 *
 * Features:
 *   - Page entrance: header, nav links stagger in
 *   - Value counters: animated number transitions for SCADA values
 *   - Modal animations: smooth scale+fade open/close
 *   - Toast animations: slide-in from right
 *   - Navbar active link indicator
 *   - SCADA helpers: pulseElement, revealDeviceCards, flashStatus
 */

(function () {
    'use strict';

    if (typeof gsap === 'undefined') return;

    /* ============================================================ */
    /*  GSAP DEFAULTS                                               */
    /* ============================================================ */

    gsap.defaults({ ease: 'power2.out', duration: 0.5 });

    /* ============================================================ */
    /*  PAGE ENTRANCE ANIMATION                                     */
    /* ============================================================ */

    function animatePageEntrance() {
        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

        // Header slides down — use fromTo so it always ends visible
        const header = document.querySelector('.app-header');
        if (header) {
            tl.fromTo(header,
                { y: -20, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.5 }, 0);
        }

        // Brand logo
        const logo = document.querySelector('.brand-logo-img');
        if (logo) {
            tl.fromTo(logo,
                { scale: 0.7, opacity: 0 },
                { scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.5)' }, 0.1);
        }

        // Brand info
        const brandInfo = document.querySelector('.brand-info');
        if (brandInfo) {
            tl.fromTo(brandInfo,
                { x: -15, opacity: 0 },
                { x: 0, opacity: 1, duration: 0.4 }, 0.2);
        }

        // Nav links stagger
        const navLinks = document.querySelectorAll('.nav-segmented .nav-link');
        if (navLinks.length) {
            tl.fromTo(navLinks,
                { y: -10, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.35, stagger: 0.04 }, 0.15);
        }

        // Nav segment labels
        const segLabels = document.querySelectorAll('.nav-segment-label');
        if (segLabels.length) {
            tl.fromTo(segLabels,
                { opacity: 0 },
                { opacity: 1, duration: 0.3, stagger: 0.05 }, 0.2);
        }

        // Header right (clock + user)
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            tl.fromTo(headerRight,
                { x: 20, opacity: 0 },
                { x: 0, opacity: 1, duration: 0.4 }, 0.2);
        }

        // Main content — ONLY target .container-main (specific class, NOT wildcard)
        const content = document.querySelector('.container-main');
        if (content) {
            tl.fromTo(content,
                { y: 15, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.5 }, 0.3);
        }
    }

    /* ============================================================ */
    /*  CARD REVEAL ON SCROLL — opt-in only                         */
    /* ============================================================ */

    function initCardReveal() {
        // SAFETY: Only target elements with explicit .animate-reveal class.
        // NEVER use .eng-panel, .card, .glass-card — too broad, causes black screens.
        const cards = document.querySelectorAll('.animate-reveal');
        if (!cards.length) return;

        gsap.set(cards, { y: 20, opacity: 0 });

        const observer = new IntersectionObserver((entries) => {
            const visible = [];
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    visible.push(entry.target);
                    observer.unobserve(entry.target);
                }
            });
            if (visible.length) {
                gsap.to(visible, {
                    y: 0, opacity: 1,
                    duration: 0.5,
                    stagger: 0.08,
                    ease: 'power2.out'
                });
            }
        }, { threshold: 0.05 });

        cards.forEach(card => observer.observe(card));
    }

    /* ============================================================ */
    /*  MODAL ANIMATIONS — Override Bootstrap                       */
    /* ============================================================ */

    function initModalAnimations() {
        document.addEventListener('show.bs.modal', function (e) {
            const dialog = e.target.querySelector('.modal-dialog');
            if (!dialog) return;
            gsap.fromTo(dialog,
                { scale: 0.85, opacity: 0, y: 30 },
                { scale: 1, opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.4)' }
            );
        });

        document.addEventListener('hide.bs.modal', function (e) {
            const dialog = e.target.querySelector('.modal-dialog');
            if (!dialog) return;
            gsap.to(dialog, {
                scale: 0.9, opacity: 0, y: 20,
                duration: 0.2, ease: 'power2.in'
            });
        });
    }

    /* ============================================================ */
    /*  TOAST ANIMATIONS — Enhance showToast                        */
    /* ============================================================ */

    function initToastAnimations() {
        const origShowToast = window.showToast;
        if (typeof origShowToast !== 'function') return;

        window.showToast = function (message, type) {
            origShowToast(message, type);

            requestAnimationFrame(() => {
                const container = document.getElementById('toast-container') ||
                    document.querySelector('.toast-container');
                if (!container) return;

                const toast = container.lastElementChild;
                if (toast) {
                    gsap.fromTo(toast,
                        { x: 80, opacity: 0 },
                        { x: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }
                    );
                }
            });
        };
    }

    /* ============================================================ */
    /*  ANIMATED VALUE COUNTERS                                     */
    /* ============================================================ */

    /**
     * Smoothly animate a numeric text element to a new value.
     * Call: LBS.animateValue(element, newValue, decimals, suffix)
     */
    const _counterTweens = new WeakMap();

    function animateValue(el, newValue, decimals, suffix) {
        if (!el || typeof gsap === 'undefined') return;

        const num = parseFloat(newValue);
        if (isNaN(num)) { el.textContent = newValue; return; }

        decimals = decimals != null ? decimals : 1;
        suffix = suffix || '';

        const currentText = el.textContent.replace(/[^\d.\-]/g, '');
        const current = parseFloat(currentText) || 0;

        // Kill previous tween on this element
        const prev = _counterTweens.get(el);
        if (prev) prev.kill();

        const obj = { val: current };
        const tween = gsap.to(obj, {
            val: num,
            duration: 0.4,
            ease: 'power1.out',
            onUpdate: () => {
                el.textContent = obj.val.toFixed(decimals) + suffix;
            }
        });
        _counterTweens.set(el, tween);
    }

    /* ============================================================ */
    /*  NAVBAR ACTIVE INDICATOR ANIMATION                           */
    /* ============================================================ */

    function initNavActiveAnimation() {
        const activeLink = document.querySelector('.nav-segmented .nav-link.active');
        if (activeLink) {
            gsap.fromTo(activeLink,
                { boxShadow: '0 0 0 0 rgba(0, 102, 255, 0)' },
                {
                    boxShadow: '0 0 12px 2px rgba(0, 102, 255, 0.3)',
                    duration: 1.2,
                    ease: 'sine.inOut',
                    repeat: -1,
                    yoyo: true
                }
            );
        }
    }

    /* ============================================================ */
    /*  DROPDOWN ANIMATIONS                                         */
    /* ============================================================ */

    function initDropdownAnimations() {
        document.addEventListener('show.bs.dropdown', function (e) {
            const menu = e.target.nextElementSibling || e.target.parentElement.querySelector('.dropdown-menu');
            if (!menu) return;
            gsap.fromTo(menu,
                { opacity: 0, y: -8, scale: 0.96 },
                { opacity: 1, y: 0, scale: 1, duration: 0.2, ease: 'power2.out' }
            );
        });
    }

    /* ============================================================ */
    /*  SCADA-SPECIFIC ANIMATIONS                                   */
    /* ============================================================ */

    /**
     * Pulse an element briefly (for alerts, status changes).
     * Call: LBS.pulseElement(el, color)
     */
    function pulseElement(el, color) {
        if (!el) return;
        color = color || '#0066FF';
        gsap.fromTo(el,
            { boxShadow: '0 0 0 0 ' + color },
            {
                boxShadow: '0 0 20px 4px ' + color,
                duration: 0.4,
                yoyo: true,
                repeat: 1,
                ease: 'power2.inOut'
            }
        );
    }

    /**
     * Stagger-reveal device cards in SCADA panel.
     * Uses fromTo so elements always end visible.
     * Call: LBS.revealDeviceCards(selector)
     */
    function revealDeviceCards(selector) {
        const cards = document.querySelectorAll(selector || '.device-card');
        if (!cards.length) return;
        gsap.fromTo(cards,
            { y: 15, opacity: 0 },
            {
                y: 0, opacity: 1,
                duration: 0.3,
                stagger: 0.05,
                ease: 'power2.out'
            }
        );
    }

    /**
     * Animate a status change (online→offline, etc).
     * Flashes the element border color briefly.
     * Call: LBS.flashStatus(el, color)
     */
    function flashStatus(el, color) {
        if (!el) return;
        const orig = getComputedStyle(el).borderColor;
        gsap.timeline()
            .to(el, { borderColor: color, duration: 0.15 })
            .to(el, { borderColor: color, duration: 0.3 })
            .to(el, { borderColor: orig, duration: 0.4 });
    }

    /* ============================================================ */
    /*  HOVER MICRO-INTERACTIONS                                    */
    /* ============================================================ */

    function initHoverEffects() {
        document.querySelectorAll('.nav-segmented .nav-link:not(.active)').forEach(link => {
            link.addEventListener('mouseenter', () => {
                gsap.to(link, { y: -2, duration: 0.2, ease: 'power2.out' });
            });
            link.addEventListener('mouseleave', () => {
                gsap.to(link, { y: 0, duration: 0.2, ease: 'power2.out' });
            });
        });

        document.querySelectorAll('.btn-primary, .btn-outline-primary').forEach(btn => {
            btn.addEventListener('mouseenter', () => {
                gsap.to(btn, { scale: 1.03, duration: 0.15, ease: 'power2.out' });
            });
            btn.addEventListener('mouseleave', () => {
                gsap.to(btn, { scale: 1, duration: 0.15, ease: 'power2.out' });
            });
        });
    }

    /* ============================================================ */
    /*  MOBILE DRAWER ANIMATION                                     */
    /* ============================================================ */

    function initMobileDrawer() {
        const origToggle = window.toggleMobileDrawer;
        const origClose = window.closeMobileDrawer;

        if (typeof origToggle === 'function') {
            window.toggleMobileDrawer = function () {
                origToggle();
                const nav = document.getElementById('navSegmented');
                if (nav && nav.classList.contains('open')) {
                    gsap.fromTo(nav,
                        { x: '100%', opacity: 0 },
                        { x: '0%', opacity: 1, duration: 0.3, ease: 'power2.out' }
                    );
                }
            };
        }

        if (typeof origClose === 'function') {
            window.closeMobileDrawer = function () {
                const nav = document.getElementById('navSegmented');
                if (nav && nav.classList.contains('open')) {
                    gsap.to(nav, {
                        x: '100%', opacity: 0, duration: 0.2, ease: 'power2.in',
                        onComplete: origClose
                    });
                } else {
                    origClose();
                }
            };
        }
    }

    /* ============================================================ */
    /*  PUBLIC API                                                  */
    /* ============================================================ */

    window.LBS = window.LBS || {};
    window.LBS.animateValue = animateValue;
    window.LBS.pulseElement = pulseElement;
    window.LBS.revealDeviceCards = revealDeviceCards;
    window.LBS.flashStatus = flashStatus;

    /* ============================================================ */
    /*  INIT ON DOM READY                                           */
    /* ============================================================ */

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        animatePageEntrance();
        initCardReveal();
        initModalAnimations();
        initToastAnimations();
        initNavActiveAnimation();
        initDropdownAnimations();
        initHoverEffects();
        initMobileDrawer();
    }
})();
  
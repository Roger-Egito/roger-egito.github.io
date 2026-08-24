/* Roger Egito — portfolio
 *
 * Everything the site needs, without jQuery or Bootstrap: mobile menu,
 * sticky-nav state, scrollspy, back-to-top, and a contact form that submits
 * in place rather than navigating the visitor off to Formspree.
 */
(function () {
    'use strict';

    /* ---- Mobile menu ---------------------------------------------------- */

    var toggle = document.querySelector('.nav-toggle');
    var links = document.getElementById('navLinks');

    if (toggle && links) {
        toggle.addEventListener('click', function () {
            var open = links.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', String(open));
            toggle.innerHTML = open
                ? '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
                : '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
        });

        links.addEventListener('click', function (e) {
            if (e.target.closest('a')) {
                links.classList.remove('is-open');
                toggle.setAttribute('aria-expanded', 'false');
                toggle.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
            }
        });
    }

    /* ---- Nav shadow + back to top --------------------------------------- */

    var nav = document.getElementById('siteNav');
    var toTop = document.querySelector('.to-top');

    function onScroll() {
        var y = window.scrollY;
        if (nav) { nav.classList.toggle('is-stuck', y > 12); }
        if (toTop) { toTop.classList.toggle('is-visible', y > 600); }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    /* ---- Scrollspy ------------------------------------------------------ */

    var spied = [].slice.call(document.querySelectorAll('main section[id]'));
    var navMap = {};

    [].forEach.call(document.querySelectorAll('.nav-links a[href*="#"]'), function (a) {
        var id = a.getAttribute('href').split('#')[1];
        if (id) { navMap[id] = a; }
    });

    if (spied.length && 'IntersectionObserver' in window) {
        var seen = new Set();
        var spy = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) { seen.add(en.target.id); } else { seen.delete(en.target.id); }
            });
            Object.keys(navMap).forEach(function (id) {
                navMap[id].classList.toggle('is-active', seen.has(id));
            });
        }, { rootMargin: '-45% 0px -50% 0px' });

        spied.forEach(function (s) { spy.observe(s); });
    }

    /* ---- Contact form --------------------------------------------------- */

    var form = document.getElementById('contactForm');
    if (!form) { return; }

    var status = document.getElementById('formStatus');

    function setStatus(kind, html) {
        status.className = 'form-status' + (kind ? ' ' + kind : '');
        status.innerHTML = html;
    }

    function validate() {
        var ok = true;
        [].forEach.call(form.querySelectorAll('input[required], textarea[required]'), function (el) {
            var bad = !el.value.trim() || (el.type === 'email' && !el.checkValidity());
            el.closest('.field').classList.toggle('is-invalid', bad);
            if (bad && ok) { el.focus(); }
            if (bad) { ok = false; }
        });
        return ok;
    }

    [].forEach.call(form.querySelectorAll('input, textarea'), function (el) {
        el.addEventListener('input', function () {
            var field = el.closest('.field');
            if (field && field.classList.contains('is-invalid') && el.value.trim()) {
                field.classList.remove('is-invalid');
            }
        });
    });

    form.addEventListener('submit', function (e) {
        if (!validate()) { e.preventDefault(); setStatus('bad', 'Please fix the fields above.'); return; }
        if (!window.fetch) { return; }   // no fetch: let the browser POST normally

        e.preventDefault();

        var button = form.querySelector('button[type="submit"]');
        var original = button.innerHTML;
        button.disabled = true;
        button.textContent = 'Sending…';
        setStatus('', '');

        fetch(form.action, {
            method: 'POST',
            body: new FormData(form),
            headers: { Accept: 'application/json' }
        }).then(function (res) {
            if (!res.ok) { throw new Error('Formspree returned ' + res.status); }
            form.reset();
            setStatus('ok', 'Thanks — your message is on its way. I usually reply within a day.');
        }).catch(function () {
            setStatus('bad',
                'Something went wrong sending that. Please email me directly at ' +
                '<a href="mailto:rogeregito@outlook.com">rogeregito@outlook.com</a>.');
        }).then(function () {
            button.disabled = false;
            button.innerHTML = original;
        });
    });
})();

/* ==========================================================================
   SPINDLE — Infrastructure page
   Keeps the topology map, route highlights, and request trace in sync.
   ========================================================================== */

(function () {
  'use strict';

  const steps = Array.from(document.querySelectorAll('[data-trace]'));
  const shell = document.querySelector('.infra-map-shell');
  const count = document.getElementById('infraTraceCount');

  if (!steps.length) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nodes = Array.from(document.querySelectorAll('[data-stage]'));
  const routes = Array.from(document.querySelectorAll('[data-route]'));
  const logs = Array.from(document.querySelectorAll('[data-log]'));

  let current = 0;
  let timer = null;

  function setActive(index) {
    current = (index + steps.length) % steps.length;
    const stage = steps[current].getAttribute('data-trace');
    const total = String(steps.length).padStart(2, '0');

    steps.forEach((step, i) => {
      const active = i === current;
      step.classList.toggle('is-active', active);
      if (active) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });

    nodes.forEach((node) => node.classList.toggle('is-active', node.getAttribute('data-stage') === stage));
    routes.forEach((route) => route.classList.toggle('is-lit', route.getAttribute('data-route') === stage));
    logs.forEach((line) => line.classList.toggle('is-active', line.getAttribute('data-log') === stage));

    if (count) count.textContent = String(current + 1).padStart(2, '0') + ' / ' + total;
  }

  function start() {
    if (reducedMotion || timer) return;
    timer = window.setInterval(() => setActive(current + 1), 2800);
  }

  function stop() {
    if (!timer) return;
    window.clearInterval(timer);
    timer = null;
  }

  steps.forEach((step) => {
    step.addEventListener('click', () => {
      setActive(steps.indexOf(step));
      start();
    });
  });

  if (shell) {
    shell.addEventListener('mouseenter', stop);
    shell.addEventListener('mouseleave', start);
    shell.addEventListener('focusin', stop);
    shell.addEventListener('focusout', (event) => {
      if (!shell.contains(event.relatedTarget)) start();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  if (reducedMotion) {
    document.querySelectorAll('animateMotion').forEach((motion) => motion.remove());
  }

  setActive(0);
  start();
})();

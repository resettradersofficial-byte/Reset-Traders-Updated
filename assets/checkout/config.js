// Checkout switch. While open is false the site keeps its "Reserve" buttons and checkout only appears
// with ?checkout=test (test payments, admin accounts only). Set open to true to start selling.
window.RT_CHECKOUT = {
  open: false,
  opensAt: '2026-12-02',
  opensLabel: '2 December 2026',
  worker: 'https://shiny-dew-032freset-traders-payments.resettradersofficial.workers.dev',
  test: new URLSearchParams(location.search).get('checkout') === 'test'
};
window.RT_CHECKOUT.active = window.RT_CHECKOUT.open || window.RT_CHECKOUT.test;

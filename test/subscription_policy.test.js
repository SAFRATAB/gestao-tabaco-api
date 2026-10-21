const test = require('node:test');
const assert = require('node:assert/strict');
const { subscriptionStatus } = require('../subscription_policy');
const now = Date.parse('2026-01-01');
const product = 'gestao_tabaco_premium';
function purchase(state, expiry = '2026-02-01', productId = product) {
  return { subscriptionState: state, lineItems: [{ productId, expiryTime: expiry }] };
}
test('aceita assinatura ativa, carência e cancelada ainda vigente', () => {
  for (const state of ['ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED']) {
    assert.equal(subscriptionStatus(purchase(`SUBSCRIPTION_STATE_${state}`), product, now).ativa, true);
  }
});
test('rejeita expirada, suspensa, produto incorreto e resposta incompleta', () => {
  for (const value of [purchase('SUBSCRIPTION_STATE_ACTIVE','2025-12-31'),
    purchase('SUBSCRIPTION_STATE_ON_HOLD'), purchase('SUBSCRIPTION_STATE_EXPIRED'),
    purchase('SUBSCRIPTION_STATE_ACTIVE','2026-02-01','outro-produto'), {},
    purchase('SUBSCRIPTION_STATE_ACTIVE','data-invalida')]) {
    assert.equal(subscriptionStatus(value,product,now).ativa,false);
  }
});

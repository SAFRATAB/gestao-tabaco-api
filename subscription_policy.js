const allowedStates = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_CANCELED', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);
function subscriptionStatus(purchase, productId, now = Date.now()) {
  const matchingLine = (Array.isArray(purchase.lineItems) ? purchase.lineItems : [])
    .find(item => item.productId === productId);
  const expiry = Date.parse(matchingLine?.expiryTime || '');
  const ativa = Boolean(matchingLine && Number.isFinite(expiry) && expiry > now && allowedStates.has(purchase.subscriptionState));
  return { ativa, expiraEm: matchingLine?.expiryTime || null };
}
module.exports = { subscriptionStatus };

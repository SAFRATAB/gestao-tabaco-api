const crypto = require('node:crypto');
const { TrialStore, TRIAL_MS, AUDIENCE, describeTrial } = require('./trial_access');

// A chave administrativa fica somente no Render, nunca no aplicativo.
class SupabaseTrialStore {
  constructor({ url, key, request = fetch } = {}) {
    let parsed;
    try { parsed = new URL(url); } catch (_) { /* configuração validada abaixo */ }
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname) || !key?.trim()) {
      throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Render.');
    }
    this.url = parsed.origin;
    this.key = key.trim();
    this.request = request;
  }

  async load(device, activate) {
    const body = { p_device_hash: device };
    if (activate) {
      // O banco escolhe atomicamente a primeira chave; reinícios não a substituem.
      body.p_signing_private_key = crypto.generateKeyPairSync('ed25519').privateKey
        .export({ type: 'pkcs8', format: 'pem' });
    }
    let response;
    try {
      response = await this.request(`${this.url}/rest/v1/rpc/safratab_${activate ? 'activate' : 'get'}_trial`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('Banco indisponível');
      const data = await response.json();
      if (data === null && !activate) return null;
      if (!data || data.device_hash !== device || !Number.isSafeInteger(data.started_at) ||
          !Number.isSafeInteger(data.expires_at) || data.expires_at - data.started_at !== TRIAL_MS ||
          !Number.isSafeInteger(data.server_now) || typeof data.signing_private_key !== 'string') {
        throw new Error('Resposta inválida');
      }
      const privateKey = crypto.createPrivateKey(data.signing_private_key);
      if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Chave inválida');
      return { row: data, privateKey };
    } catch (_) {
      // Não registrar corpo de resposta, cabeçalhos ou chave do banco nos logs.
      throw new Error('Não foi possível consultar o banco do teste gratuito.');
    }
  }

  async activate(device) {
    const { row, privateKey } = await this.load(device, true);
    return describeTrial(row, privateKey, row.server_now);
  }

  async verify(device, receipt) {
    if (typeof receipt !== 'string' || receipt.length > 4096) return null;
    const parts = receipt.split('.');
    if (parts.length !== 2) return null;
    const stored = await this.load(device, false);
    if (!stored) return null;
    const { row, privateKey } = stored;
    try {
      if (!crypto.verify(null, Buffer.from(parts[0]), crypto.createPublicKey(privateKey), Buffer.from(parts[1], 'base64url'))) return null;
      const data = JSON.parse(Buffer.from(parts[0], 'base64url'));
      if (data.aud !== AUDIENCE || data.dispositivo !== device ||
          data.inicio !== row.started_at || data.expiraEm !== row.expires_at) return null;
    } catch (_) { return null; }
    return describeTrial(row, privateKey, row.server_now);
  }
}

function createTrialStore(env = process.env) {
  if (env.SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY) {
    return new SupabaseTrialStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY });
  }
  // Compatibilidade com instalações que já tenham um disco; sem fallback efêmero.
  if (env.SAFRATAB_TRIAL_DB_PATH) return new TrialStore(env.SAFRATAB_TRIAL_DB_PATH);
  throw new Error('Configure o Supabase para habilitar o teste gratuito sem disco no Render.');
}

module.exports = { SupabaseTrialStore, createTrialStore };

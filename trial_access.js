const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Router } = require('express');
const { issueServiceToken } = require('./service_auth');
const TRIAL_DAYS = 15;
const TRIAL_MS = TRIAL_DAYS * 86400000;
const AUDIENCE = 'safratab-teste-gratuito-v1';

class TrialStore {
  constructor(filename, { now = () => Date.now() } = {}) {
    if (!filename || !path.isAbsolute(filename)) throw new Error('Configure SAFRATAB_TRIAL_DB_PATH em um disco persistente.');
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    fs.chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS trial_devices (
        device_hash TEXT PRIMARY KEY, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS trial_metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.now = now;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let row = this.db.prepare('SELECT value FROM trial_metadata WHERE name = ?').get('signing_private_key');
      if (!row) {
        const pair = crypto.generateKeyPairSync('ed25519');
        const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
        this.db.prepare('INSERT INTO trial_metadata (name,value) VALUES (?,?)').run('signing_private_key', pem);
        row = { value: pem };
      }
      this.privateKey = crypto.createPrivateKey(row.value);
      this.publicKey = crypto.createPublicKey(this.privateKey);
      // Ed25519 SPKI contém o cabeçalho DER de 12 bytes seguido da chave de 32 bytes.
      this.publicBytes = this.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64url');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }
  }
  activate(deviceHash) {
    const now = this.now();
    this.db.prepare('INSERT OR IGNORE INTO trial_devices (device_hash,started_at,expires_at) VALUES (?,?,?)')
      .run(deviceHash, now, now + TRIAL_MS);
    return this.describe(this.db.prepare('SELECT * FROM trial_devices WHERE device_hash = ?').get(deviceHash));
  }
  verify(deviceHash, receipt) {
    if (typeof receipt !== 'string' || receipt.length > 4096) return null;
    const parts = receipt.split('.');
    if (parts.length !== 2) return null;
    try {
      if (!crypto.verify(null, Buffer.from(parts[0]), this.publicKey, Buffer.from(parts[1], 'base64url'))) return null;
      const data = JSON.parse(Buffer.from(parts[0], 'base64url'));
      const row = this.db.prepare('SELECT * FROM trial_devices WHERE device_hash = ?').get(deviceHash);
      if (!row || data.aud !== AUDIENCE || data.dispositivo !== deviceHash ||
        data.inicio !== row.started_at || data.expiraEm !== row.expires_at) return null;
      return this.describe(row);
    } catch (_) { return null; }
  }
  describe(row) {
    const now = this.now();
    const payload = Buffer.from(JSON.stringify({ aud: AUDIENCE, dispositivo: row.device_hash,
      inicio: row.started_at, expiraEm: row.expires_at, verificadoEm: now })).toString('base64url');
    const receipt = `${payload}.${crypto.sign(null, Buffer.from(payload), this.privateKey).toString('base64url')}`;
    const active = now >= row.started_at && now < row.expires_at;
    return { ativo: active, dias: TRIAL_DAYS, inicio: row.started_at, expiraEm: row.expires_at,
      servidorAgora: now, comprovante: receipt, chavePublica: this.publicBytes,
      ...(active ? { serviceToken: issueServiceToken({ now, expiresAt: row.expires_at }) } : {}) };
  }
  close() { this.db.close(); }
}

function trialRouter(getStore) {
  const router = Router();
  function handler(activate) {
    return (req, res) => {
      const device = req.body?.dispositivo;
      if (typeof device !== 'string' || !/^[a-f0-9]{64}$/.test(device)) {
        return res.status(400).json({ error: 'Não foi possível identificar este aparelho.' });
      }
      try {
        const store = getStore();
        const result = activate ? store.activate(device) : store.verify(device, req.body?.comprovante);
        if (!result) return res.status(403).json({ error: 'Comprovante de teste gratuito inválido.' });
        res.set('Cache-Control', 'no-store');
        return res.json(result);
      } catch (error) {
        console.error('Falha na avaliação gratuita:', error.message);
        return res.status(503).json({ error: 'A ativação do teste gratuito está temporariamente indisponível. Tente novamente com internet.' });
      }
    };
  }
  router.post('/ativar', handler(true));
  router.post('/verificar', handler(false));
  return router;
}
module.exports = { TrialStore, trialRouter, TRIAL_MS, AUDIENCE };

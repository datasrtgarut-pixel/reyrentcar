import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function formatWibParts(date: Date) {
  const wibDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // YYYY-MM-DD

  const wibTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date); // HH:mm:ss

  const wibDisplay = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);

  return { wibDate, wibTime, wibDisplay };
}

function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(storedHash, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'REY RENT CAR API' });
  });

  // Authoritative server clock in WIB (Asia/Jakarta)
  app.get('/api/server-time', (_req, res) => {
    const now = new Date();
    const { wibDate, wibTime, wibDisplay } = formatWibParts(now);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      epochMs: now.getTime(),
      iso: now.toISOString(),
      wibDate,
      wibTime,
      wibDisplay,
      timezone: 'Asia/Jakarta',
    });
  });

  // Cryptographic password hashing & verification endpoints
  app.post('/api/auth/hash-password', (req, res) => {
    const { password, salt } = req.body as { password?: string; salt?: string };
    if (!password || typeof password !== 'string' || password.length < 4 || password.length > 128) {
      res.status(400).json({ error: 'Password minimal 4 karakter.' });
      return;
    }
    const result = hashPassword(password, typeof salt === 'string' ? salt : undefined);
    res.json(result);
  });

  app.post('/api/auth/verify-password', (req, res) => {
    const { password, salt, hash } = req.body as { password?: string; salt?: string; hash?: string };
    if (!password || !salt || !hash) {
      res.status(400).json({ valid: false, error: 'Parameter verifikasi tidak lengkap.' });
      return;
    }
    const valid = verifyPassword(password, salt, hash);
    res.json({ valid });
  });

  // Google Maps Geocoding REST API v4 Reverse Geocoding Proxy (avoids browser CORS trap)
  app.get('/api/geocode/reverse', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      res.status(400).json({ error: 'Koordinat lat/lng tidak valid.' });
      return;
    }

    const apiKey = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
    if (!apiKey) {
      res.json({
        address: `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        source: 'coordinates_fallback',
      });
      return;
    }

    try {
      const url = new URL('https://geocode.googleapis.com/v4/geocode/location');
      url.searchParams.append('location.latitude', String(lat));
      url.searchParams.append('location.longitude', String(lng));
      url.searchParams.append('languageCode', 'id');
      url.searchParams.append('regionCode', 'ID');

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'results.placeId,results.formattedAddress',
          'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
        },
      });

      const payload = (await response.json().catch(() => ({}))) as {
        results?: Array<{ formattedAddress?: string; placeId?: string }>;
        error?: { status?: string; message?: string };
      };

      if (response.status === 429 || payload?.error?.status === 'RESOURCE_EXHAUSTED') {
        res.status(429).json({
          quotaExceeded: true,
          error: payload?.error?.message || 'Google Maps Platform quota exceeded',
          address: `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        });
        return;
      }

      if (!response.ok) {
        res.json({
          address: `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
          source: 'fallback',
        });
        return;
      }

      const first = payload?.results?.[0];
      res.json({
        address: first?.formattedAddress || `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        placeId: first?.placeId || null,
        source: 'google_geocoding_v4',
      });
    } catch {
      res.json({
        address: `Koordinat ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        source: 'network_fallback',
      });
    }
  });

  const isProduction = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist', 'index.html'));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`REY RENT CAR Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();

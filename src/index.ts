import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

const REALESTATE_API_KEY = process.env.REALESTATE_API_KEY as string;
const REALESTATE_BASE_URL = 'https://api.realestateapi.com/v2/PropertySearch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResult = Record<string, any>;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Shared fetch helper ───────────────────────────────────────────────────────
async function searchProperties(payload: ApiResult): Promise<ApiResult> {
  const res = await fetch(REALESTATE_BASE_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': REALESTATE_API_KEY,
      'x-user-id': 'UniqueUserIdentifier',
    },
    body: JSON.stringify(payload),
  });
  return res.json() as Promise<ApiResult>;
}

// ── CORS middleware ───────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

// ── 1. Address Search ─────────────────────────────────────────────────────────
app.post('/webhook/realestate-address', async (req: Request, res: Response) => {
  try {
    const { city, state, zip, street, county, limit = 50 } = req.body;

    const payload: ApiResult = {
      ids_only: false,
      obfuscate: false,
      summary: false,
      size: limit,
    };
    if (street) payload.street = street;
    if (city)   payload.city   = city;
    if (state)  payload.state  = state;
    if (zip)    payload.zip    = zip;
    if (county) payload.county = county;

    const data = await searchProperties(payload);
    res.json(data);
  } catch (err) {
    console.error('[address-search]', err);
    res.status(500).json({ error: 'Address search failed' });
  }
});

// ── 2. Polygon Search ─────────────────────────────────────────────────────────
app.post('/webhook/realestate-polygon', async (req: Request, res: Response) => {
  try {
    const { polygon, limit = 50 } = req.body;

    const data = await searchProperties({
      ids_only: false,
      obfuscate: false,
      summary: false,
      polygon,
      size: limit,
    });
    res.json(data);
  } catch (err) {
    console.error('[polygon-search]', err);
    res.status(500).json({ error: 'Polygon search failed' });
  }
});

// ── 3. Radius Search ──────────────────────────────────────────────────────────
app.post('/webhook/radius-search', async (req: Request, res: Response) => {
  try {
    const { center, radiusMiles, limit = 50 } = req.body;

    const data = await searchProperties({
      ids_only: false,
      obfuscate: false,
      summary: false,
      latitude: String(center.lat),
      longitude: String(center.lng),
      radius: radiusMiles,
      size: limit,
    });
    res.json(data);
  } catch (err) {
    console.error('[radius-search]', err);
    res.status(500).json({ error: 'Radius search failed' });
  }
});

// ── 4. Geocode ────────────────────────────────────────────────────────────────
app.post('/webhook/geocode', async (req: Request, res: Response) => {
  try {
    const { address } = req.body;

    const result = await searchProperties({
      ids_only: false,
      obfuscate: false,
      summary: false,
      size: 1,
      address,
    });

    const first = result.data?.[0];
    if (!first) {
      res.status(404).json({ error: 'Address not found' });
      return;
    }

    res.json({ lat: first.latitude, lng: first.longitude });
  } catch (err) {
    console.error('[geocode]', err);
    res.status(500).json({ error: 'Geocode failed' });
  }
});

// ── Catch-all: serve frontend ─────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Property Search server running on port ${PORT}`);
});

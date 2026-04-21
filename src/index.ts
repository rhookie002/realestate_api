import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

const REALESTATE_API_KEY = process.env.REALESTATE_API_KEY as string;
const REALESTATE_BASE_URL = 'https://api.realestateapi.com/v2/PropertySearch';

// Max records the API will return per single request
const API_PAGE_SIZE = 250;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResult = Record<string, any>;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── CORS middleware ───────────────────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

// ── Single page fetch ─────────────────────────────────────────────────────────
async function fetchPage(payload: ApiResult, resultIndex: number, pageSize: number): Promise<ApiResult> {
  const res = await fetch(REALESTATE_BASE_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': REALESTATE_API_KEY,
      'x-user-id': 'UniqueUserIdentifier',
    },
    body: JSON.stringify({ ...payload, size: pageSize, resultIndex }),
  });
  return res.json() as Promise<ApiResult>;
}

// ── Paginated fetch — pulls all records up to `limit` ────────────────────────
// The API caps each response at 250 records. This function loops through
// pages using resultIndex until we have `limit` records or exhaust results.
async function fetchAllPages(basePayload: ApiResult, limit: number): Promise<ApiResult> {
  const allRecords: ApiResult[] = [];
  let resultIndex = 0;
  let totalAvailable = Infinity; // will be set after first response
  let firstResponse: ApiResult | null = null;

  while (allRecords.length < limit && resultIndex < totalAvailable) {
    const remaining = limit - allRecords.length;
    const pageSize = Math.min(remaining, API_PAGE_SIZE);

    const page = await fetchPage(basePayload, resultIndex, pageSize);

    if (!firstResponse) {
      firstResponse = page;
      // resultCount is the total matching records in the API
      totalAvailable = page.resultCount ?? 0;
    }

    const records: ApiResult[] = page.data ?? [];
    if (records.length === 0) break; // no more records

    allRecords.push(...records);
    resultIndex += records.length;

    // Stop if this page returned fewer than requested (last page)
    if (records.length < pageSize) break;
  }

  // Return in the same shape as a single API response
  return {
    ...firstResponse,
    data: allRecords,
    resultCount: firstResponse?.resultCount ?? allRecords.length,
    recordCount: allRecords.length,
  };
}

// ── 1. Address Search ─────────────────────────────────────────────────────────
app.post('/webhook/realestate-address', async (req: Request, res: Response) => {
  try {
    const { city, state, zip, street, county, limit = 50,
      beds_min, beds_max, baths_min, baths_max,
      building_size_min, building_size_max,
      last_sale_price_min, last_sale_price_max } = req.body;

    const payload: ApiResult = { ids_only: false, obfuscate: false, summary: false };
    if (street)              payload.street               = street;
    if (city)                payload.city                 = city;
    if (state)               payload.state                = state;
    if (zip)                 payload.zip                  = zip;
    if (county)              payload.county               = county;
    if (beds_min)            payload.beds_min             = beds_min;
    if (beds_max)            payload.beds_max             = beds_max;
    if (baths_min)           payload.baths_min            = baths_min;
    if (baths_max)           payload.baths_max            = baths_max;
    if (building_size_min)   payload.building_size_min    = building_size_min;
    if (building_size_max)   payload.building_size_max    = building_size_max;
    if (last_sale_price_min) payload.last_sale_price_min  = last_sale_price_min;
    if (last_sale_price_max) payload.last_sale_price_max  = last_sale_price_max;

    const data = await fetchAllPages(payload, limit);
    res.json(data);
  } catch (err) {
    console.error('[address-search]', err);
    res.status(500).json({ error: 'Address search failed' });
  }
});

// ── 2. Polygon Search ─────────────────────────────────────────────────────────
app.post('/webhook/realestate-polygon', async (req: Request, res: Response) => {
  try {
    const { polygon, limit = 50,
      beds_min, beds_max, baths_min, baths_max,
      building_size_min, building_size_max,
      last_sale_price_min, last_sale_price_max } = req.body;

    const payload: ApiResult = { ids_only: false, obfuscate: false, summary: false, polygon };
    if (beds_min)            payload.beds_min             = beds_min;
    if (beds_max)            payload.beds_max             = beds_max;
    if (baths_min)           payload.baths_min            = baths_min;
    if (baths_max)           payload.baths_max            = baths_max;
    if (building_size_min)   payload.building_size_min    = building_size_min;
    if (building_size_max)   payload.building_size_max    = building_size_max;
    if (last_sale_price_min) payload.last_sale_price_min  = last_sale_price_min;
    if (last_sale_price_max) payload.last_sale_price_max  = last_sale_price_max;
    const data = await fetchAllPages(payload, limit);
    res.json(data);
  } catch (err) {
    console.error('[polygon-search]', err);
    res.status(500).json({ error: 'Polygon search failed' });
  }
});

// ── 3. Radius Search ──────────────────────────────────────────────────────────
app.post('/webhook/radius-search', async (req: Request, res: Response) => {
  try {
    const { center, radiusMiles, limit = 50,
      beds_min, beds_max, baths_min, baths_max,
      building_size_min, building_size_max,
      last_sale_price_min, last_sale_price_max } = req.body;

    const payload: ApiResult = {
      ids_only: false,
      obfuscate: false,
      summary: false,
      latitude: String(center.lat),
      longitude: String(center.lng),
      radius: radiusMiles,
    };
    if (beds_min)            payload.beds_min             = beds_min;
    if (beds_max)            payload.beds_max             = beds_max;
    if (baths_min)           payload.baths_min            = baths_min;
    if (baths_max)           payload.baths_max            = baths_max;
    if (building_size_min)   payload.building_size_min    = building_size_min;
    if (building_size_max)   payload.building_size_max    = building_size_max;
    if (last_sale_price_min) payload.last_sale_price_min  = last_sale_price_min;
    if (last_sale_price_max) payload.last_sale_price_max  = last_sale_price_max;
    const data = await fetchAllPages(payload, limit);
    res.json(data);
  } catch (err) {
    console.error('[radius-search]', err);
    res.status(500).json({ error: 'Radius search failed' });
  }
});

// ── 4. Geocode (address → lat/lng) ───────────────────────────────────────────
app.post('/webhook/geocode', async (req: Request, res: Response) => {
  try {
    const { address } = req.body;

    const result = await fetchPage({ ids_only: false, obfuscate: false, summary: false, address }, 0, 1);
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

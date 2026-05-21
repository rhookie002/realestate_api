import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

const REALESTATE_API_KEY = process.env.REALESTATE_API_KEY as string;
const REALESTATE_BASE_URL = 'https://api.realestateapi.com/v2/PropertySearch';
const PROPERTY_DETAIL_BASE_URL = 'https://api.realestateapi.com/v2/PropertyDetail';
const apiKey = process.env.GOOGLE_MAPS_API_KEY as string;

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
app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(`
    window.GOOGLE_MAPS_API_KEY = "${apiKey}";
  `);
});

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
async function fetchAllPages(basePayload: ApiResult, limit: number): Promise<ApiResult> {
  const allRecords: ApiResult[] = [];
  let resultIndex = 0;
  let totalAvailable = Infinity;
  let firstResponse: ApiResult | null = null;

  while (allRecords.length < limit && resultIndex < totalAvailable) {
    const remaining = limit - allRecords.length;
    const pageSize = Math.min(remaining, API_PAGE_SIZE);

    const page = await fetchPage(basePayload, resultIndex, pageSize);

    if (!firstResponse) {
      firstResponse = page;
      totalAvailable = page.resultCount ?? 0;
    }

    const records: ApiResult[] = page.data ?? [];
    if (records.length === 0) break;

    allRecords.push(...records);
    resultIndex += records.length;

    if (records.length < pageSize) break;
  }

  return {
    ...firstResponse,
    data: allRecords,
    resultCount: firstResponse?.resultCount ?? allRecords.length,
    recordCount: allRecords.length,
  };
}

// ── Fetch property detail by address ──────────────────────────────────────────
async function fetchPropertyDetail(address: string): Promise<ApiResult | null> {
  try {
    const res = await fetch(PROPERTY_DETAIL_BASE_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': REALESTATE_API_KEY,
        'x-user-id': 'UniqueUserIdentifier',
      },
      body: JSON.stringify({ 
        address,
        ids_only: false, 
        obfuscate: false, 
        summary: false 
      }),
    });
    
    const data = await res.json();
    return data?.data?.[0] || null;
  } catch (err) {
    console.error('[property-detail] Failed to fetch property detail:', err);
    return null;
  }
}

// ── 1. Address Search with Property Detail Integration ────────────────────────
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

    // Build address string for PropertyDetail API
    const addressParts = [street, city, state, zip].filter(v => v).join(', ');
    
    // Fetch property detail if we have enough address info
    let propertyDetailPromise: Promise<ApiResult | null> = Promise.resolve(null);
    if (street || addressParts.length > 0) {
      propertyDetailPromise = fetchPropertyDetail(addressParts);
    }

    // Fetch both in parallel
    const [propertyDetail, searchData] = await Promise.all([
      propertyDetailPromise,
      fetchAllPages(payload, limit)
    ]);

    let combinedResults: ApiResult[] = searchData?.data || [];
    
    // Add property detail at top if found and not a duplicate
    if (propertyDetail) {
      const detailId = propertyDetail.id || propertyDetail.propertyId;
      const isDuplicate = combinedResults.some((item: ApiResult) => 
        (item.id && item.id === detailId) || 
        (item.propertyId && item.propertyId === detailId)
      );
      
      if (!isDuplicate) {
        combinedResults.unshift(propertyDetail);
        // Trim to limit if necessary
        if (combinedResults.length > limit) {
          combinedResults = combinedResults.slice(0, limit);
        }
      }
    }
    
    res.json({
      ...searchData,
      data: combinedResults,
      resultCount: combinedResults.length,
      recordCount: combinedResults.length,
      hasPropertyDetail: !!propertyDetail && !combinedResults.some((item: ApiResult, index: number) => index > 0 && ((item.id && item.id === (propertyDetail.id || propertyDetail.propertyId)) || (item.propertyId && item.propertyId === (propertyDetail.id || propertyDetail.propertyId))))
    });
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

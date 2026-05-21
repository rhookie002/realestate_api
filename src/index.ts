import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

const REALESTATE_API_KEY = process.env.REALESTATE_API_KEY as string;
const REALESTATE_BASE_URL = 'https://api.realestateapi.com/v2/PropertySearch';
const apiKey = process.env.GOOGLE_MAPS_API_KEY as string;

// Max records the API will return per single request
const API_PAGE_SIZE = 250;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ApiResult {
  data?: Record<string, any>[];      // The list of property records
  resultCount?: number;              // Total results reported by API
  recordCount?: number;              // Count of items in `data`
  [key: string]: any;                // Anything else the API might return
}

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
    const records: ApiResult[] = page.data ?? [];

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

// ── Fetch Property Detail ─────────────────────────────────────────────────────
async function fetchPropertyDetail(street: string, city?: string, state?: string, zip?: string): Promise<ApiResult | null> {
  try {
    const addressStr = [street, city, state, zip].filter(v => v).join(', ');
    
    const res = await fetch('https://api.realestateapi.com/v2/PropertyDetail', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': REALESTATE_API_KEY,
        'x-user-id': 'UniqueUserIdentifier',
      },
      body: JSON.stringify({ 
        address: addressStr,
        ids_only: false, 
        obfuscate: false, 
        summary: false 
      }),
    });
    
    const response = await res.json();
    const detail = response?.data;
    
    if (!detail) return null;
    
    // Map PropertyDetail format to match PropertySearch format
    return {
      id: detail.id,
      propertyId: String(detail.id),
      apn: detail.lotInfo?.apn || detail.lotInfo?.apnUnformatted,
      address: {
        address: detail.propertyInfo?.address?.label || detail.propertyInfo?.address?.address,
        city: detail.propertyInfo?.address?.city,
        state: detail.propertyInfo?.address?.state,
        zip: detail.propertyInfo?.address?.zip,
        county: detail.propertyInfo?.address?.county,
        street: detail.propertyInfo?.address?.address,
        fips: detail.propertyInfo?.address?.fips,
      },
      latitude: detail.propertyInfo?.latitude,
      longitude: detail.propertyInfo?.longitude,
      bedrooms: detail.propertyInfo?.bedrooms,
      bathrooms: detail.propertyInfo?.bathrooms,
      squareFeet: detail.propertyInfo?.livingSquareFeet || detail.propertyInfo?.buildingSquareFeet,
      lotSquareFeet: detail.propertyInfo?.lotSquareFeet || detail.lotInfo?.lotSquareFeet,
      yearBuilt: detail.propertyInfo?.yearBuilt,
      estimatedValue: detail.estimatedValue,
      propertyType: detail.propertyType,
      propertyUse: detail.lotInfo?.propertyUse || detail.propertyInfo?.propertyUse,
      landUse: detail.lotInfo?.landUse,
      ownerOccupied: detail.ownerOccupied,
      owner1FirstName: detail.ownerInfo?.owner1FirstName,
      owner1LastName: detail.ownerInfo?.owner1LastName,
      owner2FirstName: detail.ownerInfo?.owner2FirstName,
      owner2LastName: detail.ownerInfo?.owner2LastName,
      mailAddress: detail.ownerInfo?.mailAddress ? {
        address: detail.ownerInfo.mailAddress.label || detail.ownerInfo.mailAddress.address,
        city: detail.ownerInfo.mailAddress.city,
        state: detail.ownerInfo.mailAddress.state,
        zip: detail.ownerInfo.mailAddress.zip,
        street: detail.ownerInfo.mailAddress.address,
        county: detail.ownerInfo.mailAddress.county,
      } : null,
      lastSaleAmount: detail.lastSale?.saleAmount,
      lastSaleDate: detail.lastSale?.saleDate,
      priorSaleAmount: detail.saleHistory?.[1]?.saleAmount,
      priorSaleDate: detail.saleHistory?.[1]?.saleDate,
      equity: detail.equity,
      estimatedEquity: detail.estimatedEquity,
      estimatedMortgageBalance: detail.estimatedMortgageBalance,
      estimatedMortgagePayment: detail.estimatedMortgagePayment,
      taxAmount: detail.taxInfo?.taxAmount,
      assessedValue: detail.taxInfo?.assessedValue,
      marketValue: detail.taxInfo?.marketValue,
      lastUpdateDate: detail.lastUpdateDate,
      _source: 'propertyDetail',
    };
  } catch (err) {
    console.error('[fetchPropertyDetail] Error:', err);
    return null;
  }
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

    // Try to get property detail if street is provided
    let propertyDetail: ApiResult | null = null;
    if (street) {
      propertyDetail = await fetchPropertyDetail(street, city, state, zip);
      console.log('[address-search] PropertyDetail found:', !!propertyDetail);
    }

    // Fetch regular search results
    const data = await fetchAllPages(payload, limit) as ApiResult;
    
    // If property detail found, add it to top of results
    if (propertyDetail && data?.data) {
      const results = data.data as ApiResult[];
      const detailId = propertyDetail.id || propertyDetail.propertyId;
      const isDuplicate = results.some((item: ApiResult) => 
        (item.id && String(item.id) === String(detailId)) || 
        (item.propertyId && String(item.propertyId) === String(detailId))
      );
      
      if (!isDuplicate) {
        // Add property detail at the beginning
        results.unshift(propertyDetail);
        // Keep within limit
        if (results.length > limit) {
          results.pop();
        }
        data.data = results;
        data.resultCount = results.length;
        data.recordCount = results.length;
        console.log('[address-search] PropertyDetail added to results');
      } else {
        console.log('[address-search] PropertyDetail already in search results');
      }
    }
    
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

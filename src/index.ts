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
// ── Single page fetch ─────────────────────────────────────────────────────────
async function fetchPage(payload: ApiResult, resultIndex: number, pageSize: number): Promise<any> {
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
  return res.json();
}

// ── Paginated fetch — pulls all records up to `limit` ────────────────────────
// The API caps each response at 250 records. This function loops through
// pages using resultIndex until we have `limit` records or exhaust results.
async function fetchAllPages(basePayload: ApiResult, limit: number): Promise<any> {
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
// ── Fetch Property Detail by Address ──────────────────────────────────────────
async function getPropertyDetail(street: string, city?: string, state?: string, zip?: string): Promise<any> {
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
    
    // Format to match PropertySearch item structure
    return {
      id: detail.id,
      propertyId: String(detail.id),
      apn: detail.lotInfo?.apn || '',
      address: {
        full_address: detail.propertyInfo?.address?.label || addressStr,
        address: detail.propertyInfo?.address?.address || '',
        city: detail.propertyInfo?.address?.city || '',
        state: detail.propertyInfo?.address?.state || '',
        zip: detail.propertyInfo?.address?.zip || '',
        county: detail.propertyInfo?.address?.county || '',
        street: detail.propertyInfo?.address?.address || '',
      },
      latitude: detail.propertyInfo?.latitude || 0,
      longitude: detail.propertyInfo?.longitude || 0,
      bedrooms: detail.propertyInfo?.bedrooms || 0,
      bathrooms: detail.propertyInfo?.bathrooms || 0,
      squareFeet: detail.propertyInfo?.livingSquareFeet || detail.propertyInfo?.buildingSquareFeet || 0,
      lotSquareFeet: detail.propertyInfo?.lotSquareFeet || detail.lotInfo?.lotSquareFeet || 0,
      yearBuilt: detail.propertyInfo?.yearBuilt || 0,
      estimatedValue: detail.estimatedValue || 0,
      propertyType: detail.propertyType || '',
      propertyUse: detail.lotInfo?.propertyUse || detail.propertyInfo?.propertyUse || '',
      landUse: detail.lotInfo?.landUse || '',
      ownerOccupied: detail.ownerOccupied || false,
      owner1FirstName: detail.ownerInfo?.owner1FirstName || '',
      owner1LastName: detail.ownerInfo?.owner1LastName || '',
      owner2FirstName: detail.ownerInfo?.owner2FirstName || '',
      owner2LastName: detail.ownerInfo?.owner2LastName || '',
      mailAddress: {
        full_address: detail.ownerInfo?.mailAddress?.label || '',
        street: detail.ownerInfo?.mailAddress?.address || '',
        city: detail.ownerInfo?.mailAddress?.city || '',
        state: detail.ownerInfo?.mailAddress?.state || '',
        zip: detail.ownerInfo?.mailAddress?.zip || '',
      },
      lastSaleAmount: detail.lastSale?.saleAmount || 0,
      lastSaleDate: detail.lastSale?.saleDate || '',
      priorSaleAmount: detail.saleHistory?.[1]?.saleAmount || 0,
      priorSaleDate: detail.saleHistory?.[1]?.saleDate || '',
      _source: 'propertyDetail'
    };
  } catch (err) {
    console.error('[getPropertyDetail] Error:', err);
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

    const payload: any = { ids_only: false, obfuscate: false, summary: false };
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

    // Get property detail if street is provided
    let propertyDetail = null;
    if (street) {
      propertyDetail = await getPropertyDetail(street, city, state, zip);
    }

    // Get search results
    const data: any = await fetchAllPages(payload, limit);
    
    // Insert property detail at the beginning if found and not duplicate
    if (propertyDetail && data && data.data) {
      const detailId = String(propertyDetail.id || propertyDetail.propertyId);
      
      // Check for duplicate
      const isDuplicate = data.data.some((item: any) => {
        const itemId = String(item.id || item.propertyId || '');
        return itemId === detailId;
      });
      
      if (!isDuplicate) {
        data.data.unshift(propertyDetail);
        if (data.data.length > limit) {
          data.data.pop();
        }
        data.resultCount = data.data.length;
        data.recordCount = data.data.length;
      }
    }
    
    res.json(data);
  } catch (err) {
    console.error('[address-search]', err);
    res.status(500).json({ error: 'Address search failed' });
  }
});

// app.post('/webhook/realestate-address', async (req: Request, res: Response) => {
//   try {
//     const {
//       city,
//       state,
//       zip,
//       street,
//       county,
//       limit = 50,

//       beds_min,
//       beds_max,
//       baths_min,
//       baths_max,
//       building_size_min,
//       building_size_max,
//       last_sale_price_min,
//       last_sale_price_max
//     } = req.body;

//     // ---------------------------------------
//     // STEP 1: Build PropertySearch payload
//     // ---------------------------------------
//     const searchPayload: any = {
//       ids_only: false,
//       obfuscate: false,
//       summary: false
//     };

//     if (street) searchPayload.street = street;
//     if (city) searchPayload.city = city;
//     if (state) searchPayload.state = state;
//     if (zip) searchPayload.zip = zip;
//     if (county) searchPayload.county = county;

//     if (beds_min) searchPayload.beds_min = beds_min;
//     if (beds_max) searchPayload.beds_max = beds_max;
//     if (baths_min) searchPayload.baths_min = baths_min;
//     if (baths_max) searchPayload.baths_max = baths_max;
//     if (building_size_min) searchPayload.building_size_min = building_size_min;
//     if (building_size_max) searchPayload.building_size_max = building_size_max;
//     if (last_sale_price_min) searchPayload.last_sale_price_min = last_sale_price_min;
//     if (last_sale_price_max) searchPayload.last_sale_price_max = last_sale_price_max;

//     // ---------------------------------------
//     // STEP 2: PropertySearch (fetch)
//     // ---------------------------------------
//     const searchResponse = await fetch(
//       'https://api.realestateapi.com/v2/PropertySearch',
//       {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'x-api-key': process.env.REALESTATE_API_KEY as string
//         },
//         body: JSON.stringify(searchPayload)
//       }
//     );

//     const searchData: any = await searchResponse.json();
//     const searchResults: any[] = searchData?.data || searchData || [];

//     // ---------------------------------------
//     // STEP 3: Resolve EXACT property via ID (FIXED FLOW)
//     // ---------------------------------------
//     let exactProperty: any = null;

//     if (street && city && state) {
//       try {
//         // Step 3a: find candidate via search (this is required)
//         const resolveResponse = await fetch(
//           'https://api.realestateapi.com/v2/PropertySearch',
//           {
//             method: 'POST',
//             headers: {
//               'Content-Type': 'application/json',
//               'x-api-key': process.env.REALESTATE_API_KEY as string
//             },
//             body: JSON.stringify({
//               street,
//               city,
//               state,
//               zip,
//               ids_only: true,
//               limit: 1
//             })
//           }
//         );

//         const resolveData: any = await resolveResponse.json();
//         const firstMatch = resolveData?.data?.[0] || resolveData?.[0];

//         // Step 3b: use ID for PropertyDetail (CORRECT)
//         if (firstMatch?.id) {
//           const detailResponse = await fetch(
//             'https://api.realestateapi.com/v2/PropertyDetail',
//             {
//               method: 'POST',
//               headers: {
//                 'Content-Type': 'application/json',
//                 'x-api-key': process.env.REALESTATE_API_KEY as string
//               },
//               body: JSON.stringify({
//                 id: firstMatch.id
//               })
//             }
//           );

//           const detailData: any = await detailResponse.json();
//           exactProperty = detailData?.data || detailData || null;
//         }
//       } catch (err) {
//         console.warn('[property-detail-resolution-failed]', err);
//       }
//     }

//     // ---------------------------------------
//     // STEP 4: Deduplicate + prepend exact property
//     // ---------------------------------------
//     let finalResults: any[] = searchResults;

//     if (exactProperty) {
//       finalResults = searchResults.filter((item: any) => {
//         const sameId =
//           item?.id &&
//           exactProperty?.id &&
//           item.id === exactProperty.id;

//         const sameAddress =
//           item?.address &&
//           exactProperty?.address &&
//           item.address.toLowerCase() ===
//             exactProperty.address.toLowerCase();

//         return !sameId && !sameAddress;
//       });

//       finalResults.unshift(exactProperty);
//     }

//     // ---------------------------------------
//     // STEP 5: Return response
//     // ---------------------------------------
//     return res.json(finalResults);

//   } catch (err) {
//     console.error('[address-search]', err);
//     return res.status(500).json({
//       error: 'Address search failed'
//     });
//   }
// });
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

const express = require('express');
const path = require('path');
const fetch = require('node-fetch'); // if using Node < 18

const app = express();
const PORT = process.env.PORT || 3000;

const REALESTATE_API_KEY = process.env.REALESTATE_API_KEY;
const REALESTATE_BASE_URL = 'https://api.realestateapi.com/v2/PropertySearch';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Max records per request
const API_PAGE_SIZE = 250;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── CORS ───────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));
app.get("/config.js", (_req, res) => {
  res.type("application/javascript");
  res.send(`window.GOOGLE_MAPS_API_KEY = "${GOOGLE_MAPS_API_KEY}";`);
});

// ── Fetch a single page ───────────────────────────────
async function fetchPage(payload, resultIndex, pageSize) {
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

// ── Fetch all pages up to `limit` ───────────────────
async function fetchAllPages(basePayload, limit) {
  const allRecords = [];
  let resultIndex = 0;
  let totalAvailable = Infinity;
  let firstResponse = null;

  while (allRecords.length < limit && resultIndex < totalAvailable) {
    const remaining = limit - allRecords.length;
    const pageSize = Math.min(remaining, API_PAGE_SIZE);

    const page = await fetchPage(basePayload, resultIndex, pageSize);
    const records = page.data || [];

    if (!firstResponse) {
      firstResponse = page;
      totalAvailable = page.resultCount || 0;
    }

    if (records.length === 0) break;

    allRecords.push(...records);
    resultIndex += records.length;

    if (records.length < pageSize) break;
  }

  return {
    ...firstResponse,
    data: allRecords,
    resultCount: firstResponse?.resultCount || allRecords.length,
    recordCount: allRecords.length,
  };
}

// ── Fetch Property Detail ─────────────────────────────
async function fetchPropertyDetail(street, city, state, zip) {
  try {
    const addressStr = [street, city, state, zip].filter(Boolean).join(', ');

    const res = await fetch('https://api.realestateapi.com/v2/PropertyDetail', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': REALESTATE_API_KEY,
        'x-user-id': 'UniqueUserIdentifier',
      },
      body: JSON.stringify({ address: addressStr, ids_only: false, obfuscate: false, summary: false }),
    });

    const response = await res.json();
    const detail = response?.data;

    if (!detail) return null;

    return {
      id: detail.id,
      propertyId: String(detail.id),
      address: detail.propertyInfo?.address,
      latitude: detail.propertyInfo?.latitude,
      longitude: detail.propertyInfo?.longitude,
      bedrooms: detail.propertyInfo?.bedrooms,
      bathrooms: detail.propertyInfo?.bathrooms,
      squareFeet: detail.propertyInfo?.livingSquareFeet || detail.propertyInfo?.buildingSquareFeet,
      lotSquareFeet: detail.propertyInfo?.lotSquareFeet,
      yearBuilt: detail.propertyInfo?.yearBuilt,
      estimatedValue: detail.estimatedValue,
      propertyType: detail.propertyType,
      ownerOccupied: detail.ownerOccupied,
      lastUpdateDate: detail.lastUpdateDate,
      _source: 'propertyDetail',
    };
  } catch (err) {
    console.error('[fetchPropertyDetail] Error:', err);
    return null;
  }
}

// ── Address Search ────────────────────────────────────
app.post('/webhook/realestate-address', async (req, res) => {
  try {
    const { city, state, zip, street, county, limit = 50, beds_min, beds_max, baths_min, baths_max } = req.body;

    const payload = { ids_only: false, obfuscate: false, summary: false };
    if (street) payload.street = street;
    if (city) payload.city = city;
    if (state) payload.state = state;
    if (zip) payload.zip = zip;
    if (county) payload.county = county;
    if (beds_min) payload.beds_min = beds_min;
    if (beds_max) payload.beds_max = beds_max;
    if (baths_min) payload.baths_min = baths_min;
    if (baths_max) payload.baths_max = baths_max;

    let propertyDetail = null;
    if (street) {
      propertyDetail = await fetchPropertyDetail(street, city, state, zip);
    }

    const data = await fetchAllPages(payload, limit);

    if (propertyDetail && data?.data) {
      const detailId = propertyDetail.id || propertyDetail.propertyId;
      const isDuplicate = data.data.some(item => (item.id && String(item.id) === String(detailId)) || (item.propertyId && String(item.propertyId) === String(detailId)));
      if (!isDuplicate) {
        data.data.unshift(propertyDetail);
        if (data.data.length > limit) data.data.pop();
        data.recordCount = data.data.length;
        data.resultCount = data.data.length;
      }
    }

    res.json(data);
  } catch (err) {
    console.error('[address-search]', err);
    res.status(500).json({ error: 'Address search failed' });
  }
});

// ── Catch-all: serve frontend ────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Property Search server running on port ${PORT}`);
});

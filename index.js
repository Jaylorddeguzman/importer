/**
 * STANDALONE OSM IMPORTER SERVICE
 * 
 * This is a background service that continuously imports establishments
 * from OpenStreetMap into MongoDB. Designed to run on a separate server
 * instance to avoid resource conflicts with the main application.
 * 
 * Features:
 * - Continuous background import
 * - Self-pinging to prevent sleeping on free hosting
 * - Health endpoint for monitoring
 * - Smart rate limiting
 * - Automatic duplicate detection
 * - Progress tracking and logging
 */

import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import { MongoClient } from 'mongodb';

dotenv.config();

// Configuration
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL;
const DB_NAME = 'localproductfinder';
const COLLECTION_NAME = 'stores';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Self-ping configuration
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PING_INTERVAL_MINUTES = 14;

// Import mode (can be set via environment variable)
const IMPORT_MODE = process.env.IMPORT_MODE || 'continuous';
const IMPORT_DELAY = parseInt(process.env.IMPORT_DELAY || '3000');

// Province configurations
const ALL_PROVINCES = [
  // Metro Manila
  { name: 'Metro Manila', lat: 14.5995, lon: 120.9842, radius: 30 },
  { name: 'Quezon City', lat: 14.6760, lon: 121.0437, radius: 15 },
  { name: 'Manila', lat: 14.5995, lon: 120.9842, radius: 10 },
  { name: 'Makati', lat: 14.5547, lon: 121.0244, radius: 8 },
  { name: 'BGC', lat: 14.5507, lon: 121.0494, radius: 3 },
  { name: 'Ortigas', lat: 14.5860, lon: 121.0566, radius: 3 },
  
  // Major cities
  { name: 'Cebu', lat: 10.3157, lon: 123.8854, radius: 25 },
  { name: 'Davao', lat: 7.0731, lon: 125.6125, radius: 25 },
  { name: 'Baguio', lat: 16.4119, lon: 120.5969, radius: 15 },
  { name: 'Iloilo', lat: 10.7202, lon: 122.5621, radius: 20 },
  { name: 'Cagayan de Oro', lat: 8.4542, lon: 124.6319, radius: 15 },
  
  // Other provinces
  { name: 'Laguna', lat: 14.2691, lon: 121.3507, radius: 20 },
  { name: 'Cavite', lat: 14.4791, lon: 120.8970, radius: 20 },
  { name: 'Bulacan', lat: 14.7942, lon: 120.8795, radius: 20 },
  { name: 'Pampanga', lat: 15.0794, lon: 120.6200, radius: 20 },
  { name: 'Rizal', lat: 14.6037, lon: 121.3084, radius: 20 },
  { name: 'Batangas', lat: 13.7565, lon: 121.0583, radius: 20 },
  { name: 'Negros Occidental', lat: 10.6319, lon: 122.9823, radius: 20 },
  { name: 'Bohol', lat: 9.8500, lon: 124.1435, radius: 20 },
  { name: 'Palawan', lat: 9.8349, lon: 118.7384, radius: 25 }
];

// Establishment types
const ESTABLISHMENT_TYPES = [
  'restaurant', 'cafe', 'fast_food', 'bar', 'pub',
  'hospital', 'clinic', 'pharmacy', 'dentist', 'doctors',
  'school', 'university', 'college', 'kindergarten',
  'bank', 'atm', 'bureau_de_change',
  'fuel', 'charging_station', 'car_wash', 'car_rental',
  'supermarket', 'convenience', 'mall', 'marketplace',
  'police', 'fire_station', 'post_office', 'townhall',
  'library', 'community_centre', 'social_facility',
  'place_of_worship', 'grave_yard',
  'hotel', 'motel', 'hostel', 'guest_house',
  'park', 'playground', 'sports_centre', 'swimming_pool',
  'cinema', 'theatre', 'arts_centre', 'casino'
];

// State tracking
let state = {
  isRunning: false,
  currentProvinceIndex: 0,
  currentTypeIndex: 0,
  totalImported: 0,
  cycleCount: 0,
  startTime: null,
  errors: 0,
  lastImportTime: null
};

let mongoClient = null;
let keepAliveInterval = null;
let pingCount = 0;

// Logging utility
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

// Express app for health checks and UI
const app = express();

// Serve static files from public directory
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile('public/index.html', { root: '.' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0,
    isImporting: state.isRunning,
    totalImported: state.totalImported
  });
});

app.get('/stats', (req, res) => {
  res.json({
    service: 'OSM Importer Service',
    state: {
      isRunning: state.isRunning,
      mode: IMPORT_MODE,
      currentProvince: ALL_PROVINCES[state.currentProvinceIndex]?.name,
      currentType: ESTABLISHMENT_TYPES[state.currentTypeIndex],
      currentProvinceIndex: state.currentProvinceIndex,
      currentTypeIndex: state.currentTypeIndex,
      totalProvinces: ALL_PROVINCES.length,
      totalTypes: ESTABLISHMENT_TYPES.length
    },
    progress: {
      totalImported: state.totalImported,
      cycleCount: state.cycleCount,
      errors: state.errors,
      uptime: state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0,
      lastImportTime: state.lastImportTime
    },
    keepAlive: {
      enabled: !!RENDER_EXTERNAL_URL,
      pings: pingCount,
      interval: `${PING_INTERVAL_MINUTES} minutes`
    }
  });
});

// New endpoint to fetch recent data from database
app.get('/api/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const db = mongoClient.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const establishments = await collection
      .find({})
      .sort({ addedAt: -1 })
      .limit(limit)
      .toArray();
    
    res.json({
      success: true,
      count: establishments.length,
      establishments: establishments
    });
  } catch (error) {
    log(`Error fetching recent data: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// OSM Functions
async function fetchFromOSM(location, type, radius) {
  const query = `
    [out:json][timeout:45];
    (
      node["amenity"="${type}"](around:${radius},${location.lat},${location.lon});
      way["amenity"="${type}"](around:${radius},${location.lat},${location.lon});
    );
    out center;
  `;

  try {
    const response = await axios.post(OVERPASS_URL, query, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 50000
    });

    return response.data.elements || [];
  } catch (error) {
    if (error.response?.status === 429) {
      log('⚠️  Rate limited by OSM, waiting 60s...');
      await sleep(60000);
    } else if (error.code === 'ECONNABORTED') {
      log('⚠️  Request timeout, continuing...');
    } else {
      log(`⚠️  OSM fetch error: ${error.message}`);
    }
    return [];
  }
}

async function insertToDatabase(establishments) {
  if (establishments.length === 0) return 0;

  const db = mongoClient.db(DB_NAME);
  const collection = db.collection(COLLECTION_NAME);
  
  let inserted = 0;

  for (const est of establishments) {
    try {
      const lat = est.lat || est.center?.lat;
      const lon = est.lon || est.center?.lon;
      
      if (!lat || !lon) continue;

      const doc = {
        name: est.tags?.name || `${est.tags?.amenity || 'Establishment'}`,
        category: est.tags?.amenity || 'general',
        latitude: lat,
        longitude: lon,
        address: est.tags?.['addr:full'] || est.tags?.['addr:street'] || 'Address not available',
        phone: est.tags?.phone || null,
        website: est.tags?.website || null,
        source: 'OpenStreetMap',
        coordinatesVerified: true,
        coordinateSource: 'OpenStreetMap',
        addedAt: new Date()
      };

      // Check for duplicates
      const existing = await collection.findOne({
        latitude: lat,
        longitude: lon,
        name: doc.name
      });

      if (!existing) {
        await collection.insertOne(doc);
        inserted++;
      }
    } catch (error) {
      // Skip duplicates silently
    }
  }

  return inserted;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Continuous import loop
async function runContinuousImport() {
  log('♾️  Starting continuous import mode...');
  
  const provinces = ALL_PROVINCES;
  const types = ESTABLISHMENT_TYPES;

  while (state.isRunning) {
    const province = provinces[state.currentProvinceIndex];
    const type = types[state.currentTypeIndex];

    log(`[Cycle ${state.cycleCount + 1}] ${province.name} - ${type}`);

    try {
      const elements = await fetchFromOSM(province, type, province.radius * 1000);
      const imported = await insertToDatabase(elements);
      
      state.totalImported += imported;
      state.lastImportTime = new Date().toISOString();
      
      if (imported > 0) {
        log(`  ✓ Added ${imported} (Total: ${state.totalImported})`);
      }

      // Move to next type
      state.currentTypeIndex++;
      if (state.currentTypeIndex >= types.length) {
        state.currentTypeIndex = 0;
        state.currentProvinceIndex++;
        
        if (state.currentProvinceIndex >= provinces.length) {
          state.currentProvinceIndex = 0;
          state.cycleCount++;
          log(`✓ Completed cycle ${state.cycleCount}`);
        }
      }

      await sleep(IMPORT_DELAY);

    } catch (error) {
      state.errors++;
      log(`❌ Error: ${error.message}`);
      await sleep(10000); // Wait 10s on error
    }
  }
}

// Keep-alive functionality
function startKeepAlive() {
  if (process.env.NODE_ENV !== 'production') {
    log('Keep-alive: Disabled in development mode');
    return;
  }

  if (!RENDER_EXTERNAL_URL || RENDER_EXTERNAL_URL === 'YOUR_RENDER_URL') {
    log('⚠️  Keep-alive: No URL configured. Service may sleep after 15 minutes.');
    log('   Set RENDER_EXTERNAL_URL environment variable with your importer service URL');
    return;
  }

  if (keepAliveInterval) {
    log('Keep-alive: Already running');
    return;
  }

  const intervalMs = PING_INTERVAL_MINUTES * 60 * 1000;
  
  log(`Keep-alive: Starting, pinging ${RENDER_EXTERNAL_URL}/health every ${PING_INTERVAL_MINUTES} minutes`);

  // Initial ping after 1 minute
  setTimeout(() => {
    pingSelf();
  }, 60000);

  // Set up recurring pings
  keepAliveInterval = setInterval(() => {
    pingSelf();
  }, intervalMs);

  log('Keep-alive: Service started successfully ✅');
}

async function pingSelf() {
  try {
    const startTime = Date.now();
    const response = await axios.get(`${RENDER_EXTERNAL_URL}/health`, {
      headers: { 'User-Agent': 'Keep-Alive-Service' },
      timeout: 10000
    });

    const duration = Date.now() - startTime;
    pingCount++;

    if (response.status === 200) {
      log(`Keep-alive: Ping #${pingCount} successful (${duration}ms) - Imported: ${state.totalImported}`);
    } else {
      log(`Keep-alive: Ping #${pingCount} failed with status ${response.status}`);
    }
  } catch (error) {
    log(`Keep-alive: Ping #${pingCount} error - ${error.message}`);
  }
}

// Main startup
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║       STANDALONE OSM IMPORTER SERVICE                ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  
  log(`Mode: ${IMPORT_MODE.toUpperCase()}`);
  log(`Delay: ${IMPORT_DELAY}ms`);
  log(`MongoDB URI: ${MONGODB_URI ? '✓ Configured' : '✗ Missing'}`);
  log('');

  if (!MONGODB_URI) {
    log('❌ MONGODB_URI not configured. Please set it in .env file');
    process.exit(1);
  }

  try {
    // Connect to MongoDB
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    log('✅ Connected to MongoDB');

    // Start Express server for health checks
    app.listen(PORT, () => {
      log(`✅ Health endpoint running on port ${PORT}`);
      log(`   Health check: http://localhost:${PORT}/health`);
      log(`   Stats: http://localhost:${PORT}/stats`);
    });

    // Start keep-alive service
    startKeepAlive();

    // Start import process
    state.isRunning = true;
    state.startTime = Date.now();
    await runContinuousImport();

  } catch (error) {
    log(`❌ Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  log('Shutting down gracefully...');
  state.isRunning = false;
  
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  if (mongoClient) {
    await mongoClient.close();
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down...');
  state.isRunning = false;
  
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  
  if (mongoClient) {
    await mongoClient.close();
  }
  
  process.exit(0);
});

// Start the service
main();

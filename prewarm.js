// ── ONTH DAILY GAMEPLAN API ───────────────────────────────────
// Standalone script — no scorecard dependencies.
//
// Sheet: "Daily Gameplan"
//   Row 0 = date, Row 1 = headers, data starts Row 2
//   Col B (1) = Name
//   Col C (2) = Route / Assignment
//   Col D (3) = Bag / Van
//   Col E (4) = Wave Time
//   Col F (5) = Total Stops
//   Col H (7) = RTS Time (With Breaks)
//
// Sheet: "Route Helper"
//   Col A (0) = Route
//   Col B (1) = Route Difficulty %
//   Col C (2) = Business Stops
//   Col D (3) = Apartments
//
// URL params:
//   ?driver=First+Last+Name   — returns that driver's gameplan + route info

function doGet(e) {
  var driver = e && e.parameter && e.parameter.driver
    ? e.parameter.driver.trim()
    : '';

  if (!driver) {
    return jsonOut({ error: 'No driver specified' });
  }

  // Check cache first
  var cacheKey = GP_CACHE_PREFIX + driver.toLowerCase().replace(/\s+/g, '_');
  var cached   = CacheService.getScriptCache().get(cacheKey);
  if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var gpData = getFastValues(ss, 'Daily Gameplan');

  // Build lookup index from Daily Gameplan col B
  // Keys: "firstname lastname" (ignores middle) + full lowercase exact
  var gpIndex = {};
  for (var i = 2; i < gpData.length; i++) {
    var cell = String(gpData[i][1]).trim();
    if (!cell) continue;
    gpIndex[firstLast(cell)]      = gpData[i];
    gpIndex[cell.toLowerCase()]   = gpData[i];
  }

  // Match incoming driver name
  var driverKey = firstLast(driver.replace(/\s+j\.?r\.?$|\s+s\.?r\.?$|\s+ii$|\s+iii$|\s+iv$/i, ''));
var gpRow = gpIndex[driverKey] || gpIndex[firstLast(driver)] || gpIndex[driver.toLowerCase()] || null;

  Logger.log('driver="' + driver + '" key="' + firstLast(driver) + '" found=' + (gpRow ? String(gpRow[1]).trim() : 'none'));

  var gameplan = {
    name:  gpRow ? String(gpRow[1]).trim()  : driver,
    route: gpRow ? String(gpRow[2]).trim()  : null,
    van:   gpRow ? String(gpRow[3]).trim()  : null,
    wave:  gpRow ? fmtTime(gpRow[4])        : null,
    stops: gpRow ? String(gpRow[5]).trim()  : null,
    rts:   gpRow ? fmtTime(gpRow[7])        : null
  };

  // Route Helper lookup
  var routeInfo = { route: null, difficulty: null, businessStops: null, apartments: null };
  if (gameplan.route) {
    var rhData = getFastValues(ss, 'Route Helper');
    var rNorm  = gameplan.route.toUpperCase();
    for (var r = 1; r < rhData.length; r++) {
      if (String(rhData[r][0]).trim().toUpperCase() === rNorm) {
        routeInfo = {
          route:         String(rhData[r][0]).trim(),
          difficulty:    String(rhData[r][1]).trim(),
          businessStops: String(rhData[r][2]).trim(),
          apartments:    String(rhData[r][3]).trim()
        };
        break;
      }
    }
  }

  var result = JSON.stringify({ gameplan: gameplan, route: routeInfo });
  CacheService.getScriptCache().put(cacheKey, result, GP_CACHE_TTL);
  return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
}
// Run this from the editor to print all driver gameplan links to the log.
function buildGameplanLinks() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('DA Names');
  if (!sheet) { Logger.log('DA Names sheet not found'); return; }

  var data  = sheet.getRange('C2:C' + sheet.getLastRow()).getValues();
  var base  = 'https://onth-bot.github.io/gameplan/?driver=';
  var lines = [];

  data.forEach(function(row) {
    var name = String(row[0]).trim();
    if (!name) return;
    lines.push(name + '\n' + base + encodeURIComponent(name));
  });

  Logger.log(lines.join('\n\n'));
}

// ── PREWARM ───────────────────────────────────────────────────
// Run on a time-based trigger (every 5-30 min) to keep cache hot.
// Each driver's payload is cached for 6 hours.
var GP_CACHE_PREFIX = 'gp_drvr_';
var GP_CACHE_TTL    = 21600;

function prewarmGameplanCache() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheet  = ss.getSheetByName('DA Names');
  if (!sheet) { Logger.log('DA Names sheet not found'); return; }

  var drivers = sheet.getRange('C2:C' + sheet.getLastRow()).getValues();
  var gpData  = getFastValues(ss, 'Daily Gameplan');
  var rhData  = getFastValues(ss, 'Route Helper');

  // Build gameplan index
  var gpIndex = {};
  for (var i = 2; i < gpData.length; i++) {
    var cell = String(gpData[i][1]).trim();
    if (!cell) continue;
    gpIndex[firstLast(cell)]    = gpData[i];
    gpIndex[cell.toLowerCase()] = gpData[i];
  }

  // Build route helper index
  var rhIndex = {};
  for (var r = 1; r < rhData.length; r++) {
    var rName = String(rhData[r][0]).trim();
    if (rName) rhIndex[rName.toUpperCase()] = rhData[r];
  }

  var batch = {};
  var count = 0;

  drivers.forEach(function(row) {
    var driver = String(row[0]).trim();
    if (!driver) return;

    var driverKey = firstLast(driver.replace(/\s+j\.?r\.?$|\s+s\.?r\.?$|\s+ii$|\s+iii$|\s+iv$/i, ''));
var gpRow = gpIndex[driverKey] || gpIndex[firstLast(driver)] || gpIndex[driver.toLowerCase()] || null;

    var gameplan = {
      name:  gpRow ? String(gpRow[1]).trim() : driver,
      route: gpRow ? String(gpRow[2]).trim() : null,
      van:   gpRow ? String(gpRow[3]).trim() : null,
      wave:  gpRow ? fmtTime(gpRow[4])       : null,
      stops: gpRow ? String(gpRow[5]).trim() : null,
      rts:   gpRow ? fmtTime(gpRow[7])       : null
    };

    var routeInfo = { route: null, difficulty: null, businessStops: null, apartments: null };
    if (gameplan.route) {
      var rh = rhIndex[gameplan.route.toUpperCase()];
      if (rh) routeInfo = {
        route:         String(rh[0]).trim(),
        difficulty:    String(rh[1]).trim(),
        businessStops: String(rh[2]).trim(),
        apartments:    String(rh[3]).trim()
      };
    }

    var cacheKey = GP_CACHE_PREFIX + driver.toLowerCase().replace(/\s+/g, '_');
    batch[cacheKey] = JSON.stringify({ gameplan: gameplan, route: routeInfo });
    count++;
  });

  CacheService.getScriptCache().putAll(batch, GP_CACHE_TTL);
  Logger.log('Gameplan cache warmed for ' + count + ' drivers.');
}

// Creates a trigger to prewarm every 5 minutes.
// Run once manually from the editor to set it up.
function createGameplanTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'prewarmGameplanCache') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('prewarmGameplanCache')
    .timeBased().everyMinutes(5).create();
  Logger.log('Gameplan trigger created');
}

// ── HELPERS ───────────────────────────────────────────────────

function getFastValues(ss, sheetName) {
  var s = ss.getSheetByName(sheetName);
  if (!s) return [];
  var lr = s.getLastRow();
  if (lr < 1) return [];
  return s.getRange(1, 1, lr, s.getLastColumn()).getValues();
}

/** "firstname lastname" — strips middle names for cross-list matching */
function firstLast(name) {
  var toks = String(name).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  if (toks.length === 0) return '';
  if (toks.length === 1) return toks[0];
  return toks[0] + ' ' + toks[toks.length - 1];
}

/** Converts a Sheets Date/time cell to "H:MM AM/PM" string */
function fmtTime(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    var h = v.getHours(), m = v.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }
  var s = String(v).trim();
  return s || null;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testGameplan() {
  var result = doGet({ parameter: { driver: 'Tyler Tagle' } });
  Logger.log(result.getContent());
}

/**
 * LaporCabang — Backend Google Apps Script (Google Sheets)
 * ========================================================
 * Cara Pemasangan:
 * 1. Buka Google Sheets baru, lalu klik Ekstensi -> Apps Script.
 * 2. Hapus kode bawaan dan tempel seluruh kode ini ke file Code.gs.
 * 3. Jalankan fungsi `setupSpreadsheet` sekali untuk membuat sheet Branches, Users, dan Reports.
 * 4. (Opsional) Di Project Settings -> Script Properties, tambahkan:
 *    - APPS_SCRIPT_SHARED_SECRET : token rahasia opsional yang sama dengan server aplikasi.
 * 5. Klik Deploy -> New deployment -> Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Salin URL Web App (`https://script.google.com/macros/s/.../exec`) ke halaman Integrasi Apps Script.
 */

var SHEET_BRANCHES = 'Branches';
var SHEET_USERS = 'Users';
var SHEET_REPORTS = 'Reports';
var SESSION_TTL_SECONDS = 21600; // 6 jam

var ALLOWED_CATEGORIES = [
  'Operasional Harian',
  'Pelayanan & Lapangan',
  'Stok & Logistik',
  'SDM & Kehadiran',
  'Kendala & Insiden',
];

var ALLOWED_SHIFTS = ['Pagi', 'Siang', 'Malam', 'Penuh'];

var ALLOWED_STATUSES = [
  'Terkirim',
  'Ditinjau',
  'Selesai',
  'Perlu Revisi',
];

/**
 * Jalankan fungsi ini sekali dari editor Apps Script untuk membuat struktur sheet.
 */
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEET_BRANCHES, ['id', 'code', 'name', 'city', 'address']);
  ensureSheet_(ss, SHEET_USERS, [
    'id',
    'username',
    'fullName',
    'role',
    'branchId',
    'passwordSalt',
    'passwordHash',
    'createdAt',
  ]);
  ensureSheet_(ss, SHEET_REPORTS, [
    'id',
    'reportDate',
    'branchId',
    'title',
    'category',
    'shift',
    'staffPresent',
    'summary',
    'issues',
    'status',
    'createdById',
    'createdByName',
    'createdByRole',
    'createdAt',
    'updatedAt',
  ]);

  var branchSheet = ss.getSheetByName(SHEET_BRANCHES);
  if (branchSheet.getLastRow() <= 1) {
    var defaultBranches = [
      ['cab-jkt', 'JKT-01', 'Cabang Jakarta Pusat', 'Jakarta Pusat', 'Jl. Jend. Sudirman Kav. 21'],
      ['cab-bdg', 'BDG-02', 'Cabang Bandung', 'Bandung', 'Jl. Asia Afrika No. 88'],
      ['cab-sby', 'SBY-03', 'Cabang Surabaya', 'Surabaya', 'Jl. Basuki Rahmat No. 45'],
      ['cab-mdn', 'MDN-04', 'Cabang Medan', 'Medan', 'Jl. Gatot Subroto No. 112'],
      ['cab-mks', 'MKS-05', 'Cabang Makassar', 'Makassar', 'Jl. Pettarani No. 34'],
    ];
    branchSheet.getRange(2, 1, defaultBranches.length, 5).setValues(defaultBranches);
  }
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Health check untuk uji koneksi Web App.
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  if (action === 'ping') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hasSheets =
      Boolean(ss.getSheetByName(SHEET_BRANCHES)) &&
      Boolean(ss.getSheetByName(SHEET_USERS)) &&
      Boolean(ss.getSheetByName(SHEET_REPORTS));

    return jsonResponse_({
      ok: true,
      service: 'LaporCabang Apps Script',
      spreadsheetName: ss.getName(),
      initialized: hasSheets,
      timestamp: new Date().toISOString(),
    });
  }
  return jsonResponse_({ ok: false, error: 'Gunakan metode POST untuk operasi API.' });
}

/**
 * Router utama untuk seluruh operasi autentikasi & CRUD laporan antar cabang.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: 'Payload kosong.' });
    }

    var body = JSON.parse(e.postData.contents);
    var expectedSecret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_SHARED_SECRET');
    if (expectedSecret && body.sharedSecret !== expectedSecret) {
      return jsonResponse_({ ok: false, error: 'Secret tidak valid.' });
    }

    var action = String(body.action || '');
    var payload = body.payload || {};
    var token = body.token ? String(body.token) : '';

    switch (action) {
      case 'ping':
        return jsonResponse_({ ok: true, service: 'LaporCabang Apps Script' });

      case 'authStatus':
        return handleAuthStatus_();

      case 'bootstrapAdmin':
        return handleBootstrapAdmin_(payload);

      case 'login':
        return handleLogin_(payload);

      case 'logout':
        return handleLogout_(token);

      case 'me':
        return handleMe_(token);

      case 'listBranches':
        return handleListBranches_(token);

      case 'createBranch':
        return handleCreateBranch_(token, payload);

      case 'listReports':
        return handleListReports_(token, payload);

      case 'createReport':
        return handleCreateReport_(token, payload);

      case 'updateReport':
        return handleUpdateReport_(token, payload);

      case 'deleteReport':
        return handleDeleteReport_(token, payload);

      case 'listUsers':
        return handleListUsers_(token);

      case 'createUser':
        return handleCreateUser_(token, payload);

      case 'deleteUser':
        return handleDeleteUser_(token, payload);

      default:
        return jsonResponse_({ ok: false, error: 'Aksi tidak dikenal: ' + action });
    }
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: err && err.message ? err.message : 'Terjadi kesalahan internal pada Apps Script.',
    });
  }
}

/* ==================== AUTENTIKASI & SESI ==================== */

function handleAuthStatus_() {
  var users = readObjects_(SHEET_USERS);
  var hasAdmin = users.some(function (u) {
    return u.role === 'admin';
  });
  return jsonResponse_({ ok: true, data: { needsSetup: !hasAdmin } });
}

function handleBootstrapAdmin_(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var users = readObjects_(SHEET_USERS);
    var hasAdmin = users.some(function (u) {
      return u.role === 'admin';
    });
    if (hasAdmin) {
      return jsonResponse_({ ok: false, error: 'Akun Admin sudah pernah diaktifkan.' });
    }

    var username = normalizeUsername_(payload.username);
    var fullName = String(payload.fullName || '').trim();
    var password = String(payload.password || '');

    if (!username || username.length < 3) {
      return jsonResponse_({ ok: false, error: 'Username minimal 3 karakter.' });
    }
    if (!fullName) {
      return jsonResponse_({ ok: false, error: 'Nama lengkap wajib diisi.' });
    }
    if (password.length < 8) {
      return jsonResponse_({ ok: false, error: 'Password minimal 8 karakter.' });
    }

    var salt = generateRandomHex_(16);
    var hash = hashPassword_(password, salt);
    var now = new Date().toISOString();
    var userId = 'usr-' + Utilities.getUuid().slice(0, 8);

    var sheet = getSheetOrThrow_(SHEET_USERS);
    sheet.appendRow([
      userId,
      safeCell_(username),
      safeCell_(fullName),
      'admin',
      '',
      salt,
      hash,
      now,
    ]);

    var token = createSession_(userId);
    var profile = toUserProfile_({
      id: userId,
      username: username,
      fullName: fullName,
      role: 'admin',
      branchId: '',
      createdAt: now,
    });

    return jsonResponse_({ ok: true, data: { token: token, user: profile } });
  } finally {
    lock.releaseLock();
  }
}

function handleLogin_(payload) {
  var username = normalizeUsername_(payload.username);
  var password = String(payload.password || '');

  var users = readObjects_(SHEET_USERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    if (normalizeUsername_(users[i].username) === username) {
      found = users[i];
      break;
    }
  }

  if (!found) {
    return jsonResponse_({ ok: false, error: 'Username atau password tidak sesuai.' });
  }

  var candidateHash = hashPassword_(password, String(found.passwordSalt || ''));
  if (!constantTimeEqual_(candidateHash, String(found.passwordHash || ''))) {
    return jsonResponse_({ ok: false, error: 'Username atau password tidak sesuai.' });
  }

  var token = createSession_(found.id);
  return jsonResponse_({
    ok: true,
    data: { token: token, user: toUserProfile_(found) },
  });
}

function handleLogout_(token) {
  if (token) {
    CacheService.getScriptCache().remove('sess_' + token);
  }
  return jsonResponse_({ ok: true });
}

function handleMe_(token) {
  var user = requireUser_(token);
  return jsonResponse_({ ok: true, data: { user: toUserProfile_(user) } });
}

function createSession_(userId) {
  var token = generateRandomHex_(32);
  CacheService.getScriptCache().put('sess_' + token, userId, SESSION_TTL_SECONDS);
  return token;
}

function requireUser_(token) {
  if (!token) {
    throw new Error('UNAUTHORIZED: Silakan masuk terlebih dahulu.');
  }
  var userId = CacheService.getScriptCache().get('sess_' + token);
  if (!userId) {
    throw new Error('UNAUTHORIZED: Sesi berakhir, silakan masuk kembali.');
  }
  var users = readObjects_(SHEET_USERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].id) === String(userId)) {
      return users[i];
    }
  }
  throw new Error('UNAUTHORIZED: Akun tidak ditemukan.');
}

function requireAdmin_(token) {
  var user = requireUser_(token);
  if (user.role !== 'admin') {
    throw new Error('FORBIDDEN: Hanya Admin yang memiliki akses ke fitur ini.');
  }
  return user;
}

/* ==================== CABANG ==================== */

function handleListBranches_(token) {
  var user = requireUser_(token);
  var branches = readObjects_(SHEET_BRANCHES);
  if (user.role === 'leader') {
    branches = branches.filter(function (b) {
      return String(b.id) === String(user.branchId);
    });
  }
  return jsonResponse_({ ok: true, data: branches });
}

function handleCreateBranch_(token, payload) {
  requireAdmin_(token);
  var code = String(payload.code || '').trim().toUpperCase();
  var name = String(payload.name || '').trim();
  var city = String(payload.city || '').trim();
  var address = String(payload.address || '').trim();

  if (!code || !name || !city) {
    return jsonResponse_({ ok: false, error: 'Kode, nama cabang, dan kota wajib diisi.' });
  }

  var branches = readObjects_(SHEET_BRANCHES);
  var duplicate = branches.some(function (b) {
    return String(b.code).toUpperCase() === code;
  });
  if (duplicate) {
    return jsonResponse_({ ok: false, error: 'Kode cabang sudah digunakan.' });
  }

  var id = 'cab-' + Utilities.getUuid().slice(0, 8);
  var sheet = getSheetOrThrow_(SHEET_BRANCHES);
  sheet.appendRow([id, safeCell_(code), safeCell_(name), safeCell_(city), safeCell_(address)]);

  return jsonResponse_({
    ok: true,
    data: { id: id, code: code, name: name, city: city, address: address },
  });
}

/* ==================== LAPORAN (CRUD & OTORISASI CABANG) ==================== */

function handleListReports_(token, filters) {
  var user = requireUser_(token);
  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  var rows = readObjects_(SHEET_REPORTS);

  var filtered = rows.filter(function (row) {
    // ATURAN KETAT: Leader hanya dapat melihat laporan dari cabangnya sendiri
    if (user.role === 'leader') {
      return String(row.branchId) === String(user.branchId);
    }
    // Admin dapat memfilter cabang tertentu atau melihat semua cabang
    if (filters && filters.branchId && filters.branchId !== 'all') {
      return String(row.branchId) === String(filters.branchId);
    }
    return true;
  });

  var mapped = filtered.map(function (row) {
    return hydrateReport_(row, branchesMap);
  });

  mapped.sort(function (a, b) {
    return String(b.reportDate + b.createdAt).localeCompare(String(a.reportDate + a.createdAt));
  });

  return jsonResponse_({ ok: true, data: mapped });
}

function handleCreateReport_(token, payload) {
  var user = requireUser_(token);
  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));

  // ATURAN KETAT: Leader otomatis terkunci pada cabangnya sendiri
  var targetBranchId = user.role === 'leader' ? String(user.branchId) : String(payload.branchId || '');
  if (!targetBranchId || !branchesMap[targetBranchId]) {
    return jsonResponse_({ ok: false, error: 'Cabang tujuan tidak valid.' });
  }

  var validated = validateReportPayload_(payload, user.role);
  var now = new Date().toISOString();
  var dateKey = validated.reportDate.replace(/-/g, '');
  var id = 'RPT-' + dateKey + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();

  var rowObj = {
    id: id,
    reportDate: validated.reportDate,
    branchId: targetBranchId,
    title: validated.title,
    category: validated.category,
    shift: validated.shift,
    staffPresent: validated.staffPresent,
    summary: validated.summary,
    issues: validated.issues,
    status: validated.status,
    createdById: user.id,
    createdByName: user.fullName,
    createdByRole: user.role,
    createdAt: now,
    updatedAt: now,
  };

  var sheet = getSheetOrThrow_(SHEET_REPORTS);
  sheet.appendRow([
    rowObj.id,
    safeCell_(rowObj.reportDate),
    rowObj.branchId,
    safeCell_(rowObj.title),
    rowObj.category,
    rowObj.shift,
    rowObj.staffPresent,
    safeCell_(rowObj.summary),
    safeCell_(rowObj.issues),
    rowObj.status,
    rowObj.createdById,
    safeCell_(rowObj.createdByName),
    rowObj.createdByRole,
    rowObj.createdAt,
    rowObj.updatedAt,
  ]);

  return jsonResponse_({ ok: true, data: hydrateReport_(rowObj, branchesMap) });
}

function handleUpdateReport_(token, payload) {
  var admin = requireAdmin_(token);
  var reportId = String(payload.id || '');
  if (!reportId) {
    return jsonResponse_({ ok: false, error: 'ID laporan wajib disertakan.' });
  }

  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  var targetBranchId = String(payload.branchId || '');
  if (!targetBranchId || !branchesMap[targetBranchId]) {
    return jsonResponse_({ ok: false, error: 'Cabang tidak valid.' });
  }

  var validated = validateReportPayload_(payload, admin.role);
  var sheet = getSheetOrThrow_(SHEET_REPORTS);
  var values = sheet.getDataRange().getValues();

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === reportId) {
      var now = new Date().toISOString();
      var updatedRow = [
        reportId,
        safeCell_(validated.reportDate),
        targetBranchId,
        safeCell_(validated.title),
        validated.category,
        validated.shift,
        validated.staffPresent,
        safeCell_(validated.summary),
        safeCell_(validated.issues),
        validated.status,
        values[r][10],
        values[r][11],
        values[r][12],
        values[r][13],
        now,
      ];
      sheet.getRange(r + 1, 1, 1, updatedRow.length).setValues([updatedRow]);

      return jsonResponse_({
        ok: true,
        data: hydrateReport_(
          {
            id: reportId,
            reportDate: validated.reportDate,
            branchId: targetBranchId,
            title: validated.title,
            category: validated.category,
            shift: validated.shift,
            staffPresent: validated.staffPresent,
            summary: validated.summary,
            issues: validated.issues,
            status: validated.status,
            createdById: values[r][10],
            createdByName: values[r][11],
            createdByRole: values[r][12],
            createdAt: values[r][13],
            updatedAt: now,
          },
          branchesMap
        ),
      });
    }
  }

  return jsonResponse_({ ok: false, error: 'Laporan tidak ditemukan.' });
}

function handleDeleteReport_(token, payload) {
  requireAdmin_(token);
  var reportId = String(payload.id || '');
  var sheet = getSheetOrThrow_(SHEET_REPORTS);
  var values = sheet.getDataRange().getValues();

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === reportId) {
      sheet.deleteRow(r + 1);
      return jsonResponse_({ ok: true, data: { deletedId: reportId } });
    }
  }
  return jsonResponse_({ ok: false, error: 'Laporan tidak ditemukan.' });
}

/* ==================== KELOLA AKUN (ADMIN ONLY) ==================== */

function handleListUsers_(token) {
  requireAdmin_(token);
  var users = readObjects_(SHEET_USERS).map(toUserProfile_);
  return jsonResponse_({ ok: true, data: users });
}

function handleCreateUser_(token, payload) {
  requireAdmin_(token);
  var username = normalizeUsername_(payload.username);
  var fullName = String(payload.fullName || '').trim();
  var role = payload.role === 'admin' ? 'admin' : 'leader';
  var branchId = role === 'leader' ? String(payload.branchId || '') : '';
  var password = String(payload.password || '');

  if (!username || username.length < 3) {
    return jsonResponse_({ ok: false, error: 'Username minimal 3 karakter.' });
  }
  if (!fullName) {
    return jsonResponse_({ ok: false, error: 'Nama lengkap wajib diisi.' });
  }
  if (password.length < 8) {
    return jsonResponse_({ ok: false, error: 'Password minimal 8 karakter.' });
  }

  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  if (role === 'leader' && !branchesMap[branchId]) {
    return jsonResponse_({ ok: false, error: 'Leader wajib ditempatkan pada cabang yang valid.' });
  }

  var users = readObjects_(SHEET_USERS);
  var exists = users.some(function (u) {
    return normalizeUsername_(u.username) === username;
  });
  if (exists) {
    return jsonResponse_({ ok: false, error: 'Username sudah terdaftar.' });
  }

  var salt = generateRandomHex_(16);
  var hash = hashPassword_(password, salt);
  var now = new Date().toISOString();
  var id = 'usr-' + Utilities.getUuid().slice(0, 8);

  var sheet = getSheetOrThrow_(SHEET_USERS);
  sheet.appendRow([id, safeCell_(username), safeCell_(fullName), role, branchId, salt, hash, now]);

  return jsonResponse_({
    ok: true,
    data: toUserProfile_({
      id: id,
      username: username,
      fullName: fullName,
      role: role,
      branchId: branchId,
      createdAt: now,
    }),
  });
}

function handleDeleteUser_(token, payload) {
  var admin = requireAdmin_(token);
  var userId = String(payload.id || '');
  if (userId === String(admin.id)) {
    return jsonResponse_({ ok: false, error: 'Tidak dapat menghapus akun yang sedang aktif.' });
  }

  var sheet = getSheetOrThrow_(SHEET_USERS);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === userId) {
      sheet.deleteRow(r + 1);
      return jsonResponse_({ ok: true, data: { deletedId: userId } });
    }
  }
  return jsonResponse_({ ok: false, error: 'Pengguna tidak ditemukan.' });
}

/* ==================== UTILITAS & KEAMANAN ==================== */

function validateReportPayload_(payload, role) {
  var reportDate = String(payload.reportDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error('Format tanggal laporan harus YYYY-MM-DD.');
  }

  var title = String(payload.title || '').trim();
  if (title.length < 3 || title.length > 160) {
    throw new Error('Judul laporan harus antara 3 hingga 160 karakter.');
  }

  var category = String(payload.category || '');
  if (ALLOWED_CATEGORIES.indexOf(category) === -1) {
    throw new Error('Kategori laporan tidak valid.');
  }

  var summary = String(payload.summary || '').trim();
  if (summary.length < 5 || summary.length > 3000) {
    throw new Error('Ringkasan laporan minimal 5 karakter.');
  }

  var issues = String(payload.issues || '').trim().slice(0, 2000);
  var shift = String(payload.shift || 'Penuh');
  if (ALLOWED_SHIFTS.indexOf(shift) === -1) {
    throw new Error('Shift kegiatan tidak valid.');
  }
  var staffPresent = Math.max(0, Math.floor(Number(payload.staffPresent) || 0));

  var status = 'Terkirim';
  if (role === 'admin' && payload.status && ALLOWED_STATUSES.indexOf(String(payload.status)) !== -1) {
    status = String(payload.status);
  }

  return {
    reportDate: reportDate,
    title: title,
    category: category,
    shift: shift,
    staffPresent: staffPresent,
    summary: summary,
    issues: issues,
    status: status,
  };
}

function toUserProfile_(u) {
  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  var branch = u.branchId ? branchesMap[String(u.branchId)] : null;
  return {
    id: String(u.id),
    username: String(u.username),
    fullName: String(u.fullName),
    role: u.role === 'admin' ? 'admin' : 'leader',
    branchId: branch ? String(branch.id) : null,
    branchName: branch ? String(branch.name) : null,
    branchCode: branch ? String(branch.code) : null,
    createdAt: String(u.createdAt || ''),
  };
}

function hydrateReport_(row, branchesMap) {
  var branch = branchesMap[String(row.branchId)] || null;
  return {
    id: String(row.id),
    reportDate: String(row.reportDate),
    branchId: String(row.branchId),
    branchName: branch ? String(branch.name) : 'Cabang Tidak Dikenal',
    branchCode: branch ? String(branch.code) : '-',
    title: String(row.title),
    category: String(row.category),
    shift: String(row.shift || 'Penuh'),
    staffPresent: Number(row.staffPresent) || 0,
    summary: String(row.summary || ''),
    issues: String(row.issues || ''),
    status: String(row.status || 'Terkirim'),
    createdById: String(row.createdById || ''),
    createdByName: String(row.createdByName || ''),
    createdByRole: row.createdByRole === 'admin' ? 'admin' : 'leader',
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
  };
}

function readObjects_(sheetName) {
  var sheet = getSheetOrThrow_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0];
  var results = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[0]) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[String(headers[c])] = row[c];
    }
    results.push(obj);
  }
  return results;
}

function getSheetOrThrow_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet "' + name + '" belum dibuat. Jalankan setupSpreadsheet() terlebih dahulu.');
  }
  return sheet;
}

function indexById_(list) {
  var map = {};
  for (var i = 0; i < list.length; i++) {
    map[String(list[i].id)] = list[i];
  }
  return map;
}

function normalizeUsername_(val) {
  return String(val || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

/**
 * Mencegah formula injection di Google Sheets saat teks dimulai dengan =, +, -, atau @.
 */
function safeCell_(val) {
  var str = String(val || '');
  if (/^[=+\-@]/.test(str)) {
    return "'" + str;
  }
  return str;
}

function generateRandomHex_(byteLen) {
  var raw = Utilities.getUuid() + Utilities.getUuid() + String(new Date().getTime());
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return bytesToHex_(digest).slice(0, byteLen * 2);
}

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ':' + password,
    Utilities.Charset.UTF_8
  );
  return bytesToHex_(digest);
}

function bytesToHex_(bytes) {
  return bytes
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

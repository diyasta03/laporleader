/**
 * WM Center — Backend Google Apps Script (Google Sheets)
 * ======================================================
 * Cara Pemasangan:
 * 1. Buka Google Sheets baru, lalu klik Ekstensi -> Apps Script.
 * 2. Hapus kode bawaan dan tempel seluruh kode ini ke file Code.gs.
 * 3. Jalankan fungsi `setupSpreadsheet` sekali untuk membuat sheet Branches, Users, dan Reports.
 * 4. (Opsional) Di Project Settings -> Script Properties, tambahkan:
 *    - APPS_SCRIPT_SHARED_SECRET : token rahasia opsional yang sama dengan server aplikasi.
 * 5. Klik Deploy -> New deployment -> Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Salin URL Web App (`https://script.google.com/macros/s/.../exec`) ke menu Integrasi Apps Script.
 */

var SHEET_BRANCHES = 'Branches';
var SHEET_USERS = 'Users';
var SHEET_REPORTS = 'Reports';
var GOOGLE_CLIENT_ID = '180602020868-jmjqma9tuuclegmo8ga8mrb09vkrhhk1.apps.googleusercontent.com';
var ADMIN_EMAIL_DOMAIN = '@wmcenter.id';
var SESSION_TTL_SECONDS = 21600; // 6 jam

var ALLOWED_CATEGORIES = [
  'Operasional & Layanan Fisioterapi',
  'Sharing Session',
  'WM Class & Program Wellness',
  'Briefing & Evaluasi Tim',
  'Event & Aktivasi Komunitas',
  'Perawatan Alat & Fasilitas',
  'Kendala & Insiden',
];

var ALLOWED_STATUSES = ['Under Review', 'Reviewed'];

var DRIVE_ATTACHMENT_FOLDER = 'WM Center - Lampiran Sharing Session';
var MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Jalankan fungsi ini sekali dari editor Apps Script untuk membuat struktur sheet WM Center.
 */
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet_(ss, SHEET_BRANCHES, ['id', 'code', 'name', 'city', 'address']);
  ensureSheet_(ss, SHEET_USERS, [
    'id',
    'identifier',
    'fullName',
    'role',
    'branchId',
    'secretSalt',
    'secretHash',
    'createdAt',
  ]);
  ensureSheet_(ss, SHEET_REPORTS, [
    'id',
    'reportDate',
    'startTime',
    'endTime',
    'branchId',
    'category',
    'activityName',
    'sharingSessionTitle',
    'description',
    'achievements',
    'issues',
    'followUp',
    'status',
    'reviewNote',
    'createdById',
    'createdByName',
    'createdByRole',
    'createdAt',
    'updatedAt',
    'attachmentFileId',
    'attachmentName',
    'attachmentSize',
  ]);

  var branchSheet = ss.getSheetByName(SHEET_BRANCHES);
  if (branchSheet.getLastRow() <= 1) {
    var defaultBranches = [
      ['wm-snt', 'WM-SNT', 'WM Center Sunter', 'Jakarta Utara', 'Kawasan Sunter Agung, Jakarta Utara'],
      ['wm-pmd', 'WM-PMD', 'WM Center Pemuda', 'Jakarta Timur', 'Jl. Pemuda, Rawamangun, Jakarta Timur'],
      ['wm-kby', 'WM-KBY', 'WM Center Kebayoran', 'Jakarta Selatan', 'Kebayoran Baru, Jakarta Selatan'],
      ['wm-kmg', 'WM-KMG', 'WM Center Kemang', 'Jakarta Selatan', 'Kawasan Kemang, Jakarta Selatan'],
      ['wm-kng', 'WM-KNG', 'WM Center Kuningan', 'Jakarta Selatan', 'Kuningan, Jakarta Selatan'],
      ['wm-pri', 'WM-PRI', 'WM Center Puri', 'Jakarta Barat', 'Puri Indah, Jakarta Barat'],
      ['wm-als', 'WM-ALS', 'WM Center Alam Sutera', 'Tangerang', 'Kawasan Alam Sutera, Tangerang'],
      ['wm-bsd', 'WM-BSD', 'WM Center BSD', 'Tangerang Selatan', 'BSD City, Tangerang Selatan'],
      ['wm-bks', 'WM-BKS', 'WM Center Bekasi', 'Bekasi', 'Bekasi Barat, Kota Bekasi'],
      ['wm-dpk', 'WM-DPK', 'WM Center Depok', 'Depok', 'Margonda, Kota Depok'],
      ['wm-bdg', 'WM-BDG', 'WM Center Bandung', 'Bandung', 'Kota Bandung, Jawa Barat'],
      ['wm-sby', 'WM-SBY', 'WM Center Surabaya', 'Surabaya', 'Kota Surabaya, Jawa Timur'],
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
    sheet
      .getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#033367')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    return sheet;
  }

  // Migrasi otomatis header Users lama (email/passwordSalt/passwordHash -> identifier/secretSalt/secretHash)
  if (name === SHEET_USERS) {
    var userHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
    if (String(userHeaders[1]) === 'email' || String(userHeaders[5]) === 'passwordSalt') {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet
        .getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#033367')
        .setFontColor('#ffffff');
    }
    return sheet;
  }

  // Jika sheet Reports masih memakai struktur kolom lama (sebelum WM Center), arsipkan agar tidak salah kolom
  if (name === SHEET_REPORTS) {
    var reportHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 4)).getValues()[0];
    if (String(reportHeaders[2]) !== 'startTime' || String(reportHeaders[6]) !== 'activityName') {
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
      sheet.setName('Reports_Lama_' + stamp);
      var fresh = ss.insertSheet(SHEET_REPORTS);
      fresh.getRange(1, 1, 1, headers.length).setValues([headers]);
      fresh
        .getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#033367')
        .setFontColor('#ffffff');
      fresh.setFrozenRows(1);
      return fresh;
    }
  }

  var existingCols = sheet.getLastColumn();
  if (existingCols < headers.length) {
    var missingHeaders = headers.slice(existingCols);
    sheet.getRange(1, existingCols + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    sheet
      .getRange(1, existingCols + 1, 1, missingHeaders.length)
      .setFontWeight('bold')
      .setBackground('#033367')
      .setFontColor('#ffffff');
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
      service: 'WM Center Reporting Apps Script',
      spreadsheetName: ss.getName(),
      initialized: hasSheets,
      timestamp: new Date().toISOString(),
    });
  }
  return jsonResponse_({ ok: false, error: 'Gunakan metode POST untuk operasi API.' });
}

/**
 * Router utama untuk seluruh operasi autentikasi & CRUD laporan WM Center.
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
        return jsonResponse_({ ok: true, service: 'WM Center Reporting Apps Script' });
      case 'authStatus':
        return handleAuthStatus_();
      case 'bootstrapAdmin':
        return handleBootstrapAdmin_(payload);
      case 'login':
        return handleLogin_(payload);
      case 'googleLogin':
        return handleGoogleLogin_(payload);      case 'logout':
        return handleLogout_(token);
      case 'me':
        return handleMe_(token);
      case 'listBranches':
        return handleListBranches_(token);
      case 'createBranch':
        return handleCreateBranch_(token, payload);
      case 'updateBranch':
        return handleUpdateBranch_(token, payload);
      case 'deleteBranch':
        return handleDeleteBranch_(token, payload);
      case 'listReports':
        return handleListReports_(token, payload);
      case 'createReport':
        return handleCreateReport_(token, payload);
      case 'updateReport':
        return handleUpdateReport_(token, payload);
      case 'updateReportStatus':
        return handleUpdateReportStatus_(token, payload);
      case 'deleteReport':
        return handleDeleteReport_(token, payload);
      case 'getAttachment':
        return handleGetAttachment_(token, payload);
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

function getUserIdentifier_(u) {
  return String(u.identifier !== undefined && u.identifier !== '' ? u.identifier : u.email || '').trim();
}

function getUserSalt_(u) {
  return String(u.secretSalt !== undefined && u.secretSalt !== '' ? u.secretSalt : u.passwordSalt || '');
}

function getUserHash_(u) {
  return String(u.secretHash !== undefined && u.secretHash !== '' ? u.secretHash : u.passwordHash || '');
}

function handleAuthStatus_() {
  var users = readObjects_(SHEET_USERS);
  var hasAdmin = users.some(function (u) {
    return u.role === 'admin' && isValidWmAdminEmail_(normalizeEmail_(getUserIdentifier_(u)));
  });
  return jsonResponse_({ ok: true, data: { needsSetup: !hasAdmin } });
}

function handleBootstrapAdmin_(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var users = readObjects_(SHEET_USERS);
    var hasAdmin = users.some(function (u) {
      return u.role === 'admin' && isValidWmAdminEmail_(normalizeEmail_(getUserIdentifier_(u)));
    });
    if (hasAdmin) {
      return jsonResponse_({ ok: false, error: 'Akun Admin WM Center sudah pernah diaktifkan.' });
    }

    var email = normalizeEmail_(payload.email);
    var fullName = String(payload.fullName || '').trim();
    var password = String(payload.password || '');

    if (!isValidWmAdminEmail_(email)) {
      return jsonResponse_({
        ok: false,
        error: 'Email Admin wajib menggunakan domain ' + ADMIN_EMAIL_DOMAIN + '.',
      });
    }
    if (!fullName) {
      return jsonResponse_({ ok: false, error: 'Nama lengkap wajib diisi.' });
    }
    if (password.length < 8) {
      return jsonResponse_({ ok: false, error: 'Password minimal 8 karakter.' });
    }

    var salt = generateRandomHex_(16);
    var hash = hashSecret_(password, salt);
    var now = new Date().toISOString();
    var userId = 'usr-' + Utilities.getUuid().slice(0, 8);

    var sheet = getSheetOrThrow_(SHEET_USERS);
    sheet.appendRow([userId, safeCell_(email), safeCell_(fullName), 'admin', '', salt, hash, now]);

    var token = createSession_(userId);
    var profile = toUserProfile_({
      id: userId,
      identifier: email,
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
  var loginType = payload.loginType === 'admin' ? 'admin' : 'leader';
  var rawId = String(payload.identifier || '');
  var identifier = loginType === 'admin' ? normalizeEmail_(rawId) : normalizeUsername_(rawId);
  var rawSecret = String(payload.secret || '');
  var secret = loginType === 'leader' ? rawSecret.trim() : rawSecret;

  if (loginType === 'admin' && !isValidWmAdminEmail_(identifier)) {
    return jsonResponse_({
      ok: false,
      error: 'Login Admin wajib menggunakan email ' + ADMIN_EMAIL_DOMAIN + '.',
    });
  }

  var users = readObjects_(SHEET_USERS);
  var found = null;
  for (var i = 0; i < users.length; i++) {
    var rowRole = users[i].role === 'admin' ? 'admin' : 'leader';
    var rawRowId = getUserIdentifier_(users[i]);
    var rowId = rowRole === 'admin' ? normalizeEmail_(rawRowId) : normalizeUsername_(rawRowId);
    if (rowRole === loginType && rowId === identifier) {
      found = users[i];
      break;
    }
  }

  if (!found) {
    return jsonResponse_({
      ok: false,
      error:
        loginType === 'admin'
          ? 'Email WM Center atau password tidak sesuai.'
          : 'Username atau kode akses leader tidak sesuai.',
    });
  }

  var candidateHash = hashSecret_(secret, getUserSalt_(found));
  if (!constantTimeEqual_(candidateHash, getUserHash_(found))) {
    return jsonResponse_({
      ok: false,
      error:
        loginType === 'admin'
          ? 'Email WM Center atau password tidak sesuai.'
          : 'Username atau kode akses leader tidak sesuai.',
    });
  }

  var token = createSession_(found.id);
  return jsonResponse_({
    ok: true,
    data: { token: token, user: toUserProfile_(found) },
  });
}

function handleGoogleLogin_(payload) {
  var idToken = String((payload && payload.idToken) || '').trim();
  if (!idToken) {
    return jsonResponse_({ ok: false, error: 'Token Google tidak ditemukan.' });
  }

  // 1. Verifikasi id_token langsung ke endpoint Google
  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );

  if (res.getResponseCode() !== 200) {
    return jsonResponse_({ ok: false, error: 'Token Google tidak valid atau kedaluwarsa.' });
  }

  var profile = JSON.parse(res.getContentText());

  // 2. Validasi Client ID (aud) agar token dipastikan berasal dari aplikasi WM Center
  if (String(profile.aud || '') !== GOOGLE_CLIENT_ID) {
    return jsonResponse_({ ok: false, error: 'Client ID token Google tidak sesuai.' });
  }

  var email = normalizeEmail_(profile.email);
  var isVerified = String(profile.email_verified) === 'true';

  // 3. Validasi wajib domain @wmcenter.id (sesuai fungsi isValidWmAdminEmail_ rekan Anda)
  if (!isVerified || !isValidWmAdminEmail_(email)) {
    return jsonResponse_({
      ok: false,
      error: 'Akses ditolak. Login Admin wajib menggunakan email ' + ADMIN_EMAIL_DOMAIN + '.',
    });
  }

  // 4. Cari atau daftarkan otomatis akun Admin ke sheet Users
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var users = readObjects_(SHEET_USERS);
    var adminUser = null;

    for (var i = 0; i < users.length; i++) {
      if (users[i].role === 'admin' && normalizeEmail_(getUserIdentifier_(users[i])) === email) {
        adminUser = users[i];
        break;
      }
    }

    if (!adminUser) {
      var now = new Date().toISOString();
      var userId = 'usr-' + Utilities.getUuid().slice(0, 8);
      var fullName = String(profile.name || email.split('@')[0]).trim();
      var salt = generateRandomHex_(16);
      var hash = hashSecret_(generateRandomHex_(32), salt);

      var sheet = getSheetOrThrow_(SHEET_USERS);
      sheet.appendRow([userId, safeCell_(email), safeCell_(fullName), 'admin', '', salt, hash, now]);

      adminUser = {
        id: userId,
        identifier: email,
        fullName: fullName,
        role: 'admin',
        branchId: '',
        createdAt: now,
      };
    }

    // 5. Terbitkan session token 6 jam yang kompatibel dengan semua API CRUD rekan Anda
    var token = createSession_(adminUser.id);
    return jsonResponse_({
      ok: true,
      data: {
        token: token,
        user: toUserProfile_(adminUser),
      },
    });
  } finally {
    lock.releaseLock();
  }
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
    throw new Error('FORBIDDEN: Hanya Admin WM Center yang memiliki akses ke fitur ini.');
  }
  return user;
}

/* ==================== CABANG (CRUD ADMIN) ==================== */

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

  var id = 'wm-' + Utilities.getUuid().slice(0, 8);
  var sheet = getSheetOrThrow_(SHEET_BRANCHES);
  sheet.appendRow([id, safeCell_(code), safeCell_(name), safeCell_(city), safeCell_(address)]);

  return jsonResponse_({
    ok: true,
    data: { id: id, code: code, name: name, city: city, address: address },
  });
}

function handleUpdateBranch_(token, payload) {
  requireAdmin_(token);
  var branchId = String(payload.id || '');
  var code = String(payload.code || '').trim().toUpperCase();
  var name = String(payload.name || '').trim();
  var city = String(payload.city || '').trim();
  var address = String(payload.address || '').trim();

  if (!branchId || !code || !name || !city) {
    return jsonResponse_({ ok: false, error: 'Data cabang tidak lengkap.' });
  }

  var sheet = getSheetOrThrow_(SHEET_BRANCHES);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== branchId && String(values[i][1]).toUpperCase() === code) {
      return jsonResponse_({ ok: false, error: 'Kode cabang sudah digunakan cabang lain.' });
    }
  }

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === branchId) {
      sheet
        .getRange(r + 1, 1, 1, 5)
        .setValues([[branchId, safeCell_(code), safeCell_(name), safeCell_(city), safeCell_(address)]]);
      return jsonResponse_({
        ok: true,
        data: { id: branchId, code: code, name: name, city: city, address: address },
      });
    }
  }

  return jsonResponse_({ ok: false, error: 'Cabang tidak ditemukan.' });
}

function handleDeleteBranch_(token, payload) {
  requireAdmin_(token);
  var branchId = String(payload.id || '');
  var users = readObjects_(SHEET_USERS);
  if (
    users.some(function (u) {
      return String(u.branchId) === branchId;
    })
  ) {
    return jsonResponse_({
      ok: false,
      error: 'Cabang masih memiliki akun Leader terdaftar. Hapus atau pindahkan akun terlebih dahulu.',
    });
  }

  var sheet = getSheetOrThrow_(SHEET_BRANCHES);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === branchId) {
      sheet.deleteRow(r + 1);
      return jsonResponse_({ ok: true, data: { deletedId: branchId } });
    }
  }
  return jsonResponse_({ ok: false, error: 'Cabang tidak ditemukan.' });
}

/* ==================== LAPORAN KEGIATAN ==================== */

function handleListReports_(token, filters) {
  var user = requireUser_(token);
  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  var rows = readObjects_(SHEET_REPORTS);

  var filtered = rows.filter(function (row) {
    if (user.role === 'leader') {
      return String(row.branchId) === String(user.branchId);
    }
    if (filters && filters.branchId && filters.branchId !== 'all') {
      return String(row.branchId) === String(filters.branchId);
    }
    return true;
  });

  var mapped = filtered.map(function (row) {
    return hydrateReport_(row, branchesMap);
  });

  mapped.sort(function (a, b) {
    return String(b.reportDate + b.startTime + b.createdAt).localeCompare(
      String(a.reportDate + a.startTime + a.createdAt)
    );
  });

  return jsonResponse_({ ok: true, data: mapped });
}

function handleCreateReport_(token, payload) {
  var user = requireUser_(token);
  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));

  // ATURAN KETAT: Leader otomatis terkunci ke cabang penempatannya
  var targetBranchId = user.role === 'leader' ? String(user.branchId) : String(payload.branchId || '');
  if (!targetBranchId || !branchesMap[targetBranchId]) {
    return jsonResponse_({ ok: false, error: 'Cabang tujuan tidak valid.' });
  }

  var validated = validateReportPayload_(payload, user.role);
  var now = new Date().toISOString();
  var dateKey = validated.reportDate.replace(/-/g, '');
  var id = 'WM-' + dateKey + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();

  var savedFile = { fileId: '', fileName: '', fileSize: 0 };
  if (payload.attachment && validated.category === 'Sharing Session') {
    savedFile = savePdfAttachmentToDrive_(id, payload.attachment);
  }

  var rowObj = {
    id: id,
    reportDate: validated.reportDate,
    startTime: validated.startTime,
    endTime: validated.endTime,
    branchId: targetBranchId,
    category: validated.category,
    activityName: validated.activityName,
    sharingSessionTitle: validated.sharingSessionTitle,
    description: validated.description,
    achievements: validated.achievements,
    issues: validated.issues,
    followUp: validated.followUp,
    status: validated.status,
    reviewNote: validated.reviewNote,
    createdById: user.id,
    createdByName: user.fullName,
    createdByRole: user.role,
    createdAt: now,
    updatedAt: now,
    attachmentFileId: savedFile.fileId,
    attachmentName: savedFile.fileName,
    attachmentSize: savedFile.fileSize,
  };

  var sheet = getSheetOrThrow_(SHEET_REPORTS);
  sheet.appendRow([
    rowObj.id,
    safeCell_(rowObj.reportDate),
    safeCell_(rowObj.startTime),
    safeCell_(rowObj.endTime),
    rowObj.branchId,
    rowObj.category,
    safeCell_(rowObj.activityName),
    safeCell_(rowObj.sharingSessionTitle),
    safeCell_(rowObj.description),
    safeCell_(rowObj.achievements),
    safeCell_(rowObj.issues),
    safeCell_(rowObj.followUp),
    rowObj.status,
    safeCell_(rowObj.reviewNote),
    rowObj.createdById,
    safeCell_(rowObj.createdByName),
    rowObj.createdByRole,
    rowObj.createdAt,
    rowObj.updatedAt,
    rowObj.attachmentFileId,
    safeCell_(rowObj.attachmentName),
    rowObj.attachmentSize,
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
      var attachmentFileId = String(values[r][19] || '');
      var attachmentName = String(values[r][20] || '');
      var attachmentSize = Number(values[r][21] || 0);

      if (validated.category !== 'Sharing Session' || payload.removeAttachment) {
        trashDriveFileQuietly_(attachmentFileId);
        attachmentFileId = '';
        attachmentName = '';
        attachmentSize = 0;
      }

      if (payload.attachment && validated.category === 'Sharing Session') {
        trashDriveFileQuietly_(attachmentFileId);
        var savedFile = savePdfAttachmentToDrive_(reportId, payload.attachment);
        attachmentFileId = savedFile.fileId;
        attachmentName = savedFile.fileName;
        attachmentSize = savedFile.fileSize;
      }

      var updatedRow = [
        reportId,
        safeCell_(validated.reportDate),
        safeCell_(validated.startTime),
        safeCell_(validated.endTime),
        targetBranchId,
        validated.category,
        safeCell_(validated.activityName),
        safeCell_(validated.sharingSessionTitle),
        safeCell_(validated.description),
        safeCell_(validated.achievements),
        safeCell_(validated.issues),
        safeCell_(validated.followUp),
        validated.status,
        safeCell_(validated.reviewNote),
        values[r][14],
        values[r][15],
        values[r][16],
        values[r][17],
        now,
        attachmentFileId,
        safeCell_(attachmentName),
        attachmentSize,
      ];
      sheet.getRange(r + 1, 1, 1, updatedRow.length).setValues([updatedRow]);

      return jsonResponse_({
        ok: true,
        data: hydrateReport_(
          {
            id: reportId,
            reportDate: validated.reportDate,
            startTime: validated.startTime,
            endTime: validated.endTime,
            branchId: targetBranchId,
            category: validated.category,
            activityName: validated.activityName,
            sharingSessionTitle: validated.sharingSessionTitle,
            description: validated.description,
            achievements: validated.achievements,
            issues: validated.issues,
            followUp: validated.followUp,
            status: validated.status,
            reviewNote: validated.reviewNote,
            createdById: values[r][14],
            createdByName: values[r][15],
            createdByRole: values[r][16],
            createdAt: values[r][17],
            updatedAt: now,
            attachmentFileId: attachmentFileId,
            attachmentName: attachmentName,
            attachmentSize: attachmentSize,
          },
          branchesMap
        ),
      });
    }
  }

  return jsonResponse_({ ok: false, error: 'Laporan tidak ditemukan.' });
}

function handleUpdateReportStatus_(token, payload) {
  requireAdmin_(token);
  var reportId = String(payload.id || '');
  var status = String(payload.status || '');
  var reviewNote = String(payload.reviewNote || '').trim().slice(0, 1000);

  if (ALLOWED_STATUSES.indexOf(status) === -1) {
    return jsonResponse_({ ok: false, error: 'Status laporan harus Under Review atau Reviewed.' });
  }

  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  var sheet = getSheetOrThrow_(SHEET_REPORTS);
  var values = sheet.getDataRange().getValues();

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === reportId) {
      var now = new Date().toISOString();
      sheet.getRange(r + 1, 13).setValue(status);
      sheet.getRange(r + 1, 14).setValue(safeCell_(reviewNote));
      sheet.getRange(r + 1, 19).setValue(now);

      return jsonResponse_({
        ok: true,
        data: hydrateReport_(
          {
            id: values[r][0],
            reportDate: values[r][1],
            startTime: values[r][2],
            endTime: values[r][3],
            branchId: values[r][4],
            category: values[r][5],
            activityName: values[r][6],
            sharingSessionTitle: values[r][7],
            description: values[r][8],
            achievements: values[r][9],
            issues: values[r][10],
            followUp: values[r][11],
            status: status,
            reviewNote: reviewNote,
            createdById: values[r][14],
            createdByName: values[r][15],
            createdByRole: values[r][16],
            createdAt: values[r][17],
            updatedAt: now,
            attachmentFileId: values[r][19] || '',
            attachmentName: values[r][20] || '',
            attachmentSize: Number(values[r][21] || 0),
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
      var fileId = String(values[r][19] || '');
      trashDriveFileQuietly_(fileId);
      sheet.deleteRow(r + 1);
      return jsonResponse_({ ok: true, data: { deletedId: reportId } });
    }
  }
  return jsonResponse_({ ok: false, error: 'Laporan tidak ditemukan.' });
}

function handleGetAttachment_(token, payload) {
  var user = requireUser_(token);
  var reportId = String(payload.id || '');
  var rows = readObjects_(SHEET_REPORTS);
  var found = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === reportId) {
      found = rows[i];
      break;
    }
  }
  if (!found) {
    return jsonResponse_({ ok: false, error: 'Laporan tidak ditemukan.' });
  }
  if (user.role === 'leader' && String(found.branchId) !== String(user.branchId)) {
    return jsonResponse_({
      ok: false,
      error: 'Akses ditolak. Anda tidak dapat mengunduh lampiran cabang lain.',
    });
  }

  var fileId = String(found.attachmentFileId || '');
  if (!fileId) {
    return jsonResponse_({ ok: false, error: 'Laporan ini tidak memiliki lampiran PDF.' });
  }

  var file = DriveApp.getFileById(fileId);
  var bytes = file.getBlob().getBytes();
  var base64 = Utilities.base64Encode(bytes);
  return jsonResponse_({
    ok: true,
    data: {
      fileName: String(found.attachmentName || file.getName() || 'lampiran.pdf'),
      dataBase64: base64,
    },
  });
}

/* ==================== KELOLA AKUN (ADMIN ONLY) ==================== */

function handleListUsers_(token) {
  requireAdmin_(token);
  var users = readObjects_(SHEET_USERS).map(toUserProfile_);
  return jsonResponse_({ ok: true, data: users });
}

function handleCreateUser_(token, payload) {
  requireAdmin_(token);
  var role = payload.role === 'admin' ? 'admin' : 'leader';
  var fullName = String(payload.fullName || '').trim();
  var rawSecret = String(payload.secret || '');
  var secret = role === 'leader' ? rawSecret.trim() : rawSecret;
  var identifier =
    role === 'admin' ? normalizeEmail_(payload.identifier) : normalizeUsername_(payload.identifier);
  var branchId = role === 'leader' ? String(payload.branchId || '') : '';

  if (role === 'admin') {
    if (!isValidWmAdminEmail_(identifier)) {
      return jsonResponse_({
        ok: false,
        error: 'Akun Admin wajib menggunakan email ' + ADMIN_EMAIL_DOMAIN + '.',
      });
    }
    if (secret.length < 8) {
      return jsonResponse_({ ok: false, error: 'Password Admin minimal 8 karakter.' });
    }
  } else {
    if (!identifier || identifier.length < 3) {
      return jsonResponse_({ ok: false, error: 'Username Leader minimal 3 karakter.' });
    }
    if (secret.length < 6) {
      return jsonResponse_({ ok: false, error: 'Kode akses Leader minimal 6 karakter.' });
    }
  }

  if (!fullName) {
    return jsonResponse_({ ok: false, error: 'Nama lengkap wajib diisi.' });
  }

  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  if (role === 'leader' && !branchesMap[branchId]) {
    return jsonResponse_({ ok: false, error: 'Leader wajib ditempatkan pada cabang yang valid.' });
  }

  var users = readObjects_(SHEET_USERS);
  var exists = users.some(function (u) {
    return getUserIdentifier_(u).toLowerCase() === identifier.toLowerCase();
  });
  if (exists) {
    return jsonResponse_({
      ok: false,
      error: role === 'admin' ? 'Email Admin sudah terdaftar.' : 'Username Leader sudah terdaftar.',
    });
  }

  var salt = generateRandomHex_(16);
  var hash = hashSecret_(secret, salt);
  var now = new Date().toISOString();
  var id = 'usr-' + Utilities.getUuid().slice(0, 8);

  var sheet = getSheetOrThrow_(SHEET_USERS);
  sheet.appendRow([id, safeCell_(identifier), safeCell_(fullName), role, branchId, salt, hash, now]);

  return jsonResponse_({
    ok: true,
    data: toUserProfile_({
      id: id,
      identifier: identifier,
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

/* ==================== VALIDASI & UTILITAS ==================== */

function validateReportPayload_(payload, role) {
  var reportDate = String(payload.reportDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error('Format tanggal kegiatan harus YYYY-MM-DD.');
  }

  var startTime = String(payload.startTime || '').trim();
  var endTime = String(payload.endTime || '').trim();
  if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    throw new Error('Jam mulai dan jam selesai wajib berformat HH:MM.');
  }
  if (endTime <= startTime) {
    throw new Error('Jam selesai harus lebih akhir daripada jam mulai.');
  }

  var category = String(payload.category || '');
  if (ALLOWED_CATEGORIES.indexOf(category) === -1) {
    throw new Error('Kategori kegiatan tidak valid.');
  }

  var activityName = String(payload.activityName || '').trim();
  if (activityName.length < 3 || activityName.length > 180) {
    throw new Error('Nama kegiatan harus antara 3 hingga 180 karakter.');
  }

  var sharingSessionTitle = '';
  if (category === 'Sharing Session') {
    sharingSessionTitle = String(payload.sharingSessionTitle || '').trim();
    if (sharingSessionTitle.length < 3 || sharingSessionTitle.length > 180) {
      throw new Error('Judul Sharing Session wajib diisi (minimal 3 karakter).');
    }
  }

  var description = String(payload.description || '').trim();
  if (description.length < 5 || description.length > 3000) {
    throw new Error('Uraian kegiatan minimal 5 karakter.');
  }

  var achievements = String(payload.achievements || '').trim();
  if (achievements.length < 3 || achievements.length > 2000) {
    throw new Error('Capaian kegiatan wajib diisi (minimal 3 karakter).');
  }

  var issues = String(payload.issues || '').trim();
  if (issues.length < 3 || issues.length > 2000) {
    throw new Error('Kolom kendala wajib diisi (minimal 3 karakter).');
  }

  var followUp = String(payload.followUp || '').trim();
  if (followUp.length < 3 || followUp.length > 2000) {
    throw new Error('Kolom tindak lanjut wajib diisi (minimal 3 karakter).');
  }

  var status = 'Under Review';
  var reviewNote = '';
  if (role === 'admin') {
    if (payload.status && ALLOWED_STATUSES.indexOf(String(payload.status)) !== -1) {
      status = String(payload.status);
    }
    reviewNote = String(payload.reviewNote || '').trim().slice(0, 1000);
  }

  return {
    reportDate: reportDate,
    startTime: startTime,
    endTime: endTime,
    category: category,
    activityName: activityName,
    sharingSessionTitle: sharingSessionTitle,
    description: description,
    achievements: achievements,
    issues: issues,
    followUp: followUp,
    status: status,
    reviewNote: reviewNote,
  };
}

function getOrCreateAttachmentFolder_() {
  var folders = DriveApp.getFoldersByName(DRIVE_ATTACHMENT_FOLDER);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(DRIVE_ATTACHMENT_FOLDER);
}

function sanitizePdfName_(rawName) {
  var clean = String(rawName || 'lampiran.pdf')
    .replace(/^.*[\\/]/, '')
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 110);
  return clean.toLowerCase().slice(-4) === '.pdf' ? clean : (clean || 'lampiran') + '.pdf';
}

function savePdfAttachmentToDrive_(reportId, attachment) {
  if (!attachment || typeof attachment !== 'object') {
    throw new Error('Lampiran PDF tidak valid.');
  }
  if (String(attachment.mimeType || '').toLowerCase() !== 'application/pdf') {
    throw new Error('Lampiran wajib berformat PDF.');
  }

  var base64 = String(attachment.dataBase64 || '').replace(/\s+/g, '');
  var bytes = Utilities.base64Decode(base64);
  if (!bytes || bytes.length < 5) {
    throw new Error('File PDF kosong atau rusak.');
  }
  if (bytes.length > MAX_PDF_BYTES) {
    throw new Error('Ukuran file PDF maksimal 5 MB.');
  }

  // Validasi header magic bytes %PDF-
  if (
    bytes[0] !== 37 ||
    bytes[1] !== 80 ||
    bytes[2] !== 68 ||
    bytes[3] !== 70 ||
    bytes[4] !== 45
  ) {
    throw new Error('File yang diunggah bukan dokumen PDF yang valid.');
  }

  var safeName = sanitizePdfName_(attachment.fileName);
  var folder = getOrCreateAttachmentFolder_();
  var blob = Utilities.newBlob(bytes, 'application/pdf', reportId + '-' + safeName);
  var file = folder.createFile(blob);

  return {
    fileId: file.getId(),
    fileName: safeName,
    fileSize: bytes.length,
  };
}

function trashDriveFileQuietly_(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (err) {
    // abaikan jika file sudah dihapus manual
  }
}

function formatSheetDate_(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(val || '').replace(/^'/, '');
}

function formatSheetTime_(val) {
  if (val instanceof Date && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(val || '').replace(/^'/, '');
}

function toUserProfile_(u) {
  var branchesMap = indexById_(readObjects_(SHEET_BRANCHES));
  var branch = u.branchId ? branchesMap[String(u.branchId)] : null;
  return {
    id: String(u.id),
    identifier: getUserIdentifier_(u),
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
  var fileName = String(row.attachmentName || '');
  var fileId = String(row.attachmentFileId || '');
  var fileSize = Number(row.attachmentSize || 0);
  return {
    id: String(row.id),
    reportDate: formatSheetDate_(row.reportDate),
    startTime: formatSheetTime_(row.startTime),
    endTime: formatSheetTime_(row.endTime),
    branchId: String(row.branchId),
    branchName: branch ? String(branch.name) : 'Cabang Tidak Dikenal',
    branchCode: branch ? String(branch.code) : '-',
    category: String(row.category),
    activityName: String(row.activityName || ''),
    sharingSessionTitle: String(row.sharingSessionTitle || ''),
    description: String(row.description || ''),
    achievements: String(row.achievements || ''),
    issues: String(row.issues || ''),
    followUp: String(row.followUp || ''),
    hasAttachment: Boolean(fileId && fileName),
    attachmentName: fileName,
    attachmentSize: fileSize,
    status: row.status === 'Reviewed' ? 'Reviewed' : 'Under Review',
    reviewNote: String(row.reviewNote || ''),
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

function normalizeEmail_(val) {
  return String(val || '').trim().toLowerCase();
}

function isValidWmAdminEmail_(email) {
  return (
    /^[a-z0-9._%+-]+@wmcenter\.id$/i.test(email) &&
    email.length <= 120
  );
}

function normalizeUsername_(val) {
  return String(val || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

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

function hashSecret_(secret, salt) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ':' + secret,
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

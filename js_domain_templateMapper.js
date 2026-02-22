/**
 * templateMapper — Pure Excel template detection. No DB, no DOM.
 * Requires SheetJS (window.XLSX) to be loaded.
 */
const templateMapper = (() => {

  const ROSTER_ANCHORS = ['team member','employee','nombre','empleado','roster','name','operador','operator'];
  const HEADER_ANCHORS = ['position','job','puesto','estación','estacion','station','operation','operacion'];
  const TITLE_ANCHORS  = ['skills matrix','matriz de habilidades'];
  const NAME_RE = /^[A-Za-zÀ-ÿ]{2,}(\s[A-Za-zÀ-ÿ\.\-]{1,})+$/;

  // Headers / columns to ignore as "operations"
  const SUMMARY_HEADER_PATTERNS = [
    /^\s*#/,                         // starts with '#'
    /trained\s*jobs/i,
    /jobs\s*\/\s*person/i,
    /operations\s*known/i,
    /known\s*by\s*employee/i,
    /operators?\s*trained/i,
    /trained\s*at\s*level/i,
    /\btarget\b/i,
    /\bgoal\b/i,
    /\btotal\b/i,
    /\bsubtotal\b/i,
    /\bavg\b|\baverage\b/i,
    /\bpercent\b|%/i,
    /^\s*shift\s*$/i,
    /\bshift\b/i
  ];

  function _norm(s) {
    return String(s ?? '').trim();
  }

  function _looksLikeDateHeader(text) {
    const s = _norm(text);
    if (!s) return false;
    const v = s.toLowerCase();

    // Numeric date patterns
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(v)) return true;   // 2/22/26, 02-22-2026
    if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(v)) return true;   // 2026-02-22

    // Month names (Jan, January, etc.)
    if (/(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/.test(v)) return true;

    return false;
  }

  function _isIgnoredOperationHeader(text) {
    const s = _norm(text);
    if (!s) return true;
    if (_looksLikeDateHeader(s)) return true;
    return SUMMARY_HEADER_PATTERNS.some(re => re.test(s));
  }

  function _isPossibleEmployeeName(text) {
    const s = _norm(text);
    if (!s || s.length < 2) return false;
    const v = s.toLowerCase();
    if (v === 'shift') return false;
    if (v.startsWith('#')) return false;
    if (v.includes('trained jobs') || v.includes('operations known') || v.includes('operators trained')) return false;
    // allow common name patterns; fallback to general length check if not matching regex
    return NAME_RE.test(s) || s.length >= 3;
  }

  function _parseSkillLevel(cell) {
    if (!cell) return 0;

    // Prefer raw value; fallback to formatted text (w)
    const raw = (cell.v !== undefined && cell.v !== null && cell.v !== '') ? cell.v : cell.w;
    if (raw === undefined || raw === null) return 0;

    // Numbers
    if (typeof raw === 'number' && isFinite(raw)) {
      // guard against Excel date serials etc.
      if (raw > 10) return 0;
      const n = Math.round(raw);
      if (n >= 0 && n <= 4) return n;
      return 0;
    }

    const s = String(raw).trim();
    if (!s) return 0;

    // L1 / L2 / L3 / L4
    const mL = s.match(/^\s*L\s*([0-4])\s*$/i);
    if (mL) return Number(mL[1]);

    // "3/4" or "3 of 4" -> take first digit
    const mDigit = s.match(/([0-4])/);
    if (mDigit) return Number(mDigit[1]);

    const n = Number(s);
    if (!isNaN(n) && isFinite(n)) {
      if (n > 10) return 0;
      const nn = Math.round(n);
      if (nn >= 0 && nn <= 4) return nn;
    }

    return 0;
  }

  function detectMapping(workbook, options = {}) {
    const minPositions = options.minPositions || 5;
    const minRoster    = options.minRoster    || 5;
    const minRatio     = options.minRatio     || 0.70;

    // Phase 1: Named Ranges
    const p1 = _tryNamedRanges(workbook);
    if (p1) {
      const ws = workbook.Sheets[p1.sheet];
      const validation = _validate(ws, p1, minPositions, minRoster, minRatio);
      return { ...p1, ...validation };
    }

    // Select best sheet
    const sheetName = _selectSheet(workbook, options);
    const ws = workbook.Sheets[sheetName];
    if (!ws) return { valid: false, errors: ['No valid sheet found'], method: 'unknown' };

    // Phase 2: Keyword anchors
    const p2 = _tryKeywords(ws, sheetName);
    if (p2) {
      const validation = _validate(ws, p2, minPositions, minRoster, minRatio);
      if (validation.valid) return { ...p2, ...validation };
      // Fall through to structural but keep p2 if structural also fails
    }

    // Phase 3: Structural
    const p3 = _tryStructural(ws, sheetName);
    const base = p3 || p2 || { sheet: sheetName, headerRow: 0, rosterCol: 0, firstPositionCol: 1, firstRosterRow: 1, method: 'structural' };
    const validation = _validate(ws, base, minPositions, minRoster, minRatio);
    return { ...base, ...validation };
  }

  function _tryNamedRanges(wb) {
    const names = wb.Workbook && wb.Workbook.Names;
    if (!names) return null;
    const find = (n) => names.find(x => x.Name.toLowerCase() === n.toLowerCase());
    const ms = find('Matrix_Start');
    const rs = find('Roster_Start');
    const hr = find('Header_Row');
    const fp = find('First_Position_Col');
    if (!ms || !rs || !hr || !fp) return null;
    try {
      const sheet = ms.Ref.split('!')[0].replace(/'/g, '');
      const headerRow = parseInt(hr.Ref.match(/\d+/)[0]) - 1;
      const rosterCol = XLSX.utils.decode_col(rs.Ref.match(/[A-Z]+/)[0]);
      const firstPositionCol = XLSX.utils.decode_col(fp.Ref.match(/[A-Z]+/)[0]);
      const firstRosterRow = XLSX.utils.decode_row(ms.Ref.match(/\d+/)[0]) ;
      return { sheet, headerRow, rosterCol, firstPositionCol, firstRosterRow, method: 'named_ranges' };
    } catch(e) { return null; }
  }

    function _selectSheet(wb, options = {}) {
    // Explicit sheet override
    if (options.sheetName && wb.Sheets[options.sheetName]) return options.sheetName;

    // Prefer sheet by shift hint if provided (common patterns: '1st', '2nd', '3rd', 'A', 'B')
    const shiftHint = (options.shift || '').toString().toLowerCase().trim();
    const shiftTokens = [];
    if (shiftHint) {
      // normalize common shift values
      if (['1','1st','first','shift 1','1st shift'].includes(shiftHint)) shiftTokens.push('1st', 'first', 'shift 1', '1');
      else if (['2','2nd','second','shift 2','2nd shift'].includes(shiftHint)) shiftTokens.push('2nd', 'second', 'shift 2', '2');
      else if (['3','3rd','third','shift 3','3rd shift'].includes(shiftHint)) shiftTokens.push('3rd', 'third', 'shift 3', '3');
      else shiftTokens.push(shiftHint);
    }

    let best = wb.SheetNames[0], bestScore = -1;

    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      let score = 0;

      const lname = (name || '').toString().toLowerCase();
      if (shiftTokens.length && shiftTokens.some(t => lname.includes(t))) score += 25;

      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      for (let r = 0; r <= Math.min(39, range.e.r); r++) {
        for (let c = 0; c <= Math.min(15, range.e.c); c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
          const v = String(cell.v).toLowerCase().trim();
          if ([...ROSTER_ANCHORS, ...HEADER_ANCHORS, ...TITLE_ANCHORS].some(a => v.includes(a))) score += 10;
        }
      }

      if (score > bestScore) { bestScore = score; best = name; }
    });

    return best;
  }

  function _tryKeywords(ws, sheetName) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    let headerRow = -1, rosterCol = -1, hScore = -1, rScore = -1;

    for (let r = 0; r <= Math.min(39, range.e.r); r++) {
      let rowScore = 0, nameCount = 0;
      for (let c = 0; c <= Math.min(15, range.e.c); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || !cell.v) continue;
        const v = String(cell.v).toLowerCase().trim();
        HEADER_ANCHORS.forEach(a => { if (v.includes(a)) rowScore += 5; });
        ROSTER_ANCHORS.forEach(a => { if (v.includes(a)) rowScore += 8; });
        if (NAME_RE.test(String(cell.v).trim())) nameCount++;
      }
      if (rowScore > hScore) { hScore = rowScore; headerRow = r; }
    }
    if (headerRow < 0) return null;

    // Find roster col: most name-pattern matches in rows below header
    for (let c = 0; c <= Math.min(10, range.e.c); c++) {
      let score = 0;
      for (let r = headerRow + 1; r <= Math.min(headerRow + 40, range.e.r); r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v && NAME_RE.test(String(cell.v).trim())) score++;
      }
      if (score > rScore) { rScore = score; rosterCol = c; }
    }
    if (rosterCol < 0) return null;

    // First position col: first non-empty text cell right of roster in header row
    let firstPositionCol = rosterCol + 1;
    for (let c = rosterCol + 1; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
      if (cell && cell.v && typeof cell.v === 'string' && cell.v.trim()) { firstPositionCol = c; break; }
    }

    // First roster row
    let firstRosterRow = headerRow + 1;
    for (let r = headerRow + 1; r <= Math.min(headerRow + 10, range.e.r); r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: rosterCol })];
      if (cell && cell.v && String(cell.v).trim().length >= 2) { firstRosterRow = r; break; }
    }

    return { sheet: sheetName, headerRow, rosterCol, firstPositionCol, firstRosterRow, method: 'keyword' };
  }

  function _tryStructural(ws, sheetName) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    let headerRow = 0, bestTextCount = -1;

    for (let r = 0; r <= Math.min(29, range.e.r); r++) {
      let total = 0, textCount = 0;
      for (let c = 0; c <= Math.min(range.e.c, 30); c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || !cell.v) continue;
        total++;
        if (typeof cell.v === 'string') textCount++;
      }
      if (total > 3 && textCount / total >= 0.5 && textCount > bestTextCount) {
        bestTextCount = textCount; headerRow = r;
      }
    }

    let rosterCol = 0, bestNames = -1;
    for (let c = 0; c <= Math.min(9, range.e.c); c++) {
      let names = 0;
      for (let r = headerRow + 1; r <= Math.min(headerRow + 40, range.e.r); r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v && NAME_RE.test(String(cell.v).trim())) names++;
      }
      if (names > bestNames) { bestNames = names; rosterCol = c; }
    }

    let firstPositionCol = rosterCol + 1;
    for (let c = rosterCol + 1; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
      if (cell && cell.v && String(cell.v).trim()) { firstPositionCol = c; break; }
    }

    return { sheet: sheetName, headerRow, rosterCol, firstPositionCol, firstRosterRow: headerRow + 1, method: 'structural' };
  }

  function _validate(ws, mapping, minPositions, minRoster, minRatio) {
    if (!ws) return { valid: false, errors: ['Worksheet not found'], positionHeaders: 0, rosterEntries: 0, skillRatio: 0 };
    const { headerRow, rosterCol, firstPositionCol, firstRosterRow } = mapping;
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');

    // Count positions
    let positionHeaders = 0, lastPosCol = firstPositionCol;
    let consecutive = 0;
    for (let c = firstPositionCol; c <= range.e.c && consecutive < 3; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
      if (cell && cell.v && String(cell.v).trim()) { positionHeaders++; consecutive = 0; lastPosCol = c; }
      else consecutive++;
    }

    // Count roster entries
    let rosterEntries = 0;
    consecutive = 0;
    for (let r = firstRosterRow; r <= range.e.r && consecutive < 3; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: rosterCol })];
      if (cell && cell.v && String(cell.v).trim().length >= 2) { rosterEntries++; consecutive = 0; }
      else consecutive++;
    }

    // Skill ratio
    let total = 0, valid = 0;
    for (let r = firstRosterRow; r <= Math.min(firstRosterRow + rosterEntries, range.e.r); r++) {
      for (let c = firstPositionCol; c <= lastPosCol; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell || !cell.v) { valid++; total++; continue; }
        total++;
        const n = Number(cell.v);
        if (!isNaN(n) && n >= 0 && n <= 4) valid++;
      }
    }
    const skillRatio = total > 0 ? valid / total : 1;

    const errors = [];
    if (positionHeaders < minPositions) errors.push(`Only ${positionHeaders} position headers found (need ${minPositions}+)`);
    if (rosterEntries < minRoster)      errors.push(`Only ${rosterEntries} roster entries found (need ${minRoster}+)`);
    if (skillRatio < minRatio)          errors.push(`Skill area ratio ${Math.round(skillRatio*100)}% (need ${Math.round(minRatio*100)}%+)`);

    return { valid: errors.length === 0, errors, positionHeaders, rosterEntries, skillRatio };
  }

  function extractData(ws, mapping) {
    const { headerRow, rosterCol, firstPositionCol, firstRosterRow } = mapping;
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');

    const positions = [];
    let consecutive = 0;
    for (let c = firstPositionCol; c <= range.e.c && consecutive < 3; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRow, c })];
      const name = (cell && (cell.v !== undefined && cell.v !== null)) ? String(cell.v).trim() : '';
      if (name) {
        if (!_isIgnoredOperationHeader(name)) {
          positions.push({ col: c, name });
        }
        // Treat ignored headers as "present" so we keep scanning
        consecutive = 0;
      } else {
        consecutive++;
      }
    }

    const employees = [];
    consecutive = 0;
    for (let r = firstRosterRow; r <= range.e.r && consecutive < 3; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: rosterCol })];
      const name = (cell && (cell.v !== undefined && cell.v !== null)) ? String(cell.v).trim() : '';
      if (name) {
        if (_isPossibleEmployeeName(name)) {
          employees.push({ row: r, name });
          consecutive = 0;
        } else {
          // Not an employee name (e.g., 'Shift', KPI row) — keep scanning
          consecutive = 0;
        }
      } else {
        consecutive++;
      }
    }

    const skills = [];
    employees.forEach(emp => {
      positions.forEach(pos => {
        const cell = ws[XLSX.utils.encode_cell({ r: emp.row, c: pos.col })];
        const level = _parseSkillLevel(cell);
        if (level > 0) skills.push({ empName: emp.name, posName: pos.name, level });
      });
    });

    return { positions, employees, skills };
  }

  function writeExport(workbook, mapping, exportData) {
    const { sheet, headerRow, rosterCol, firstPositionCol, firstRosterRow } = mapping;
    const ws = workbook.Sheets[sheet];
    if (!ws) return workbook;

    const { employees, positions, skills } = exportData;
    const skillMap = {};
    skills.forEach(s => { skillMap[`${s.empId}_${s.posId}`] = s.level; });

    // Write position headers
    positions.forEach((pos, pi) => {
      const addr = XLSX.utils.encode_cell({ r: headerRow, c: firstPositionCol + pi });
      const existing = ws[addr];
      if (existing) { existing.v = pos.name; existing.w = pos.name; }
      else ws[addr] = { t: 's', v: pos.name };
    });

    // Write roster + skills
    employees.forEach((emp, ei) => {
      const rosterAddr = XLSX.utils.encode_cell({ r: firstRosterRow + ei, c: rosterCol });
      const existingRoster = ws[rosterAddr];
      if (existingRoster) { existingRoster.v = emp.name; existingRoster.w = emp.name; }
      else ws[rosterAddr] = { t: 's', v: emp.name };

      positions.forEach((pos, pi) => {
        const cellAddr = XLSX.utils.encode_cell({ r: firstRosterRow + ei, c: firstPositionCol + pi });
        const level = skillMap[`${emp.id}_${pos.id}`] || 0;
        const existing = ws[cellAddr];
        if (existing) { existing.v = level; existing.w = String(level); existing.t = 'n'; }
        else ws[cellAddr] = { t: 'n', v: level };
      });
    });

    // Update range
    const lastRow = firstRosterRow + employees.length - 1;
    const lastCol = firstPositionCol + positions.length - 1;
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });

    return workbook;
  }

  function validateOnly(ws, mapping, options = {}) {
    const minPositions = options.minPositions || 5;
    const minRoster    = options.minRoster    || 5;
    const minRatio     = options.minRatio     || 0.70;
    return _validate(ws, mapping, minPositions, minRoster, minRatio);
  }

  return { detect: detectMapping, detectMapping, extractData, writeExport, validateOnly };
})();

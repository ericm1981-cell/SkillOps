/**
 * templateMapper — Pure Excel template detection. No DB, no DOM.
 * Requires SheetJS (window.XLSX) to be loaded.
 */
const templateMapper = (() => {

  const ROSTER_ANCHORS = ['team member','employee','nombre','empleado','roster','name','operador','operator'];
  const HEADER_ANCHORS = ['position','job','puesto','estación','estacion','station','operation','operacion'];
  const TITLE_ANCHORS  = ['skills matrix','matriz de habilidades'];
  const NAME_RE = /^[A-Za-zÀ-ÿ]{2,}(\s[A-Za-zÀ-ÿ\.\-]{1,})+$/;

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
    const sheetName = _selectSheet(workbook);
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

  function _selectSheet(wb) {
    let best = wb.SheetNames[0], bestScore = -1;
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      let score = 0;
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
      for (let r = 0; r <= Math.min(39, range.e.r); r++) {
        for (let c = 0; c <= Math.min(15, range.e.c); c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (!cell || !cell.v) continue;
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
      if (cell && cell.v && String(cell.v).trim()) {
        positions.push({ col: c, name: String(cell.v).trim() });
        consecutive = 0;
      } else consecutive++;
    }

    const employees = [];
    consecutive = 0;
    for (let r = firstRosterRow; r <= range.e.r && consecutive < 3; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: rosterCol })];
      if (cell && cell.v && String(cell.v).trim().length >= 2) {
        employees.push({ row: r, name: String(cell.v).trim() });
        consecutive = 0;
      } else consecutive++;
    }

    const skills = [];
    employees.forEach(emp => {
      positions.forEach(pos => {
        const cell = ws[XLSX.utils.encode_cell({ r: emp.row, c: pos.col })];
        if (cell && cell.v !== undefined) {
          const level = Math.min(4, Math.max(0, Math.round(Number(cell.v))));
          if (!isNaN(level) && level > 0) skills.push({ empName: emp.name, posName: pos.name, level });
        }
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

  return { detectMapping, extractData, writeExport, validateOnly };
})();

/**
 * DB — IndexedDB wrapper with in-memory fallback.
 *
 * If IndexedDB is unavailable (private mode, file:// restriction, blocked),
 * all operations transparently use an in-memory store for the session.
 * window.__DB_WARN(reason) is called to show a visible banner.
 */
const DB = (() => {
  const NAME    = 'SkillsMatrixDB';
  const VERSION = 3;
  let _db       = null;
  let _memMode  = false;

  /* ── In-memory store ──────────────────────────────────────────── */
  const _mem    = {};
  let   _memSeq = 1;

  const SCHEMA = [
    { name: 'lines',        opts: { keyPath: 'id', autoIncrement: true },  indexes: [] },
    { name: 'employees',    opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',       kp: 'lineId',                    opts: {} },
        { name: 'role',         kp: 'role',                      opts: {} },
        { name: 'lineRole',     kp: ['lineId','role'],           opts: {} },
        { name: 'lineActive',   kp: ['lineId','active'],         opts: {} },
        { name: 'lineNormName', kp: ['lineId','normalizedName'], opts: { unique: true } },
      ]
    },
    { name: 'positions',    opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',       kp: 'lineId',                    opts: {} },
        { name: 'lineCritical', kp: ['lineId','critical'],       opts: {} },
        { name: 'lineNormName', kp: ['lineId','normalizedName'], opts: { unique: true } },
      ]
    },
    { name: 'skillRecords', opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',     kp: 'lineId',                      opts: {} },
        { name: 'employeeId', kp: 'employeeId',                  opts: {} },
        { name: 'positionId', kp: 'positionId',                  opts: {} },
        { name: 'empPos',     kp: ['employeeId','positionId'],   opts: { unique: true } },
      ]
    },
    { name: 'trainingLogs', opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',             kp: 'lineId',                      opts: {} },
        { name: 'employeeId',         kp: 'employeeId',                  opts: {} },
        { name: 'positionId',         kp: 'positionId',                  opts: {} },
        { name: 'timestamp',          kp: 'timestamp',                   opts: {} },
        { name: 'lineTimestamp',      kp: ['lineId','timestamp'],        opts: {} },
        { name: 'lineServerReceived', kp: ['lineId','serverReceivedAt'], opts: {} },
        { name: 'syncedToAuthority',  kp: 'syncedToAuthority',          opts: {} },
        { name: 'clientId',           kp: 'clientId',                    opts: { unique: true } },
        { name: 'employeeResolved',   kp: 'employeeResolved',            opts: {} },
      ]
    },
    { name: 'attendance',   opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',     kp: 'lineId',              opts: {} },
        { name: 'employeeId', kp: 'employeeId',          opts: {} },
        { name: 'date',       kp: 'date',                opts: {} },
        { name: 'empDate',    kp: ['employeeId','date'], opts: { unique: true } },
        { name: 'lineDate',   kp: ['lineId','date'],     opts: {} },
      ]
    },
    { name: 'rotationPlans', opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',   kp: 'lineId',          opts: {} },
        { name: 'date',     kp: 'date',             opts: {} },
        { name: 'lineDate', kp: ['lineId','date'],  opts: {} },
      ]
    },
    { name: 'auditLogs',    opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',       kp: 'lineId',                  opts: {} },
        { name: 'positionId',   kp: 'positionId',              opts: {} },
        { name: 'supervisorId', kp: 'supervisorId',            opts: {} },
        { name: 'date',         kp: 'date',                    opts: {} },
        { name: 'supDate',      kp: ['supervisorId','date'],   opts: {} },
        { name: 'lineSuper',    kp: ['lineId','supervisorId'], opts: {} },
      ]
    },
    { name: 'templateMappings', opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId', kp: 'lineId', opts: { unique: true } },
      ]
    },
    { name: 'pendingRecommendations', opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'lineId',            kp: 'lineId',                    opts: {} },
        { name: 'employeeId',        kp: 'employeeId',                opts: {} },
        { name: 'positionId',        kp: 'positionId',                opts: {} },
        { name: 'status',            kp: 'status',                    opts: {} },
        { name: 'lineStatus',        kp: ['lineId','status'],         opts: {} },
        { name: 'empPos',            kp: ['employeeId','positionId'], opts: {} },
        { name: 'clientId',          kp: 'clientId',                  opts: { unique: true } },
        { name: 'syncedToAuthority', kp: 'syncedToAuthority',        opts: {} },
      ]
    },
    { name: 'users',    opts: { keyPath: 'id', autoIncrement: true },
      indexes: [
        { name: 'role',   kp: 'role',   opts: {} },
        { name: 'active', kp: 'active', opts: {} },
      ]
    },
    { name: 'devices',  opts: { keyPath: 'id' },
      indexes: [
        { name: 'role',   kp: 'role',   opts: {} },
        { name: 'lineId', kp: 'lineId', opts: {} },
      ]
    },
    { name: 'appSettings', opts: { keyPath: 'key' }, indexes: [] },
  ];

  // Index definitions for memory-mode queries
  const _indexDefs = {};
  SCHEMA.forEach(s => {
    _indexDefs[s.name] = {};
    (s.indexes || []).forEach(idx => { _indexDefs[s.name][idx.name] = idx.kp; });
  });

  /* ── open() with 3s timeout and in-memory fallback ───────────── */
  function open() {
    if (_memMode)              return Promise.resolve(null);
    if (_db)                   return Promise.resolve(_db);
    if (!window.indexedDB)     return _toMemory('IndexedDB not supported in this browser/mode');

    return new Promise((resolve, reject) => {
      let done = false;
      function settle(val, err) {
        if (done) return; done = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(val);
      }

      const timer = setTimeout(() =>
        settle(null, new Error('IndexedDB open timed out (3 s) — may be blocked or corrupted')),
        3000
      );

      let req;
      try { req = indexedDB.open(NAME, VERSION); }
      catch(e) { settle(null, e); return; }

      req.onblocked = () =>
        settle(null, new Error('IndexedDB blocked — close other tabs with this app open'));

      req.onupgradeneeded = e => {
        try {
          const d  = e.target.result;
          const tx = e.target.transaction;
          SCHEMA.forEach(s => {
            let store;
            if (!d.objectStoreNames.contains(s.name)) {
              store = d.createObjectStore(s.name, s.opts);
            } else {
              store = tx.objectStore(s.name);
            }
            (s.indexes || []).forEach(idx => {
              if (!store.indexNames.contains(idx.name)) {
                try { store.createIndex(idx.name, idx.kp, idx.opts); }
                catch(ie) { console.warn('[DB] index:', idx.name, ie.message); }
              }
            });
          });
        } catch(ue) { settle(null, ue); }
      };

      req.onsuccess = e => { _db = e.target.result; settle(_db); };
      req.onerror   = e => settle(null, e.target.error);
    }).catch(err => {
      console.warn('[DB] Falling back to memory mode:', err.message);
      return _toMemory(err.message);
    });
  }

  function _toMemory(reason) {
    _memMode = true; _db = null;
    if (typeof window.__DB_WARN === 'function') window.__DB_WARN(reason);
    return Promise.resolve(null);
  }

  /* ── Memory helpers ──────────────────────────────────────────── */
  function _kp(storeName) {
    const s = SCHEMA.find(x => x.name === storeName);
    return s ? s.opts.keyPath : 'id';
  }
  function _mmap(n) { if (!_mem[n]) _mem[n] = new Map(); return _mem[n]; }

  function _mGet(sn, key) {
    const k = _kp(sn) === 'key' ? String(key) : Number(key);
    return _mmap(sn).get(k);
  }
  function _mGetAll(sn) { return Array.from(_mmap(sn).values()); }

  function _mMatch(sn, indexName, query) {
    const kp  = _indexDefs[sn]?.[indexName];
    if (!kp) return [];
    return _mGetAll(sn).filter(rec => {
      const rv = Array.isArray(kp) ? kp.map(k => rec[k]) : rec[kp];
      if (query == null) return true;
      // IDBKeyRange.only(x) has lower===upper===x
      const cmp = (query && typeof query === 'object' && 'lower' in query)
        ? query.lower : query;
      if (Array.isArray(cmp) && Array.isArray(rv))
        return cmp.every((v, i) => String(rv[i]) === String(v));
      if (Array.isArray(rv))
        return String(rv) === String(cmp);
      return rv === cmp || String(rv) === String(cmp);
    });
  }

  function _mPut(sn, data) {
    const k = _kp(sn);
    if (k === 'key') { _mmap(sn).set(String(data[k]), data); return data[k]; }
    const id = (data[k] != null) ? Number(data[k]) : _memSeq++;
    const rec = { ...data, [k]: id };
    _mmap(sn).set(id, rec);
    return id;
  }

  function _mAdd(sn, data) {
    const k = _kp(sn);
    if (k === 'key') { _mmap(sn).set(String(data[k]), data); return data[k]; }
    if (data[k] != null && _mmap(sn).has(Number(data[k]))) {
      const e = new Error('ConstraintError'); e.name = 'ConstraintError'; throw e;
    }
    return _mPut(sn, data);
  }

  /* ── Public API ──────────────────────────────────────────────── */
  function get(sn, key) {
    return open().then(() =>
      _memMode ? _mGet(sn, key) :
      new Promise((res, rej) => {
        const r = _db.transaction(sn).objectStore(sn).get(key);
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      })
    );
  }

  function getAll(sn) {
    return open().then(() =>
      _memMode ? _mGetAll(sn) :
      new Promise((res, rej) => {
        const r = _db.transaction(sn).objectStore(sn).getAll();
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      })
    );
  }

  function getAllByIndex(sn, idx, query) {
    return open().then(() =>
      _memMode ? _mMatch(sn, idx, query) :
      new Promise((res, rej) => {
        const r = _db.transaction(sn).objectStore(sn).index(idx).getAll(query);
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      })
    );
  }

  function getByIndex(sn, idx, query) {
    return open().then(() =>
      _memMode ? (_mMatch(sn, idx, query)[0] ?? undefined) :
      new Promise((res, rej) => {
        const r = _db.transaction(sn).objectStore(sn).index(idx).get(query);
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      })
    );
  }

  function put(sn, data) {
    return open().then(() =>
      _memMode ? _mPut(sn, data) :
      new Promise((res, rej) => {
        const r = _db.transaction(sn, 'readwrite').objectStore(sn).put(data);
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      })
    );
  }

  function add(sn, data) {
    return open().then(() =>
      _memMode ? _mAdd(sn, data) :
      new Promise((res, rej) => {
        const r = _db.transaction(sn, 'readwrite').objectStore(sn).add(data);
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      })
    );
  }

  function remove(sn, key) {
    return open().then(() => {
      if (_memMode) { _mmap(sn).delete(Number(key)); return; }
      return new Promise((res, rej) => {
        const r = _db.transaction(sn, 'readwrite').objectStore(sn).delete(key);
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      });
    });
  }

  function clear(sn) {
    return open().then(() => {
      if (_memMode) { _mmap(sn).clear(); return; }
      return new Promise((res, rej) => {
        const r = _db.transaction(sn, 'readwrite').objectStore(sn).clear();
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      });
    });
  }

  async function getSetting(key, defaultVal = null) {
    const rec = await get('appSettings', key);
    return (rec !== undefined && rec !== null) ? rec.value : defaultVal;
  }

  function setSetting(key, value) {
    return put('appSettings', { key, value });
  }

  async function upsertAttendance(data) {
    if (_memMode) {
      const ex = _mMatch('attendance', 'empDate', [data.employeeId, data.date])[0];
      return ex ? _mPut('attendance', { ...data, id: ex.id }) : _mAdd('attendance', data);
    }
    await open();
    return new Promise((res, rej) => {
      const tx   = _db.transaction('attendance', 'readwrite');
      const st   = tx.objectStore('attendance');
      const find = st.index('empDate').getKey(IDBKeyRange.only([data.employeeId, data.date]));
      find.onsuccess = e => {
        const eid = e.target.result;
        const rec = eid !== undefined ? { ...data, id: eid } : data;
        const pr  = st.put(rec);
        pr.onsuccess = ev => res(ev.target.result);
        pr.onerror   = ev => rej(ev.target.error);
      };
      find.onerror = e => rej(e.target.error);
    });
  }

  async function batchUpsertAttendance(records) {
    if (_memMode) { for (const r of records) await upsertAttendance(r); return records; }
    await open();
    return new Promise((res, rej) => {
      const tx   = _db.transaction('attendance', 'readwrite');
      const st   = tx.objectStore('attendance');
      const idx  = st.index('empDate');
      const out  = [];
      records.forEach(data => {
        const find = idx.getKey(IDBKeyRange.only([data.employeeId, data.date]));
        find.onsuccess = e => {
          const eid = e.target.result;
          const rec = eid !== undefined ? { ...data, id: eid } : data;
          st.put(rec).onsuccess = ev => out.push(ev.target.result);
        };
      });
      tx.oncomplete = () => res(out);
      tx.onerror    = e  => rej(e.target.error);
    });
  }

  async function upsertByIndex(sn, indexName, keyValue, data) {
    if (_memMode) {
      const ex = _mMatch(sn, indexName, keyValue)[0];
      if (ex) return _mPut(sn, { ...data, [_kp(sn)]: ex[_kp(sn)] });
      return _mAdd(sn, data);
    }
    await open();
    return new Promise((res, rej) => {
      const tx    = _db.transaction(sn, 'readwrite');
      const st    = tx.objectStore(sn);
      const query = Array.isArray(keyValue) ? IDBKeyRange.only(keyValue) : keyValue;
      const find  = st.index(indexName).getKey(query);
      find.onsuccess = e => {
        const eid = e.target.result;
        const rec = eid !== undefined ? { ...data, id: eid } : data;
        const pr  = st.put(rec);
        pr.onsuccess = ev => res(ev.target.result);
        pr.onerror   = ev => rej(ev.target.error);
      };
      find.onerror = e => rej(e.target.error);
    });
  }

  function dropDatabase() {
    if (_memMode) { Object.keys(_mem).forEach(k => delete _mem[k]); return Promise.resolve(); }
    return new Promise((res, rej) => {
      if (_db) { _db.close(); _db = null; }
      const req = indexedDB.deleteDatabase(NAME);
      req.onsuccess = () => res();
      req.onerror   = e => rej(e.target.error);
    });
  }

  return {
    open, get, getAll, getAllByIndex, getByIndex, put, add, remove, clear,
    getSetting, setSetting, upsertAttendance, batchUpsertAttendance,
    upsertByIndex, dropDatabase, NAME,
    get isMemoryMode() { return _memMode; }
  };
})();

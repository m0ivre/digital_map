// Kleiner IndexedDB-Wrapper für gespeicherte Karten
'use strict';

const DB_NAME = 'georef-standort-db';
const DB_VERSION = 1;
const STORE = 'maps';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function dbTx(mode) {
  const db = await openDatabase();
  const tx = db.transaction(STORE, mode);
  return { tx, store: tx.objectStore(STORE) };
}

async function saveMap(mapRecord) {
  const { tx, store } = await dbTx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(mapRecord);
    req.onsuccess = () => resolve(mapRecord);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllMaps() {
  const { store } = await dbTx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getMap(id) {
  const { store } = await dbTx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteMap(id) {
  const { tx, store } = await dbTx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

function makeId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'map-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

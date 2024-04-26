// piniaPersist.js
"use strict";

import { showSistemError } from "@/utils/methods";

function isObject(v) {
    return typeof v === "object" && v !== null;
}

function normalizeOptions(options, factoryOptions) {
    options = isObject(options) ? options : Object.create(null);
    return new Proxy(options, {
        get(target, key, receiver) {
            if (key === "key")
                return Reflect.get(target, key, receiver);
            return Reflect.get(target, key, receiver) || Reflect.get(factoryOptions, key, receiver);
        }
    });
}

function get(state, path) {
    return path.reduce((obj, p) => {
        return obj == null ? undefined : obj[p];
    }, state);
}

function set(state, path, val) {
    return path.slice(0, -1).reduce((obj, p) => {
        if (/^(__proto__)$/.test(p))
        return {};
        else
        return obj[p] = obj[p] || {};
    }, state)[path[path.length - 1]] = val, state;
}

function pick(baseState, paths) {
    return paths.reduce((substate, path) => {
        const pathArray = path.split(".");
        return set(substate, pathArray, get(baseState, pathArray));
    }, {});
}

function excludeItems(baseState, excludes){
    const filteredState = { ...baseState };
    excludes.forEach((excludedKey) => {
        delete filteredState[excludedKey];
    });
    return filteredState;
}

let indexedDBInstance;

async function openIndexedDB() {
    // showSistemMsg('Opening IndexedDB...');
    if (!indexedDBInstance) {
        // showSistemMsg('Creating new IndexedDB instance...');
        indexedDBInstance = new Promise((resolve, reject) => {
            try {
                const request = window.indexedDB.open('piniaPersistedState', 1);

                request.onupgradeneeded = (event) => {
                    showSistemMsg('Upgrade needed, creating object store...');
                    const db = event.target.result;
                    db.createObjectStore('piniaPersistedState');
                };

                request.onsuccess = (event) => {
                    showSistemMsg('IndexedDB opened successfully.');
                    resolve(event.target.result);
                };

                request.onerror = (event) => {
                    showSistemError({msg: 'Error opening IndexedDB:', event});
                    reject(event);
                };
            } catch (error) {
                showSistemError({msg: 'Error opening IndexedDB:', error});
                reject(error);
            }
        });
    }
    return indexedDBInstance;
}

async function hydrateStore(store, { serializer, key, debug }) {
    try {
        // showSistemMsg('Hydrating store from IndexedDB...');
        const db = await openIndexedDB();
        const transaction = db.transaction(['piniaPersistedState'], 'readonly');
        const objectStore = transaction.objectStore('piniaPersistedState');
        const request = objectStore.get(key);
  
        request.onsuccess = (event) => {
            const fromStorage = event.target.result;
            if (fromStorage) {
                // showSistemMsg('Hydration successful. Updating store state...');
                store.$patch(serializer == null ? void 0 : serializer.deserialize(fromStorage));
            } 
            // else {
            //     showSistemMsg('No data found in IndexedDB for key:', key);
            // }
        };
    } catch (error) {
        showSistemError({msg: 'Error hydrating store from IndexedDB:', error});
        throw error; // Re-lanzar el error para que sea manejado por el código que llamó a esta función, si es necesario.
    }
}

async function persistState(state, { serializer, key, debug }) {
    try {
        // showSistemMsg('Persisting store state to IndexedDB...');
        const db = await openIndexedDB();
        const transaction = db.transaction(['piniaPersistedState'], 'readwrite');
        const objectStore = transaction.objectStore('piniaPersistedState');
        objectStore.put(serializer.serialize(state), key);
    } catch (error) {
        showSistemError({msg: 'Error persisting store state to IndexedDB:', error});
        if (debug) console.error(error);
        throw error; // Re-lanzar el error para que sea manejado por el código que llamó a esta función, si es necesario.

    }
}

async function clearIndexedDB() {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction(['piniaPersistedState'], 'readwrite');
        const objectStore = transaction.objectStore('piniaPersistedState');
        objectStore.clear();
        showSistemMsg('IndexedDB cleared successfully.');
    } catch (error) {
        showSistemError({msg: 'Error clearing IndexedDB:', error});
        throw error;
    }
}

async function clearIndexedDBStore(store) {
    try {
        const db = await openIndexedDB();
        const transaction = db.transaction(['piniaPersistedState'], 'readwrite');
        const objectStore = transaction.objectStore('piniaPersistedState');
        
        // Obtén el nombre del almacén específico para el store
        const storeId = store.$id;

        // Elimina el almacén específico
        objectStore.delete(storeId);

        showSistemMsg(`IndexedDB store (${storeId}) cleared successfully.`);
    } catch (error) {
        showSistemError({ msg: 'Error clearing IndexedDB store:', error });
        throw error;
    }
}

export function createPersistedState(factoryOptions = {}) {
    return (context) => {
        const { auto = false } = factoryOptions;
        const {
            options: { persist = auto },
            store,
            pinia
        } = context;
        if (!persist) return;
        if (!(store.$id in pinia.state.value)) {
            const original_store = pinia._s.get(store.$id.replace("__hot:", ""));
            if (original_store) Promise.resolve().then(() => original_store.$persist());
            return;
        }

        const persistences = (Array.isArray(persist) ? persist.map((p) => normalizeOptions(p, factoryOptions)) : [normalizeOptions(persist, factoryOptions)]).map(
        ({
            storage = localStorage,
            beforeRestore = null,
            afterRestore = null,
            serializer = {
                serialize: JSON.stringify,
                deserialize: JSON.parse
            },
            key = store.$id,
            paths = null,
            excludes = null,
            debug = false
        }) => {
            var _a;
            return {
                storage,
                beforeRestore,
                afterRestore,
                serializer,
                key: ((_a = factoryOptions.key) != null ? _a : (k) => k)(typeof key == "string" ? key : key(store.$id)),
                paths,
                excludes,
                debug
            };
        }
        );
        store.$persist = () => {
            persistences.forEach((persistence) => {
                persistState(store.$state, persistence);
            });
        };
        store.$hydrate = ({ runHooks = true } = {}) => {
            persistences.forEach((persistence) => {
                const { beforeRestore, afterRestore } = persistence;
                if (runHooks)
                beforeRestore == null ? undefined : beforeRestore(context);
                hydrateStore(store, persistence);
                if (runHooks)
                afterRestore == null ? undefined : afterRestore(context);
            });
        };
        store.$clearIndexedDBStore = (store) => {
            clearIndexedDBStore(store);
        };
        store.$clearIndexedDB = () => {
            persistences.forEach(async (persistence) => {
                await clearIndexedDB(persistence);
            });
        };
        store.$persistActive = true;
        persistences.forEach((persistence) => {
            const { beforeRestore, afterRestore } = persistence;
            beforeRestore == null ? undefined : beforeRestore(context);
            hydrateStore(store, persistence);
            afterRestore == null ? undefined : afterRestore(context);
            store.$subscribe(
                (_mutation, state) => {
                    if (persistence.paths) {
                        // Si paths está definido, persiste solo las variables especificadas en paths
                        const subsetState = pick(state, persistence.paths);
                        persistState(subsetState, persistence);
                    } else if (persistence.excludes) {
                        // Si excludes está definido, persiste todo el state excepto las variables especificadas en excludes
                        const subsetState = excludeItems(state, persistence.excludes);
                        persistState(subsetState, persistence);
                    } else {
                        // Si key es true, persiste el state completo
                        persistState(state, persistence);
                    }
                },
                {
                    detached: true
                }
            );
        });
    };
}

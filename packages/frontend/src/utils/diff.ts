export interface DiffItem {
  path: string[];
  type: 'CHANGE' | 'ADD' | 'REMOVE';
  oldValue?: any;
  newValue?: any;
}

function isObject(val: any) {
  return val != null && typeof val === 'object' && !Array.isArray(val);
}

function isEmptyValue(val: any) {
  return (
    val == null ||
    (Array.isArray(val) && val.length === 0) ||
    (isObject(val) && Object.keys(val).length === 0)
  );
}

export function sortKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  if (isObject(obj)) {
    return Object.keys(obj)
      .sort()
      .reduce((sortedObj: any, key) => {
        sortedObj[key] = sortKeys(obj[key]);
        return sortedObj;
      }, {});
  }
  return obj;
}

export function getObjectDiff(
  obj1: any,
  obj2: any,
  path: string[] = []
): DiffItem[] {
  const diffs: DiffItem[] = [];

  const ignoredKeys = new Set([
    'uuid',
    'trusted',
    'encryptedPassword',
    'showChanges',
    'ip',
    'addonPassword',
  ]);

  if ((obj1 == null) && (obj2 == null)) return diffs;

  // Treat empty objects/arrays as equal to null/undefined to avoid ghost diffs
  if (isEmptyValue(obj1) && isEmptyValue(obj2)) return diffs;

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1 === obj2) return [];
    
    try {
      if (JSON.stringify(obj1) === JSON.stringify(obj2)) return [];
    } catch(e) {
      console.warn('Fast array comparison failed:', e);
    }

    const lastPath = path.length > 0 ? path[path.length - 1] : '';
    const isAddons = lastPath === 'addons';    const isPresets = lastPath === 'presets';
    const isRegexPatterns = lastPath && (lastPath.endsWith('RegexPatterns') || lastPath === 'regexPatterns');
    const isStreamExpressions = lastPath && (lastPath.endsWith('StreamExpressions') || lastPath === 'streamExpressions');
    const isMergedCatalogs = lastPath === 'mergedCatalogs';
    const isProxiedList = lastPath === 'proxiedAddons' || lastPath === 'proxiedServices';
    
    const isPrimitiveList = lastPath && (
        lastPath.endsWith('Keywords') || 
        lastPath.endsWith('Resolutions') ||
        lastPath.endsWith('Qualities') ||
        lastPath.endsWith('Encodes') ||
        lastPath.endsWith('Tags') ||
        lastPath.endsWith('Languages') ||
        lastPath.endsWith('StreamTypes') ||
        lastPath.endsWith('Sources') ||
        lastPath.endsWith('Types')
    );

    if (isAddons) {
      return calculateKeyedArrayDiff(obj1, obj2, 'instanceId', path);
    } 
    else if (isMergedCatalogs) {
      return calculateKeyedArrayDiff(obj1, obj2, 'id', path);
    }
    else if (isRegexPatterns) {
      return calculateKeyedArrayDiff(obj1, obj2, (item) => item.pattern || item.name, path);
    }
    else if (isStreamExpressions || isPrimitiveList || isProxiedList) {
      return calculatePrimitiveArrayDiff(obj1, obj2, path);
    }

    const getKey = (item: any) => {
        if (!isObject(item)) {
             return String(item);
        }
        if (item.instanceId) return item.instanceId;
        if (item.id) return item.id;
        if (item.name) return item.name;
        if (item.key) return item.key;
        if (item.pattern) return item.pattern;
        if (Array.isArray(item.addons)) {
            try {
                return `group:${JSON.stringify(item.addons)}`;
            } catch {
                return null;
            }
        }
        return null;
    };

    const keys1 = obj1.map(getKey);
    const keys2 = obj2.map(getKey);

    const canKey =
      keys1.every(k => k !== null) &&
      keys2.every(k => k !== null) &&
      new Set(keys1).size === obj1.length &&
      new Set(keys2).size === obj2.length;

    if (canKey && !isAddons) {
        const oldMap = new Map();
        const oldOrder: any[] = [];
        obj1.forEach((item: any) => {
            const key = getKey(item);
            oldMap.set(key, item);
            oldOrder.push(key);
        });

        const newMap = new Map();
        const newOrder: any[] = [];
        obj2.forEach((item: any) => {
            const key = getKey(item);
            newMap.set(key, item);
            newOrder.push(key);
        });

        const getLabel = (key: any) => {
            const item = newMap.get(key) || oldMap.get(key);
            if (item?.addons && Array.isArray(item.addons)) {
                const firstAddon = item.addons[0] || '';
                const count = item.addons.length;
                const summary = firstAddon ? ` (${firstAddon}${count > 1 ? ` +${count - 1}` : ''})` : '';
                return `Group: ${item.condition || 'true'}${summary}`;
            }
            return item?.name || item?.options?.name || item?.instanceId || item?.id || key; 
        };

        oldMap.forEach((val, key) => {
            if (!newMap.has(key)) {
                 const originalIndex = obj1.findIndex((i: any) => getKey(i) === key);
                 diffs.push({
                     path: [...path, `[${originalIndex}]`], 
                     type: 'REMOVE',
                     oldValue: isPresets ? `Deleted: ${getLabel(key)}` : val
                 });
            }
        });

        newMap.forEach((val, key) => {
             const newIndex = obj2.findIndex((i: any) => getKey(i) === key);
             if (!oldMap.has(key)) {
                 diffs.push({
                     path: [...path, `[${newIndex}]`],
                     type: 'ADD',
                     newValue: val
                 });
             } else {
                 const oldVal = oldMap.get(key);
                 diffs.push(...getObjectDiff(oldVal, val, [...path, `[${newIndex}]`]));
             }
        });

        const intersectionOld = oldOrder.filter(key => newOrder.includes(key));
        const intersectionNew = newOrder.filter(key => oldOrder.includes(key));

        const isOrderChanged = intersectionOld.length !== intersectionNew.length || 
                              intersectionOld.some((key, i) => key !== intersectionNew[i]);
        
        if (isOrderChanged) {
              diffs.push({
                  path: [...path],
                  type: 'CHANGE',
                  oldValue: oldOrder.map(getLabel),
                  newValue: newOrder.map(getLabel)
              });
        }
        
        return diffs;
    }

    const len = Math.max(obj1.length, obj2.length);

    for (let i = 0; i < len; i++) {
        if (i < obj1.length && i < obj2.length) {
            diffs.push(...getObjectDiff(obj1[i], obj2[i], [...path, `[${i}]`]));
        }
        else if (i >= obj1.length) {
            diffs.push({
                path: [...path, `[${i}]`],
                type: 'ADD',
                newValue: obj2[i]
            });
        }
        else if (i >= obj2.length) {
             diffs.push({
                path: [...path, `[${i}]`],
                type: 'REMOVE',
                oldValue: obj1[i]
            });
        }
    }
    return diffs;
  }

  if (!isObject(obj1) || !isObject(obj2)) {
    if (obj1 === obj2) return diffs;
    
    try {
        if (JSON.stringify(obj1) === JSON.stringify(obj2)) return diffs;
    } catch {
    }
    
    return [
      {
        path,
        type: 'CHANGE',
        oldValue: obj1,
        newValue: obj2,
      },
    ];
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  for (const key of keys1) {
    if (ignoredKeys.has(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(obj2, key)) {
       if (obj1[key] == null || isEmptyValue(obj1[key])) continue;
      diffs.push({
        path: [...path, key],
        type: 'REMOVE',
        oldValue: obj1[key],
      });
    } else {
      diffs.push(...getObjectDiff(obj1[key], obj2[key], [...path, key]));
    }
  }

  for (const key of keys2) {
    if (ignoredKeys.has(key)) continue;
    
    if (!Object.prototype.hasOwnProperty.call(obj1, key)) {
      if (obj2[key] == null || isEmptyValue(obj2[key])) continue;
      
      diffs.push({
        path: [...path, key],
        type: 'ADD',
        newValue: obj2[key],
      });
    }
  }

  return diffs;
}

export function formatValue(value: any): string {
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[Circular Reference]';
    }
  }
  return String(value);
}

function calculateKeyedArrayDiff(
  arr1: any[],
  arr2: any[],
  key: string | ((item: any) => string),
  path: string[]
): DiffItem[] {
    const diffs: DiffItem[] = [];
    
    const getKey = (item: any) => {
      if (typeof key === 'function') return key(item);
      return item[key];
    };

    const oldMap = new Map();
    const oldOrder: any[] = [];
    arr1.forEach((item: any) => {
        const k = getKey(item);
        if (k) {
            oldMap.set(k, item);
            oldOrder.push(k);
        }
    });

    const newMap = new Map();
    const newOrder: any[] = [];
    arr2.forEach((item: any) => {
        const k = getKey(item);
        if (k) {
            newMap.set(k, item);
            newOrder.push(k);
        }
    });

    oldMap.forEach((val, k) => {
        if (!newMap.has(k)) {
            const originalIndex = arr1.findIndex((i: any) => getKey(i) === k);
            diffs.push({
                path: [...path, `[${originalIndex}]`],
                type: 'REMOVE',
                oldValue: val
            });
        }
    });

    newMap.forEach((val, k) => {
        const newIndex = arr2.findIndex((i: any) => getKey(i) === k);
        if (!oldMap.has(k)) {
            diffs.push({
                path: [...path, `[${newIndex}]`],
                type: 'ADD',
                newValue: val
            });
        } else {
            const oldVal = oldMap.get(k);
            diffs.push(...getObjectDiff(oldVal, val, [...path, `[${newIndex}]`]));
        }
    });

    // Check for reordering
    const intersectionOld = oldOrder.filter(k => newOrder.includes(k));
    const intersectionNew = newOrder.filter(k => oldOrder.includes(k));

    const isOrderChanged = intersectionOld.length !== intersectionNew.length || 
                          intersectionOld.some((k, i) => k !== intersectionNew[i]);

    if (isOrderChanged) {
        const getLabel = (k: any) => {
             const item = newMap.get(k) || oldMap.get(k);
             if (item?.name) return item.name;
             if (item?.pattern) return item.pattern;
             if (item?.instanceId) return item.instanceId;
             return k;
        };

        diffs.push({
            path: [...path],
            type: 'CHANGE',
            oldValue: oldOrder.map(getLabel),
            newValue: newOrder.map(getLabel)
        });
    }

    return diffs;
}

function calculatePrimitiveArrayDiff(
  arr1: any[],
  arr2: any[],
  path: string[]
): DiffItem[] {
  const diffs: DiffItem[] = [];
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  
  arr1.forEach((item, index) => {
      if (!set2.has(item)) {
          diffs.push({
            path: [...path, `[${index}]`],
            oldValue: item,
            newValue: undefined,
            type: 'REMOVE'
          });
      }
  });

  arr2.forEach((item, index) => {
      if (!set1.has(item)) {
          diffs.push({
            path: [...path, `[${index}]`],
            oldValue: undefined,
            newValue: item,
            type: 'ADD'
          });
      }
  });

  if (diffs.length === 0 && JSON.stringify(arr1) !== JSON.stringify(arr2)) {
       diffs.push({
          path,
          type: 'CHANGE',
          oldValue: arr1,
          newValue: arr2
       });
  }

  return diffs; 
}

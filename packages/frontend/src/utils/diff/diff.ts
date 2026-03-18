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
    const isPresets = lastPath === 'presets';
    const isCatalogModifications = lastPath === 'catalogModifications';

    const getKey = (item: any) => {
      if (!isObject(item)) {
        return String(item);
      }
      if (isCatalogModifications && item.id && item.type) return `${item.id}_${item.type}`;
      if (item.instanceId) return item.instanceId;
      if (item.id) return item.id;
      if (item.pattern) return item.pattern;
      if (item.condition && Array.isArray(item.addons)) {
        try {
          return `grouping:${item.condition}:${JSON.stringify(item.addons)}`;
        } catch {
          return item.condition;
        }
      }
      if (item.condition) return item.condition;
      if (item.expression) return item.expression;
      if (Array.isArray(item.addons)) {
        try {
          return `addons:${JSON.stringify(item.addons)}`;
        } catch {
          return null;
        }
      }
      if (item.key) return item.key;
      if (item.name) return item.name;
      return null;
    };

    const keys1 = obj1.map(getKey);
    const keys2 = obj2.map(getKey);

    const canKey =
      keys1.every(k => k !== null) &&
      keys2.every(k => k !== null) &&
      new Set(keys1).size === obj1.length &&
      new Set(keys2).size === obj2.length;

    if (canKey) {
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
        if (item?.expression && item?.score !== undefined) {
          return `${item.expression} (Score: ${item.score})`;
        }
        if (item?.addons && Array.isArray(item.addons)) {
          const firstAddon = item.addons[0] || '';
          const count = item.addons.length;
          const summary = firstAddon ? ` (${firstAddon}${count > 1 ? ` +${count - 1}` : ''})` : '';
          return `Group: ${item.condition || 'true'}${summary}`;
        }
        if (item?.name) {
          if (isCatalogModifications && item.type) {
             return `${item.name} (${item.type})`;
          }
          return item.name;
        }
        return item?.options?.name || item?.instanceId || item?.id || key; 
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

    let i = 0;
    let j = 0;
    while (i < obj1.length || j < obj2.length) {
      if (i >= obj1.length) {
        diffs.push({
          path: [...path, `[${j}]`],
          type: 'ADD',
          newValue: obj2[j],
        });
        j++;
        continue;
      }
      if (j >= obj2.length) {
        diffs.push({
          path: [...path, `[${i}]`],
          type: 'REMOVE',
          oldValue: obj1[i],
        });
        i++;
        continue;
      }

      const diff = getObjectDiff(obj1[i], obj2[j], [...path, `[${j}]`]);
      if (diff.length === 0) {
        i++;
        j++;
        continue;
      }

      let isDeletion = false;
      if (i + 1 < obj1.length) {
        if (getObjectDiff(obj1[i + 1], obj2[j], []).length === 0) {
          isDeletion = true;
        }
      }

      let isInsertion = false;
      if (j + 1 < obj2.length) {
        if (getObjectDiff(obj1[i], obj2[j + 1], []).length === 0) {
          isInsertion = true;
        }
      }

      if (isDeletion && !isInsertion) {
        diffs.push({
          path: [...path, `[${i}]`],
          type: 'REMOVE',
          oldValue: obj1[i],
        });
        i++;
      } else if (isInsertion && !isDeletion) {
        diffs.push({
          path: [...path, `[${j}]`],
          type: 'ADD',
          newValue: obj2[j],
        });
        j++;
      } else {
        diffs.push(...diff);
        i++;
        j++;
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


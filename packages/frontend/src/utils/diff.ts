export interface DiffItem {
  path: string[];
  type: 'CHANGE' | 'ADD' | 'REMOVE';
  oldValue?: any;
  newValue?: any;
}

function isObject(val: any) {
  return val != null && typeof val === 'object' && !Array.isArray(val);
}

export function getObjectDiff(
  obj1: any,
  obj2: any,
  path: string[] = []
): DiffItem[] {
  const diffs: DiffItem[] = [];

  const ignoredKeys = new Set(['uuid', 'trusted', 'encryptedPassword']);

  if ((obj1 == null) && (obj2 == null)) return diffs;

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    const getKey = (item: any) => {
        if (!isObject(item)) {
             // Avoid noisy diffs by defaulting to index for non-objects
             return null;
        }
        if (item.instanceId) return item.instanceId;
        if (item.id) return item.id;
        if (item.name) return item.name;
        if (item.key) return item.key;
        if (Array.isArray(item.addons) && typeof item.condition === 'string') {
            return `group:${[...item.addons].sort().join(',')}`;
        }
        // Fallback for keyless objects (like groups)
        return null;
    };

    const canKey =
      obj1.length > 0 &&
      obj2.length > 0 && 
      obj1.every(getKey) &&
      obj2.every(getKey) &&
      new Set(obj1.map(getKey)).size === obj1.length &&
      new Set(obj2.map(getKey)).size === obj2.length;

    if (canKey) {
        const oldMap = new Map();
        const oldOrder: any[] = [];
        obj1.forEach((item: any, index: number) => {
            const key = getKey(item);
            oldMap.set(key, item);
            oldOrder.push(key);
        });

        const newMap = new Map();
        const newOrder: any[] = [];
        obj2.forEach((item: any, index: number) => {
            const key = getKey(item);
            newMap.set(key, item);
            newOrder.push(key);
        });

        oldMap.forEach((val, key) => {
            if (!newMap.has(key)) {
                 const originalIndex = obj1.findIndex((i: any) => getKey(i) === key);
                 diffs.push({
                     path: [...path, `[${originalIndex}]`], 
                     type: 'REMOVE',
                     oldValue: val
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

        const len = Math.min(obj1.length, obj2.length);
        for (let i = 0; i < len; i++) {
          const key1 = getKey(obj1[i]);
          const key2 = getKey(obj2[i]);
          
          if (key1 !== key2) {
             const name1 = obj1[i].name || obj1[i].options?.name;
             const name2 = obj2[i].name || obj2[i].options?.name;

             if (name1 && name2 && name1 !== name2) {
                  diffs.push({
                     path: [...path, `[${i}]`, 'name'],
                     type: 'CHANGE',
                     oldValue: name1,
                     newValue: name2
                 });
             } else {
                 const identityFields = ['id', 'instanceId', 'key', 'condition'];
                 let foundIdentityChange = false;
                 
                 identityFields.forEach(field => {
                     const val1 = obj1[i][field];
                     const val2 = obj2[i][field];
                     if (val1 !== val2 && (val1 !== undefined || val2 !== undefined)) {
                         diffs.push({
                             path: [...path, `[${i}]`, field],
                             type: 'CHANGE',
                             oldValue: val1,
                             newValue: val2
                         });
                         foundIdentityChange = true;
                     }
                 });

                 if (!foundIdentityChange) {
                      diffs.push({
                         path: [...path, `[${i}]`],
                         type: 'CHANGE',
                         oldValue: obj1[i],
                         newValue: obj2[i]
                     });
                 }
             }
          }
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
       if (obj1[key] == null) continue;
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
      if (obj2[key] == null) continue;
      
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
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

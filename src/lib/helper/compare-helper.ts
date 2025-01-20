export const isObjectEqual = (obj1: any, obj2: any): boolean => {
  if (obj1.toString() === obj2.toString()) return true; // Check for reference equality
  if (
    typeof obj1 !== "object" ||
    typeof obj2 !== "object" ||
    obj1 == null ||
    obj2 == null
  ) {
    return false; // If not both objects or one is null
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false; // Check for key length equality

  for (const key of keys1) {
    if (!keys2.includes(key) || !isObjectEqual(obj1[key], obj2[key])) {
      return false; // Check for key existence and recursive equality
    }
  }

  return true; // All checks passed
};
